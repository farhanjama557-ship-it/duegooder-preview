#!/usr/bin/env node
'use strict';
/**
 * Run the real platform detector against institutions and store the results.
 *
 * Usage:
 *   node scripts/detect.js appstate.edu udayton.edu uwf.edu
 *   node scripts/detect.js --from-directory --limit 25
 *   node scripts/detect.js --no-robots --timeout 8000 example.edu
 *
 * Storage (deliberately simple for a hackathon - no database):
 *   assets/data/detections.json   latest detection per domain
 *   assets/data/runs.json         every detector execution, newest first
 * Both files are written ONLY from real detector executions. Re-running merges:
 *   fresh detections (< 24h) are reused from the store instead of re-requesting.
 */
const fs = require('fs');
const path = require('path');
const { runDetection, summarize } = require('../lib/detect-runner');
const { schoolIdFor } = require('../lib/institutions');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'assets', 'data');
const DET_PATH = path.join(DATA, 'detections.json');
const RUNS_PATH = path.join(DATA, 'runs.json');
const MAX_RUNS = 500;

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}
function flag(name) { return process.argv.includes(name); }
function opt(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const store = readJson(DET_PATH, { detections: [], generated_at: null });
  const runsStore = readJson(RUNS_PATH, { runs: [], summary: null, generated_at: null });

  let targets = process.argv.slice(2).filter(a => !a.startsWith('--') && !/^\d+$/.test(a));
  const directory = readJson(path.join(DATA, 'institutions.json'), []);

  if (flag('--from-directory')) {
    const limit = Number(opt('--limit', '10'));
    targets = directory.slice(0, limit).map(i => i.domain);
  }
  if (!targets.length) {
    console.error('No domains given. Pass domains, or --from-directory --limit N');
    process.exitCode = 1;
    return;
  }

  const byDomain = new Map(directory.map(i => [i.domain, i]));
  const institutions = targets.map(d => {
    const domain = String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const known = byDomain.get(domain);
    return {
      domain,
      school_id: schoolIdFor(domain),
      school_name: known ? known.name : null,
      state: known ? known.state : null
    };
  });

  const cache = {};
  if (!flag('--force')) {
    for (const d of store.detections || []) cache[d.domain] = { detection: d };
  }

  console.log(`Running Banner detection against ${institutions.length} institution(s)`);
  console.log(`  timeout ${opt('--timeout', '10000')}ms | concurrency 2 | robots ${flag('--no-robots') ? 'ignored' : 'respected'}`);

  const { detections, runs, cacheHits } = await runDetection(institutions, {
    platform: 'banner',
    timeoutMs: Number(opt('--timeout', '10000')),
    concurrency: 2,
    delayMs: Number(opt('--delay', '750')),
    respectRobots: !flag('--no-robots'),
    cache,
    startSeq: (runsStore.runs || []).length + 1,
    onResult(det, run) {
      const conf = det.result === 'detected' ? ` confidence ${det.confidence} (${det.confidence_band})` : '';
      console.log(`  ${det.domain.padEnd(28)} ${det.result}${conf}  ${run.requests} req  ${run.duration_ms}ms${det.error ? '  [' + det.error + ']' : ''}`);
    }
  });

  // merge: latest detection per domain
  const merged = new Map((store.detections || []).map(d => [d.domain, d]));
  for (const d of detections) merged.set(d.domain, d);
  const allDetections = Array.from(merged.values()).sort((a, b) => String(a.domain).localeCompare(String(b.domain)));

  const allRuns = runs.concat(runsStore.runs || [])
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
    .slice(0, MAX_RUNS);

  fs.writeFileSync(DET_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    detector: 'banner',
    detections: allDetections
  }, null, 1));

  fs.writeFileSync(RUNS_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    summary: summarize(allRuns),
    runs: allRuns
  }, null, 1));

  const s = summarize(runs);
  console.log('\nThis session:');
  console.log(`  runs ${s.total} | detected ${s.detected} | no match ${s.no_match} | failed ${s.failed} | cache hits ${cacheHits}`);
  console.log(`  requests ${s.total_requests} | avg ${s.avg_duration_ms}ms | avg confidence ${s.avg_confidence === null ? 'n/a' : s.avg_confidence}`);
  console.log(`Stored ${allDetections.length} detections and ${allRuns.length} runs.`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
