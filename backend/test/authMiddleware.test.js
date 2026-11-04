import { test } from 'node:test';
import assert from 'node:assert';
import { requireAuth, requireRole } from '../src/middleware/auth.js';

function fakeReq({ authorization = null } = {}) {
  return { headers: authorization ? { authorization } : {} };
}

test('requireRole: allows matching role, rejects others', async () => {
  const mw = requireRole('ADMIN');
  const adminReq = fakeReq();
  adminReq.user = { id: 1, role: 'ADMIN' };
  let passed = false;
  await new Promise((resolve) => mw(adminReq, {}, () => { passed = true; resolve(); }));
  assert.equal(passed, true);

  const userReq = fakeReq();
  userReq.user = { id: 2, role: 'USER' };
  let err = null;
  await new Promise((resolve) => mw(userReq, {}, (e) => { err = e; resolve(); }));
  assert.equal(err.status, 403);
  assert.equal(err.code, 'FORBIDDEN');
});

test('requireRole: unauthenticated request is rejected with 401', async () => {
  const mw = requireRole('ADMIN');
  let err = null;
  await new Promise((resolve) => mw(fakeReq(), {}, (e) => { err = e; resolve(); }));
  assert.equal(err.status, 401);
});

test('requireAuth: missing/malformed/invalid tokens are rejected', async () => {
  // no header
  let err = null;
  await new Promise((resolve) => requireAuth(fakeReq(), {}, (e) => { err = e; resolve(); }));
  assert.equal(err.status, 401);
  assert.match(err.message, /Missing Bearer token/);

  // bad token
  err = null;
  await new Promise((resolve) =>
    requireAuth(fakeReq({ authorization: 'Bearer not-a-jwt' }), {}, (e) => { err = e; resolve(); })
  );
  assert.equal(err.status, 401);
  assert.match(err.message, /Invalid token/);
});

test('requireAuth: valid token loads the CURRENT user from the database', async (t) => {
  const { bootTestApp } = await import('./helpers/testApp.js');
  const ctx = await bootTestApp({ withApp: false });
  const { models } = ctx;
  const user = await models.User.create({ email: 'rt@test.dev', passwordHash: 'h' });
  const { signToken } = await import('../src/services/token.service.js');
  const token = signToken({ userId: user.id, role: 'USER' });

  const req = fakeReq({ authorization: `Bearer ${token}` });
  await new Promise((resolve, reject) => {
    requireAuth(req, {}, (e) => (e ? reject(e) : resolve()));
  });
  assert.equal(req.user.id, user.id);

  // token referencing a deleted user -> 401
  const token2 = signToken({ userId: 99999, role: 'USER' });
  let err = null;
  await new Promise((resolve) =>
    requireAuth(fakeReq({ authorization: `Bearer ${token2}` }), {}, (e) => { err = e; resolve(); })
  );
  assert.equal(err.status, 401);
  assert.match(err.message, /no longer exists/);

  await ctx.teardown();
});