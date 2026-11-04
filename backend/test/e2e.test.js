import { test, after } from 'node:test';
import assert from 'node:assert';
import { bootTestApp } from './helpers/testApp.js';
import { closeAuction } from '../src/jobs/closingRunner.js';

const ctx = await bootTestApp();
after(() => ctx.teardown());

const { request, helpers, models } = ctx;

/**
 * One complete E2E workflow exercising all mandated user journeys:
 *  1. Seller: register -> login -> list item -> open auction -> schedule -> activate
 *  2. Bidder: browse/filter -> inspect -> bid (min increment respected) -> get outbid
 *  3. System: close -> deterministic winner -> immutable outcome
 * Permission/validity negatives are asserted along the way.
 */
test('E2E: auction lifecycle with concurrent-looking bid race and deterministic outcome', async () => {
  // ===== Seller journey =====
  const sellerEmail = 'e2e-seller@test.dev';
  const sellerReg = await request
    .post('/api/auth/register')
    .send({ email: sellerEmail, password: 'Password123!' });
  assert.equal(sellerReg.status, 201);

  const sellerAuth = await helpers.bearerViaLogin(sellerEmail);
  const me = await request.get('/api/auth/me').set(sellerAuth);
  assert.equal(me.body.user.email, sellerEmail);

  const itemRes = await request
    .post('/api/items')
    .set(sellerAuth)
    .send({ title: 'E2E Vintage Hasselblad', description: 'Medium format film camera', condition: 'GOOD' });
  assert.equal(itemRes.status, 201);
  const itemId = itemRes.body.item.id;

  const auctionRes = await request
    .post('/api/auctions')
    .set(sellerAuth)
    .send({ itemId, startPrice: '100.00', minIncrement: '10.00' });
  assert.equal(auctionRes.status, 201);
  assert.equal(auctionRes.body.auction.status, 'DRAFT');
  const auctionId = auctionRes.body.auction.id;

  const scheduleRes = await request
    .post(`/api/auctions/${auctionId}/transitions`)
    .set(sellerAuth)
    .send({
      to: 'SCHEDULED',
      startsAt: new Date(Date.now() - 1_000).toISOString(),
      endsAt: new Date(Date.now() + 60_000).toISOString()
    });
  assert.equal(scheduleRes.status, 200);
  const activeRes = await request
    .post(`/api/auctions/${auctionId}/transitions`)
    .set(sellerAuth)
    .send({ to: 'ACTIVE' });
  assert.equal(activeRes.status, 200);
  assert.equal(activeRes.body.auction.status, 'ACTIVE');

  // negative: ordinary user may not transition the seller's auction
  const strangerEmail = 'e2e-stranger@test.dev';
  await request.post('/api/auth/register').send({ email: strangerEmail, password: 'Password123!' });
  const strangerAuth = await helpers.bearerViaLogin(strangerEmail);
  const forbidden = await request
    .post(`/api/auctions/${auctionId}/transitions`)
    .set(strangerAuth)
    .send({ to: 'CANCELLED' });
  assert.equal(forbidden.status, 403);

  // ===== Bidder journeys =====
  const bidders = ['e2e-bidder1', 'e2e-bidder2', 'e2e-bidder3'];
  const bidderAuths = [];
  for (const name of bidders) {
    await request.post('/api/auth/register').send({ email: `${name}@test.dev`, password: 'Password123!' });
    bidderAuths.push(await helpers.bearerViaLogin(`${name}@test.dev`));
  }

  // browse: filter ACTIVE, sort by soonest end
  const browse = await request.get('/api/auctions?status=ACTIVE&sort=startPrice&order=desc');
  assert.equal(browse.status, 200);
  assert.ok(browse.body.data.some((a) => a.id === auctionId));

  const stats = await request.get(`/api/auctions/${auctionId}/stats`);
  assert.equal(stats.body.minimumBidCents, 10000); // startPrice at no bids

  // race: all three fire at the same price simultaneously -> one winner
  const race = await Promise.all(
    bidderAuths.map((auth) => request.post(`/api/auctions/${auctionId}/bids`).set(auth).send({ amount: '110.00' }))
  );
  const winners = race.filter((r) => r.status === 201);
  const losers = race.filter((r) => r.status === 409);
  assert.equal(winners.length, 1, 'same-price race resolves to exactly one accepted bid');
  assert.equal(losers.length, 2);
  assert.equal(losers[0].body.error.code, 'BID_TOO_LOW');
  assert.equal(losers[0].body.error.details.currentMinimumCents, 12000); // 110 + 10

  // the loser re-enters with a higher bid
  const secondWinnerIdx = race.findIndex((r) => r.status === 409);
  const reentry = await request
    .post(`/api/auctions/${auctionId}/bids`)
    .set(bidderAuths[secondWinnerIdx])
    .send({ amount: '130.00' });
  assert.equal(reentry.status, 201);
  const leader = reentry.body.bid.bidderId;

  // seller cannot bid on own auction
  const ownBid = await request
    .post(`/api/auctions/${auctionId}/bids`)
    .set(sellerAuth)
    .send({ amount: '140.00' });
  assert.equal(ownBid.status, 403);

  // persisted bid history reflects order
  const history = await request.get(`/api/auctions/${auctionId}/bids`);
  assert.equal(history.body.meta.total, 2);
  assert.deepEqual(history.body.data.map((b) => b.amountCents), [13000, 11000]);

  // ===== Closing & outcome =====
  // (system clock override: the auction's deadline has "passed")
  const closeResult = await closeAuction(auctionId, { now: new Date(Date.now() + 120_000) });
  assert.equal(closeResult.auction.status, 'ENDED');
  assert.equal(closeResult.winnerBid.bidderId, leader, 'last standing bidder wins');
  assert.equal(closeResult.winnerBid.amountCents, 13000);

  // outcome immutable: no more bids accepted
  const late = await request
    .post(`/api/auctions/${auctionId}/bids`)
    .set(bidderAuths[0])
    .send({ amount: '999.00' });
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, 'AUCTION_NOT_ACTIVE');

  const finalStats = await request.get(`/api/auctions/${auctionId}/stats`);
  assert.equal(finalStats.body.status, 'ENDED');
  assert.equal(finalStats.body.bidCount, 2);
  assert.equal(finalStats.body.maxBidCents, 13000);
});

test('E2E: second seller workflow with cancellation before bids', async () => {
  const email = 'e2e-seller2@test.dev';
  await request.post('/api/auth/register').send({ email, password: 'Password123!' });
  const auth = await helpers.bearerViaLogin(email);

  const item = await request.post('/api/items').set(auth).send({ title: 'E2E Cancellable Item' });
  const auction = await request
    .post('/api/auctions')
    .set(auth)
    .send({ itemId: item.body.item.id, startPrice: '5.00', minIncrement: '0.50' });

  // DRAFT -> CANCELLED edge works only with no bids
  const cancelled = await request
    .post(`/api/auctions/${auction.body.auction.id}/transitions`)
    .set(auth)
    .send({ to: 'CANCELLED' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.auction.status, 'CANCELLED');

  // item deletion allowed after cancellation
  const del = await request.delete(`/api/items/${item.body.item.id}`).set(auth);
  assert.equal(del.status, 200);
});