# CON — Concurrency & Consistency (mandatory package)

## Requirement (from challenge sheet)
Concurrent operations against a shared limited resource; integrity enforced by server/database. Verification: ≥ 20 concurrent requests against insufficient capacity; verify responses and persisted state; no over-allocation.

## Implementation (layers, see ADR 003)
1. Global in-process write mutex (`utils/mutex.js`) — all transactional writes FIFO, matching SQLite's single writer.
2. `BEGIN IMMEDIATE` transaction per bid/closing/transition — invariant re-evaluated against committed state inside the transaction:
   - auction `ACTIVE`, `now < endsAt` (server clock only),
   - `amountCents >= max(bid) + minIncrement` (or `startPrice` when no bids),
   - bidder ≠ seller.
3. DB-level `UNIQUE(auctionId, amountCents)` — same-price double acceptance is physically unpersistable.
4. Winner determination deterministic: `ORDER BY amountCents DESC, id ASC` at close; leader columns updated in the same transaction.

## Verification (executable evidence)
`backend/test/bidding.test.js`:
- **Scenario A — last-slot race**: 20 concurrent bids (20 distinct users) at the same price → exactly 1 × 201, 19 × 409 `BID_TOO_LOW` (with updated `currentMinimum` in details); persisted: exactly 1 bid row; auction leader = winning bid; loser errors identify the new minimum.
- **Scenario B — same-price race**: 20 concurrent identical bids above minimum → exactly 1 accepted; history holds no tied prices.
- Rejected bids never change the leader (asserted on `leaderId` after rejected attempts).
- Deadline invariant: bids after `endsAt` → 409 `BID_DEADLINE_PASSED`, zero rows persisted.
- Permission negatives: own-auction bid → 403; unauthenticated → 401; malformed amount → 422; unknown auction → 404.
- Under load: `load/bid-race.js` (k6, 20 VUs) — `race_violations = 0`, `server_errors_5xx = 0`, persisted history verified at teardown.

## Limitations
Queue is per-process; SQLite locks the whole file (per-auction parallel writes impossible here — by design, see ADR 003); `busy_timeout` bounds worst-case waits; Sequelize retry adds bounded re-attempts.