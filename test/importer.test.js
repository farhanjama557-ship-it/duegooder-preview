'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsvObjects } = require('../lib/csv');
const { normalizeIpedsRows, domainFromWebsite, schoolIdFor } = require('../lib/institutions');

/* A fixture in the real IPEDS HD shape (same column names, same quirks:
   latin-1 text, www prefixes, trailing paths, inactive rows, missing sites). */
const HD_FIXTURE = [
  'UNITID,INSTNM,CITY,STABBR,WEBADDR,SECTOR,ICLEVEL,CYACTIVE',
  '198516,Appalachian State University,Boone,NC,www.appstate.edu,1,1,1',
  '157289,"University of Louisville",Louisville,KY,louisville.edu,1,1,1',
  '206604,University of Dayton,Dayton,OH,https://udayton.edu/,2,1,1',
  '999001,Closed College,Nowhere,TX,www.closed.edu,1,1,0',
  '999002,No Website Institute,Somewhere,CA,,1,1,1',
  '999003,"Duplicate Domain, The",Boone,NC,appstate.edu,1,1,1',
  '999004,,Blank Name City,NY,blank.edu,1,1,1'
].join('\n');

test('parses the IPEDS HD csv shape including quoted fields', () => {
  const rows = parseCsvObjects(HD_FIXTURE);
  assert.strictEqual(rows.length, 7);
  assert.strictEqual(rows[1].INSTNM, 'University of Louisville');
  assert.strictEqual(rows[5].INSTNM, 'Duplicate Domain, The');
});

test('normalizes to the six DueGooder fields and drops what we cannot use', () => {
  const { institutions, stats } = normalizeIpedsRows(parseCsvObjects(HD_FIXTURE));
  assert.deepStrictEqual(institutions.map(i => i.domain).sort(), ['appstate.edu', 'louisville.edu', 'udayton.edu']);
  const app = institutions.find(i => i.domain === 'appstate.edu');
  assert.deepStrictEqual(Object.keys(app).sort(), ['city', 'domain', 'name', 'state', 'unitid', 'website'].sort());
  assert.strictEqual(app.unitid, '198516');
  assert.strictEqual(app.state, 'NC');
  assert.strictEqual(app.website, 'https://www.appstate.edu');
  assert.strictEqual(stats.dropped_inactive, 1);
  assert.strictEqual(stats.dropped_no_website, 1);
  assert.strictEqual(stats.dropped_duplicate_domain, 1);
  assert.strictEqual(stats.dropped_no_name, 1);
});

test('domain extraction strips scheme, www and paths', () => {
  assert.strictEqual(domainFromWebsite('www.appstate.edu'), 'appstate.edu');
  assert.strictEqual(domainFromWebsite('https://www.udayton.edu/'), 'udayton.edu');
  assert.strictEqual(domainFromWebsite('http://uwf.edu/admissions/index.html'), 'uwf.edu');
  assert.strictEqual(domainFromWebsite('ssb.banner.state.edu'), 'ssb.banner.state.edu');
  assert.strictEqual(domainFromWebsite(''), '');
  assert.strictEqual(domainFromWebsite('not a url'), '');
});

test('school_id is a stable slug of the domain', () => {
  assert.strictEqual(schoolIdFor('appstate.edu'), 'appstate');
  assert.strictEqual(schoolIdFor('k-state.edu'), 'k-state');
  assert.strictEqual(schoolIdFor('my.college.edu'), 'my-college');
});

test('output is sorted by name for stable diffs', () => {
  const { institutions } = normalizeIpedsRows(parseCsvObjects(HD_FIXTURE));
  const names = institutions.map(i => i.name);
  assert.deepStrictEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
});
