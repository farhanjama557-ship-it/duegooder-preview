'use strict';
/** Minimal ZIP reader (stored + deflate) built on zlib. Enough for the IPEDS HD archive. */
const zlib = require('zlib');

function readEntries(buf) {
  // locate End Of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no EOCD record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory header');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(buf, entry) {
  if (buf.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new Error('bad local file header');
  const nameLen = buf.readUInt16LE(entry.localOffset + 26);
  const extraLen = buf.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const data = buf.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported zip compression method: ${entry.method}`);
}

/** Return the first entry whose name matches `re`, decompressed. */
function readFirstMatching(buf, re) {
  const entries = readEntries(buf);
  const entry = entries.find(e => re.test(e.name));
  if (!entry) throw new Error(`no entry matching ${re} in zip (have: ${entries.map(e => e.name).join(', ')})`);
  return { name: entry.name, data: extract(buf, entry) };
}

module.exports = { readEntries, extract, readFirstMatching };
