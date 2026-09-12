'use strict';
/**
 * Canonical normalized DueGooder section schema.
 *
 * This module is the single source of truth: validation, the Field Definitions
 * page and the example record are all generated from FIELDS, so documentation
 * cannot drift from what is actually enforced.
 */

/** Allowed values for extraction_status. */
const EXTRACTION_STATUS = Object.freeze([
  'complete',
  'partial_source_missing',
  'partial_extraction_failure',
  'failed'
]);

/** Allowed values for enrollment_status (null when the source does not publish it). */
const ENROLLMENT_STATUS = Object.freeze(['open', 'closed', 'waitlist', 'cancelled']);

/**
 * field: canonical key
 * type: 'string' | 'integer' | 'array'
 * required: value must be a non-empty string / array (never null)
 * nullable: may be null when the source does not publish it
 * description: shown on the Field Definitions page
 * example: used for the illustrative example record (SCHEMA EXAMPLE only)
 */
const FIELDS = Object.freeze([
  { field: 'school_id', type: 'string', required: true, nullable: false, description: 'Unique identifier for the institution (domain slug).', example: 'appstate' },
  { field: 'school_name', type: 'string', required: true, nullable: false, description: 'Official institution name.', example: 'Appalachian State University' },
  { field: 'term_id', type: 'string', required: true, nullable: false, description: 'Platform term code (e.g. 202608).', example: '202608' },
  { field: 'term_name', type: 'string', required: true, nullable: false, description: 'Human-readable term name.', example: 'Fall 2026' },
  { field: 'department', type: 'string', required: false, nullable: true, description: 'Academic department, when the source publishes one.', example: null },
  { field: 'subject', type: 'string', required: true, nullable: false, description: 'Course subject code (e.g. CS, MATH, ENGL).', example: 'CS' },
  { field: 'course_number', type: 'string', required: true, nullable: false, description: 'Course number (e.g. 250).', example: '250' },
  { field: 'course_title', type: 'string', required: true, nullable: false, description: 'Course title.', example: 'Data Structures' },
  { field: 'section_number', type: 'string', required: true, nullable: false, description: 'Section number as published by the platform.', example: '001' },
  { field: 'crn', type: 'string', required: false, nullable: true, description: 'Course Reference Number (Banner and similar platforms).', example: '41231' },
  { field: 'instructor', type: 'string', required: false, nullable: true, description: 'Primary instructor name.', example: 'M. Wilson' },
  { field: 'meeting_days', type: 'array', required: true, nullable: false, description: 'Meeting days normalized to two-letter codes: MO TU WE TH FR SA SU. Empty array when the section has no scheduled meetings.', example: ['MO', 'WE'] },
  { field: 'start_time', type: 'string', required: false, nullable: true, description: 'Start time, 24h HH:MM.', example: '10:00' },
  { field: 'end_time', type: 'string', required: false, nullable: true, description: 'End time, 24h HH:MM.', example: '11:15' },
  { field: 'location', type: 'string', required: false, nullable: true, description: 'Building and room.', example: 'Belk Hall 210' },
  { field: 'enrollment_status', type: 'string', required: false, nullable: true, description: 'One of: ' + ENROLLMENT_STATUS.join(', ') + '.', example: 'open' },
  { field: 'seats_available', type: 'integer', required: false, nullable: true, description: 'Seats available, when published.', example: null },
  { field: 'source_url', type: 'string', required: true, nullable: false, description: 'URL of the public page the record was extracted from.', example: 'https://ssb.appstate.edu/StudentRegistrationSsb/ssb/searchResults' },
  { field: 'retrieved_at', type: 'string', required: true, nullable: false, description: 'ISO-8601 UTC timestamp of retrieval.', example: '2026-09-11T00:00:00Z' },
  { field: 'extraction_status', type: 'string', required: true, nullable: false, description: 'One of: ' + EXTRACTION_STATUS.join(', ') + '.', example: 'complete' }
]);

const FIELD_NAMES = Object.freeze(FIELDS.map(f => f.field));
const DAYS = Object.freeze(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** An empty record with every canonical field present. Missing data stays null. */
function emptySection() {
  const out = {};
  for (const f of FIELDS) out[f.field] = f.type === 'array' ? [] : null;
  return out;
}

/**
 * Validate a normalized section.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateSection(record) {
  const errors = [];
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['record must be an object'] };
  }
  for (const key of Object.keys(record)) {
    if (!FIELD_NAMES.includes(key)) errors.push(`unknown field: ${key}`);
  }
  for (const f of FIELDS) {
    const has = Object.prototype.hasOwnProperty.call(record, f.field);
    if (!has) { errors.push(`missing field: ${f.field}`); continue; }
    const v = record[f.field];

    if (v === null) {
      if (!f.nullable) errors.push(`${f.field} must not be null`);
      continue;
    }
    if (v === undefined) { errors.push(`${f.field} must not be undefined`); continue; }

    if (f.type === 'array') {
      if (!Array.isArray(v)) { errors.push(`${f.field} must be an array`); continue; }
    } else if (f.type === 'integer') {
      if (typeof v !== 'number' || !Number.isInteger(v)) { errors.push(`${f.field} must be an integer`); continue; }
      if (v < 0) errors.push(`${f.field} must not be negative`);
      continue;
    } else if (typeof v !== 'string') {
      errors.push(`${f.field} must be a string`); continue;
    }

    if (f.required) {
      if (f.type === 'array') {
        // meeting_days may be empty (async sections) but must be an array, checked above.
      } else if (v.trim() === '') {
        errors.push(`${f.field} is required and must not be empty`);
      }
    }

    // field-specific rules
    if (f.field === 'meeting_days') {
      for (const d of v) {
        if (typeof d !== 'string' || !DAYS.includes(d)) errors.push(`meeting_days contains invalid day: ${String(d)}`);
      }
      if (new Set(v).size !== v.length) errors.push('meeting_days contains duplicate days');
    }
    if ((f.field === 'start_time' || f.field === 'end_time') && !TIME_RE.test(v)) {
      errors.push(`${f.field} must be 24h HH:MM`);
    }
    if (f.field === 'enrollment_status' && !ENROLLMENT_STATUS.includes(v)) {
      errors.push(`enrollment_status must be one of: ${ENROLLMENT_STATUS.join(', ')}`);
    }
    if (f.field === 'extraction_status' && !EXTRACTION_STATUS.includes(v)) {
      errors.push(`extraction_status must be one of: ${EXTRACTION_STATUS.join(', ')}`);
    }
    if (f.field === 'source_url' && !/^https?:\/\//i.test(v)) {
      errors.push('source_url must be an absolute http(s) URL');
    }
    if (f.field === 'retrieved_at' && !ISO_RE.test(v)) {
      errors.push('retrieved_at must be an ISO-8601 timestamp');
    }
  }
  // cross-field
  if (typeof record.start_time === 'string' && typeof record.end_time === 'string'
      && TIME_RE.test(record.start_time) && TIME_RE.test(record.end_time)
      && record.end_time <= record.start_time) {
    errors.push('end_time must be after start_time');
  }
  return { valid: errors.length === 0, errors };
}

/** The illustrative example record. Marked SCHEMA EXAMPLE in the UI - never collected data. */
function exampleSection() {
  const out = {};
  for (const f of FIELDS) out[f.field] = f.example === undefined ? null : f.example;
  return out;
}

module.exports = { FIELDS, FIELD_NAMES, EXTRACTION_STATUS, ENROLLMENT_STATUS, DAYS, emptySection, validateSection, exampleSection };
