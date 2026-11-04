import { env } from '../config/env.js';

/**
 * External integration: Frankfurter (free, keyless ECB reference rates).
 *
 * Integration contract:
 *  - GET {base}/latest?base=EUR&symbols=CODE -> { base, rates: { CODE: number } }
 *  - Timeout per attempt: env.fxTimeoutMs (AbortSignal).
 *  - Bounded retries: env.fxRetries with exp backoff (250ms * 2^n + jitter).
 *  - In-memory cache (TTL env.fxCacheTtlMs). On upstream failure the LAST
 *    known rate is served marked `stale: true`; a total failure with no cache
 *    yields 503 EXTERNAL_UNAVAILABLE.
 *  - Idempotency/dedup: repeated conversions within the TTL reuse the same
 *    cached rate (no duplicate upstream calls).
 */
const state = {
  cache: new Map(), // currency -> { rate, fetchedAt }
  fetchImpl: null,
  cacheTtlMs: env.fxCacheTtlMs
};

export function configureFx({ fetchImpl = globalThis.fetch, cacheTtlMs = env.fxCacheTtlMs } = {}) {
  state.fetchImpl = fetchImpl;
  state.cacheTtlMs = cacheTtlMs;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.5);

export async function fetchRate(currency, { retries = env.fxRetries, timeoutMs = env.fxTimeoutMs } = {}) {
  const code = String(currency).toUpperCase().trim();
  const impl = state.fetchImpl ?? globalThis.fetch;

  // Fresh cached rate: served WITHOUT contacting upstream (idempotent dedup).
  const fresh = state.cache.get(code);
  if (fresh && Date.now() - Date.parse(fresh.fetchedAt) < state.cacheTtlMs) {
    return { ...fresh, source: 'cache', stale: false };
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(jitter(250 * 2 ** (attempt - 1)));
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await impl(`${env.fxBaseUrl}/latest?base=EUR&symbols=${encodeURIComponent(code)}`, {
        signal,
        headers: { Accept: 'application/json' }
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`upstream ${res.status}`);
        continue; // retryable
      }
      if (!res.ok) {
        const err = new Error(`upstream ${res.status}`);
        err.status = 502;
        throw err; // non-retryable (bad request etc.)
      }
      const body = await res.json();
      const rate = body?.rates?.[code];
      if (typeof rate !== 'number' || !Number.isFinite(rate)) {
        const err = new Error('INVALID_CURRENCY');
        err.status = 422;
        throw err;
      }
      const record = { rate, fetchedAt: new Date().toISOString(), source: 'upstream' };
      state.cache.set(code, record);
      return { ...record, stale: false };
    } catch (err) {
      lastError = err;
      if (err.status) throw err; // mapped business error: no retry
      // timeout / network error / 5xx / 429 -> retry
    }
  }

  const cached = state.cache.get(code);
  if (cached) {
    return { ...cached, source: 'cache', stale: true };
  }
  const err = new Error(`external rate service unreachable for ${code}: ${lastError?.message ?? 'unknown'}`);
  err.status = 503;
  err.code = 'EXTERNAL_UNAVAILABLE';
  throw err;
}

export async function convert({ amountCents, currency }) {
  const rate = await fetchRate(currency);
  return {
    amountCents,
    currency: String(currency).toUpperCase().trim(),
    rate: rate.rate,
    convertedAmount: Number(((amountCents / 100) * rate.rate).toFixed(2)),
    fetchedAt: rate.fetchedAt,
    stale: rate.stale,
    source: rate.source
  };
}

export function cacheState() {
  return Object.fromEntries(state.cache);
}

export function resetFxCache() {
  state.cache.clear();
}