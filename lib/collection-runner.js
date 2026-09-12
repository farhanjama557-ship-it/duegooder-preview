'use strict';
/** Orchestrates one measurable Banner collection pass across configured schools. */
const { collectBanner } = require('./collectors/banner');

function runId(now) {
  return 'collection_' + new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

async function runCollection(schools, opts = {}) {
  const startedMs = Date.now();
  const startedAt = new Date(opts.now ? opts.now() : Date.now()).toISOString();
  const all = { terms: [], subjects: [], sections: [], meetings: [], provenance: [], extraction_failures: [] };
  const schoolRuns = [];

  // Banner sessions are deliberately isolated and sequential. This is polite to
  // public systems and makes request counts/retries reproducible.
  for (const school of schools) {
    const before = Date.now();
    try {
      const result = await collectBanner(school, opts);
      all.terms.push(...result.terms);
      all.subjects.push(...result.subjects);
      all.sections.push(...result.sections);
      all.meetings.push(...result.meetings);
      all.provenance.push(...result.provenance);
      all.extraction_failures.push(...result.extraction_failures);
      schoolRuns.push({
        school_id: school.school_id, school_name: school.school_name, domain: school.domain,
        registration_url: school.registration_url, status: result.status,
        selected_terms: result.selected_terms, terms_discovered: result.terms.length,
        subjects: result.subjects.length, sections: result.metrics.sections,
        meetings: result.metrics.meetings, meetings_with_times: result.metrics.meetings_with_times,
        http_requests: result.metrics.http_requests, runtime_ms: result.metrics.runtime_ms,
        failures: result.metrics.failures, manual_intervention: 0, direct_cost_usd: 0,
        error: null
      });
    } catch (err) {
      const provenance = err && err.details && Array.isArray(err.details.provenance) ? err.details.provenance : [];
      all.provenance.push(...provenance);
      schoolRuns.push({
        school_id: school.school_id, school_name: school.school_name, domain: school.domain,
        registration_url: school.registration_url, status: 'failed', selected_terms: [],
        terms_discovered: 0, subjects: 0, sections: 0, meetings: 0, meetings_with_times: 0,
        http_requests: Number(err && err.details && err.details.http_requests) || 0,
        runtime_ms: Date.now() - before, failures: 1, manual_intervention: 0,
        direct_cost_usd: 0, error: `${err.code || 'collection_failure'}: ${err.message}`
      });
    }
  }

  const complete = schoolRuns.filter(s => s.status === 'complete').length;
  const failures = schoolRuns.reduce((n, s) => n + s.failures, 0);
  const finishedAt = new Date(opts.now ? opts.now() : Date.now()).toISOString();
  const metrics = {
    schools_processed: schoolRuns.length,
    schools_complete: complete,
    sections: all.sections.length,
    meetings: all.meetings.length,
    meetings_with_times: all.meetings.filter(m => m.start_time && m.end_time).length,
    http_requests: schoolRuns.reduce((n, s) => n + s.http_requests, 0),
    runtime_ms: Date.now() - startedMs,
    failures,
    manual_intervention: 0,
    direct_cost_usd: 0
  };
  const record = {
    run_id: opts.runId || runId(startedAt), connector: 'banner', status: complete === schools.length ? 'complete' : 'failed',
    started_at: startedAt, finished_at: finishedAt, term_selection: opts.term || 'latest',
    metrics, schools: schoolRuns
  };
  return Object.assign(all, { run_record: record });
}

module.exports = { runCollection, runId };
