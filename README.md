# Real-Time Auction Platform — Backend

Course project for **Tehnologii Web** (2026–2027), tema 9: simulated live auctions with concurrent bids, deadlines and real-time updates. Mandatory architectural packages: **RTM** (Real-Time Collaboration via SSE) and **CON** (Concurrency & Consistency).

## Stack

JavaScript (ESM, no TypeScript) · Node.js LTS · Express 5 · Sequelize 6 + SQLite (WAL) · `node:test` + `supertest` + `c8` · k6 for load tests.

## Quick start

```bash
cd backend
npm install            # install deps
npm run seed -- --force # populate synthetic data (40 users, ~120 items, active auctions)
npm start              # serve on :3000
```

Demo accounts (see `.env.example` for configuration):

- Admin: `admin@auction.dev` / `Password123!`
- Users: `user0..user37@auction.dev` / `Password123!`

A demo auction closing in ~5 seconds is seeded — open an SSE stream to watch it close.

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Items | `GET/POST /api/items`, `GET/PATCH/DELETE /api/items/:id` (filter/sort/page) |
| Auctions | `GET/POST /api/auctions`, `GET /api/auctions/:id`, `GET /api/auctions/:id/stats`, `GET /api/auctions/:id/bids`, `POST /api/auctions/:id/transitions` |
| Bids | `POST /api/auctions/:id/bids` |
| Currency | `GET /api/auctions/:id/price?currency=USD` (Frankfurter) |
| Realtime | `GET /api/auctions/:id/events`, `GET /api/users/:id/events`, `GET /api/global/events` (SSE, Bearer auth, `Last-Event-ID` replay) |

Consistent error envelope: `{ "error": { "code", "message", "details?" } }`.

## Tests, coverage, load

```bash
npm test                       # 76 unit/integration/E2E/RTM/CON tests
npm run coverage               # c8 report (95% statements / 86% branches)
BASE_URL=http://localhost:3000 k6 run load/mixed-workload.js   # 3-level load test
BASE_URL=http://localhost:3000 ROUNDS=8 k6 run load/bid-race.js # CON invariant under load
node scripts/smoke-fx.js       # one live call against the real Frankfurter API
```

## Repository layout

- `backend/src` — application code (routes → controllers → services → models)
- `backend/test` — unit, integration, CON, RTM, E2E tests
- `backend/load` — k6 scripts + measured results (`load/results/`)
- `backend/scripts` — seed + external-service smoke
- `docs/` — requirements, architecture, ADRs, testing, capacity, package docs

## Key documented invariants

1. Bids respect the server-side minimum (`max(bid) + minIncrement`, or start price) and the deadline (server clock); rejected bids never change the leader.
2. Winner is deterministic: highest accepted bid; per-auction price uniqueness is enforced at the database level.
3. All auction state transitions pass through an explicit state machine with actor + precondition rules.

See `docs/architecture.md` and the ADRs under `docs/adr/`.