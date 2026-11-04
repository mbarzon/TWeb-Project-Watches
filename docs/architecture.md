# Architecture

## Overview

Layered monolith: `routes (HTTP) → controllers → services (business rules) → models (Sequelize/SQLite)`, with two side modules: `realtime/` (event bus + SSE hub) and `jobs/` (closing runner). One shared DB context (`db/context.js`) injectable for tests.

```
Client ──HTTP──> Express app
                  ├── routes/            validation (validateBody/Query), auth middleware
                  ├── controllers/       thin; delegate to services
                  ├── services/          business rules: auction engine, bid rules, FX, tokens
                  ├── models/            Sequelize models + associations + constraints
                  ├── realtime/          in-process event bus + SSE hub
                  └── jobs/              closing runner (interval sweep)
```

- **Auth**: JWT (Bearer) with a 15-minute expiry; roles `USER`/`ADMIN` reloaded from the DB per request (role revocation immediate). Passwords hashed with bcrypt (cost 10). Object-level authorization checks live in services (`assertCanModify`, seller checks).
- **Validation**: dependency-free `validateBody/validateQuery` middleware; every violation returns 422 with per-field `details[]`; unknown/unexpected errors return 500 through one middleware; error envelope `{ error: { code, message, details? } }`.
- **Money**: stored as integer cents in SQLite INTEGER; decoded to decimal on the API boundary.

## Realtime (RTM package)

`realtime/eventBus.js` — in-process EventEmitter; every business event is published post-commit with `channel` + `busSeq` + application `seq`. `realtime/sseHub.js` — one bus subscription; fans out per client membership: per-auction, per-user (owner-only), or global. The hub records events into a bounded ring buffer; SSE `id` = buffer sequence; clients reconnect with `Last-Event-ID` and receive the replayed backlog before a `connected` event marking the new cursor. Heartbeats every 15s keep intermediaries alive.

See `docs/adr/002-sse-vs-websockets.md`.

## Concurrency model (CON package)

Every state-changing read-modify-write (bid acceptance, closing, transitions) runs inside a `BEGIN IMMEDIATE` transaction. SQLite is single-writer per file, and Sequelize's sqlite dialect opens a **new connection per transaction**; uncontrolled concurrent transactions degrade into `SQLITE_BUSY` storms. Therefore transactional writes are funneled through one in-process **global write mutex** (FIFO by arrival), matching the engine's model exactly. `busy_timeout` (5s, applied to every transaction connection) remains as a backstop, plus a DB-level `UNIQUE(auctionId, amountCents)` index that makes same-price double-acceptance physically unpersistable.

See `docs/adr/003-sqlite-write-concurrency.md`.

## Auction lifecycle (multistate workflow)

Explicit state machine in `services/auctionStateMachine.js`: `TRANSITIONS` table with permitted actors (`SELLER`, `ADMIN`, `SYSTEM`) and preconditions. `DRAFT → SCHEDULED → ACTIVE → ENDED`, `DRAFT/SCHEDULED/ACTIVE → CANCELLED`. The closing runner transitions `ACTIVE → ENDED` as `SYSTEM` only after `endsAt`; bids are possible only on `ACTIVE` auctions and only before the deadline (server clock). Non-listed transitions are illegal by construction; repeated submissions and unauthorized actors are rejected with 409/403.

## External integration

`services/fx.service.js` — Frankfurter (ECB reference rates, keyless): timeout + bounded retries with backoff, in-memory TTL cache with stale-while-error fallback; `/api/auctions/:id/price` exposes the converted leading price. `node scripts/smoke-fx.js` performs the single live verification; automated tests use an injected stub fetch.

## Capacity-relevant decisions

- Global write mutex: all writes serialize; reads stay concurrent (WAL).
- Ring buffer replay for SSE: O(buffered) per reconnect.
- Closer sweeps every 1s in batches of ≤50 auctions.
- Measured baseline: 398 req/s, p95 166 ms at 200 VUs (see `docs/capacity.md`).