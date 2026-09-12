#!/usr/bin/env node
'use strict';
/**
 * Import the official U.S. institution directory.
 *
 * CANONICAL SOURCE: NCES IPEDS "Directory information" (HD) file, published by the
 * U.S. Department of Education's National Center for Education Statistics:
 *   https://nces.ed.gov/ipeds/datacenter/data/HD<YEAR>.zip
 * The archive contains hd<year>.csv, whose UNITID / INSTNM / CITY / STABBR / WEBADDR
 * columns are the only fields DueGooder keeps.
 *
 * Falls back through recent survey years if the newest is not published yet.
 * Writes:
 *   assets/data/institutions.json   compact array of {unitid,name,city,state,website,domain}
 *   assets/data/manifest.json       source URL, survey year, retrieved_at, count, bytes
 *
 * This script NEVER writes invented data. If every source fails it exits 0 with a
 * manifest recording the failure, and the UI shows an honest "not imported yet" state.
 *
 * Usage: node scripts/import-institutions.js [--year 2023] [--from <file.zip|file.csv>]
 */
const fs = require('fs');
const path = require('path');
const { parseCsvObjects } = require('../lib/csv');
const zip = require('../lib/zip');
const { normalizeIpedsRows } = require('../lib/institutions');
const { getPublic } = require('../lib/http');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'data');
const YEARS = [2024, 2023, 2022, 2021];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function download(url) {
  process.stdout.write(`  fetching ${url} ... `);
  const res = await getPublic(url, { timeoutMs: 60000, raw: true });
  if (res.outcome !== 'ok' || res.status !== 200) {
    console.log(`${res.outcome}${res.status ? ' (HTTP ' + res.status + ')' : ''}`);
    return null;
  }
  console.log('ok');
  return res;
}

/** getPublic returns text; for binary we need the raw bytes, so use fetch directly here. */
async function downloadBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    process.stdout.write(`  fetching ${url} ... `);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': require('../lib/http').USER_AGENT }
    });
    if (!res.ok) { console.log(`HTTP ${res.status}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
    return buf;
  } catch (err) {
    console.log(`failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function csvFromBuffer(buf, sourceName) {
  // IPEDS ships a zip; allow a bare csv too (--from)
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const entry = zip.readFirstMatching(buf, /hd\d{4}\.csv$/i);
    console.log(`  zip entry: ${entry.name}`);
    return entry.data.toString('latin1');   // IPEDS files are latin-1, not UTF-8
  }
  console.log(`  reading ${sourceName} as csv`);
  return buf.toString('latin1');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const localFile = arg('--from');
  const onlyYear = arg('--year');
  const attempts = [];
  let csvText = null, sourceUrl = null, surveyYear = null;

  if (localFile) {
    console.log(`Reading local file ${localFile}`);
    csvText = csvFromBuffer(fs.readFileSync(localFile), localFile);
    sourceUrl = `file://${path.resolve(localFile)}`;
    surveyYear = (localFile.match(/(\d{4})/) || [])[1] || null;
  } else {
    const years = onlyYear ? [Number(onlyYear)] : YEARS;
    console.log('Importing NCES IPEDS Directory information (HD)');
    for (const year of years) {
      const url = `https://nces.ed.gov/ipeds/datacenter/data/HD${year}.zip`;
      const buf = await downloadBuffer(url);
      attempts.push({ url, ok: !!buf });
      if (!buf) continue;
      try {
        csvText = csvFromBuffer(buf, url);
        sourceUrl = url;
        surveyYear = String(year);
        break;
      } catch (err) {
        console.log(`  could not read archive: ${err.message}`);
        attempts[attempts.length - 1].ok = false;
      }
    }
  }

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if (!csvText) {
    const manifest = {
      status: 'not_imported',
      source: 'NCES IPEDS Directory information (HD)',
      source_url_pattern: 'https://nces.ed.gov/ipeds/datacenter/data/HD<YEAR>.zip',
      attempts,
      error: 'no official source could be downloaded from this environment',
      institution_count: 0,
      generated_at: new Date().toISOString()
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    console.error('\nIMPORT FAILED: no official source reachable. Wrote manifest with status=not_imported.');
    console.error('The UI will show "institution directory not imported yet" rather than invented data.');
    return;   // exit 0 so a deploy build is never blocked
  }

  const rows = parseCsvObjects(csvText);
  const { institutions, stats } = normalizeIpedsRows(rows);
  const outPath = path.join(OUT_DIR, 'institutions.json');
  fs.writeFileSync(outPath, JSON.stringify(institutions));
  const bytes = fs.statSync(outPath).size;

  const manifest = {
    status: 'imported',
    source: 'NCES IPEDS Directory information (HD)',
    source_url: sourceUrl,
    survey_year: surveyYear,
    retrieved_at: new Date().toISOString(),
    institution_count: institutions.length,
    file_bytes: bytes,
    fields: ['unitid', 'name', 'city', 'state', 'website', 'domain'],
    row_stats: stats,
    generated_at: new Date().toISOString()
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

  console.log('\nImported institution directory');
  console.log(`  source        ${sourceUrl}`);
  console.log(`  survey year   ${surveyYear}`);
  console.log(`  input rows    ${stats.input}`);
  console.log(`  kept          ${institutions.length}`);
  console.log(`  dropped       no website ${stats.dropped_no_website}, duplicate domain ${stats.dropped_duplicate_domain}, inactive ${stats.dropped_inactive}`);
  console.log(`  file          ${outPath} (${(bytes / 1024).toFixed(0)} KB)`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
