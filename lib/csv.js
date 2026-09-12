'use strict';
/** RFC4180-ish CSV parser (quotes, embedded commas/newlines, CRLF). No dependencies. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* handled by \n */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse into objects keyed by header (headers upper-cased and trimmed). */
function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.replace(/^﻿/, '').trim().toUpperCase());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length === 1 && rows[i][0] === '') continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = rows[i][j] === undefined ? '' : rows[i][j];
    out.push(obj);
  }
  return out;
}

module.exports = { parseCsv, parseCsvObjects };
