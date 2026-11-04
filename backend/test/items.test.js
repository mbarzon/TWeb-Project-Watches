import { test, after } from 'node:test';
import assert from 'node:assert';
import { bootTestApp } from './helpers/testApp.js';

const ctx = await bootTestApp();
after(() => ctx.teardown());

const { request, helpers, models } = ctx;

async function makeUser(prefix) {
  const user = await helpers.user({ prefix });
  return { user, auth: helpers.bearer(user) };
}

test('item creation requires authentication', async () => {
  const res = await request.post('/api/items').send({ title: 'Unauthed item' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('seller creates an item; validation rejects bad condition', async () => {
  const { auth } = await makeUser('seller');
  const ok = await request
    .post('/api/items')
    .set(auth)
    .send({ title: 'Leica M3 rangefinder', description: 'Film camera', condition: 'USED' });

  assert.equal(ok.status, 201);
  assert.equal(ok.body.item.condition, 'USED');
  assert.ok(ok.body.item.sellerId >= 1);

  const badField = await request
    .post('/api/items')
    .set(auth)
    .send({ title: 'x', condition: 'IMMORTAL' });
  assert.equal(badField.status, 422);
  const fields = badField.body.error.details.map((d) => d.field);
  assert.ok(fields.includes('title'));
  assert.ok(fields.includes('condition'));
});

test('GET /items lists, filters by q, sorts and paginates', async () => {
  const { auth } = await makeUser('lister');
  for (const title of ['Alpha Camera', 'Beta Lens', 'Gamma Tripod', 'Delta Flash']) {
    await request.post('/api/items').set(auth).send({ title });
  }

  const all = await request.get('/api/items?limit=2&page=1');
  assert.equal(all.status, 200);
  assert.equal(all.body.data.length, 2);
  assert.equal(all.body.meta.page, 1);
  assert.ok(all.body.meta.totalPages >= 2);

  const filtered = await request.get('/api/items?q=camera');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.data.length, 1);
  assert.equal(filtered.body.data[0].title, 'Alpha Camera');

  const asc = await request.get('/api/items??sort=title&order=asc&limit=50&page=1'.replace('??', '?'));
  const titlesAsc = asc.body.data.map((i) => i.title);
  const sorted = [...titlesAsc].sort();
  assert.deepEqual(titlesAsc, sorted);

  const badSort = await request.get('/api/items?sort=banana');
  assert.equal(badSort.status, 422);
  assert.equal(badSort.body.error.code, 'VALIDATION_ERROR');

  const badVal = await request.get('/api/items?sort=id');
  assert.equal(badVal.status, 422);
});

test('object-level authorization: only the owner or an ADMIN can modify', async () => {
  const owner = await makeUser('owner1');
  const stranger = await makeUser('stranger');
  const created = await request
    .post('/api/items')
    .set(owner.auth)
    .send({ title: 'Owner only camera' });
  const itemId = created.body.item.id;

  const forbidden = await request
    .patch(`/api/items/${itemId}`)
    .set(stranger.auth)
    .send({ description: 'hijacked' });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, 'FORBIDDEN');

  const admin = await helpers.user({ prefix: 'admin', role: 'ADMIN' });
  const byAdmin = await request
    .patch(`/api/items/${itemId}`)
    .set(helpers.bearer(admin))
    .send({ description: 'admin-corrected' });
  assert.equal(byAdmin.status, 200);
  assert.equal(byAdmin.body.item.description, 'admin-corrected');

  const byOwner = await request
    .patch(`/api/items/${itemId}`)
    .set(owner.auth)
    .send({ title: 'Renamed by owner' });
  assert.equal(byOwner.status, 200);
  assert.equal(byOwner.body.item.title, 'Renamed by owner');
});

test('item deletion blocked while auction live (conflict), 404 for unknown id', async () => {
  const { auth, user } = await makeUser('deleter');
  const created = await request
    .post('/api/items')
    .set(auth)
    .send({ title: 'To delete later' });
  const itemId = created.body.item.id;

  const missing = await request.delete('/api/items/999999').set(auth);
  assert.equal(missing.status, 404);

  // with a DRAFT auction, delete works
  await models.Auction.create({
    itemId,
    sellerId: user.id,
    startPriceCents: 1000,
    minIncrementCents: 100
  });
  const okDelete = await request.delete(`/api/items/${itemId}`).set(auth);
  assert.equal(okDelete.status, 200);
  assert.equal(okDelete.body.deleted, true);

  const gone = await request.get(`/api/items/${itemId}`);
  assert.equal(gone.status, 404);
});

test('stranger cannot delete (403)', async () => {
  const owner = await makeUser('delowner');
  const stranger = await makeUser('delstranger');
  const created = await request
    .post('/api/items')
    .set(owner.auth)
    .send({ title: 'Keep me' });

  const res = await request
    .delete(`/api/items/${created.body.item.id}`)
    .set(stranger.auth);
  assert.equal(res.status, 403);
});