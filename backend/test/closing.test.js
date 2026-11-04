import { test, after } from 'node:test';
import assert from 'node:assert';
import { bootTestApp } from './helpers/testApp.js';
import { closeAuction, closeDueAuctions, startClosingRunner, stopClosingRunner } from '../src/jobs/closingRunner.js';
import { subscribe } from '../src/realtime/eventBus.js';

const ctx = await bootTestApp({ withApp: true });
after(() => ctx.teardown());

const { request, helpers, models } = ctx;

async function makeAuction({ dueIn = -1_000, status = 'ACTIVE', startPriceCents = 1000, minIncrementCents = 100 } = {}) {
  const seller = await helpers.user({ prefix: 'close-seller' });
  const item = await models.Item.create({ title: `Closing cam ${Date.now()}`, sellerId: seller.id });
  return models.Auction.create({
    itemId: item.id,
    sellerId: seller.id,
    startPriceCents,
    minIncrementCents,
    status,
    endsAt: new Date(Date.now() + dueIn)
  });
}

test('closeAuction: highest bid wins deterministically (winner persisted)', async () => {
  const auction = await makeAuction({ dueIn: -1_000 });
  const b1 = await helpers.user({ prefix: 'loser' });
  const b2 = await helpers.user({ prefix: 'winner' });
  await models.Bid.create({ auctionId: auction.id, bidderId: b1.id, amountCents: 1100 });
  await models.Bid.create({ auctionId: auction.id, bidderId: b2.id, amountCents: 1800 });
  await models.Bid.create({ auctionId: auction.id, bidderId: b1.id, amountCents: 1500 });

  const events = [];
  const off = subscribe('auctions:global', (e) => events.push(e));

  const result = await closeAuction(auction.id);
  off();

  assert.equal(result.auction.status, 'ENDED');
  assert.ok(result.auction.closedAt);
  assert.equal(result.winnerBid.bidderId, b2.id, 'max bid wins');
  assert.equal(result.winnerBid.amountCents, 1800);

  // persisted
  const row = await models.Auction.findByPk(auction.id);
  assert.equal(row.status, 'ENDED');
  assert.equal(row.leaderId, b2.id);
  assert.ok(row.closedAt);

  // auction.closed event fanned out
  const closedEv = events.find((e) => e.type === 'auction.closed' && e.auctionId === auction.id);
  assert.ok(closedEv, 'auction.closed event must be published');
  assert.equal(closedEv.winner.bidderId, b2.id);

  // winner got a personal auction.won event
  const wonEv = events.find((e) => e.type === 'auction.won' && e.auctionId === auction.id);
  assert.ok(wonEv);
});

test('closeAuction: auction without bids ends without a winner', async () => {
  const auction = await makeAuction({ dueIn: -1_000 });
  const result = await closeAuction(auction.id);
  assert.equal(result.auction.status, 'ENDED');
  assert.equal(result.winnerBid, null);
  const row = await models.Auction.findByPk(auction.id);
  assert.equal(row.leaderId, null);
});

test('deadline invariant: auction not due is never closed early', async () => {
  const auction = await makeAuction({ dueIn: +600_000 });
  const result = await closeAuction(auction.id);
  assert.equal(result, null);
  const row = await models.Auction.findByPk(auction.id);
  assert.equal(row.status, 'ACTIVE');
});

test('closeDueAuctions: closes every overdue auction in one sweep', async () => {
  const a1 = await makeAuction({ dueIn: -5_000 });
  const a2 = await makeAuction({ dueIn: -1_000 });
  const notDue = await makeAuction({ dueIn: +600_000 });

  const closedIds = [];
  const off = subscribe('auctions:global', (e) => {
    if (e.type === 'auction.closed') closedIds.push(e.auctionId);
  });

  const n = await closeDueAuctions();
  off();

  assert.equal(n, 2);
  assert.deepEqual(closedIds.sort(), [a1.id, a2.id].sort());

  const st1 = await models.Auction.findByPk(a1.id);
  const st2 = await models.Auction.findByPk(a2.id);
  const notDueRow = await models.Auction.findByPk(notDue.id);
  assert.equal(st1.status, 'ENDED');
  assert.equal(st2.status, 'ENDED');
  assert.equal(notDueRow.status, 'ACTIVE', 'not-due auction must stay ACTIVE');
});

test('post-close: late bids are rejected (AUCTION_NOT_ACTIVE), no leader change', async () => {
  const auction = await makeAuction({ dueIn: -1_000 });
  await closeAuction(auction.id);

  const straggler = await helpers.user({ prefix: 'straggler' });
  const res = await request
    .post(`/api/auctions/${auction.id}/bids`)
    .set(helpers.bearer(straggler))
    .send({ amount: '50.00' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'AUCTION_NOT_ACTIVE');

  const row = await models.Auction.findByPk(auction.id);
  assert.equal(row.status, 'ENDED');
});

test('closing runner timer: closes auctions automatically on sweep', async () => {
  const controller = startClosingRunner({ intervalMs: 50 });
  const auction = await makeAuction({ dueIn: -1_000 });

  // wait up to 1.5s for the sweep to close it
  let row = null;
  for (let i = 0; i < 30; i++) {
    row = await models.Auction.findByPk(auction.id);
    if (row.status === 'ENDED') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  stopClosingRunner();
  controller.stop();

  assert.equal(row.status, 'ENDED');
});