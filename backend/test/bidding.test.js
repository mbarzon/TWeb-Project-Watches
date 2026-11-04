import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { bootTestApp } from './helpers/testApp.js';

const ctx = await bootTestApp();
after(() => ctx.teardown());

const { request, helpers, models } = ctx;

/**
 * Builds an ACTIVE auction with N registered bidders, ready to bid.
 */
async function setupAuction({ bidders = 20, startPrice = '10.00', minIncrement = '5.00' } = {}) {
  const seller = await helpers.user({ prefix: 'seller' });
  const item = await models.Item.create({ title: 'Concurrency camera', sellerId: seller.id });
  const auction = await models.Auction.create({
    itemId: item.id,
    sellerId: seller.id,
    startPriceCents: Math.round(Number(startPrice) * 100),
    minIncrementCents: Math.round(Number(minIncrement) * 100),
    status: 'ACTIVE',
    endsAt: new Date(Date.now() + 600_000)
  });
  const users = [];
  for (let i = 0; i < bidders; i++) {
    users.push(await helpers.user({ prefix: `bidder${i}` }));
  }
  return { seller, item, auction, users };
}

const bidRequest = (user, auctionId, amount) =>
  request
    .post(`/api/auctions/${auctionId}/bids`)
    .set(helpers.bearer(user))
    .send({ amount });

test('CON scenario 1: 20 concurrent bids on one slot -> exactly one accepted, persisted state consistent', async () => {
  const { auction, users } = await setupAuction({ bidders: 20 });

  // All 20 fire at the same minimum price (startPrice); only 1 slot exists.
  const amount = '10.00';
  const responses = await Promise.all(users.map((u) => bidRequest(u, auction.id, amount)));

  const accepted = responses.filter((r) => r.status === 201);
  const rejected = responses.filter((r) => r.status === 409);

  assert.equal(accepted.length, 1, `expected exactly 1 accepted, got ${accepted.length}`);
  assert.equal(rejected.length, 19, 'exactly 19 rejections expected');
  rejected.forEach((r) => {
    assert.equal(r.body.error.code, 'BID_TOO_LOW');
    assert.ok(r.body.error.details?.currentMinimumCents > 1000, 'loser told the new minimum');
  });

  // persisted state: exactly one bid row, correct leader
  const bids = await models.Bid.findAll({ where: { auctionId: auction.id } });
  assert.equal(bids.length, 1);
  const refreshed = await models.Auction.findByPk(auction.id);
  assert.equal(refreshed.leaderId, accepted[0].body.bid.bidderId);
  assert.equal(refreshed.leaderBidId, accepted[0].body.bid.id);
  assert.equal(refreshed.leaderId, accepted[0].body.bid.bidderId);

  // rejection list must include everyone except the winner
  const winnerIds = new Set(accepted.map((r) => r.body.bid.bidderId));
  assert.ok(users.some((u) => winnerIds.has(u.id)), 'a registered bidder won');
});

test('CON scenario 2: 20 concurrent identical-price bids above minimum -> single accepted (no ties in history)', async () => {
  const { auction, users } = await setupAuction({ bidders: 20 });
  // same price for everyone: 50.00 (>= 10+5, so individually valid when idle)
  const responses = await Promise.all(users.map((u) => bidRequest(u, auction.id, '50.00')));

  const accepted = responses.filter((r) => r.status === 201);
  assert.equal(accepted.length, 1, 'same-price race must yield exactly one winner');

  const bids = await models.Bid.findAll({ where: { auctionId: auction.id } });
  assert.equal(bids.length, 1);
});

test('sequential valid bids follow minimum increments; loser cannot change leader', async () => {
  const { auction, users } = await setupAuction({ bidders: 5, startPrice: '1.00', minIncrement: '0.50' });

  const first = await bidRequest(users[0], auction.id, '1.00');
  assert.equal(first.status, 201);

  const below = await bidRequest(users[1], auction.id, '1.10');
  assert.equal(below.status, 409);
  assert.equal(below.body.error.code, 'BID_TOO_LOW');
  assert.equal(below.body.error.details.currentMinimumCents, 150); // 1.00 + 0.50

  const second = await bidRequest(users[1], auction.id, '1.50');
  assert.equal(second.status, 201);

  // leader unchanged by rejected bid
  const rejected = await bidRequest(users[2], auction.id, '1.60');
  assert.equal(rejected.status, 409);
  const auctionRow = await models.Auction.findByPk(auction.id);
  assert.equal(auctionRow.leaderId, users[1].id, 'rejected bid must not change the leader');
});

test('deadline invariant: bid after endsAt rejected, DB clock only', async () => {
  const seller = await helpers.user({ prefix: 'sdlexp' });
  const item = await models.Item.create({ title: 'Expired camera', sellerId: seller.id });
  const auction = await models.Auction.create({
    itemId: item.id,
    sellerId: seller.id,
    startPriceCents: 1000,
    minIncrementCents: 100,
    status: 'ACTIVE',
    endsAt: new Date(Date.now() - 5_000) // already past
  });
  const bidder = await helpers.user({ prefix: 'late' });

  const res = await bidRequest(bidder, auction.id, '20.00');
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'BID_DEADLINE_PASSED');

  const bids = await models.Bid.findAll({ where: { auctionId: auction.id } });
  assert.equal(bids.length, 0, 'no bid may be persisted past the deadline');
});

test('permission rules: cannot bid own auction, unauthenticated rejected, invalid amount rejected', async () => {
  const { auction, seller, users } = await setupAuction({ bidders: 2 });

  const own = await bidRequest(seller, auction.id, '12.00');
  assert.equal(own.status, 403);

  const noAuth = await request.post(`/api/auctions/${auction.id}/bids`).send({ amount: '12.00' });
  assert.equal(noAuth.status, 401);

  const bogus = await bidRequest(users[0], auction.id, '-3.00');
  assert.equal(bogus.status, 422);

  const garbage = await bidRequest(users[0], auction.id, 'banana');
  assert.equal(garbage.status, 422);
  assert.equal(garbage.body.error.code, 'VALIDATION_ERROR');

  const notFound = await bidRequest(users[0], 999999, '50.00');
  assert.equal(notFound.status, 404);
});

test('cannot bid on non-ACTIVE auctions (SCHEDULED / ENDED)', async () => {
  const seller = await helpers.user({ prefix: 'stx' });
  const item = await models.Item.create({ title: 'Scheduled camera', sellerId: seller.id });
  const scheduled = await models.Auction.create({
    itemId: item.id,
    sellerId: seller.id,
    startPriceCents: 1000,
    minIncrementCents: 100,
    status: 'SCHEDULED',
    startsAt: new Date(Date.now() + 600_000),
    endsAt: new Date(Date.now() + 1_200_000)
  });
  const bidder = await helpers.user({ prefix: 'eager' });

  const res = await bidRequest(bidder, scheduled.id, '20.00');
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'AUCTION_NOT_ACTIVE');

  const ended = await models.Auction.create({
    itemId: (await models.Item.create({ title: 'Ended camera', sellerId: seller.id })).id,
    sellerId: seller.id,
    startPriceCents: 1000,
    minIncrementCents: 100,
    status: 'ENDED',
    endsAt: new Date(Date.now() - 10_000),
    closedAt: new Date(Date.now() - 5_000)
  });
  const res2 = await bidRequest(bidder, ended.id, '20.00');
  assert.equal(res2.status, 409);
});

test('bid history endpoint exposes persisted, monotonic-by-price history', async () => {
  const { auction, users } = await setupAuction({ bidders: 5, startPrice: '1.00', minIncrement: '0.50' });

  const r1 = await bidRequest(users[0], auction.id, '1.00');
  const r2 = await bidRequest(users[1], auction.id, '1.50');
  const r3 = await bidRequest(users[2], auction.id, '2.00');
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(r3.status, 201);

  const history = await request.get(`/api/auctions/${auction.id}/bids`);
  assert.equal(history.status, 200);
  assert.equal(history.body.meta.total, 3);
  const amounts = history.body.data.map((b) => b.amountCents);
  const sorted = [...amounts].sort((a, b) => b - a);
  assert.deepEqual(amounts, sorted, 'leader-first history');
  assert.deepEqual(amounts, [200, 150, 100]);
});