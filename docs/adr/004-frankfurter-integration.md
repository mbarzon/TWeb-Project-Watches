# ADR 004 — Frankfurter integration (external API, resilience contract)

## Problem
Spec requirement 7: one meaningful external service integration with a clear contract. The auction domain has no payments, so the natural fit is currency conversion of the leading price (rates are public data; the service is free and keyless).

## Alternatives
1. **Simulated local email/notification service** — allowed by the spec but adds no real integration surface.
2. **Free crypto rates API** — noisy, often rate-limited harder.
3. **Frankfurter (api.frankfurter.dev)** — ECB reference rates, no key, stable schema, free.

## Decision
Frankfurter. Contract:

- `GET {FX_BASE_URL}/latest?base=EUR&symbols=CODE` → `{ base, rates: { CODE } }`.
- Per-attempt timeout `FX_TIMEOUT_MS=2000` (AbortSignal), bounded retries `FX_RETRIES=2` with exponential backoff + jitter for network errors/429/5xx; 4xx maps to a business error without retry.
- In-memory TTL cache (`FX_CACHE_TTL_MS=60000`): repeated conversions within TTL reuse the cached rate (idempotent/dedup, no upstream call).
- **Stale-while-error**: if every attempt fails, the last known cached rate is served with `stale: true` + `source: 'cache'`; a total outage with nothing cached yields `503 EXTERNAL_UNAVAILABLE`.
- Rate records carry `fetchedAt` provenance, surfaced in the API response.

All HTTP interaction is behind an injectable `fetchImpl` (`configureFx`), so fault scenarios (timeout, 429, outage, bad payload, recovery) are **deterministic and hermetic** in `test/fx.test.js`; the live contract is verified manually once via `node scripts/smoke-fx.js` (EUR/USD printed with timestamp).

## Experiment / tests
`test/fx.test.js`: cache dedup (1 upstream call), bounded retries (3 calls for 2 retries), stale fallback on outage, non-retryable 404 → 502 mapping, invalid payload → 422, 429 → retry then success. `test/fxRoutes.test.js`: route converts the leading bid (not start price), degrades to stale, validates `currency` (422).

## Limitations
- ECB reference rates update daily — acceptable for display, not for settlement.
- Cache is per-process; a cluster variant needs shared cache, out of scope.