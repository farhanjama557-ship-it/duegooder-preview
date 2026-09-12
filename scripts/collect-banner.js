#!/usr/bin/env node
'use strict';
/**
 * Collect public Banner 9 terms, subjects, sections and meetings.
 *
 * Usage:
 *   npm run collect:banner
 *   npm run collect:banner -- --schools uwf.edu,udayton.edu,ung.edu --repeat 2
 *   npm run collect:banner -- --term 202680 --schools udayton.edu
 */
const path = require('path');
const configs = require('../config/banner-universities.json');
const { runCollection } = require('../lib/collection-runner');
const { persistCollection } = require('../lib/collection-store');

const DATA = path.join(__dirname, '..', 'assets', 'data');

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function targets() {
  const requested = option('--schools', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!requested.length) return configs;
  const selected = requested.map(domain => configs.find(c => c.domain === domain));
  const missing = requested.filter((_, i) => !selected[i]);
  if (missing.length) throw new Error(`No verified Banner configuration for: ${missing.join(', ')}. App State is intentionally not forced.`);
  return selected;
}

function printRun(record) {
  for (const school of record.schools) {
    const detail = school.error ? ` | ${school.error}` : '';
    console.log(`  ${school.domain.padEnd(20)} ${school.status.padEnd(9)} ` +
      `${school.sections} sections | ${school.meetings} meetings | ${school.http_requests} requests | ${school.runtime_ms}ms${detail}`);
  }
  const m = record.metrics;
  console.log(`  totals: ${m.schools_processed} schools | ${m.sections} sections | ${m.meetings} meetings ` +
    `(${m.meetings_with_times} timed) | ${m.http_requests} HTTP requests | ${m.runtime_ms}ms | ` +
    `${m.failures} failures | ${m.manual_intervention} manual | $${m.direct_cost_usd.toFixed(2)} direct cost`);
  const p = record.persistence;
  console.log(`  persistence: ${p.sections.created} sections created | ${p.sections.updated} updated | ` +
    `${p.sections.unchanged} matched | ${p.sections.duplicates_prevented} duplicate creations prevented`);
}

async function main() {
  const schools = targets();
  const repeat = Math.max(1, Math.min(10, Number(option('--repeat', '1')) || 1));
  const term = option('--term', 'latest');
  const timeoutMs = Number(option('--timeout', '20000'));
  let failed = false;
  let firstCounts = null;
  for (let pass = 1; pass <= repeat; pass++) {
    console.log(`Banner collection pass ${pass}/${repeat}: ${schools.map(s => s.domain).join(', ')} (term=${term})`);
    const run = await runCollection(schools, {
      term, timeoutMs,
      runId: `collection_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_p${pass}`
    });
    const persisted = persistCollection(DATA, run);
    printRun(persisted);
    if (persisted.status !== 'complete' || persisted.metrics.schools_complete !== schools.length
        || persisted.metrics.sections === 0 || persisted.metrics.meetings_with_times === 0) failed = true;
    if (pass === 1) firstCounts = persisted.metrics;
    if (pass > 1) {
      if (persisted.persistence.sections.created !== 0 || persisted.persistence.meetings.created !== 0) {
        console.error('Idempotency failure: repeat pass created duplicate sections or meetings.');
        failed = true;
      }
      if (firstCounts && (persisted.metrics.sections !== firstCounts.sections || persisted.metrics.meetings !== firstCounts.meetings)) {
        console.error('Repeat verification failure: live counts changed between immediate passes.');
        failed = true;
      }
    }
  }
  if (failed) {
    console.error('Phase 3 live verification did not pass for every requested school.');
    process.exitCode = 1;
  } else {
    console.log(repeat > 1 ? 'PASS: real sections/meeting times verified twice with zero duplicate creation.'
      : 'PASS: real sections and meeting times verified. Use --repeat 2 to prove idempotency.');
  }
}

main().catch(err => { console.error(err.message || err); process.exitCode = 1; });
