'use strict';
/** Idempotent flat-file persistence for Phase 3 collection output. */
const fs = require('fs');
const path = require('path');
const { sectionIdentity } = require('./collectors/banner');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function comparable(value) {
  const copy = Object.assign({}, value);
  delete copy.retrieved_at;
  return JSON.stringify(copy);
}

function merge(existing, incoming, keyFor) {
  const byKey = new Map();
  for (const value of existing) byKey.set(keyFor(value), value);
  const stats = { created: 0, updated: 0, unchanged: 0, duplicates_prevented: 0 };
  const incomingKeys = new Set();
  for (const value of incoming) {
    const key = keyFor(value);
    if (incomingKeys.has(key)) stats.duplicates_prevented++;
    incomingKeys.add(key);
    const before = byKey.get(key);
    if (!before) stats.created++;
    else if (comparable(before) === comparable(value)) stats.unchanged++;
    else stats.updated++;
    byKey.set(key, value);
  }
  return { values: Array.from(byKey.values()), stats };
}

function persistCollection(dataDir, run, opts = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const now = opts.generatedAt || new Date().toISOString();
  const files = {
    sections: path.join(dataDir, 'sections.json'), meetings: path.join(dataDir, 'meetings.json'),
    terms: path.join(dataDir, 'terms.json'), subjects: path.join(dataDir, 'subjects.json'),
    provenance: path.join(dataDir, 'provenance.json'), collections: path.join(dataDir, 'collections.json')
  };
  const stores = {
    sections: readJson(files.sections, { sections: [] }).sections || [],
    meetings: readJson(files.meetings, { meetings: [] }).meetings || [],
    terms: readJson(files.terms, { terms: [] }).terms || [],
    subjects: readJson(files.subjects, { subjects: [] }).subjects || [],
    provenance: readJson(files.provenance, { sources: [] }).sources || []
  };
  const sectionMerge = merge(stores.sections, run.sections, sectionIdentity);
  const meetingMerge = merge(stores.meetings, run.meetings, m => m.meeting_id);
  const termMerge = merge(stores.terms, run.terms, t => `${t.school_id}|${t.code}`);
  const subjectMerge = merge(stores.subjects, run.subjects, s => `${s.school_id}|${s.term_id}|${s.code}`);
  const provenanceMerge = merge(stores.provenance, run.provenance,
    p => `${p.school_id || ''}|${p.kind}|${p.source_url}`);

  fs.writeFileSync(files.sections, JSON.stringify({ generated_at: now,
    identity: 'school_id + term_id + CRN; fallback SHA-256(school_id|term_id|subject|course_number|section_number)',
    sections: sectionMerge.values.sort((a, b) => sectionIdentity(a).localeCompare(sectionIdentity(b))) }, null, 1));
  fs.writeFileSync(files.meetings, JSON.stringify({ generated_at: now,
    identity: 'section identity + SHA-256(days|times|location|type|dates)',
    meetings: meetingMerge.values.sort((a, b) => a.meeting_id.localeCompare(b.meeting_id)) }, null, 1));
  fs.writeFileSync(files.terms, JSON.stringify({ generated_at: now, terms: termMerge.values }, null, 1));
  fs.writeFileSync(files.subjects, JSON.stringify({ generated_at: now, subjects: subjectMerge.values }, null, 1));
  fs.writeFileSync(files.provenance, JSON.stringify({ generated_at: now, sources: provenanceMerge.values }, null, 1));

  const collectionStore = readJson(files.collections, { runs: [] });
  const persisted = Object.assign({}, run.run_record, {
    persistence: {
      sections: sectionMerge.stats, meetings: meetingMerge.stats,
      terms: termMerge.stats, subjects: subjectMerge.stats, provenance: provenanceMerge.stats
    }
  });
  const runs = [persisted].concat(collectionStore.runs || []).slice(0, 100);
  fs.writeFileSync(files.collections, JSON.stringify({ generated_at: now, latest: persisted, runs }, null, 1));
  return persisted;
}

module.exports = { readJson, merge, persistCollection };
