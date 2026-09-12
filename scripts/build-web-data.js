#!/usr/bin/env node
'use strict';
/**
 * Generate the browser-side data that must not drift from the code:
 *   assets/data/schema.json    canonical schema fields + enums + example record
 *   assets/data/detectors.json detector registry (which platforms actually work)
 */
const fs = require('fs');
const path = require('path');
const schema = require('../lib/schema');
const detectors = require('../lib/detectors');
const banner = require('../lib/detectors/banner');

const OUT = path.join(__dirname, '..', 'assets', 'data');
fs.mkdirSync(OUT, { recursive: true });

fs.writeFileSync(path.join(OUT, 'schema.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  generated_from: 'lib/schema.js',
  fields: schema.FIELDS,
  extraction_status: schema.EXTRACTION_STATUS,
  enrollment_status: schema.ENROLLMENT_STATUS,
  meeting_days: schema.DAYS,
  example: schema.exampleSection()
}, null, 1));

fs.writeFileSync(path.join(OUT, 'detectors.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  generated_from: 'lib/detectors/',
  registry: detectors.registry(),
  banner: {
    signals: Object.entries(banner.SIGNALS).map(([key, s]) => ({ key, weight: s.weight, structural: s.structural, label: s.label })),
    routes: banner.BANNER_ROUTES,
    bands: banner.BAND,
    well_known_hosts: banner.WELL_KNOWN_HOSTS,
    candidate_path: banner.CANDIDATE_PATH,
    max_requests_per_school: banner.MAX_REQUESTS,
    hub_keywords: banner.HUB_KEYWORDS,
    max_hub_pages: banner.MAX_HUB_PAGES,
    timeout_ms: require('../lib/http').DEFAULT_TIMEOUT_MS,
    user_agent: require('../lib/http').USER_AGENT,
    cache_ttl_hours: 24,
    concurrency: 2,
    delay_ms: 750
  }
}, null, 1));

/* Ship empty (not invented) data files so the pages fetch a real 200 with an
   empty dataset instead of a 404. scripts/import-institutions.js and
   scripts/detect.js overwrite these with real data. */
const EMPTY = {
  'institutions.json': [],
  'detections.json': { generated_at: null, detector: 'banner', detections: [] },
  'runs.json': { generated_at: null, summary: null, runs: [] },
  'sections.json': { generated_at: null, identity: null, sections: [] },
  'meetings.json': { generated_at: null, identity: null, meetings: [] },
  'terms.json': { generated_at: null, terms: [] },
  'subjects.json': { generated_at: null, subjects: [] },
  'provenance.json': { generated_at: null, sources: [] },
  'collections.json': { generated_at: null, latest: null, runs: [] }
};
for (const [name, value] of Object.entries(EMPTY)) {
  const file = path.join(OUT, name);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(value, null, 1));
    console.log(`Created empty ${name} (no data yet)`);
  }
}

console.log('Wrote assets/data/schema.json and assets/data/detectors.json');
