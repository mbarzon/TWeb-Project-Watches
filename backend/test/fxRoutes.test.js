import { test, after } from 'node:test';
import assert from 'node:assert';
import { bootTestApp } from './helpers/testApp.js';
import { configureFx, resetFxCache } from '../src/services/fx.service.js';

const ctx = await bootTestApp();
after(() => ctx.teardown());

const { request, helpers, models } = ctx;

function stubFetch(behaviors, { cacheTtlMs } = {}) {
  let i = 0;
  const impl = async () => {
    const behavior = behaviors[Math.min(i++, behaviors.length - 1)];
    return behavior();
  };
  configureFx(cacheTtlMs ? { fetchImpl: impl, cacheTtlMs } : { fetchImpl: impl });
}

test('GET /auctions/:id/price converts the current leading price (upstream ok)', async () => {
  resetFxCache();
  stubFetch([() => ({ ok: true, status: 200, json: async () => ({ base: 'EUR', rates: { USD: 2 } }) })]);

  const seller = await helpers.user({ prefix: 'fx-seller' });
  const item = await models.Item.create({ title: 'FX camera', sellerId: seller.id });
  const auction = await models.Auction.create({
    itemId: item.id,
    sellerId: seller.id,
    startPriceCents: 2000,
    minIncrementCents: 100,
    status: 'ACTIVE',
    endsAt: new Date(Date.now() + 600_000)
  });
  const bidder = await helpers.user({ prefix: 'fx-bidder' });
  await models.Bid.create({ auctionId: auction.id, bidderId: bidder.id, amountCents: 5000 });

  const res = await request.get(`/api/auctions/${auction.id}/price?currency=USD`);
  assert.equal(res.status, 200);
  assert.equal(res.body.amountCents, 5000, 'uses leading bid, not start price');
  assert.equal(res.body.convertedAmount, 100);
  assert.equal(res.body.stale, false);
});

test('GET /auctions/:id/price degrades to stale rate when upstream is down', async () => {
  resetFxCache();
  stubFetch([() => ({ ok: true, status: 200, json: async () => ({ base: 'EUR', rates: { USD: 2 } }) })], { cacheTtlMs: 1 });
  await request.get('/api/auctions/1/price?currency=USD'); // prime cache (rate 2)
  await new Promise((r) => setTimeout(r, 3));

  // upstream goes down; cache still holds the last known rate
  configureFx({
    fetchImpl: async () => {
      throw new Error('upstream down');
    },
    cacheTtlMs: 1
  });
  const res = await request.get('/api/auctions/1/price?currency=USD');
  assert.equal(res.status, 200);
  assert.equal(res.body.stale, true, 'staleness is explicit in the response');
  assert.equal(res.body.rate, 2, 'last known rate served');
  assert.equal(res.body.source, 'cache');
});

test('GET /auctions/:id/price responds 422 for an invalid currency', async () => {
  resetFxCache();
  const res = await request.get('/api/auctions/1/price?currency=DOLLAR');
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});