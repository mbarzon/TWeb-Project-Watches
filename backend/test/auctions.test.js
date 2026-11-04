import { test, after } from 'node:test';
import assert from 'node:assert';
import { bootTestApp } from './helpers/testApp.js';

const ctx = await bootTestApp();
after(() => ctx.teardown());

const { request, helpers } = ctx;

async function registerAndItem(prefix, title = `Item by ${prefix}`) {
  const email = `${prefix}@test.dev`;
  await request.post('/api/auth/register').send({ email, password: 'Password123!' });
  const auth = await helpers.bearerViaLogin(email);
  const item = await request.post('/api/items').set(auth).send({ title });
  return { email, auth, item: item.body.item };
}

test('seller creates an auction for own item; auction starts DRAFT', async () => {
  const { auth, item } = await registerAndItem('auc-seller', 'Vintage Rolleiflex');

  const res = await request
    .post('/api/auctions')
    .set(auth)
    .send({ itemId: item.id, startPrice: '100.00', minIncrement: '5.00' });

  assert.equal(res.status, 201);
  assert.equal(res.body.auction.status, 'DRAFT');
  assert.equal(res.body.auction.startPriceCents, 10000);
  assert.equal(res.body.auction.minIncrementCents, 500);
  assert.equal(res.body.auction.item.id, item.id);
});

test('stranger cannot auction the item of another seller (object-level authz)', async () => {
  const a = await registerAndItem('ownerX', 'Mint Apple II');
  const b = await registerAndItem('strangerY');

  const res = await request
    .post('/api/auctions')
    .set(b.auth)
    .send({ itemId: a.item.id, startPrice: '10.00', minIncrement: '1.00' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('auction validation: negative/non-numeric prices rejected (422)', async () => {
  const { auth, item } = await registerAndItem('vails', 'Test unit');
  const bad = await request
    .post('/api/auctions')
    .set(auth)
    .send({ itemId: item.id, startPrice: '-1.00', minIncrement: 'x' });
  assert.equal(bad.status, 422);
  const fields = bad.body.error.details.map((d) => d.field);
  assert.ok(fields.includes('startPrice'));
  assert.ok(fields.includes('minIncrement'));
});

test('duplicate auction on same item -> 409 AUCTION_EXISTS', async () => {
  const { auth, item } = await registerAndItem('dupey', 'Only one auction');
  await request.post('/api/auctions').set(auth).send({ itemId: item.id, startPrice: '5.00', minIncrement: '0.50' });
  const again = await request
    .post('/api/auctions')
    .set(auth)
    .send({ itemId: item.id, startPrice: '5.00', minIncrement: '0.50' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'AUCTION_EXISTS');
});

test('full happy lifecycle through transitions: DRAFT -> SCHEDULED -> ACTIVE', async () => {
  const { auth, item } = await registerAndItem('lifecycle', 'Lifecycle check');
  const auction = (
    await request.post('/api/auctions').set(auth).send({ itemId: item.id, startPrice: '20.00', minIncrement: '1.00' })
  ).body.auction;

  const badStart = await request
    .post(`/api/auctions/${auction.id}/transitions`)
    .set(auth)
    .send({ to: 'ACTIVE' });
  assert.equal(badStart.status, 409); // skips SCHEDULED
  assert.equal(badStart.body.error.code, 'INVALID_TRANSITION');

  // invalid scheduled windows rejected
  const badWindow = await request
    .post(`/api/auctions/${auction.id}/transitions`)
    .set(auth)
    .send({ to: 'SCHEDULED', startsAt: new Date(Date.now() + 1000).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(badWindow.status, 409);
  assert.equal(badWindow.body.error.code, 'PRECONDITION_FAILED');

  const scheduled = await request
    .post(`/api/auctions/${auction.id}/transitions`)
    .set(auth)
    .send({ to: 'SCHEDULED', startsAt: new Date(Date.now() + 1000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.body.auction.status, 'SCHEDULED');

  // repeated submission: already SCHEDULED -> no SCHEDULED -> SCHEDULED edge
  const repeat = await request
    .post(`/api/auctions/${auction.id}/transitions`)
    .set(auth)
    .send({ to: 'SCHEDULED' });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.body.error.code, 'INVALID_TRANSITION');

  const active = await request
    .post(`/api/auctions/${auction.id}/transitions`)
    .set(auth)
    .send({ to: 'ACTIVE' });
  assert.equal(active.status, 200);
  assert.equal(active.body.auction.status, 'ACTIVE');
});

test('stranger cannot transition a foreign auction (403)', async () => {
  const owner = await registerAndItem('towner', 'Not yours');
  const stranger = await registerAndItem('tstranger');
  const auction = (
    await request
      .post('/api/auctions')
      .set(owner.auth)
      .send({ itemId: owner.item.id, startPrice: '10.00', minIncrement: '1.00' })
  ).body.auction;

  const res = await request
    .post(`/api/auctions/${auction.id}/transitions`)
    .set(stranger.auth)
    .send({ to: 'SCHEDULED', startsAt: new Date(Date.now() + 1_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('cancel with bids is forbidden (fairness rule)', async () => {
  const { models } = ctx;
  const { auth, item } = await registerAndItem('canceler', 'Cancel test');
  const auction = (
    await request.post('/api/auctions').set(auth).send({ itemId: item.id, startPrice: '10.00', minIncrement: '1.00' })
  ).body.auction;

  // schedule then attach a bid
  await request
    .post(`/api/auctions/${auction.id}/transitions`)
    .set(auth)
    .send({ to: 'SCHEDULED', startsAt: new Date(Date.now() - 1_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() });

  await models.Bid.create({
    auctionId: auction.id,
    bidderId: 1,
    amountCents: 1500
  });

  // seller cancels a scheduled auction that already carries bids -> blocked
  const res = await request
    .post(`/api/auctions/${auction.id}/transitions`)
    .set(auth)
    .send({ to: 'CANCELLED' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'AUCTION_HAS_BIDS');
});

test('auction list filters by status and q, sorts by endsAt', async () => {
  const { auth, item } = await registerAndItem('listy', 'Super Special Widget');
  const created = await request
    .post('/api/auctions')
    .set(auth)
    .send({ itemId: item.id, startPrice: '1.00', minIncrement: '0.10' });

  const filtered = await request.get('/api/auctions?status=DRAFT&q=widget');
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.data.some((a) => a.id === created.body.auction.id));
  assert.ok(filtered.body.data.every((a) => a.status === 'DRAFT'));

  const sorted = await request.get('/api/auctions?sort=startPrice&order=asc&limit=3');
  assert.equal(sorted.status, 200);
  const prices = sorted.body.data.map((a) => a.startPriceCents);
  const sortedCopy = [...prices].sort((x, y) => x - y);
  assert.deepEqual(prices, sortedCopy);

  const badStatus = await request.get('/api/auctions?status=SOMEDAY');
  assert.equal(badStatus.status, 422);
  assert.equal(badStatus.body.error.code, 'VALIDATION_ERROR');
});

test('GET /auctions/:id/stats exposes server minimum', async () => {
  const { auth, item } = await registerAndItem('statsy', 'Stats widget');
  const auction = (
    await request.post('/api/auctions').set(auth).send({ itemId: item.id, startPrice: '10.00', minIncrement: '2.00' })
  ).body.auction;

  const stats = await request.get(`/api/auctions/${auction.id}/stats`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.minimumBidCents, 1000);
  assert.equal(stats.body.bidCount, 0);
  assert.equal(stats.body.status, 'DRAFT');
});