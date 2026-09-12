/**
 * Collected sections on the homepage: the current verified snapshot.
 *
 * Proves the homepage describes exactly the latest verified run (schools with
 * status "complete" in collections.latest), that historical-only schools never
 * leak into the default view, that terms come from discovery rather than from
 * the section rows, and that evidence is shown as the canonical record with
 * real provenance.
 */
const BASE = process.env.DG_BASE || 'http://127.0.0.1:8090';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

(async () => {
  const root = path.join(__dirname, '..', '..');
  const collections = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/collections.json'), 'utf8'));
  const sections = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/sections.json'), 'utf8')).sections;
  const terms = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/terms.json'), 'utf8')).terms;

  const active = (collections.latest.schools || []).filter(s => s.status === 'complete');
  const activeIds = active.map(s => s.school_id);
  const activeTotal = sections.filter(s => activeIds.includes(s.school_id)).length;
  const historicalIds = [...new Set(sections.map(s => s.school_id))].filter(id => !activeIds.includes(id));
  const expectedTotal = active.reduce((a, s) => a + s.sections, 0);

  console.log(`  snapshot: ${activeIds.join(', ')} = ${activeTotal} sections; historical-only: ${historicalIds.join(', ') || 'none'}`);
  ok(activeTotal === expectedTotal, `persisted snapshot matches the run metrics (${activeTotal} === ${expectedTotal})`);

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1536, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto(BASE + '/');
  await p.waitForFunction(() => document.documentElement.getAttribute('data-dg-sections-ready') === '1', { timeout: 30000 });

  const rowSchools = async () => (await p.locator('#tbody tr td:nth-child(1)').allTextContents()).map(t => t.trim());

  /* 1 + 2: default table is the verified snapshot only */
  const def = await rowSchools();
  const activeNames = active.map(s => s.school_name);
  ok(def.length === 100, `default table renders 100 rows (got ${def.length})`);
  ok(def.every(n => activeNames.some(a => n.includes(a))),
    'default rows contain only the latest verified schools');
  const historicalNames = historicalIds.map(id => (sections.find(s => s.school_id === id) || {}).school_name).filter(Boolean);
  for (const name of historicalNames) {
    ok(!def.some(n => n.includes(name)), `historical school absent from the default table: ${name}`);
  }
  ok(!def.some(n => /Eastern Illinois/.test(n)), 'Eastern Illinois University is absent from the current snapshot');

  /* 3: deterministic balance across the active schools */
  const tally = {};
  def.forEach(n => { const s = activeNames.find(a => n.includes(a)); tally[s] = (tally[s] || 0) + 1; });
  const counts = activeNames.map(n => tally[n] || 0);
  ok(Math.max(...counts) - Math.min(...counts) <= 1,
    `first 100 rows are evenly balanced: ${activeNames.map((n, i) => n.replace('University of ', '') + '=' + counts[i]).join(', ')}`);
  const head = def.slice(0, activeNames.length).map(n => activeNames.find(a => n.includes(a)));
  ok(new Set(head).size === activeNames.length, 'rows are interleaved round-robin, not grouped by school');
  // deterministic: a reload produces the same order
  const firstRowBefore = await p.textContent('#tbody tr:first-child');
  await p.reload();
  await p.waitForFunction(() => document.documentElement.getAttribute('data-dg-sections-ready') === '1', { timeout: 30000 });
  ok(firstRowBefore === (await p.textContent('#tbody tr:first-child')), 'default ordering is deterministic across reloads');

  /* 7: the count line is the snapshot total */
  const countLine = (await p.textContent('#sectionCount')).trim();
  ok(countLine === `Showing 100 of ${activeTotal.toLocaleString('en-US')} matching canonical records`,
    `default count line: "${countLine}"`);

  /* 4-6: selecting a university shows only that university */
  for (const school of active) {
    await p.selectOption('#filterUni', school.school_id);
    await p.waitForTimeout(200);
    const rows = await rowSchools();
    ok(rows.length > 0 && rows.every(n => n.includes(school.school_name)),
      `selecting ${school.school_name} shows only its rows (${rows.length} shown)`);
    const line = (await p.textContent('#sectionCount')).trim();
    ok(line.includes(school.sections.toLocaleString('en-US')),
      `  count matches the run total for ${school.school_id}: "${line}"`);
  }

  /* 8: university selection rebuilds term options from terms.json */
  for (const school of active) {
    await p.selectOption('#filterUni', school.school_id);
    await p.waitForTimeout(200);
    const optionCount = await p.locator('#filterTerm optgroup option').count();
    const discovered = terms.filter(t => t.school_id === school.school_id).length;
    ok(optionCount === discovered,
      `${school.school_id}: term dropdown lists all ${discovered} discovered terms (got ${optionCount})`);
  }
  await p.selectOption('#filterUni', '');
  await p.waitForTimeout(200);
  const unionCount = await p.locator('#filterTerm optgroup option').count();
  const unionExpected = new Set(terms.filter(t => activeIds.includes(t.school_id)).map(t => t.code)).size;
  ok(unionCount === unionExpected, `all-universities term list is the union of active schools (${unionCount} === ${unionExpected})`);

  /* 9: a collected term is individually selectable and filters to real rows */
  const uwf = active.find(s => s.school_id === 'uwf') || active[0];
  await p.selectOption('#filterUni', uwf.school_id);
  await p.waitForTimeout(200);
  const collectedOpts = p.locator('#filterTerm optgroup[label="COLLECTED"] option');
  ok(await collectedOpts.count() > 0, 'collected terms are grouped under COLLECTED');
  const termCode = await collectedOpts.first().getAttribute('value');
  const termLabel = (await collectedOpts.first().textContent()).trim();
  await p.selectOption('#filterTerm', termCode);
  await p.waitForTimeout(250);
  const termRows = await p.locator('#tbody tr').count();
  const expectedForTerm = sections.filter(s => s.school_id === uwf.school_id && s.term_id === termCode).length;
  ok(termRows > 0, `selecting "${termLabel}" (${termCode}) returns real rows (${termRows})`);
  ok((await p.textContent('#sectionCount')).includes(expectedForTerm.toLocaleString('en-US')),
    `  term filter total matches persisted sections for school+term (${expectedForTerm})`);

  /* 10: discovered-but-not-collected terms are marked and unselectable */
  const discOpts = p.locator('#filterTerm optgroup[label="DISCOVERED · NOT COLLECTED"] option');
  const discCount = await discOpts.count();
  ok(discCount > 0, `discovered-only terms are listed separately (${discCount})`);
  const allDisabled = await discOpts.evaluateAll(os => os.every(o => o.disabled && o.dataset.collected === 'false'));
  ok(allDisabled, 'every discovered-only term is disabled and flagged data-collected="false"');
  const collectedEnabled = await collectedOpts.evaluateAll(os => os.every(o => !o.disabled && o.dataset.collected === 'true'));
  ok(collectedEnabled, 'collected terms are selectable and flagged data-collected="true"');

  /* term resets when it does not apply to the newly selected university */
  const other = active.find(s => s.school_id !== uwf.school_id);
  await p.selectOption('#filterUni', other.school_id);
  await p.waitForTimeout(250);
  ok((await p.inputValue('#filterTerm')) === '', `switching to ${other.school_id} resets an inapplicable term to All terms`);

  /* 11: All terms */
  await p.selectOption('#filterUni', '');
  await p.selectOption('#filterTerm', '');
  await p.waitForTimeout(250);
  ok((await p.textContent('#sectionCount')).includes(activeTotal.toLocaleString('en-US')),
    'All universities + All terms returns the whole snapshot');
  ok((await p.locator('#tbody tr').count()) === 100, 'All terms still pages at 100 rows');

  /* search keeps working */
  await p.fill('#tableSearch', 'accounting');
  await p.waitForTimeout(250);
  const searchRows = await p.locator('#tbody tr').count();
  ok(searchRows > 0, `search returns rows (${searchRows})`);
  await p.fill('#tableSearch', 'course-that-does-not-exist-zzzz');
  await p.waitForTimeout(250);
  ok(await p.isVisible('#noresults'), 'empty search state shows');
  await p.fill('#tableSearch', '');
  await p.waitForTimeout(250);

  /* 12-15: evidence modal */
  ok((await p.textContent('#tbody tr:first-child td:nth-child(8)')).includes('View evidence'),
    'table action is "View evidence"');
  ok((await p.locator('#tbody a.view').count()) === 0, 'the raw source link is no longer the table action');
  const course = (await p.textContent('#tbody tr:first-child td:nth-child(2)')).trim();
  const school = (await p.textContent('#tbody tr:first-child td:nth-child(1)')).trim();
  await p.click('#tbody tr:first-child button[data-ev]');
  await p.waitForTimeout(300);
  ok(await p.isVisible('.ovl.on'), 'View evidence opens the modal');
  const modal = await p.textContent('.modal');
  ok(modal.includes(course), `modal shows the clicked canonical record (${course})`);
  ok(activeNames.some(n => school.includes(n) && modal.includes(n)), 'modal names the same university as the row');
  const fields = ['University', 'Platform', 'Term', 'Term ID', 'Course', 'Course title', 'Section', 'CRN',
    'Instructor', 'Meeting days', 'Start time', 'End time', 'Location', 'Enrollment status',
    'Seats available', 'Extraction status', 'Retrieved at', 'Connector'];
  const missing = fields.filter(f => !modal.includes(f));
  ok(missing.length === 0, `modal shows every canonical field${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
  ok(/Banner/.test(modal), 'modal names the Banner platform/connector');

  const provFields = ['Official registration system', 'Technical source endpoint', 'Retrieval timestamp'];
  const provMissing = provFields.filter(f => !modal.includes(f));
  ok(provMissing.length === 0, `provenance block present${provMissing.length ? ' (missing: ' + provMissing.join(', ') + ')' : ''}`);

  const official = await p.getAttribute('#evOfficial', 'href');
  const configured = active.map(s => s.registration_url);
  ok(configured.includes(official), `official class-search link is the configured public endpoint: ${official}`);
  ok(/StudentRegistrationSsb\/ssb\/term\/termSelection\?mode=search/.test(official),
    'official link is the public term-selection entry point');
  const raw = await p.getAttribute('#evRaw', 'href');
  ok(sections.some(s => s.source_url === raw), 'raw API link is the persisted source_url, unchanged');
  ok(/searchResults/.test(raw), 'raw link is the technical endpoint');
  const order = await p.evaluate(() => {
    const a = document.getElementById('evOfficial'), r = document.getElementById('evRaw');
    return !!(a && r) && (a.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
  });
  ok(order, 'official link is primary, raw API evidence is secondary');
  ok((await p.textContent('.ev-note')).includes('may require an active Banner term session'),
    'raw endpoint is labelled as session-dependent');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  ok(!(await p.isVisible('.ovl.on')), 'modal closes');

  /* 17: consistency across the homepage + no visual regression */
  await p.selectOption('#filterUni', '');
  await p.waitForTimeout(250);
  ok((await p.textContent('#metricSections')).trim() === collections.latest.metrics.sections.toLocaleString('en-US'),
    'Latest collection sections metric matches the run');
  ok((await p.textContent('#connectorSchoolCount')).trim() === String(active.length),
    'Connector architecture school count matches the snapshot');
  const connectorNames = await p.textContent('#connectorSchools');
  ok(active.every(s => connectorNames.includes(s.school_name.replace('University of ', ''))),
    'Connector architecture lists the snapshot schools');
  ok(!connectorNames.includes('Eastern Illinois'), 'Connector architecture excludes historical-only schools');
  ok((await p.textContent('#refreshMatched')).trim() === activeTotal.toLocaleString('en-US'),
    'Refresh intelligence matched count equals the snapshot total');

  for (const w of [1536, 1440, 1024, 768, 390]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(200);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(o <= 0, `no horizontal overflow at ${w}px (overflow=${o})`);
  }

  console.log('console/page errors:', errs.length ? errs : 'none');
  if (errs.length) process.exitCode = 1;
  await b.close();
})();
