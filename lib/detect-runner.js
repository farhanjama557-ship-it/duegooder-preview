'use strict';
/**
 * Runs detectors over institutions and records every execution as a run.
 *
 * Every detector execution - success, no match, or failure - produces one run
 * record. The Recent Runs page is rendered from these records; there is no
 * separate "demo" source.
 */
const registry = require('./detectors');

function newRunId(seq) {
  return 'run_' + String(seq).padStart(6, '0');
}

/**
 * @param {Array<{domain:string, school_id?:string, school_name?:string}>} institutions
 * @param {object} opts
 *   platform      detector to use (default 'banner')
 *   fetchImpl     injected fetch (tests)
 *   timeoutMs     per-request timeout
 *   concurrency   parallel institutions (default 2 - deliberately low)
 *   delayMs       pause between institutions (default 750ms)
 *   cache         { [domain]: {detection, detected_at} } reused when fresh
 *   cacheTtlMs    default 24h
 *   startSeq      first run sequence number
 *   onResult      callback(detection, run)
 */
async function runDetection(institutions, opts = {}) {
  const detector = registry.get(opts.platform || 'banner');
  if (!detector) throw new Error(`unknown platform: ${opts.platform}`);
  if (!detector.implemented) throw new Error(`detector not implemented: ${detector.platform}`);

  const concurrency = Math.max(1, Math.min(opts.concurrency || 2, 4));
  const delayMs = opts.delayMs == null ? 750 : opts.delayMs;
  const cacheTtlMs = opts.cacheTtlMs == null ? 24 * 60 * 60 * 1000 : opts.cacheTtlMs;
  const cache = opts.cache || {};
  const now = opts.now || (() => Date.now());

  const detections = [];
  const runs = [];
  let seq = opts.startSeq || 1;
  let cacheHits = 0;

  const queue = institutions.slice();
  async function worker() {
    while (queue.length) {
      const inst = queue.shift();
      const cached = cache[inst.domain];
      if (cached && cached.detection && (now() - Date.parse(cached.detection.detected_at)) < cacheTtlMs) {
        cacheHits++;
        detections.push(cached.detection);
        continue;                                   // cache hit: no request, no run record
      }
      const startedAt = new Date(now()).toISOString();
      const t0 = Date.now();
      let detection;
      try {
        detection = await detector.detect(inst, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs, respectRobots: opts.respectRobots });
      } catch (err) {
        detection = {
          school_id: inst.school_id || null, school_name: inst.school_name || null, domain: inst.domain,
          platform: detector.platform, confidence: 0, confidence_band: null, registration_url: null,
          evidence: [], detected_at: new Date(now()).toISOString(), result: 'request_failed',
          requests: 0, error: `detector threw: ${err.message}`
        };
      }
      const durationMs = Date.now() - t0;
      const run = {
        run_id: newRunId(seq++),
        school_id: detection.school_id,
        school_name: detection.school_name,
        domain: detection.domain,
        platform: detector.platform,
        status: detection.result,
        confidence: detection.result === 'detected' ? detection.confidence : null,
        duration_ms: durationMs,
        requests: detection.requests || 0,
        started_at: startedAt,
        finished_at: new Date(now()).toISOString(),
        evidence: detection.evidence || [],
        error: detection.error || null
      };
      detections.push(detection);
      runs.push(run);
      if (opts.onResult) opts.onResult(detection, run);
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { detections, runs, cacheHits };
}

/** Metrics computed from real run records - never hand-written. */
function summarize(runs) {
  const total = runs.length;
  const by = {};
  for (const r of runs) by[r.status] = (by[r.status] || 0) + 1;
  const detected = by.detected || 0;
  const noMatch = by.no_match || 0;
  const failed = total - detected - noMatch;
  // largest-remainder rounding so the displayed percentages always total 100
  const pcts = (() => {
    if (!total) return { detected: 0, no_match: 0, failed: 0 };
    const parts = [['detected', detected], ['no_match', noMatch], ['failed', failed]]
      .map(([k, n]) => ({ k, exact: (n / total) * 100 }));
    const out = {};
    let used = 0;
    for (const p of parts) { out[p.k] = Math.floor(p.exact); used += out[p.k]; }
    parts.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
    for (let i = 0; used < 100 && i < parts.length; i++, used++) out[parts[i].k]++;
    return out;
  })();
  const confidences = runs.filter(r => typeof r.confidence === 'number').map(r => r.confidence);
  return {
    total,
    detected, no_match: noMatch, failed,
    by_status: by,
    pct: pcts,
    avg_confidence: confidences.length
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2)) : null,
    total_requests: runs.reduce((a, r) => a + (r.requests || 0), 0),
    avg_duration_ms: total ? Math.round(runs.reduce((a, r) => a + r.duration_ms, 0) / total) : 0
  };
}

module.exports = { runDetection, summarize, newRunId };
