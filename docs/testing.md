# Testing strategy

## Layers

| Layer | Scope | Files |
|---|---|---|
| Unit (pure logic) | state machine rules, validators, mutex, rate/fault logic | `stateMachine.test.js`, `validators.test.js`, `fx.test.js` |
| Model/persistence | constraints, unique indexes, FK behavior on a temp-file SQLite | `models.test.js` |
| Integration (HTTP) | auth flows, items CRUD + authz, auctions + transitions, bids, SSE routes, FX route | `auth.test.js`, `items.test.js`, `auctions.test.js`, `bidding.test.js`, `closing.test.js`, `fxRoutes.test.js` |
| CON package scenarios | 20-bid races (last-slot + same-price), deadline invariant, own-auction prohibition | `bidding.test.js` |
| RTM package scenarios | 20 SSE clients live delivery, reconnect replay, channel privacy, seq/ordering | `realtime.test.js` |
| E2E workflow | register → item → auction → schedule/activate → bid race → close → deterministic winner → immutability | `e2e.test.js` |

## Isolation & hermeticity
- Every test file bootstraps its own **temp-file** SQLite DB (not `:memory:` — Sequelize's sqlite connection manager shares one connection for in-memory DBs, which breaks concurrent `BEGIN IMMEDIATE`; file storage matches production semantics). Helper: `test/helpers/testApp.js`.
- FX integration stubs `fetchImpl` — **no network in tests**; the live contract is verified once via `scripts/smoke-fx.js`.
- Deterministic PRNG in the seed script; closing runner injects `now` to avoid sleeps.

## Negative coverage
- Validation: malformed JSON, invalid email/short password, invalid sort/status/currency → 422/400 with per-field details.
- Authorization: stranger PATCH/DELETE on items (403), foreign auction transitions (403), cross-user SSE channel (403), seller-bids-own-auction (403), unauthenticated streams (401), token referencing deleted user (401).
- Business: bid below minimum (409 with `currentMinimum` detail), deadline passed (409), cancel-with-bids (409 `AUCTION_HAS_BIDS`), duplicate auction per item (409), duplicate email (409).

## Coverage (c8, `npm run coverage`)

- Statements: **95.07%**, Branches: **85.86%** (thresholds: 70/60) — `coverage/` HTML report.
- **Documented exclusions**: `src/index.js` (bootstrap: env assertions + listen; verified by every integration test end-to-end instead), `backend/scripts/*` and `load/*` (operational tooling, not shipped logic; smoke script output recorded).
- Known untested gaps and risk:
  - `errorHandler` generic 500 path is exercised only implicitly (SQLITE-related); risk: unforeseen error shapes leaking stack details — mitigated by the envelope + `console.error` audit path.
  - The SSE heartbeat branch (15 s timer) is not asserted directly (needs a 15 s+ test); risk: intermediaries closing idle streams — mitigated by documented heartbeat + client `retry: 2000`.
  - FX clock edge: TTL boundary exactly at expiry not asserted; risk negligible (cache is an optimization, never a correctness gate).

## Reproduction

```bash
cd backend
npm test            # all 76 tests, serial execution
npm run coverage    # c8 text + HTML, thresholds above are measured, not assumed
```