'use strict';
/**
 * Banner (Ellucian Banner 9 Self-Service) detector.
 *
 * Strategy — cheapest signal first, network probing only as needed:
 *   1. GET the institution homepage once. Scan its HTML for links that look like
 *      Banner self-service (StudentRegistrationSsb, /ssb/, ssb.<domain>, Ellucian markers).
 *   2. If a candidate registration URL was found, fetch that one page to confirm.
 *   3. Only if the homepage yielded no candidate, try at most two well-known host
 *      patterns (ssb.<domain>, banner.<domain>).
 * Worst case is 4 requests per institution, plus one robots.txt fetch.
 *
 * SCORING (documented, and asserted by test/banner-detector.test.js)
 *   Signals are weighted by how specific they are to Banner. The word "banner"
 *   alone is deliberately worth nothing.
 *
 *     STUDENT_REGISTRATION_SSB   0.45  strong   'StudentRegistrationSsb' in a URL or the HTML
 *     BANNER_ROUTE               0.35  strong   a known Banner 9 SSB route (/ssb/term/termSelection,
 *                                               /ssb/classSearch/classSearch, /ssb/searchResults,
 *                                               /ssb/sectionDetail, /ssb/registration)
 *     SSB_PATH                   0.20  medium   '/ssb/' or '/StudentSelfService/' in a URL
 *     ELLUCIAN_MARKER            0.15  medium   Ellucian/Banner-specific HTML markers
 *                                               (ellucian.com, "Ellucian Company", bannerid,
 *                                               "Banner Self-Service", banner favicon path)
 *     SSB_HOSTNAME               0.10  weak     host starts with ssb. / banner. / bannerweb.
 *     BANNER_WORDING             0.05  weak     "Banner" next to self-service/registration wording
 *
 *   confidence = min(0.99, sum of matched distinct signal weights)
 *
 *   A domain is only classified as Banner when BOTH hold:
 *     (a) confidence >= 0.35, and
 *     (b) at least one structural signal matched
 *         (STUDENT_REGISTRATION_SSB, BANNER_ROUTE or SSB_PATH).
 *   Wording and hostname signals can raise confidence but can never, on their own,
 *   classify a school as Banner.
 *
 *   Confidence bands reported to the UI:
 *     >= 0.80 high | >= 0.55 medium | >= 0.35 low | below that -> no_match
 */

const { getPublic, robotsDisallows, OUTCOME } = require('../http');

const PLATFORM = 'banner';

const SIGNALS = Object.freeze({
  STUDENT_REGISTRATION_SSB: { weight: 0.45, structural: true, label: "Found 'StudentRegistrationSsb'" },
  BANNER_ROUTE: { weight: 0.35, structural: true, label: 'Found a known Banner 9 SSB route' },
  SSB_PATH: { weight: 0.20, structural: true, label: "Found '/ssb/' in a URL path" },
  ELLUCIAN_MARKER: { weight: 0.15, structural: false, label: 'Found Ellucian/Banner HTML markers' },
  SSB_HOSTNAME: { weight: 0.10, structural: false, label: 'Registration host looks like Banner (ssb./banner.)' },
  BANNER_WORDING: { weight: 0.05, structural: false, label: 'Page wording mentions Banner self-service' }
});

const BANNER_ROUTES = Object.freeze([
  '/ssb/term/termselection',
  '/ssb/classsearch/classsearch',
  '/ssb/searchresults',
  '/ssb/sectiondetail',
  '/ssb/registration'
]);

const WELL_KNOWN_HOSTS = Object.freeze(['ssb', 'banner', 'bannerweb']);
const CANDIDATE_PATH = '/StudentRegistrationSsb/ssb/term/termSelection?mode=search';

const BAND = Object.freeze({ HIGH: 0.80, MEDIUM: 0.55, MIN: 0.35 });

/**
 * Collect signals from one (url, html) pair. Pure - no network.
 *
 * opts.scanUrl=false scores the response body ONLY. That matters for probes whose
 * URL we constructed ourselves (the well-known ssb./banner. host patterns): the URL
 * we invented is not evidence, or every server with a catch-all 200 would look like
 * Banner. URLs discovered in the institution's own HTML are evidence, because the
 * institution published them.
 */
function scanSource(url, html, opts) {
  const scanUrl = !opts || opts.scanUrl !== false;
  const found = new Map();
  const add = (key, detail) => { if (!found.has(key)) found.set(key, detail || SIGNALS[key].label); };
  const lowerUrl = scanUrl ? String(url || '').toLowerCase() : '';
  const body = String(html || '');
  const lowerBody = body.toLowerCase();

  if (lowerUrl.includes('studentregistrationssb') || lowerBody.includes('studentregistrationssb')) {
    add('STUDENT_REGISTRATION_SSB');
  }
  for (const route of BANNER_ROUTES) {
    if (lowerUrl.includes(route) || lowerBody.includes(route)) { add('BANNER_ROUTE', `Found Banner route ${route}`); break; }
  }
  if (/\/ssb\//.test(lowerUrl) || /\/studentselfservice\//.test(lowerUrl)
      || /\/ssb\//.test(lowerBody) || /\/studentselfservice\//.test(lowerBody)) {
    add('SSB_PATH');
  }
  if (lowerBody.includes('ellucian.com') || lowerBody.includes('ellucian company')
      || lowerBody.includes('bannerid') || lowerBody.includes('banner self-service')
      || lowerBody.includes('banner self service') || lowerBody.includes('banner9')) {
    add('ELLUCIAN_MARKER');
  }
  try {
    if (!scanUrl) throw new Error('url not scored');
    const host = new URL(url).hostname.toLowerCase();
    if (WELL_KNOWN_HOSTS.some(h => host === `${h}.${host.split('.').slice(1).join('.')}` || host.startsWith(`${h}.`))) {
      add('SSB_HOSTNAME');
    }
  } catch (_) { /* not an absolute URL - ignore */ }
  if (/banner[^.]{0,40}(self[- ]?service|registration|student information)/i.test(body)
      || /(self[- ]?service|registration)[^.]{0,40}banner/i.test(body)) {
    add('BANNER_WORDING');
  }
  return found;
}

/** Extract candidate Banner URLs from a page's links. Pure - no network. */
function candidateUrlsFrom(html, baseUrl) {
  const out = [];
  const re = /(?:href|src|action)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const raw = m[1];
    const lower = raw.toLowerCase();
    if (!(lower.includes('studentregistrationssb') || lower.includes('/ssb/') || /\/\/(ssb|banner|bannerweb)\./.test(lower))) continue;
    try {
      const abs = new URL(raw, baseUrl).toString();
      if (/^https?:/i.test(abs) && !out.includes(abs)) out.push(abs);
    } catch (_) { /* skip unparseable */ }
    if (out.length >= 3) break;
  }
  return out;
}

function score(found) {
  let confidence = 0;
  let structural = false;
  for (const key of found.keys()) {
    confidence += SIGNALS[key].weight;
    if (SIGNALS[key].structural) structural = true;
  }
  return { confidence: Math.min(0.99, Number(confidence.toFixed(2))), structural };
}

function band(confidence) {
  if (confidence >= BAND.HIGH) return 'high';
  if (confidence >= BAND.MEDIUM) return 'medium';
  if (confidence >= BAND.MIN) return 'low';
  return null;
}

function normalizeDomain(input) {
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  return d;
}

function isPlausibleDomain(d) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && d.length <= 253;
}

function result(base, extra) {
  return Object.assign({
    school_id: base.school_id || null,
    school_name: base.school_name || null,
    domain: base.domain,
    platform: PLATFORM,
    confidence: 0,
    confidence_band: null,
    registration_url: null,
    evidence: [],
    detected_at: new Date().toISOString(),
    result: 'no_match',
    requests: 0,
    error: null
  }, extra);
}

/**
 * Run Banner detection against one institution.
 * @param {{domain:string, school_id?:string, school_name?:string}} institution
 * @param {{fetchImpl?:Function, timeoutMs?:number, respectRobots?:boolean, now?:Function}} [opts]
 */
async function detect(institution, opts = {}) {
  const domain = normalizeDomain(institution && institution.domain);
  const base = { domain, school_id: institution && institution.school_id, school_name: institution && institution.school_name };
  const counter = { requests: 0 };
  const httpOpts = { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs, counter };

  if (!isPlausibleDomain(domain)) {
    return result(base, { result: 'request_failed', error: `invalid domain: ${String(institution && institution.domain)}`, requests: 0 });
  }

  // robots.txt - one request, honoured for the paths we would probe
  if (opts.respectRobots !== false) {
    const robots = await getPublic(`https://${domain}/robots.txt`, httpOpts);
    if (robots.outcome === OUTCOME.OK && robots.status === 200 && robotsDisallows(robots.body, '/StudentRegistrationSsb')) {
      return result(base, { result: 'blocked', error: 'robots.txt disallows the registration path', requests: counter.requests });
    }
  }

  const evidence = new Map();
  let registrationUrl = null;

  // 1. homepage
  const home = await getPublic(`https://${domain}/`, httpOpts);
  if (home.outcome === OUTCOME.TIMEOUT) return result(base, { result: 'timeout', error: home.error, requests: counter.requests });
  if (home.outcome === OUTCOME.BLOCKED) return result(base, { result: 'blocked', error: home.error, requests: counter.requests });
  if (home.outcome === OUTCOME.REQUEST_FAILED) return result(base, { result: 'request_failed', error: home.error, requests: counter.requests });
  if (home.outcome === OUTCOME.PARSE_FAILURE) return result(base, { result: 'parse_failure', error: home.error, requests: counter.requests });
  if (home.status >= 500) return result(base, { result: 'request_failed', error: `HTTP ${home.status}`, requests: counter.requests });

  let candidates = [];
  try {
    for (const [k, v] of scanSource(home.finalUrl || home.url, home.body)) evidence.set(k, v);
    candidates = candidateUrlsFrom(home.body, home.finalUrl || home.url);
  } catch (err) {
    return result(base, { result: 'parse_failure', error: `failed to parse homepage: ${err.message}`, requests: counter.requests });
  }

  // 2. confirm on the best candidate, or 3. try well-known hosts
  const probes = candidates.length
    ? candidates.slice(0, 1).map(u => ({ url: u, discovered: true }))
    : WELL_KNOWN_HOSTS.slice(0, 2).map(h => ({ url: `https://${h}.${domain}${CANDIDATE_PATH}`, discovered: false }));

  for (const probe of probes) {
    const probeUrl = probe.url;
    const res = await getPublic(probeUrl, httpOpts);
    if (res.outcome === OUTCOME.PARSE_FAILURE) {
      return result(base, { result: 'parse_failure', error: res.error, requests: counter.requests });
    }
    if (res.outcome === OUTCOME.OK && res.status < 400) {
      try {
        // constructed probe URLs are not evidence - only their response body is
        for (const [k, v] of scanSource(res.finalUrl || res.url, res.body, { scanUrl: probe.discovered })) evidence.set(k, v);
      } catch (err) {
        return result(base, { result: 'parse_failure', error: `failed to parse ${probeUrl}: ${err.message}`, requests: counter.requests });
      }
      if (!registrationUrl) registrationUrl = res.finalUrl || res.url;
      if (score(evidence).confidence >= BAND.HIGH) break;   // enough - stop spending requests
    }
    // a failed probe is not fatal: the homepage evidence may still stand
  }

  const { confidence, structural } = score(evidence);
  const b = band(confidence);
  const detected = structural && b !== null;

  return result(base, {
    confidence,
    confidence_band: detected ? b : null,
    registration_url: detected ? registrationUrl : null,
    evidence: Array.from(evidence.values()),
    result: detected ? 'detected' : 'no_match',
    requests: counter.requests
  });
}

module.exports = {
  platform: PLATFORM,
  implemented: true,
  detect,
  // exported for tests and for the Technical Details page
  SIGNALS, BANNER_ROUTES, BAND, WELL_KNOWN_HOSTS, CANDIDATE_PATH,
  scanSource, candidateUrlsFrom, score, band, normalizeDomain
};
