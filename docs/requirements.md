# Requirements — Real-Time Auction Platform

## Actors & roles
| Actor | Capabilities |
|---|---|
| Guest | Browse/list items and auctions, view bid history |
| USER | All of the above + register/login, manage own items, open auctions on own items, transition own auctions, place bids on others' auctions, SSE streams |
| ADMIN | Object-level override (edit/delete any item), watch any user event channel |
| SYSTEM | Internal closing runner: `ACTIVE → ENDED` transitions after deadline only |

## Entities & integrity
- **User**(id, email unique, passwordHash, role) — bcrypt+JWT, never stores plaintext.
- **Item**(id, title, description, condition, sellerId → User) — one owner.
- **Auction**(id, itemId → Item **unique** (one auction per item), sellerId → User, status, startPriceCents, minIncrementCents, startsAt, endsAt, leaderId, leaderBidId, closedAt).
- **Bid**(id, auctionId → Auction, bidderId → User, amountCents > 0, createdAt) — **UNIQUE(auctionId, amountCents)**: two accepted bids can never share a price in one auction.

## State machine (multistate workflow)
`DRAFT → SCHEDULED → ACTIVE → ENDED` (+ `DRAFT|SCHEDULED|ACTIVE → CANCELLED`, terminal `ENDED/CANCELLED`).
Actors: SELLER (own auction) / ADMIN; SYSTEM only `ACTIVE → ENDED` after `endsAt`. Preconditions: valid date window, start/stop window reached, no bids on cancel (`AUCTION_HAS_BIDS`). All enforced by the explicit transition table.

## Workflows (with acceptance criteria)

### W1 — Seller opens an auction
1. Register/login → create item → create auction (DRAFT) → schedule (SCHEDULED with startsAt/endsAt) → activate (ACTIVE).
- **Accepts**: status follows only legal transitions; invalid dates → 409 `PRECONDITION_FAILED`; skip DRAFT→ACTIVE → 409 `INVALID_TRANSITION`; stranger scheduling someone else's auction → 403.

### W2 — Bidder competes
1. Register/login → browse `ACTIVE` auctions (filter/sort/page) → inspect stats (`minimumBidCents`) → bid.
- **Accepts**: bid ≥ `max(bid)+minIncrement` (else 409 `BID_TOO_LOW` with the current minimum); same-price race → exactly one 201; leader unchanged by rejected bids; deadline passed → 409 `BID_DEADLINE_PASSED`; own auction → 403.

### W3 — Auction completes
1. Closing runner sweeps overdue auctions → `ENDED` with deterministic winner (max bid) or no winner → bid history immutable.
- **Accepts**: no bids after end (`AUCTION_NOT_ACTIVE`); winner persisted on auction + `auction.closed` / `auction.won` events; not-due auctions are never closed early.

## Critical invariant (server-enforced)
Every accepted bid respects the server-side minimum and deadline; rejected bids never change the leader; one accepted bid per price step (DB-level `UNIQUE(auctionId, amountCents)`); final result deterministic (max bid, tie impossible — earliest id would win).

## Validation & errors
All request bodies/queries validated server-side (no client trust); consistent envelope `{ error: { code, message, details? } }`; loading/error states on the SPA side consume `details[]` for field messages.

## External service
Frankfurter (currency rates) for price display in other currencies — resilient contract (timeout/retries/TTL cache/stale fallback) per ADR 004.

## Workload & testing obligations
3-level load test (20/100/200 VUs), CON 20-bid races, RTM 20-client streams, coverage ≥ 70% stmt / 60% branch — see `docs/testing.md` and `docs/capacity.md`.