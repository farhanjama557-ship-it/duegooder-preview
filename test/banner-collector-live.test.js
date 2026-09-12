'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const configs = require('../config/banner-universities.json');
const { collectBanner } = require('../lib/collectors/banner');

const LIVE = process.env.DG_LIVE === '1';
const skip = LIVE ? false : 'live network tests are opt-in: run npm run test:live';
const SUCCESSFUL_TRIO = ['uwf.edu', 'udayton.edu', 'ung.edu'];

for (const domain of SUCCESSFUL_TRIO) {
  const school = configs.find(config => config.domain === domain);
  assert.ok(school, `missing Banner configuration for ${domain}`);
  test(`live collection: ${school.domain} returns real sections and timed meetings`, { skip, timeout: 180000 }, async () => {
    const result = await collectBanner(school, { term: 'latest', timeoutMs: 30000 });
    console.log(`  ${school.domain}: ${result.sections.length} sections, ${result.meetings.length} meetings, ${result.metrics.http_requests} requests`);
    assert.strictEqual(result.status, 'complete');
    assert.ok(result.terms.length > 0, 'terms discovered');
    assert.ok(result.subjects.length > 0, 'subjects discovered');
    assert.ok(result.sections.length > 0, 'actual sections collected');
    assert.ok(result.sections.every(s => s.crn || (s.subject && s.course_number && s.section_number)), 'stable identities available');
    assert.ok(result.meetings.some(m => m.start_time && m.end_time), 'real meeting times collected');
    assert.ok(result.sections.every(s => s.source_url && s.retrieved_at && s.extraction_status), 'provenance fields present');
  });
}
