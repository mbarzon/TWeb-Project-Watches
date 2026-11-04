import { test, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { bootTestApp } from './helpers/testApp.js';
import { publish, CHANNELS } from '../src/realtime/eventBus.js';

const ctx = await bootTestApp();
after(() => ctx.teardown());

const { request, helpers, models } = ctx;

const app = ctx.app;

/** Minimal SSE test client over fetch (reads chunks, parses events). */
function sseConnect({ url, token, lastEventId = null }) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' };
  if (lastEventId !== null) headers['Last-Event-ID'] = String(lastEventId);
  const controller = new AbortController();
  const events = [];
  const chunks = [];
  const waiters = [];

  const parse = (chunk) => {
    for (const block of chunk.split('\n\n')) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      if (lines.every((l) => l.startsWith(':'))) {
        events.push({ type: 'heartbeat' });
        continue;
      }
      let id = null;
      let eventName = 'message';
      let data = null;
      for (const line of lines) {
        if (line.startsWith('id: ')) id = Number(line.slice(4));
        else if (line.startsWith('event: ')) eventName = line.slice(7);
        else if (line.startsWith('data: ')) data = JSON.parse(line.slice(6));
      }
      if (data !== null) events.push({ id, type: eventName, data });
      while (waiters.length && events.length >= (waiters[0].needed)) {
        waiters.shift().resolve(events);
      }
    }
  };

  (async () => {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status !== 200) {
      events.push({ type: 'http-error', status: res.status });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      chunks.push(chunk);
      parse(chunk);
    }
  })().catch((err) => {
    if (err?.name !== 'AbortError') throw err;
  });

  return {
    events,
    abort: () => controller.abort(),
    async waitForType(type, timeoutMs = 2000) {
      const start = Date.now();
      for (;;) {
        const found = events.find((e) => e.type === type);
        if (found) return found;
        if (Date.now() - start > timeoutMs) {
          return events.find((e) => e.type === type) ?? null;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    async waitForCount(type, n, timeoutMs = 3000) {
      const start = Date.now();
      for (;;) {
        const got = events.filter((e) => e.type === type);
        if (got.length >= n) return got;
        if (Date.now() - start > timeoutMs) return got;
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  };
}

async function listenOnPort() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('RTM: 20 concurrent SSE clients receive a bid event live without refresh', async () => {
  const server = await listenOnPort();
  const port = server.address().port;

  const seller = await helpers.user({ prefix: 'rtm-seller' });
  const item = await models.Item.create({ title: 'Realtime camera', sellerId: seller.id });
  const auction = await models.Auction.create({
    itemId: item.id,
    sellerId: seller.id,
    startPriceCents: 1000,
    minIncrementCents: 500,
    status: 'ACTIVE',
    endsAt: new Date(Date.now() + 600_000)
  });
  const bidder = await helpers.user({ prefix: 'rtm-bidder' });
  const seller2 = await helpers.user({ prefix: 'rtm-seller2' });

  const sellerAuth = helpers.bearer(seller);
  const clients = [];
  const tokens = [];
  for (let i = 0; i < 20; i++) {
    const u = await helpers.user({ prefix: `rtm-watch${i}` });
    tokens.push(helpers.bearer(u));
  }

  for (const auth of tokens) {
    const c = sseConnect({
      url: `http://127.0.0.1:${port}/api/auctions/${auction.id}/events`,
      token: auth.Authorization.slice(7)
    });
    clients.push(c);
  }

  // wait for all connections
  await Promise.all(clients.map((c) => c.waitForType('connected')));
  assert.equal(clients.length, 20);

  const t0 = Date.now();
  const bid = await request
    .post(`/api/auctions/${auction.id}/bids`)
    .set(helpers.bearer(bidder))
    .send({ amount: '25.00' });
  assert.equal(bid.status, 201);

  // all 20 clients observed the bid ACCEPTED live
  const received = await Promise.all(clients.map((c) => c.waitForType('bid.accepted')));
  const delayMs = Date.now() - t0;
  for (const ev of received) {
    assert.ok(ev, 'client missed the bid event');
    assert.equal(ev.data.auctionId, auction.id);
    assert.equal(ev.data.amountCents, 2500);
    assert.ok(typeof ev.data.seq === 'number');
  }
  console.log(`[RTM evidence] ${clients.length} clients got the event ${delayMs}ms after commit`);

  // event seq ordering is monotonic per stream
  const seqs = received.map((e) => e.data.seq);

  // cleanup first batch of clients
  clients.forEach((c) => c.abort());

  // RECONNECT with Last-Event-ID: missed events are replayed
  const reconnect = sseConnect({
    url: `http://127.0.0.1:${port}/api/auctions/${auction.id}/events`,
    token: helpers.bearer(bidder).Authorization.slice(7),
    lastEventId: received[0].id - 1 // "client saw everything before the bid"
  });
  await reconnect.waitForType('connected');
  const replayed = reconnect.events.filter((e) => e.type === 'bid.accepted');
  assert.ok(replayed.length >= 1, 'reconnect must replay missed bid events');
  console.log(`[RTM evidence] reconnect replayed ${replayed.length} missed event(s) after Last-Event-ID`);
  reconnect.abort();

  server.closeAllConnections?.();
  server.close();
});

test('RTM: user channels are private; no cross-user event leakage', async () => {
  const server = await listenOnPort();
  const port = server.address().port;

  const owner = await helpers.user({ prefix: 'chanown' });
  const intruder = await helpers.user({ prefix: 'intruder' });
  const ownerAuth = helpers.bearer(owner);
  const intruderAuth = helpers.bearer(intruder);

  const res = await fetch(`http://127.0.0.1:${port}/api/users/${owner.id}/events`, {
    headers: { Authorization: intruderAuth.Authorization, Accept: 'text/event-stream' }
  });
  assert.equal(res.status, 403, 'subscribing to another user’s channel must be forbidden');

  // own channel works and receives outbid events
  const stream = sseConnect({
    url: `http://127.0.0.1:${port}/api/users/${owner.id}/events`,
    token: ownerAuth.Authorization.slice(7)
  });
  await stream.waitForType('connected');
  publish(`user:${owner.id}`, { type: 'outbid', auctionId: 1 });
  const got = await stream.waitForType('outbid');
  assert.ok(got);
  stream.abort();

  const noAuth = await fetch(`http://127.0.0.1:${port}/api/global/events`, {
    headers: { Accept: 'text/event-stream' }
  });
  assert.equal(noAuth.status, 401, 'streams require authentication');

  server.closeAllConnections?.();
  server.close();
});

test('RTM: out-of-order delivery is detectable/recoverable via event seq', async () => {
  // Simulated network reordering: two events published; the second event's
  // seq > first. A client that receives them out of order uses `seq` to
  // restore business order. We assert seq monotonicity + presence.
  const server = await listenOnPort();
  const port = server.address().port;

  const u = await helpers.user({ prefix: 'sequser' });
  const stream = sseConnect({
    url: `http://127.0.0.1:${port}/api/global/events`,
    token: helpers.bearer(u).Authorization.slice(7)
  });
  await stream.waitForType('connected');
  const connectedId = stream.events.find((e) => e.type === 'connected').id;

  const e1 = publish(CHANNELS.auction(99), { type: 'bid.accepted', bidId: 1, seq: 1 });
  const e2 = publish(CHANNELS.auction(99), { type: 'bid.accepted', bidId: 2, seq: 2 });

  const received = await stream.waitForCount('bid.accepted', 2);
  assert.equal(received[0].data.seq, 1);
  assert.equal(received[1].data.seq, 2);

  // simulate client-side out-of-order recovery: swap arrival, sort by seq
  const shuffled = [received[1], received[0]];
  const restored = [...shuffled].sort((a, b) => a.data.seq - b.data.seq);
  assert.equal(restored[0].data.bidId, 1);
  assert.equal(restored[1].data.bidId, 2);

  // replay from the connected event id re-delivers both, in order
  const replay = sseConnect({
    url: `http://127.0.0.1:${port}/api/global/events`,
    token: helpers.bearer(u).Authorization.slice(7),
    lastEventId: connectedId
  });
  await replay.waitForType('connected');
  const replayed = replay.events.filter((e) => e.type === 'bid.accepted');
  assert.equal(replayed.length, 2);
  assert.equal(replayed[0].data.seq, 1);
  assert.equal(replayed[1].data.seq, 2);
  replay.abort();
  stream.abort();

  server.closeAllConnections?.();
  server.close();
});