'use strict';
/**
 * Opt-in live detection tests. These make real requests to real universities,
 * so they are skipped unless you ask for them:
 *
 *   DG_LIVE=1 npm test          (or: npm run test:live)
 *
 * They are the regression guard for the Phase 2 discovery repair: UWF publishes
 * Banner 9 at apps.banner.uwf.edu, which the first implementation missed.
 * Nothing here is school-specific in the detector - these only assert outcomes.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const banner = require('../lib/detectors/banner');

const LIVE = process.env.DG_LIVE === '1';
const skip = LIVE ? false : 'live network tests are opt-in: run with DG_LIVE=1';
const VALID = ['detected', 'no_match', 'request_failed', 'timeout', 'blocked', 'parse_failure'];

function report(label, res) {
  console.log(`  ${label.padEnd(16)} ${res.result.padEnd(15)} confidence ${res.confidence} ` +
    `${res.confidence_band || ''} | ${res.requests} requests | ${res.evidence.length} signals` +
    `${res.registration_url ? '\n                   ' + res.registration_url : ''}` +
    `${res.error ? '\n                   error: ' + res.error : ''}`);
}

test('live: uwf.edu is detected as Banner (apps.banner.<domain> discovery)', { skip, timeout: 120000 }, async () => {
  const res = await banner.detect({ domain: 'uwf.edu', school_name: 'University of West Florida' });
  report('uwf.edu', res);
  assert.strictEqual(res.result, 'detected',
    `expected Banner. evidence=${JSON.stringify(res.evidence)} error=${res.error}`);
  assert.ok(res.evidence.length >= 2, 'multiple independent signals');
  assert.ok(res.registration_url, 'a registration URL was found');
  assert.ok(res.requests <= banner.MAX_REQUESTS, `within budget: ${res.requests}`);
});

test('live: udayton.edu is detected as Banner', { skip, timeout: 120000 }, async () => {
  const res = await banner.detect({ domain: 'udayton.edu', school_name: 'University of Dayton' });
  report('udayton.edu', res);
  assert.strictEqual(res.result, 'detected', `evidence=${JSON.stringify(res.evidence)} error=${res.error}`);
});

test('live: appstate.edu returns a truthful outcome, never a forced one', { skip, timeout: 120000 }, async () => {
  // Deliberately NOT asserting Banner. App State's public class search appears to
  // use an older implementation; if the bounded discovery finds no structural
  // public signal, no_match is the correct, honest answer.
  const res = await banner.detect({ domain: 'appstate.edu', school_name: 'Appalachian State University' });
  report('appstate.edu', res);
  assert.ok(VALID.includes(res.result), `unexpected result ${res.result}`);
  if (res.result === 'detected') {
    assert.ok(res.evidence.length >= 2, 'a detection must rest on multiple signals');
    assert.ok(res.registration_url, 'a detection must produce a registration URL');
  } else {
    assert.strictEqual(res.registration_url, null);
    assert.strictEqual(res.confidence_band, null);
  }
});

test('live: an invalid domain fails fast without classifying', { skip, timeout: 60000 }, async () => {
  const res = await banner.detect({ domain: 'this-university-does-not-exist-12345.edu' });
  report('nonexistent', res);
  assert.ok(['request_failed', 'timeout', 'no_match'].includes(res.result), res.result);
  assert.strictEqual(res.registration_url, null);
});
