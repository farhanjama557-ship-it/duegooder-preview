'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  collectBanner, pagedLookup, BannerClient, normalizeSection, sectionIdentity
} = require('../lib/collectors/banner');
const { persistCollection } = require('../lib/collection-store');
const { validateSection } = require('../lib/schema');

const SCHOOL = {
  domain: 'example.edu', school_id: 'example', school_name: 'Example University',
  registration_url: 'https://banner.example.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search'
};

function response(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function rawSection(crn, overrides = {}) {
  return Object.assign({
    term: '202680', termDesc: 'Fall 2026', courseReferenceNumber: crn,
    subject: 'CPS', courseNumber: '149', sequenceNumber: crn ? '01' : '02',
    courseTitle: 'Creative Media App', seatsAvailable: 8, openSection: true,
    faculty: [{ displayName: 'Ongwere, Tom', primaryIndicator: true }],
    meetingsFaculty: [{ meetingTime: {
      beginTime: '1115', endTime: '1205', monday: true, tuesday: false,
      wednesday: true, thursday: false, friday: true, saturday: false, sunday: false,
      buildingDescription: 'Jessie Hathcock Hall', room: '035', meetingTypeDescription: 'Class',
      startDate: '08/24/2026', endDate: '12/11/2026'
    }}]
  }, overrides);
}

test('normalizes canonical fields, all meeting data, seats and stable CRN identity', () => {
  const term = { code: '202680', description: 'Fall 2026' };
  const result = normalizeSection(rawSection('22810'), SCHOOL, term,
    'https://banner.example.edu/StudentRegistrationSsb/ssb/searchResults/searchResults?txt_term=202680',
    '2026-09-12T00:00:00.000Z');
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(validateSection(result.record).valid, true);
  assert.deepStrictEqual(result.record.meeting_days, ['MO', 'WE', 'FR']);
  assert.strictEqual(result.record.start_time, '11:15');
  assert.strictEqual(result.record.location, 'Jessie Hathcock Hall 035');
  assert.strictEqual(result.record.seats_available, 8);
  assert.strictEqual(result.record.instructor, 'Ongwere, Tom');
  assert.strictEqual(sectionIdentity(result.record), 'example|202680|crn:22810');
  assert.strictEqual(result.meetings.length, 1);
});

test('fallback identity is stable when Banner omits CRN', () => {
  const a = rawSection(null);
  const b = Object.assign({}, a);
  const term = { code: '202680', description: 'Fall 2026' };
  const one = normalizeSection(a, SCHOOL, term, 'https://banner.example.edu/source', '2026-09-12T00:00:00.000Z');
  const two = normalizeSection(b, SCHOOL, term, 'https://banner.example.edu/source', '2026-09-13T00:00:00.000Z');
  assert.match(sectionIdentity(one.record), /^example\|202680\|fallback:[a-f0-9]{20}$/);
  assert.strictEqual(sectionIdentity(one.record), sectionIdentity(two.record));
});

test('lookup pagination consumes every page and rejects repeated full pages', async () => {
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    const offset = Number(new URL(url).searchParams.get('offset'));
    if (offset === 1) return response(Array.from({ length: 100 }, (_, i) => ({ code: `S${i}`, description: `Subject ${i}` })));
    return response([{ code: 'S100', description: 'Subject 100' }]);
  };
  const client = new BannerClient(SCHOOL.registration_url, { fetchImpl });
  const rows = await pagedLookup(client, '/ssb/classSearch/get_subject', { term: '202680' }, 'subjects', 'example');
  assert.strictEqual(rows.length, 101);
  assert.strictEqual(calls, 2);

  const repeating = new BannerClient(SCHOOL.registration_url, {
    fetchImpl: async () => response(Array.from({ length: 100 }, (_, i) => ({ code: `S${i}` })))
  });
  await assert.rejects(() => pagedLookup(repeating, '/ssb/classSearch/get_subject', {}, 'subjects', 'example'),
    err => err.code === 'pagination_failure');
});

test('one reusable session collects terms, subjects and every section page', async () => {
  const seen = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url); seen.push({ url, opts });
    if (u.pathname === '/robots.txt') return response('', 404);
    if (u.pathname.endsWith('/term/termSelection')) {
      return response('<html>StudentRegistrationSsb /ssb/term/search /ssb/classSearch/getTerms</html>', 200,
        { 'set-cookie': 'JSESSIONID=abc; Path=/StudentRegistrationSsb; Secure; HttpOnly' });
    }
    if (u.pathname.endsWith('/classSearch/getTerms')) return response([{ code: '202680', description: 'Fall 2026' }]);
    if (u.pathname.endsWith('/term/search')) {
      assert.match(opts.headers.Cookie || '', /JSESSIONID=abc/);
      return response({ fwdURL: '/StudentRegistrationSsb/ssb/classSearch/classSearch' });
    }
    if (u.pathname.endsWith('/classSearch/get_subject')) return response([{ code: 'CPS', description: 'Computer Science' }]);
    if (u.pathname.endsWith('/searchResults/searchResults')) {
      const offset = Number(u.searchParams.get('pageOffset'));
      if (offset === 0) return response({ success: true, totalCount: 3, data: [rawSection('1'), rawSection('2')] });
      if (offset === 2) return response({ success: true, totalCount: 3, data: [rawSection('3')] });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await collectBanner(SCHOOL, { fetchImpl, term: 'latest' });
  assert.strictEqual(result.status, 'complete');
  assert.strictEqual(result.terms.length, 1);
  assert.strictEqual(result.subjects.length, 1);
  assert.strictEqual(result.sections.length, 3);
  assert.strictEqual(result.meetings.length, 3);
  assert.strictEqual(result.metrics.http_requests, 7);
  assert.ok(result.provenance.every(p => p.source_url && p.retrieved_at && p.extraction_status));
  assert.deepStrictEqual(seen.filter(x => x.url.includes('searchResults')).map(x => new URL(x.url).searchParams.get('pageOffset')), ['0', '2']);
});

test('persistence upserts by stable identity; immediate second pass creates no duplicates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duegooder-store-'));
  try {
    const normalized = normalizeSection(rawSection('22810'), SCHOOL, { code: '202680', description: 'Fall 2026' },
      'https://banner.example.edu/source', '2026-09-12T00:00:00.000Z');
    const base = {
      terms: [{ school_id: 'example', code: '202680', description: 'Fall 2026', source_url: 'https://banner.example.edu/terms', retrieved_at: '2026-09-12T00:00:00.000Z', extraction_status: 'complete' }],
      subjects: [{ school_id: 'example', term_id: '202680', code: 'CPS', description: 'Computer Science', source_url: 'https://banner.example.edu/subjects', retrieved_at: '2026-09-12T00:00:00.000Z', extraction_status: 'complete' }],
      sections: [normalized.record, normalized.record], meetings: [normalized.meetings[0], normalized.meetings[0]],
      provenance: [], run_record: { run_id: 'one', connector: 'banner', status: 'complete', metrics: {}, schools: [] }
    };
    const first = persistCollection(dir, base, { generatedAt: '2026-09-12T00:00:00.000Z' });
    assert.strictEqual(first.persistence.sections.created, 1);
    assert.strictEqual(first.persistence.sections.duplicates_prevented, 1);
    base.run_record = Object.assign({}, base.run_record, { run_id: 'two' });
    const second = persistCollection(dir, base, { generatedAt: '2026-09-12T00:01:00.000Z' });
    assert.strictEqual(second.persistence.sections.created, 0);
    assert.strictEqual(second.persistence.meetings.created, 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'sections.json'))).sections.length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'meetings.json'))).meetings.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
