'use strict';
/**
 * Reusable Ellucian Banner 9 public class-search collector.
 *
 * University differences belong in configuration (the public registration URL),
 * never in parsing branches. The connector keeps a cookie jar because Banner's
 * search API requires a term-selection session before subjects/sections can be
 * read. Every response is recorded as provenance and every page is consumed.
 */
const crypto = require('crypto');
const { robotsDisallows, USER_AGENT } = require('../http');
const { emptySection, validateSection } = require('../schema');

const DEFAULT_TIMEOUT_MS = 20000;
const LOOKUP_PAGE_SIZE = 100;
const SECTION_PAGE_SIZE = 500;
const MAX_PAGES = 1000;
const DAY_FIELDS = Object.freeze([
  ['monday', 'MO'], ['tuesday', 'TU'], ['wednesday', 'WE'],
  ['thursday', 'TH'], ['friday', 'FR'], ['saturday', 'SA'], ['sunday', 'SU']
]);

class CollectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CollectionError';
    this.code = code;
    this.details = details;
  }
}

function iso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function clean(value) {
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeTime(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return null;
  const padded = digits.padStart(4, '0');
  if (!/^([01]\d|2[0-3])[0-5]\d$/.test(padded)) return null;
  return padded.slice(0, 2) + ':' + padded.slice(2);
}

function normalizeDays(meetingTime) {
  return DAY_FIELDS.filter(([field]) => meetingTime && meetingTime[field] === true).map(([, code]) => code);
}

function normalizeLocation(meetingTime) {
  if (!meetingTime) return null;
  const building = clean(meetingTime.buildingDescription || meetingTime.building);
  const room = clean(meetingTime.room);
  if (building && room) return `${building} ${room}`;
  return building || room;
}

function sectionIdentity(record) {
  if (clean(record.crn)) return `${record.school_id}|${record.term_id}|crn:${clean(record.crn)}`;
  const natural = [record.school_id, record.term_id, record.subject, record.course_number,
    record.section_number].map(v => String(v || '').trim().toLowerCase()).join('|');
  return `${record.school_id}|${record.term_id}|fallback:${crypto.createHash('sha256').update(natural).digest('hex').slice(0, 20)}`;
}

function meetingIdentity(meeting) {
  const natural = [meeting.section_key, (meeting.meeting_days || []).join(','), meeting.start_time,
    meeting.end_time, meeting.location, meeting.meeting_type, meeting.start_date, meeting.end_date]
    .map(v => String(v || '').trim().toLowerCase()).join('|');
  return `${meeting.section_key}|meeting:${crypto.createHash('sha256').update(natural).digest('hex').slice(0, 20)}`;
}

function enrollmentStatus(raw) {
  if (raw && (raw.cancelled === true || /cancel/i.test(String(raw.statusDescription || '')))) return 'cancelled';
  const seats = Number(raw && raw.seatsAvailable);
  const wait = Number(raw && raw.waitAvailable);
  if (Number.isFinite(seats) && seats > 0) return 'open';
  if (Number.isFinite(wait) && wait > 0) return 'waitlist';
  if (raw && raw.openSection === true) return 'open';
  if (raw && (raw.openSection === false || (Number.isFinite(seats) && seats === 0))) return 'closed';
  return null;
}

function normalizeMeeting(rawMeeting, base) {
  const mt = rawMeeting && (rawMeeting.meetingTime || rawMeeting);
  if (!mt || typeof mt !== 'object') return null;
  const meeting = {
    school_id: base.school_id,
    term_id: base.term_id,
    crn: base.crn,
    section_key: base.section_key,
    meeting_days: normalizeDays(mt),
    start_time: normalizeTime(mt.beginTime),
    end_time: normalizeTime(mt.endTime),
    location: normalizeLocation(mt),
    meeting_type: clean(mt.meetingTypeDescription || mt.meetingType),
    start_date: clean(mt.startDate),
    end_date: clean(mt.endDate),
    source_url: base.source_url,
    retrieved_at: base.retrieved_at,
    extraction_status: 'complete'
  };
  if ((mt.beginTime && !meeting.start_time) || (mt.endTime && !meeting.end_time)) {
    meeting.extraction_status = 'partial_extraction_failure';
  }
  meeting.meeting_id = meetingIdentity(meeting);
  return meeting;
}

function normalizeSection(raw, institution, term, sourceUrl, retrievedAt) {
  const faculty = Array.isArray(raw.faculty) ? raw.faculty : [];
  const primary = faculty.find(f => f && f.primaryIndicator === true) || faculty[0] || null;
  const rawMeetings = Array.isArray(raw.meetingsFaculty) ? raw.meetingsFaculty : [];
  const keySeed = {
    school_id: institution.school_id,
    term_id: String(raw.term || term.code),
    crn: clean(raw.courseReferenceNumber),
    subject: clean(raw.subject),
    course_number: clean(raw.courseNumber || raw.courseDisplay),
    section_number: clean(raw.sequenceNumber)
  };
  const key = sectionIdentity(keySeed);
  const meetings = rawMeetings.map(m => normalizeMeeting(m, {
    school_id: institution.school_id, term_id: keySeed.term_id, crn: keySeed.crn,
    section_key: key, source_url: sourceUrl, retrieved_at: retrievedAt
  })).filter(Boolean);
  const firstMeeting = meetings.find(m => m.meeting_days.length || m.start_time || m.location) || meetings[0] || null;

  const record = emptySection();
  Object.assign(record, {
    school_id: institution.school_id,
    school_name: institution.school_name,
    term_id: keySeed.term_id,
    term_name: clean(raw.termDesc) || term.description,
    department: null,
    subject: keySeed.subject,
    course_number: keySeed.course_number,
    course_title: clean(raw.courseTitle),
    section_number: keySeed.section_number,
    crn: keySeed.crn,
    instructor: primary ? clean(primary.displayName) : null,
    meeting_days: firstMeeting ? firstMeeting.meeting_days : [],
    start_time: firstMeeting ? firstMeeting.start_time : null,
    end_time: firstMeeting ? firstMeeting.end_time : null,
    location: firstMeeting ? firstMeeting.location : null,
    enrollment_status: enrollmentStatus(raw),
    seats_available: Number.isInteger(raw.seatsAvailable) && raw.seatsAvailable >= 0 ? raw.seatsAvailable : null,
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    extraction_status: meetings.some(m => m.extraction_status !== 'complete')
      ? 'partial_extraction_failure' : 'complete'
  });

  const validation = validateSection(record);
  if (!validation.valid) {
    return { record: null, meetings, key, errors: validation.errors };
  }
  return { record, meetings, key, errors: [] };
}

function splitSetCookie(header) {
  if (!header) return [];
  return String(header).split(/,(?=\s*[^;,=]+=[^;,]+)/g);
}

class BannerClient {
  constructor(registrationUrl, opts = {}) {
    const parsed = new URL(registrationUrl);
    const marker = parsed.pathname.toLowerCase().indexOf('/studentregistrationssb');
    if (parsed.protocol !== 'https:' || marker < 0) {
      throw new CollectionError('invalid_configuration', 'registration_url must be an HTTPS StudentRegistrationSsb URL');
    }
    this.origin = parsed.origin;
    this.appPath = parsed.pathname.slice(0, marker) + '/StudentRegistrationSsb';
    this.registrationUrl = registrationUrl;
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.now = opts.now || (() => new Date());
    this.cookies = new Map();
    this.requests = 0;
    this.provenance = [];
  }

  endpoint(pathname) {
    return `${this.origin}${this.appPath}${pathname}`;
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  rememberCookies(headers) {
    let values = [];
    if (headers && typeof headers.getSetCookie === 'function') values = headers.getSetCookie();
    if (!values.length && headers && typeof headers.get === 'function') values = splitSetCookie(headers.get('set-cookie'));
    for (const value of values) {
      const pair = String(value).split(';', 1)[0];
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  async request(url, opts = {}) {
    let current = new URL(url, this.origin).toString();
    let method = opts.method || 'GET';
    let body = opts.body;
    for (let redirect = 0; redirect <= 4; redirect++) {
      if (new URL(current).origin !== this.origin) {
        throw new CollectionError('blocked', `redirect left configured Banner origin: ${current}`);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      this.requests++;
      const retrievedAt = iso(this.now);
      let response;
      try {
        const headers = Object.assign({
          'User-Agent': USER_AGENT,
          'Accept': opts.accept || 'application/json,text/html;q=0.9,*/*;q=0.5'
        }, opts.headers || {});
        const cookie = this.cookieHeader();
        if (cookie) headers.Cookie = cookie;
        response = await this.fetchImpl(current, { method, body, headers, redirect: 'manual', signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        const code = err && (err.name === 'AbortError' || err.name === 'TimeoutError') ? 'timeout' : 'request_failed';
        this.provenance.push({ school_id: opts.schoolId || null, kind: opts.kind || 'unknown', source_url: current,
          retrieved_at: retrievedAt, http_status: null, extraction_status: 'failed', error: err.message || code });
        throw new CollectionError(code, `${current}: ${err.message || code}`);
      }
      clearTimeout(timer);
      this.rememberCookies(response.headers);
      const status = response.status;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers && response.headers.get && response.headers.get('location');
        if (!location) throw new CollectionError('request_failed', `HTTP ${status} without Location: ${current}`);
        current = new URL(location, current).toString();
        if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
        continue;
      }
      const text = await response.text();
      const extractionStatus = status >= 200 && status < 300 ? 'complete' : 'failed';
      this.provenance.push({ school_id: opts.schoolId || null, kind: opts.kind || 'unknown', source_url: current,
        retrieved_at: retrievedAt, http_status: status, extraction_status: extractionStatus,
        error: extractionStatus === 'failed' ? `HTTP ${status}` : null });
      if (status === 401 || status === 403 || status === 429) throw new CollectionError('blocked', `HTTP ${status}: ${current}`);
      if (!opts.allowHttpErrors && (status < 200 || status >= 300)) {
        throw new CollectionError('request_failed', `HTTP ${status}: ${current}`);
      }
      return { text, url: current, retrievedAt, status };
    }
    throw new CollectionError('request_failed', `too many redirects: ${url}`);
  }

  async json(url, opts = {}) {
    const response = await this.request(url, Object.assign({}, opts, { accept: 'application/json' }));
    try {
      return Object.assign(response, { data: JSON.parse(response.text) });
    } catch (err) {
      const last = this.provenance[this.provenance.length - 1];
      if (last) { last.extraction_status = 'failed'; last.error = `invalid JSON: ${err.message}`; }
      throw new CollectionError('parse_failure', `invalid JSON from ${response.url}: ${err.message}`);
    }
  }
}

async function pagedLookup(client, endpoint, params, kind, schoolId) {
  const out = [];
  const seen = new Set();
  let offset = 1;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams(Object.assign({}, params, { offset: String(offset), max: String(LOOKUP_PAGE_SIZE) }));
    const response = await client.json(client.endpoint(endpoint) + '?' + query, { kind, schoolId });
    if (!Array.isArray(response.data)) throw new CollectionError('parse_failure', `${kind} response is not an array`);
    let added = 0;
    for (const item of response.data) {
      const code = clean(item && item.code);
      if (!code || seen.has(code)) continue;
      seen.add(code); added++;
      out.push({ code, description: clean(item.description) || code, source_url: response.url,
        retrieved_at: response.retrievedAt, extraction_status: 'complete' });
    }
    if (response.data.length < LOOKUP_PAGE_SIZE) return out;
    if (added === 0) throw new CollectionError('pagination_failure', `${kind} endpoint repeated a full page at offset ${offset}`);
    offset += response.data.length;
  }
  throw new CollectionError('pagination_failure', `${kind} exceeded ${MAX_PAGES} pages`);
}

async function collectSections(client, institution, term) {
  const output = [];
  const meetings = [];
  const failures = [];
  const seenPages = new Set();
  let offset = 0;
  let total = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      txt_term: term.code, pageOffset: String(offset), pageMaxSize: String(SECTION_PAGE_SIZE),
      sortColumn: 'subjectDescription', sortDirection: 'asc'
    });
    const response = await client.json(client.endpoint('/ssb/searchResults/searchResults') + '?' + query,
      { kind: 'sections', schoolId: institution.school_id });
    const payload = response.data;
    if (!payload || !Array.isArray(payload.data)) throw new CollectionError('parse_failure', 'section response has no data array');
    if (payload.success === false) throw new CollectionError('source_failure', clean(payload.message) || 'Banner returned success=false');
    if (Number.isInteger(payload.totalCount) && payload.totalCount >= 0) total = payload.totalCount;
    const fingerprint = payload.data.map(s => s && s.courseReferenceNumber).join('|');
    if (payload.data.length && seenPages.has(fingerprint)) {
      throw new CollectionError('pagination_failure', `Banner repeated the section page at offset ${offset}`);
    }
    seenPages.add(fingerprint);
    for (const raw of payload.data) {
      const normalized = normalizeSection(raw, institution, term, response.url, response.retrievedAt);
      if (!normalized.record) {
        failures.push({ school_id: institution.school_id, term_id: term.code,
          crn: clean(raw && raw.courseReferenceNumber), source_url: response.url,
          extraction_status: 'failed', errors: normalized.errors });
        continue;
      }
      output.push(normalized.record);
      meetings.push(...normalized.meetings);
    }
    offset += payload.data.length;
    if (!payload.data.length || (total !== null && offset >= total)) break;
    if (total === null && payload.data.length < SECTION_PAGE_SIZE) break;
  }
  if (total !== null && offset < total) throw new CollectionError('pagination_failure', `collected ${offset} of ${total} section rows`);
  return { sections: output, meetings, failures, reportedTotal: total };
}

function selectTerms(terms, requested) {
  if (!terms.length) return [];
  if (!requested || requested === 'latest') return [terms[0]];
  if (requested === 'all') return terms;
  const wanted = new Set(String(requested).split(',').map(s => s.trim()).filter(Boolean));
  const found = terms.filter(t => wanted.has(t.code));
  if (found.length !== wanted.size) {
    const missing = Array.from(wanted).filter(code => !found.some(t => t.code === code));
    throw new CollectionError('term_not_found', `term(s) not published: ${missing.join(', ')}`);
  }
  return found;
}

async function collectBanner(institution, opts = {}) {
  const started = Date.now();
  const client = new BannerClient(institution.registration_url, opts);
  const schoolId = institution.school_id;
  try {
    const robots = await client.request(`${client.origin}/robots.txt`, { kind: 'robots', schoolId, allowHttpErrors: true });
    if (robots.status === 200 && robotsDisallows(robots.text, client.appPath)) {
      throw new CollectionError('blocked', 'robots.txt disallows the Banner application path');
    }
    const landing = await client.request(institution.registration_url, { kind: 'banner_verification', schoolId });
    if (!/StudentRegistrationSsb/i.test(landing.url + ' ' + landing.text)
        || !/(ssb\/term\/search|ssb\/classSearch\/getTerms)/i.test(landing.text)) {
      throw new CollectionError('not_banner', 'configured page lacks Banner 9 structural endpoints');
    }

    const terms = await pagedLookup(client, '/ssb/classSearch/getTerms', { searchTerm: '' }, 'terms', schoolId);
    const selectedTerms = selectTerms(terms, opts.term || 'latest');
    const subjects = [];
    const sections = [];
    const meetings = [];
    const extractionFailures = [];

    for (const term of selectedTerms) {
    const form = new URLSearchParams({ term: term.code, studyPath: '', studyPathText: '', startDatepicker: '', endDatepicker: '' });
    await client.json(client.endpoint('/ssb/term/search?mode=search'), {
      method: 'POST', body: form.toString(), kind: 'term_selection', schoolId,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
    });
    const termSubjects = await pagedLookup(client, '/ssb/classSearch/get_subject',
      { searchTerm: '', term: term.code }, 'subjects', schoolId);
    subjects.push(...termSubjects.map(s => Object.assign({ school_id: schoolId, term_id: term.code }, s)));
    const result = await collectSections(client, institution, term);
    sections.push(...result.sections);
    meetings.push(...result.meetings);
    extractionFailures.push(...result.failures);
    }

    const sectionMap = new Map();
    for (const record of sections) sectionMap.set(sectionIdentity(record), record);
    const meetingMap = new Map();
    for (const meeting of meetings) meetingMap.set(meeting.meeting_id, meeting);
    const normalizedSections = Array.from(sectionMap.values());
    const normalizedMeetings = Array.from(meetingMap.values());
    const timedMeetings = normalizedMeetings.filter(m => m.start_time && m.end_time).length;
    const status = normalizedSections.length > 0 && timedMeetings > 0 ? 'complete'
      : (normalizedSections.length ? 'partial_source_missing' : 'failed');

    return {
    school: institution,
    status,
    terms: terms.map(t => Object.assign({ school_id: schoolId }, t)),
    selected_terms: selectedTerms.map(t => t.code),
    subjects,
    sections: normalizedSections,
    meetings: normalizedMeetings,
    extraction_failures: extractionFailures,
    provenance: client.provenance,
    metrics: {
      sections: normalizedSections.length,
      meetings: normalizedMeetings.length,
      meetings_with_times: timedMeetings,
      http_requests: client.requests,
      runtime_ms: Date.now() - started,
      failures: extractionFailures.length + (status === 'complete' ? 0 : 1),
      manual_intervention: 0,
      direct_cost_usd: 0
    }
    };
  } catch (err) {
    if (err && typeof err === 'object') {
      err.details = Object.assign({}, err.details, { http_requests: client.requests, provenance: client.provenance });
    }
    throw err;
  }
}

module.exports = {
  BannerClient, CollectionError, collectBanner, collectSections, pagedLookup,
  normalizeSection, normalizeMeeting, normalizeTime, normalizeDays, normalizeLocation,
  enrollmentStatus, sectionIdentity, meetingIdentity, selectTerms,
  DEFAULT_TIMEOUT_MS, LOOKUP_PAGE_SIZE, SECTION_PAGE_SIZE, MAX_PAGES
};
