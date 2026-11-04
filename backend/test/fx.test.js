import { test } from 'node:test';
import assert from 'node:assert';
import { fetchRate, convert, configureFx, resetFxCache } from '../src/services/fx.service.js';

const usdBody = { base: 'EUR', rates: { USD: 1.0852 } };

function stubFetch(behaviors) {
  // behaviors[0..n]: factory per attempt; last one repeats on retries
  let i = 0;
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const behavior = behaviors[Math.min(i, behaviors.length - 1)];
    i++;
    return behavior();
  };
  return { impl, calls };
}

test('fx: success caches the rate; repeated conversions dedup upstream calls', async () => {
  resetFxCache();
  const { impl, calls } = stubFetch([() => ({ ok: true, status: 200, json: async () => usdBody })]);
  configureFx({ fetchImpl: impl });

  const first = await fetchRate('USD');
  assert.equal(first.rate, 1.0852);
  assert.equal(first.stale, false);

  const second = await fetchRate('USD');
  assert.equal(second.rate, 1.0852);
  assert.equal(calls.length, 1, 'no duplicate upstream calls within cache TTL');
});

test('fx: persistent timeouts exhaust bounded retries, then 503 EXTERNAL_UNAVAILABLE when no cache', async () => {
  resetFxCache();
  const { impl, calls } = stubFetch([
    () => {
      throw new Error('TimeoutError');
    }
  ]);
  configureFx({ fetchImpl: impl });

  const start = Date.now();
  await assert.rejects(
    () => fetchRate('GBP', { retries: 2, timeoutMs: 1 }),
    (err) => err.status === 503 && err.code === 'EXTERNAL_UNAVAILABLE'
  );
  assert.equal(calls.length, 3, '1 initial + 2 bounded retries');
  assert.ok(Date.now() - start >= 250, 'attempts back off');
});

test('fx: after a successful fetch, upstream outage serves the STALE cached rate', async () => {
  resetFxCache();
  const okThenFail = stubFetch([
    () => ({ ok: true, status: 200, json: async () => usdBody }),
    () => {
      throw new Error('upstream down');
    }
  ]);
  configureFx({ fetchImpl: okThenFail.impl, cacheTtlMs: 1 }); // entry expires instantly

  await fetchRate('USD'); // prime cache (already expired due to TTL=1ms)
  await new Promise((r) => setTimeout(r, 3));
  okThenFail.calls.length = 0; // reset call counter

  const stale = await fetchRate('USD', { retries: 0 });
  assert.equal(stale.rate, 1.0852, 'stale rate still usable');
  assert.equal(stale.stale, true, 'marked stale');
  assert.equal(stale.source, 'cache');
});

test('fx: hard upstream failure (4xx) is non-retryable and mapped', async () => {
  resetFxCache();
  const { impl, calls } = stubFetch([() => ({ ok: false, status: 404, json: async () => ({}) })]);
  configureFx({ fetchImpl: impl });

  await assert.rejects(
    () => fetchRate('USD'),
    (err) => err.status === 502
  );
  assert.equal(calls.length, 1, 'non-retryable stops immediately');
});

test('fx: invalid upstream payload maps to INVALID_CURRENCY', async () => {
  resetFxCache();
  const { impl } = stubFetch([
    () => ({ ok: true, status: 200, json: async () => ({ base: 'EUR', rates: {} }) })
  ]);
  configureFx({ fetchImpl: impl });

  await assert.rejects(
    () => fetchRate('ZZZ'),
    (err) => err.status === 422
  );
});

test('fx: rate-limit (429) responses trigger bounded retries', async () => {
  resetFxCache();
  const { impl, calls } = stubFetch([
    () => ({ ok: false, status: 429, json: async () => ({}) }),
    () => ({ ok: true, status: 200, json: async () => usdBody })
  ]);
  configureFx({ fetchImpl: impl });

  const rate = await fetchRate('USD', { retries: 2 });
  assert.equal(rate.rate, 1.0852);
  assert.equal(calls.length, 2, 'recovered after retry');
});

test('fx: convert returns converted amount with provenance', async () => {
  resetFxCache();
  const { impl, calls } = stubFetch([() => ({ ok: true, status: 200, json: async () => usdBody })]);
  configureFx({ fetchImpl: impl });

  const r = await convert({ amountCents: 15000, currency: 'USD' });
  assert.equal(r.convertedAmount, 162.78); // 150.00 * 1.0852
  assert.equal(r.currency, 'USD');
  assert.equal(r.stale, false);
  assert.equal(calls.length, 1);
});