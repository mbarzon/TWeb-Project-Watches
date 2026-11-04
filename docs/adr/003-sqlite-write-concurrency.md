# ADR 003 — SQLite write concurrency for bid acceptance (CON package)

## Problem
Concurrent operations target a shared limited resource: the leading slot of an auction. Two bidders must never both "win" the same price slot; rejected bids must not change the leader; the outcome must be deterministic and persisted. With SQLite as the mandated database, how safe and how fast can bid acceptance be under 20+ concurrent writers?

## Alternatives
1. **Rely purely on `busy_timeout` + deferred transactions** — deferred reads upgrade to a write lock mid-transaction; SQLite detects the upgrade deadlock and returns busy immediately; Sequelize retries blindly, producing storms under load.
2. **`BEGIN IMMEDIATE` transactions alone** — the whole rule check (read max bid → validate increment → insert bid → update leader) is serialized by the file's write lock. Correct, but Sequelize opens a fresh connection per transaction; when 20+ connections race, `SQLITE_BUSY` waits interact badly with Sequelize's retry loop (measured: 100 s+ storms, 5xx responses at 200 VUs).
3. **Optimistic version checking (compare-and-swap on a version column)** — correct in Postgres, awkward in SQLite (still needs a write transaction to commit the CAS).
4. **Global in-process write mutex + `BEGIN IMMEDIATE` + DB constraints** — one cooperative queue for all state-changing transactions, FIFO by arrival, matching SQLite's single-writer model; `busy_timeout` stays as a backstop; `UNIQUE(auctionId, amountCents)` remains the physical guarantee against same-price double acceptance even under a future regression.

## Decision
Option 4, layered:
1. Application-level global write mutex (`utils/mutex.js`, `dbWriteMutex`) — all transactional writes queue; cross-auction operations serialize (SQLite admits one writer per file anyway); fairness is FIFO.
2. `BEGIN IMMEDIATE` transaction — the invariant (amount ≥ max bid + minIncrement, deadline not passed, auction ACTIVE) is re-evaluated **inside** the transaction against committed state — never stale.
3. Database-level `UNIQUE(auctionId, amountCents)` — even a code path that forgets the re-check cannot persist a duplicate price (integrity at the DB boundary, per the general spec).
4. Pragmas: `journal_mode = WAL` (readers during writes), `busy_timeout = 5000` **per connection** (critically: Sequelize opens a new connection for each transaction, so pragmas are re-applied on every transaction connection — see `src/db/sequelize.js`).

## Experiment / tests (measured)
- **Correctness under contention**: `test/bidding.test.js` fires **20 concurrent bids from 20 users** at the last available price slot → exactly 1 × 201, 19 × 409 `BID_TOO_LOW`, leader = winner in the persisted row; a same-price scenario yields one accepted bid; rejected bids never change `leaderId`; bids after `endsAt` → 409 `BID_DEADLINE_PASSED`, zero persisted rows.
- **Performance under load (k6, 3 levels, 200 VUs peak)**:
  - per-auction mutex (variant 2): 62.8 req/s, p95 ≈ 6 s, SQLITE_BUSY storms in server logs (29k log lines), 53 bid errors outside the accepted/rejected envelope.
  - global write mutex (decided): **398.8 req/s, p95 166 ms, 0 5xx** (`load/results/mixed-final.txt`).
- **CON package verification (spec §5)**: 20 concurrent requests against insufficient capacity (one price slot); responses and persisted state verified (exactly one accepted bid per round; history monotonic by price). Also verified under k6 (`load/bid-race.js`, `race_violations = 0`).

## Limitations
- The write mutex is per-process: scaling out to several nodes requires moving the queue to the DB (or Postgres row locks) — out of scope for the mandated stack.
- Global FIFO queues writes across ALL auctions; a long transaction delays writes of unrelated auctions. Measured cost at 200 VUs: p95 166 ms — acceptable against the service objective; per-auction batching is the next optimization if it regresses.
- `busy_timeout` is the last-resort backstop; its 5 s bound plus Sequelize's built-in retry (max 5) bound worst-case request latency.