import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/app.js';

test('GET /health returns ok', async () => {
  const app = createApp();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('404 responses use the consistent error envelope', async () => {
  const app = createApp();
  const res = await request(app).get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('malformed JSON returns 400 with consistent envelope', async () => {
  const app = createApp();
  const res = await request(app)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .send('{"broken":');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'MALFORMED_JSON');
});