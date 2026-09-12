'use strict';
/**
 * Normalization of official institution files into the compact DueGooder record:
 *   { unitid, name, city, state, website, domain }
 *
 * Kept separate from the download script so it can be unit-tested against a fixture.
 */

/** IPEDS HD (Directory information) column names we use. */
const IPEDS_COLUMNS = Object.freeze({
  unitid: 'UNITID', name: 'INSTNM', city: 'CITY', state: 'STABBR',
  website: 'WEBADDR', sector: 'SECTOR', level: 'ICLEVEL', active: 'CYACTIVE'
});

function domainFromWebsite(website) {
  let w = String(website || '').trim().toLowerCase();
  if (!w) return '';
  if (!/^https?:\/\//.test(w)) w = 'http://' + w;
  let host;
  try { host = new URL(w).hostname; } catch (_) { return ''; }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return '';
  return host;
}

function cleanWebsite(website) {
  let w = String(website || '').trim();
  if (!w) return '';
  if (!/^https?:\/\//i.test(w)) w = 'https://' + w.replace(/^\/+/, '');
  try { return new URL(w).origin + (new URL(w).pathname === '/' ? '' : new URL(w).pathname); }
  catch (_) { return ''; }
}

/** school_id: stable slug derived from the domain (matches detector output). */
function schoolIdFor(domain) {
  const d = String(domain || '');
  const parts = d.split('.');
  const core = parts.length > 2 ? parts.slice(0, parts.length - 1).join('-') : parts[0];
  return core.replace(/[^a-z0-9-]/g, '');
}

/**
 * @param {object[]} rows parsed IPEDS HD rows (keys upper-cased)
 * @param {{requireActive?:boolean}} [opts]
 * @returns {{institutions:object[], stats:object}}
 */
function normalizeIpedsRows(rows, opts = {}) {
  const C = IPEDS_COLUMNS;
  const seenDomain = new Map();
  const out = [];
  const stats = { input: rows.length, dropped_no_website: 0, dropped_inactive: 0, dropped_duplicate_domain: 0, dropped_no_name: 0 };

  for (const r of rows) {
    if (opts.requireActive !== false && Object.prototype.hasOwnProperty.call(r, C.active)) {
      // CYACTIVE 1 = active in the current year
      if (String(r[C.active]).trim() !== '' && String(r[C.active]).trim() !== '1') { stats.dropped_inactive++; continue; }
    }
    const name = String(r[C.name] || '').trim();
    if (!name) { stats.dropped_no_name++; continue; }
    const domain = domainFromWebsite(r[C.website]);
    if (!domain) { stats.dropped_no_website++; continue; }
    if (seenDomain.has(domain)) { stats.dropped_duplicate_domain++; continue; }

    const rec = {
      unitid: String(r[C.unitid] || '').trim(),
      name,
      city: String(r[C.city] || '').trim(),
      state: String(r[C.state] || '').trim().toUpperCase(),
      website: cleanWebsite(r[C.website]),
      domain
    };
    seenDomain.set(domain, true);
    out.push(rec);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  stats.output = out.length;
  return { institutions: out, stats };
}

module.exports = { IPEDS_COLUMNS, domainFromWebsite, cleanWebsite, schoolIdFor, normalizeIpedsRows };
