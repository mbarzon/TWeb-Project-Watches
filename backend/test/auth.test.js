import { test, after } from 'node:test';
import assert from 'node:assert';
import { bootTestApp } from './helpers/testApp.js';

const ctx = await bootTestApp();
after(() => ctx.teardown());

const { request } = ctx;

test('POST /auth/register creates a user with hashed password and USER role', async () => {
  const res = await request.post('/api/auth/register').send({
    email: 'Ana@Example.com',
    password: 'Password123!'
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'ana@example.com');
  assert.equal(res.body.user.role, 'USER');
  assert.ok(!('passwordHash' in res.body.user), 'must never leak passwordHash');
});

test('register rejects invalid email / short password with 422 details', async () => {
  const res = await request
    .post('/api/auth/register')
    .send({ email: 'not-an-email', password: 'short' });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  const fields = res.body.error.details.map((d) => d.field);
  assert.ok(fields.includes('email'));
  assert.ok(fields.includes('password'));
});

test('register rejects duplicate email with 409', async () => {
  await request.post('/api/auth/register').send({ email: 'dup@example.com', password: 'Password123!' });
  const res = await request
    .post('/api/auth/register')
    .send({ email: 'dup@example.com', password: 'Password123!' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'EMAIL_TAKEN');
});

test('login returns token and user; wrong password -> consistent 401', async () => {
  const reg = await request
    .post('/api/auth/register')
    .send({ email: 'lucia@example.com', password: 'Password123!' });

  const ok = await request
    .post('/api/auth/login')
    .send({ email: 'lucia@example.com', password: 'Password123!' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.user.id, reg.body.user.id);

  const bad = await request
    .post('/api/auth/login')
    .send({ email: 'lucia@example.com', password: 'WrongPass1!' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'UNAUTHORIZED');

  const unknown = await request
    .post('/api/auth/login')
    .send({ email: 'ghost@example.com', password: 'Whatever1!' });
  assert.equal(unknown.status, 401);
  // No account enumeration: same message as wrong password
  assert.equal(unknown.body.error.message, bad.body.error.message);
});

test('GET /auth/me requires a valid token', async () => {
  const noAuth = await request.get('/api/auth/me');
  assert.equal(noAuth.status, 401);

  const garbage = await request.get('/api/auth/me').set('Authorization', 'Bearer garbage');
  assert.equal(garbage.status, 401);
  assert.equal(garbage.body.error.code, 'UNAUTHORIZED');
});

test('GET /auth/me returns current user for a valid token', async () => {
  await request
    .post('/api/auth/register')
    .send({ email: 'me@example.com', password: 'Password123!' });
  const token = await ctx.helpers.loginToken('me@example.com');
  const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'me@example.com');
  assert.ok(!('passwordHash' in res.body.user));
});