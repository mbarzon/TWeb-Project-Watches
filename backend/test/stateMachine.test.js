import { test } from 'node:test';
import assert from 'node:assert';
import {
  checkTransition,
  assertTransition,
  isTerminal,
  actorFor
} from '../src/services/auctionStateMachine.js';
import { AUCTION_STATUSES as S } from '../src/models/index.js';

const future = (hours = 1) => new Date(Date.now() + hours * 3600_000);
const past = () => new Date(Date.now() - 3600_000);

test('legal seller transition DRAFT -> SCHEDULED with valid dates', () => {
  const r = checkTransition({
    from: S.DRAFT,
    to: S.SCHEDULED,
    actor: 'SELLER',
    context: { startsAt: future(), endsAt: future(2) }
  });
  assert.equal(r.ok, true);
});

test('DRAFT -> SCHEDULED rejected when endsAt <= startsAt (precondition)', () => {
  const r = checkTransition({
    from: S.DRAFT,
    to: S.SCHEDULED,
    actor: 'SELLER',
    context: { startsAt: future(), endsAt: past() }
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PRECONDITION_FAILED');
});

test('nonexistent transitions are rejected regardless of actor', () => {
  for (const [from, to] of [
    [S.DRAFT, S.ACTIVE], // cannot skip SCHEDULED
    [S.DRAFT, S.ENDED],
    [S.ENDED, S.ACTIVE], // terminal
    [S.CANCELLED, S.SCHEDULED], // terminal
    [S.ENDED, S.ACTIVE]
  ]) {
    const r = checkTransition({ from, to, actor: 'SELLER' });
    assert.equal(r.ok, false, `${from} -> ${to}`);
    assert.equal(r.code, 'INVALID_TRANSITION');
  }
});

test('repeated scheduling is rejected (second one has no edge SCHEDULED -> SCHEDULED)', () => {
  const r = checkTransition({ from: S.SCHEDULED, to: S.SCHEDULED, actor: 'SELLER' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'INVALID_TRANSITION');
});

test('ordinary user cannot end an ACTIVE auction (only ADMIN/SYSTEM)', () => {
  const r = checkTransition({
    from: S.ACTIVE,
    to: S.ENDED,
    actor: 'SELLER',
    context: { endsAt: past() }
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNAUTHORIZED_TRANSITION');
});

test('system can close an ACTIVE auction only after endsAt (deadline invariant)', () => {
  const early = checkTransition({
    from: S.ACTIVE,
    to: S.ENDED,
    actor: 'SYSTEM',
    context: { endsAt: future() }
  });
  assert.equal(early.ok, false);
  assert.equal(early.code, 'PRECONDITION_FAILED');

  const due = checkTransition({
    from: S.ACTIVE,
    to: S.ENDED,
    actor: 'SYSTEM',
    context: { endsAt: past() }
  });
  assert.equal(due.ok, true);
});

test('SCHEDULED -> ACTIVE is blocked before startsAt', () => {
  const r = checkTransition({
    from: S.SCHEDULED,
    to: S.ACTIVE,
    actor: 'SELLER',
    context: { startsAt: future() }
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PRECONDITION_FAILED');
});

test('assertTransition throws ConflictError with proper code', () => {
  assert.throws(
    () =>
      assertTransition({ from: S.ACTIVE, to: S.DRAFT, actor: 'SELLER', context: {} }),
    (err) => err.status === 409 && err.code === 'INVALID_TRANSITION'
  );
});

test('isTerminal and actorFor', () => {
  assert.equal(isTerminal(S.ENDED), true);
  assert.equal(isTerminal(S.CANCELLED), true);
  assert.equal(isTerminal(S.ACTIVE), false);
  assert.equal(actorFor(null), 'GUEST');
  assert.equal(actorFor({ role: 'ADMIN' }), 'ADMIN');
  assert.equal(actorFor({ role: 'USER' }), 'SELLER');
});