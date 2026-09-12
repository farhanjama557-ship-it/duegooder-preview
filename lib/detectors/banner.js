'use strict';
/**
 * Banner (Ellucian Banner 9 Self-Service) detector.
 *
 * DISCOVERY - cheapest signal first, bounded, never a crawler.
 * The whole budget is MAX_REQUESTS (8) per institution including robots.txt, and
 * each stage only runs if the previous one has not already produced structural
 * evidence:
 *
 *   0. robots.txt                        1 request
 *   1. institution homepage              1 request
 *        collect Banner-looking links, and registrar / class-search "hub" links
 *   2. probe up to 2 discovered Banner links
 *   3. follow up to 2 hub pages (registrar, class schedule, course search,
 *      self service ...) and probe up to 2 Banner links discovered on them
 *   4. last resort: up to 3 constructed well-known hosts
 *        ssb.<domain>, banner.<domain>, apps.banner.<domain>
 *
 * Stage 3 is what finds the common real-world layout where the homepage says
 * nothing about registration but the registrar page links to Banner on a
 * subdomain such as apps.banner.<domain>.
 *
 * EVIDENCE RULES
 *   A URL the detector constructed itself is never evidence. Evidence may come
 *   only from:
 *     - the HTTP response body,
 *     - the final URL after redirects, when the server redirected us somewhere
 *       we did not ask for (the server chose it, so it is real), or
 *     - links the institution actually published on its own pages.
 *   So a host that answers every path with a catch-all 200 cannot be classified.
 *
 * SCORING (asserted by test/banner-detector.test.js)
 *   Signals are weighted by how specific they are to Banner. The word "banner"
 *   alone is deliberately worth almost nothing.
 *
 *     STUDENT_REGISTRATION_SSB   0.45  strong   'StudentRegistrationSsb' in a URL or the HTML
 *     BANNER_ROUTE               0.35  strong   a known Banner 9 SSB route (/ssb/term/termSelection,
 *                                               /ssb/classSearch/classSearch, /ssb/searchResults,
 *                                               /ssb/sectionDetail, /ssb/registration)
 *     SSB_PATH                   0.20  medium   '/ssb/' or '/StudentSelfService/' in a URL
 *     ELLUCIAN_MARKER            0.15  medium   Ellucian/Banner-specific HTML markers
 *                                               (ellucian.com, "Ellucian Company", bannerid,
 *                                               "Banner Self-Service", banner9)
 *     SSB_HOSTNAME               0.10  weak     host is ssb./banner./bannerweb./apps.banner.
 *     BANNER_WORDING             0.05  weak     "Banner" next to self-service/registration wording
 *
 *   confidence = min(0.99, sum of matched distinct signal weights)
 *
 *   A domain is only classified as Banner when BOTH hold:
 *     (a) confidence >= 0.35, and
 *     (b) at least one structural signal matched
 *         (STUDENT_REGISTRATION_SSB, BANNER_ROUTE or SSB_PATH).
 *   Wording and hostname signals can raise confidence but can never, on their
 *   own, classify a school as Banner.
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

/** Host prefixes Banner self-service is commonly published under. */
const WELL_KNOWN_HOSTS = Object.freeze(['ssb', 'banner', 'apps.banner', 'bannerweb']);
const CANDIDATE_PATH = '/StudentRegistrationSsb/ssb/term/termSelection?mode=search';

/**
 * Concepts that identify a public page likely to link to the registration system.
 * Matched against link text and href. This is how we reach Banner installs that
 * the homepage does not link to directly.
 */
const HUB_KEYWORDS = Object.freeze([
  'class search', 'course search', 'class schedule', 'schedule of classes',
  'registration', 'register for classes', 'registrar', 'self service', 'self-service',
  'student self service', 'course catalog'
]);

/** Hard request budget per institution, including robots.txt. */
const MAX_REQUESTS = 8;
const MAX_HUB_PAGES = 2;
const MAX_CANDIDATE_PROBES = 2;
const MAX_CONSTRUCTED_PROBES = 3;

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
  if (scanUrl) {
    try {
      if (isBannerHost(new URL(url).hostname)) add('SSB_HOSTNAME');
    } catch (_) { /* not an absolute URL - ignore */ }
  }
  if (/banner[^.]{0,40}(self[- ]?service|registration|student information)/i.test(body)
      || /(self[- ]?service|registration)[^.]{0,40}banner/i.test(body)) {
    add('BANNER_WORDING');
  }
  return found;
}

/** True when a hostname looks like a Banner self-service host (ssb., banner., apps.banner., ...). */
function isBannerHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return WELL_KNOWN_HOSTS.some(prefix => h === prefix || h.startsWith(prefix + '.'));
}

/**
 * Extract candidate Banner URLs from a page's links. Pure - no network.
 * These are links the institution published, so they count as evidence.
 */
function candidateUrlsFrom(html, baseUrl) {
  const out = [];
  const re = /(?:href|src|action)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const raw = m[1];
    const lower = raw.toLowerCase();
    let abs;
    try { abs = new URL(raw, baseUrl); } catch (_) { continue; }
    if (!/^https?:$/i.test(abs.protocol)) continue;
    const looksBanner = lower.includes('studentregistrationssb')
      || lower.includes('/ssb/')
      || lower.includes('/studentselfservice/')
      || isBannerHost(abs.hostname);
    if (!looksBanner) continue;
    const href = abs.toString();
    if (!out.includes(href)) out.push(href);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Extract a few high-value public pages likely to link to the registration
 * system (registrar, class search, schedule of classes ...). Pure - no network.
 * Restricted to the institution's own domain so this never becomes a crawler.
 */
function hubLinksFrom(html, baseUrl, domain) {
  const scored = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    let abs;
    try { abs = new URL(href, baseUrl); } catch (_) { continue; }
    if (!/^https?:$/i.test(abs.protocol)) continue;
    const host = abs.hostname.toLowerCase();
    if (host !== domain && !host.endsWith('.' + domain)) continue;   // stay on the institution
    const url = abs.toString();
    if (seen.has(url)) continue;
    const hrefLower = url.toLowerCase();
    let weight = 0;
    for (const kw of HUB_KEYWORDS) {
      const compact = kw.replace(/[\s-]/g, '');
      if (text.includes(kw)) weight = Math.max(weight, 3);                       // link text is the best signal
      else if (hrefLower.includes(compact) || hrefLower.includes(kw.replace(/\s/g, '-'))) weight = Math.max(weight, 2);
    }
    if (!weight) continue;
    seen.add(url);
    scored.push({ url, weight });
  }
  scored.sort((a, b) => b.weight - a.weight);
  return scored.map(s => s.url);
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

  // ---- staged discovery, bounded by MAX_REQUESTS ----------------------------
  const budgetLeft = () => MAX_REQUESTS - counter.requests;
  const probed = new Set([`https://${domain}/`]);
  const discoveredBannerUrls = candidates.slice();   // links the institution published
  let parseFailure = null;

  /**
   * Fetch one page and fold its evidence in.
   * `discovered` marks a URL the institution published (or a hub page we found);
   * for constructed URLs only the response body - and a redirect the server
   * chose - may count as evidence.
   */
  async function visit(url, discovered) {
    if (probed.has(url) || budgetLeft() <= 0) return null;
    probed.add(url);
    const res = await getPublic(url, httpOpts);
    if (res.outcome === OUTCOME.PARSE_FAILURE) { parseFailure = res.error; return null; }
    if (res.outcome !== OUTCOME.OK || res.status >= 400) return null;
    const finalUrl = res.finalUrl || res.url;
    const redirected = finalUrl.replace(/\/$/, '') !== url.replace(/\/$/, '');
    try {
      // a constructed URL is not evidence unless the server redirected us to it
      for (const [k, v] of scanSource(finalUrl, res.body, { scanUrl: discovered || redirected })) evidence.set(k, v);
    } catch (err) {
      parseFailure = `failed to parse ${url}: ${err.message}`;
      return null;
    }
    return { url: finalUrl, body: res.body };
  }

  const hasStructural = () => score(evidence).structural;
  const enough = () => score(evidence).confidence >= BAND.HIGH;

  // stage 2: Banner links the homepage published
  for (const url of candidates.slice(0, MAX_CANDIDATE_PROBES)) {
    if (enough() || budgetLeft() <= 0) break;
    const page = await visit(url, true);
    if (page && !registrationUrl) registrationUrl = page.url;
  }

  // stage 3: follow a couple of registrar / class-search pages and probe what they link to
  if (!enough() && budgetLeft() > 1) {
    let hubs = [];
    try { hubs = hubLinksFrom(home.body, home.finalUrl || home.url, domain); } catch (_) { hubs = []; }
    for (const hubUrl of hubs.slice(0, MAX_HUB_PAGES)) {
      if (enough() || budgetLeft() <= 1) break;
      const hub = await visit(hubUrl, true);
      if (!hub) continue;
      let hubCandidates = [];
      try { hubCandidates = candidateUrlsFrom(hub.body, hub.url); } catch (_) { hubCandidates = []; }
      for (const u of hubCandidates) if (!discoveredBannerUrls.includes(u)) discoveredBannerUrls.push(u);
      for (const url of hubCandidates.slice(0, MAX_CANDIDATE_PROBES)) {
        if (enough() || budgetLeft() <= 0) break;
        const page = await visit(url, true);
        if (page && !registrationUrl) registrationUrl = page.url;
      }
    }
  }

  // stage 4: last resort - constructed well-known hosts. Their URLs are never
  // evidence; only what the server actually returns (or redirects to) counts.
  if (!hasStructural() && budgetLeft() > 0) {
    for (const host of WELL_KNOWN_HOSTS.slice(0, MAX_CONSTRUCTED_PROBES)) {
      if (enough() || budgetLeft() <= 0) break;
      const url = `https://${host}.${domain}${CANDIDATE_PATH}`;
      const page = await visit(url, false);
      if (page && !registrationUrl && score(evidence).structural) registrationUrl = page.url;
    }
  }

  if (parseFailure && !evidence.size) {
    return result(base, { result: 'parse_failure', error: parseFailure, requests: counter.requests });
  }

  // A Banner link the institution published is a usable registration URL even when
  // we already had enough confidence and stopped spending requests.
  if (!registrationUrl && discoveredBannerUrls.length) registrationUrl = discoveredBannerUrls[0];

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
  SIGNALS, BANNER_ROUTES, BAND, WELL_KNOWN_HOSTS, CANDIDATE_PATH, HUB_KEYWORDS,
  MAX_REQUESTS, MAX_HUB_PAGES, MAX_CANDIDATE_PROBES, MAX_CONSTRUCTED_PROBES,
  scanSource, candidateUrlsFrom, hubLinksFrom, isBannerHost, score, band, normalizeDomain
};
