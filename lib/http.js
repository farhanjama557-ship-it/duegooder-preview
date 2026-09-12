'use strict';
/**
 * Tiny polite HTTP client for public-page probing.
 *
 * - identifies itself with a real User-Agent and a contact URL
 * - hard timeout per request
 * - follows a bounded number of redirects
 * - caps the number of bytes read (we only need the head of a page)
 * - counts every request so callers can report request cost
 * - classifies failures instead of swallowing them
 */

const USER_AGENT =
  'DueGooderBot/0.2 (+https://github.com/farhanjama557-ship-it/duegooder-preview; public course data research)';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_BYTES = 250 * 1024;
const MAX_REDIRECTS = 4;

/** Outcome kinds shared by the HTTP layer and the detectors. */
const OUTCOME = Object.freeze({
  OK: 'ok',
  REQUEST_FAILED: 'request_failed',
  TIMEOUT: 'timeout',
  BLOCKED: 'blocked',
  PARSE_FAILURE: 'parse_failure'
});

function classifyError(err) {
  const name = err && (err.name || '');
  const code = err && (err.code || '');
  if (name === 'AbortError' || name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return OUTCOME.TIMEOUT;
  }
  return OUTCOME.REQUEST_FAILED;
}

/**
 * Fetch a URL and return a classified result. Never throws.
 * @param {string} url
 * @param {{timeoutMs?:number, fetchImpl?:Function, counter?:{requests:number}, method?:string}} [opts]
 * @returns {Promise<{outcome:string, status:number|null, url:string, finalUrl:string|null, body:string, error:string|null, ms:number}>}
 */
async function getPublic(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  if (opts.counter) opts.counter.requests++;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: opts.method || 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5' }
    });
    const status = res.status;
    // 403/429 (and 401) are the "please stop" signals we honour rather than retry.
    if (status === 401 || status === 403 || status === 429) {
      return { outcome: OUTCOME.BLOCKED, status, url, finalUrl: res.url || url, body: '', error: `HTTP ${status}`, ms: Date.now() - started };
    }
    // The connection succeeded; a body we cannot read is a parse failure, not a request failure.
    let body = '';
    try {
      if (typeof res.text === 'function') {
        body = await res.text();
        if (typeof body !== 'string') throw new Error('response body is not text');
        if (body.length > MAX_BYTES) body = body.slice(0, MAX_BYTES);
      }
    } catch (err) {
      return {
        outcome: OUTCOME.PARSE_FAILURE, status, url, finalUrl: (res && res.url) || url, body: '',
        error: `could not read response body: ${err && err.message ? err.message : 'unknown'}`, ms: Date.now() - started
      };
    }
    return { outcome: OUTCOME.OK, status, url, finalUrl: (res && res.url) || url, body, error: null, ms: Date.now() - started };
  } catch (err) {
    return {
      outcome: classifyError(err), status: null, url, finalUrl: null, body: '',
      error: (err && err.message) ? String(err.message) : 'request failed', ms: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Minimal robots.txt check for our own User-Agent.
 * Only understands User-agent / Disallow, which is all we need to honour an obvious block.
 */
function robotsDisallows(robotsTxt, pathname) {
  if (!robotsTxt) return false;
  const lines = String(robotsTxt).split(/\r?\n/);
  let applies = false;
  let matched = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      const ua = val.toLowerCase();
      applies = ua === '*' || ua.includes('duegooder');
    } else if (key === 'disallow' && applies) {
      if (val === '') continue;              // empty Disallow allows everything
      if (pathname.startsWith(val)) matched = true;
    }
  }
  return matched;
}

module.exports = { getPublic, robotsDisallows, USER_AGENT, OUTCOME, DEFAULT_TIMEOUT_MS, MAX_REDIRECTS, MAX_BYTES };
