'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const banner = require('../lib/detectors/banner');
const { runDetection, summarize } = require('../lib/detect-runner');
const { statusFor, STATUS } = require('../lib/status');

/* ---------- fixtures: real-shaped public pages, no network ---------- */
const BANNER_HOMEPAGE = `<!doctype html><html><head><title>State University</title></head><body>
  <a href="https://ssb.example-state.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search">Register for classes</a>
  <a href="/admissions">Admissions</a></body></html>`;

const BANNER_REGISTRATION_PAGE = `<!doctype html><html><head><title>Select a Term</title>
  <link rel="stylesheet" href="/StudentRegistrationSsb/css/registration.css"></head><body>
  <div id="termSelection">Banner Self-Service</div>
  <script src="/StudentRegistrationSsb/ssb/classSearch/classSearch"></script>
  <footer>&copy; 2026 Ellucian Company L.P. and its affiliates.</footer></body></html>`;

const NON_BANNER_HOMEPAGE = `<!doctype html><html><body>
  <h1>Custom College</h1>
  <img src="/images/banner-hero.jpg" alt="campus banner">
  <a href="/course-catalog">Course catalog</a>
  <a href="https://my.customcollege.edu/registration">Student portal</a></body></html>`;

const WORKDAY_HOMEPAGE = `<!doctype html><html><body>
  <a href="https://wd5.myworkday.com/customcollege/login.htmld">Student system</a></body></html>`;

function fakeFetch(routes) {
  return async function (url) {
    const key = Object.keys(routes).find(k => url.startsWith(k));
    if (!key) return { status: 404, url, text: async () => 'not found' };
    const r = routes[key];
    if (typeof r === 'function') return r(url);
    return { status: r.status || 200, url: r.url || url, text: async () => r.body || '' };
  };
}

/* ---------- scoring rules ---------- */
test('scoring: the word "banner" alone never classifies a school', () => {
  const found = banner.scanSource('https://customcollege.edu/', NON_BANNER_HOMEPAGE);
  const { confidence, structural } = banner.score(found);
  assert.strictEqual(structural, false, 'no structural signal should match');
  assert.ok(confidence < banner.BAND.MIN, `confidence ${confidence} must stay below ${banner.BAND.MIN}`);
});

test('scoring: strong fingerprints add up to a high band', () => {
  const found = banner.scanSource('https://ssb.x.edu/StudentRegistrationSsb/ssb/term/termSelection', BANNER_REGISTRATION_PAGE);
  const { confidence, structural } = banner.score(found);
  assert.strictEqual(structural, true);
  assert.ok(confidence >= banner.BAND.HIGH, `expected high band, got ${confidence}`);
  assert.strictEqual(banner.band(confidence), 'high');
});

test('scoring: bands map exactly as documented', () => {
  assert.strictEqual(banner.band(0.95), 'high');
  assert.strictEqual(banner.band(0.80), 'high');
  assert.strictEqual(banner.band(0.79), 'medium');
  assert.strictEqual(banner.band(0.55), 'medium');
  assert.strictEqual(banner.band(0.54), 'low');
  assert.strictEqual(banner.band(0.35), 'low');
  assert.strictEqual(banner.band(0.34), null);
});

test('candidate extraction pulls Banner links out of a homepage', () => {
  const urls = banner.candidateUrlsFrom(BANNER_HOMEPAGE, 'https://example-state.edu/');
  assert.ok(urls.length >= 1);
  assert.ok(urls[0].includes('StudentRegistrationSsb'));
});

/* ---------- end-to-end detector outcomes ---------- */
test('positive: Banner school is detected with evidence and a registration URL', async () => {
  const res = await banner.detect({ domain: 'example-state.edu', school_id: 'example-state', school_name: 'State University' }, {
    respectRobots: false,
    fetchImpl: fakeFetch({
      'https://example-state.edu/': { body: BANNER_HOMEPAGE },
      'https://ssb.example-state.edu/StudentRegistrationSsb': { body: BANNER_REGISTRATION_PAGE }
    })
  });
  assert.strictEqual(res.result, 'detected');
  assert.strictEqual(res.platform, 'banner');
  assert.strictEqual(res.confidence_band, 'high');
  assert.ok(res.confidence >= 0.8);
  assert.ok(res.registration_url.includes('StudentRegistrationSsb'));
  assert.ok(res.evidence.length >= 2, 'multiple independent signals required');
  assert.ok(res.requests <= 5, `stayed cheap: ${res.requests} requests`);
  assert.match(res.detected_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('negative: non-Banner school is no_match, not a false positive', async () => {
  const res = await banner.detect({ domain: 'customcollege.edu' }, {
    respectRobots: false,
    fetchImpl: fakeFetch({ 'https://customcollege.edu/': { body: NON_BANNER_HOMEPAGE } })
  });
  assert.strictEqual(res.result, 'no_match');
  assert.strictEqual(res.registration_url, null);
  assert.strictEqual(res.confidence_band, null);
});

test('negative: a Workday school is not claimed as Banner', async () => {
  const res = await banner.detect({ domain: 'customcollege.edu' }, {
    respectRobots: false,
    fetchImpl: fakeFetch({ 'https://customcollege.edu/': { body: WORKDAY_HOMEPAGE } })
  });
  assert.strictEqual(res.result, 'no_match');
});

test('timeout is reported as timeout, not as no_match or manual review', async () => {
  const res = await banner.detect({ domain: 'slow.edu' }, {
    respectRobots: false,
    fetchImpl: async () => { const e = new Error('timed out'); e.name = 'AbortError'; throw e; }
  });
  assert.strictEqual(res.result, 'timeout');
  assert.ok(res.error);
  assert.strictEqual(statusFor(res), STATUS.DISCOVERING, 'a timeout must not become MANUAL REVIEW');
});

test('connection failure is reported as request_failed', async () => {
  const res = await banner.detect({ domain: 'unreachable.edu' }, {
    respectRobots: false,
    fetchImpl: async () => { const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
  });
  assert.strictEqual(res.result, 'request_failed');
  assert.strictEqual(statusFor(res), STATUS.DISCOVERING);
});

test('HTTP 403 is reported as blocked', async () => {
  const res = await banner.detect({ domain: 'blocked.edu' }, {
    respectRobots: false,
    fetchImpl: fakeFetch({ 'https://blocked.edu/': { status: 403 } })
  });
  assert.strictEqual(res.result, 'blocked');
});

test('robots.txt disallow is honoured before any probing', async () => {
  let requests = 0;
  const res = await banner.detect({ domain: 'polite.edu' }, {
    fetchImpl: async (url) => {
      requests++;
      if (url.endsWith('/robots.txt')) return { status: 200, url, text: async () => 'User-agent: *\nDisallow: /StudentRegistrationSsb' };
      return { status: 200, url, text: async () => BANNER_HOMEPAGE };
    }
  });
  assert.strictEqual(res.result, 'blocked');
  assert.strictEqual(requests, 1, 'stops after robots.txt');
});

test('invalid domain fails fast without any request', async () => {
  let requests = 0;
  const res = await banner.detect({ domain: 'not a domain' }, {
    respectRobots: false,
    fetchImpl: async () => { requests++; return { status: 200, url: 'x', text: async () => '' }; }
  });
  assert.strictEqual(res.result, 'request_failed');
  assert.strictEqual(requests, 0);
  assert.match(res.error, /invalid domain/);
});

test('unreadable response body is parse_failure, not request_failed', async () => {
  const res = await banner.detect({ domain: 'weird.edu' }, {
    respectRobots: false,
    fetchImpl: async (url) => ({ status: 200, url, text: async () => { throw new Error('stream aborted'); } })
  });
  assert.strictEqual(res.result, 'parse_failure');
  assert.match(res.error, /could not read response body/);
});

test('a catch-all 200 on a guessed Banner URL is NOT a detection', async () => {
  // Server answers every path with its generic homepage. The URL we constructed
  // must not count as evidence.
  const res = await banner.detect({ domain: 'catchall.edu' }, {
    respectRobots: false,
    fetchImpl: async (url) => ({ status: 200, url, text: async () => NON_BANNER_HOMEPAGE })
  });
  assert.strictEqual(res.result, 'no_match', `got ${res.result} with evidence ${JSON.stringify(res.evidence)}`);
});

test('result shape is normalized for every outcome', async () => {
  const keys = ['school_id', 'school_name', 'domain', 'platform', 'confidence', 'confidence_band',
    'registration_url', 'evidence', 'detected_at', 'result', 'requests', 'error'];
  for (const f of [
    fakeFetch({ 'https://a.edu/': { body: BANNER_HOMEPAGE }, 'https://ssb.a.edu': { body: BANNER_REGISTRATION_PAGE } }),
    fakeFetch({ 'https://a.edu/': { body: NON_BANNER_HOMEPAGE } }),
    async () => { throw new Error('nope'); }
  ]) {
    const res = await banner.detect({ domain: 'a.edu' }, { respectRobots: false, fetchImpl: f });
    assert.deepStrictEqual(Object.keys(res).sort(), keys.slice().sort());
  }
});

/* ---------- runner + metrics ---------- */
test('runner records one run per execution and computes metrics from them', async () => {
  const { detections, runs } = await runDetection(
    [{ domain: 'example-state.edu' }, { domain: 'customcollege.edu' }, { domain: 'down.edu' }],
    {
      delayMs: 0, concurrency: 1, respectRobots: false,
      fetchImpl: async (url) => {
        if (url.startsWith('https://down.edu')) throw Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
        if (url.startsWith('https://example-state.edu')) return { status: 200, url, text: async () => BANNER_HOMEPAGE };
        if (url.startsWith('https://ssb.example-state.edu')) return { status: 200, url, text: async () => BANNER_REGISTRATION_PAGE };
        return { status: 200, url, text: async () => NON_BANNER_HOMEPAGE };
      }
    });
  assert.strictEqual(runs.length, 3);
  assert.strictEqual(detections.length, 3);
  for (const r of runs) {
    assert.match(r.run_id, /^run_\d{6}$/);
    assert.ok(typeof r.duration_ms === 'number');
    assert.ok(r.started_at && r.finished_at);
  }
  const s = summarize(runs);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.detected, 1);
  assert.strictEqual(s.no_match, 1);
  assert.strictEqual(s.failed, 1);
  assert.strictEqual(s.pct.detected + s.pct.no_match + s.pct.failed, 100);
});

test('fresh cached detections are reused instead of re-requesting', async () => {
  let calls = 0;
  const cached = { domain: 'example-state.edu', result: 'detected', confidence: 0.9, detected_at: new Date().toISOString() };
  const { runs, cacheHits } = await runDetection([{ domain: 'example-state.edu' }], {
    delayMs: 0, respectRobots: false, cache: { 'example-state.edu': { detection: cached } },
    fetchImpl: async () => { calls++; return { status: 200, url: 'x', text: async () => '' }; }
  });
  assert.strictEqual(cacheHits, 1);
  assert.strictEqual(calls, 0);
  assert.strictEqual(runs.length, 0, 'a cache hit is not a detector execution');
});

/* ---------- status model ---------- */
test('status model never yields LIVE in phase 2 and keeps errors out of MANUAL REVIEW', () => {
  assert.strictEqual(statusFor({ result: 'detected', platform: 'banner' }), STATUS.SUPPORTED);
  assert.strictEqual(statusFor({ result: 'no_match' }), STATUS.MANUAL_REVIEW);
  assert.strictEqual(statusFor(null), STATUS.DISCOVERING);
  for (const bad of ['timeout', 'request_failed', 'blocked', 'parse_failure']) {
    assert.strictEqual(statusFor({ result: bad }), STATUS.DISCOVERING, `${bad} must not be MANUAL REVIEW`);
  }
  assert.strictEqual(statusFor({ result: 'detected', platform: 'workday' }), STATUS.DISCOVERING,
    'detected on a platform we have no connector for is not SUPPORTED');
  assert.strictEqual(statusFor({ result: 'detected', platform: 'banner' }, { collectionVerified: true }), STATUS.LIVE);
});

test('unimplemented detectors never classify anything', async () => {
  for (const p of ['peoplesoft', 'workday', 'colleague', 'custom']) {
    const d = require(`../lib/detectors/${p}`);
    assert.strictEqual(d.implemented, false);
    const res = await d.detect({ domain: 'anything.edu' });
    assert.strictEqual(res.result, 'not_implemented');
    assert.strictEqual(res.confidence, 0);
  }
});
