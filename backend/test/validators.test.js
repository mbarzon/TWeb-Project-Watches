import { test } from 'node:test';
import assert from 'node:assert';
import { runValidation } from '../src/utils/validators.js';

test('validators: string rules (trim, length bounds, enum)', () => {
  const spec = {
    name: { type: 'string', required: true, min: 2, max: 5 },
    tag: { type: 'string', enum: ['a', 'b'] }
  };
  const ok = runValidation({ name: '  Anon  ', tag: 'b' }, spec);
  assert.equal(ok.values.name, 'Anon');
  assert.equal(ok.values.tag, 'b');
  assert.equal(ok.errors.length, 0);

  const bad = runValidation({ name: 'x', tag: 'z' }, spec);
  const fields = Object.fromEntries(bad.errors.map((e) => [e.field, e.message]));
  assert.match(fields.name, /at least 2/);
  assert.match(fields.tag, /one of/);

  const missing = runValidation({}, spec);
  assert.ok(missing.errors.some((e) => e.field === 'name' && e.message.includes('required')));
  // OPTIONAL missing fields are simply absent
  assert.ok(!missing.errors.some((e) => e.field === 'tag' && !spec.tag.required));

  // trim can be disabled
  const noTrim = runValidation({ name: '  Ab  ' }, { name: { type: 'string', trim: false, min: 2 } });
  assert.equal(noTrim.values.name, '  Ab  ');
});

test('validators: integer rules (string coercion, bounds)', () => {
  const spec = { page: { type: 'integer', min: 1, max: 10 } };
  assert.equal(runValidation({ page: '3' }, spec).values.page, 3);
  assert.equal(runValidation({ page: 7 }, spec).values.page, 7);
  assert.ok(runValidation({ page: 'xx' }, spec).errors[0].message.includes('integer'));
  assert.ok(runValidation({ page: '0' }, spec).errors[0].message.includes('>= 1'));
  assert.ok(runValidation({ page: '11' }, spec).errors[0].message.includes('<= 10'));
  // whitespace-only string is NOT coerced
  assert.ok(runValidation({ page: '   ' }, spec).errors.length === 1);
});

test('validators: datetime and boolean rules', () => {
  const spec = {
    when: { type: 'datetime', required: true },
    active: { type: 'boolean' }
  };
  const ok = runValidation({ when: '2026-01-01T00:00:00Z', active: false }, spec);
  assert.ok(ok.values.when instanceof Date, 'datetime parses to a Date');
  assert.equal(ok.values.when.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(ok.values.active, false);
  assert.equal(ok.errors.length, 0);

  const bad = runValidation({ when: 'not-a-date', active: 'yes' }, spec);
  assert.ok(bad.errors.some((e) => e.field === 'when'));
  assert.ok(bad.errors.some((e) => e.field === 'active'));
  // missing required datetime
  const missing = runValidation({}, spec);
  assert.ok(missing.errors.some((e) => e.field === 'when' && e.message.includes('required')));
});

test('validators: null/undefined input shapes', () => {
  const spec = { a: { type: 'string', required: true } };
  const fromNull = runValidation(null, spec);
  assert.ok(fromNull.errors.some((e) => e.field === 'a'));
  const optional = runValidation(null, { a: { type: 'string' } });
  assert.equal(optional.errors.length, 0);
});
test('validators: empty string counts as missing for required fields', () => {
  const spec = { q: { type: 'string' }, must: { type: 'string', required: true } };
  const res = runValidation({ q: '', must: '' }, spec);
  assert.ok(res.errors.some((e) => e.field === 'must'));
  assert.ok(!('q' in res.values));
});