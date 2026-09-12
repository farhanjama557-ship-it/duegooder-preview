'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const schema = require('../lib/schema');

test('example record validates', () => {
  const r = schema.validateSection(schema.exampleSection());
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.valid, true);
});

test('empty record reports every required field, not fake defaults', () => {
  const r = schema.validateSection(schema.emptySection());
  assert.strictEqual(r.valid, false);
  const required = schema.FIELDS.filter(f => f.required && f.type !== 'array').map(f => f.field);
  for (const f of required) {
    assert.ok(r.errors.some(e => e.startsWith(f)), `expected an error for required field ${f}`);
  }
});

test('optional fields may be null; required fields may not', () => {
  const rec = schema.exampleSection();
  rec.instructor = null; rec.crn = null; rec.location = null; rec.seats_available = null;
  assert.strictEqual(schema.validateSection(rec).valid, true, 'nullable fields accept null');
  rec.subject = null;
  const r = schema.validateSection(rec);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.includes('subject must not be null'));
});

test('rejects unknown fields', () => {
  const rec = schema.exampleSection();
  rec.enrollment_count = 30;
  const r = schema.validateSection(rec);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('unknown field: enrollment_count')));
});

test('rejects invalid enums, days, times and urls', () => {
  const bad = Object.assign(schema.exampleSection(), {
    extraction_status: 'done',
    enrollment_status: 'full',
    meeting_days: ['MON', 'WE', 'WE'],
    start_time: '25:00',
    source_url: 'ssb.appstate.edu'
  });
  const r = schema.validateSection(bad);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('extraction_status must be one of')));
  assert.ok(r.errors.some(e => e.startsWith('enrollment_status must be one of')));
  assert.ok(r.errors.some(e => e.includes('invalid day: MON')));
  assert.ok(r.errors.some(e => e.includes('duplicate days')));
  assert.ok(r.errors.some(e => e.includes('start_time must be 24h')));
  assert.ok(r.errors.some(e => e.includes('source_url must be an absolute')));
});

test('rejects end_time before start_time and non-object records', () => {
  const rec = Object.assign(schema.exampleSection(), { start_time: '11:00', end_time: '10:00' });
  assert.ok(schema.validateSection(rec).errors.includes('end_time must be after start_time'));
  assert.strictEqual(schema.validateSection(null).valid, false);
  assert.strictEqual(schema.validateSection('x').valid, false);
  assert.strictEqual(schema.validateSection([]).valid, false);
});

test('async section with no meetings is valid (empty array, not fake data)', () => {
  const rec = Object.assign(schema.exampleSection(), { meeting_days: [], start_time: null, end_time: null, location: null });
  assert.strictEqual(schema.validateSection(rec).valid, true);
});

test('extraction status enum is exactly the documented set', () => {
  assert.deepStrictEqual(schema.EXTRACTION_STATUS.slice(),
    ['complete', 'partial_source_missing', 'partial_extraction_failure', 'failed']);
});
