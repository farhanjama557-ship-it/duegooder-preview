# DueGooder — public university course data

Turn any university into structured course data: detect the registration platform a
school runs, then collect its public course sections into one normalized schema.

**Status: Phase 3 (reusable Banner 9 collection).** The frozen Phase 2 institution
directory and truthful detector feed one shared, session-aware Banner connector. It
discovers terms and subjects, consumes every section page, normalizes sections and all
meeting patterns, deduplicates stable identities, persists provenance, and records real
run metrics.

## What is real, and what is not

| Area | State |
| --- | --- |
| Institution directory | Real. Imported from NCES IPEDS by `scripts/import-institutions.js`. |
| University search (homepage, Universities page) | Real. Searches the imported directory. |
| Banner platform detection | Real. `lib/detectors/banner.js` probes public pages. |
| Detection results / runs | Real. Written only by actual detector executions. |
| Normalized section schema | Real and validated (`lib/schema.js`). |
| PeopleSoft / Workday / Colleague / Custom detectors | Not implemented. Stubs that never classify anything. |
| Banner terms / subjects / sections / meetings | Real. Written only by `scripts/collect-banner.js`. |
| "Collected sections" table on the homepage | Real canonical records from `assets/data/sections.json`. |

Pages show an honest empty state when data has not been generated yet. No screen
invents institutions, detections, runs or metrics.

## Data sources

**Canonical institution source:** NCES IPEDS *Directory information* (HD) file, published
by the U.S. Department of Education's National Center for Education Statistics:

```
https://nces.ed.gov/ipeds/datacenter/data/HD<YEAR>.zip   →   hd<year>.csv
```

The importer tries recent survey years in order, reads the archive without any
dependencies, and keeps only the six fields DueGooder needs:

```json
{ "unitid": "", "name": "", "city": "", "state": "", "website": "", "domain": "" }
```

Rows without a website, duplicate domains, inactive institutions (`CYACTIVE != 1`) and
rows with no name are dropped; the counts are recorded in `assets/data/manifest.json`
along with the exact source URL, survey year and retrieval time. The UI reads its
institution count from that manifest, so the number on screen is always the measured one.

## Commands

```bash
npm test                  # library tests (schema, detector, search, importer) - no network
npm run import:institutions   # download + normalize the official IPEDS directory
npm run detect -- appstate.edu udayton.edu uwf.edu     # run the real Banner detector
npm run collect:banner                    # collect latest public term for verified Banner schools
npm run collect:banner -- --schools uwf.edu,udayton.edu,eiu.edu --repeat 2
npm run detect -- --from-directory --limit 25          # detect across the imported directory
npm run build:web-data    # regenerate schema.json / detectors.json from the code
npm run build             # import + build:web-data (this is what Vercel runs)
npm run test:ui           # browser tests; needs `npx playwright install chromium`
npm run test:live         # opt-in: detector + collector against real universities
```

Generated files live in `assets/data/` and are served statically:

| File | Written by | Contents |
| --- | --- | --- |
| `institutions.json` | `import-institutions.js` | the official directory |
| `manifest.json` | `import-institutions.js` | source URL, survey year, count, byte size |
| `detections.json` | `detect.js` | latest detection per domain |
| `runs.json` | `detect.js` | one record per detector execution + computed summary |
| `schema.json` | `build-web-data.js` | canonical schema, from `lib/schema.js` |
| `detectors.json` | `build-web-data.js` | detector registry + Banner scoring rules |
| `terms.json` | `collect-banner.js` | all terms discovered from the public Banner API |
| `subjects.json` | `collect-banner.js` | subjects for each collected term |
| `sections.json` | `collect-banner.js` | canonical, validated section records |
| `meetings.json` | `collect-banner.js` | every published meeting pattern, not only the primary display meeting |
| `provenance.json` | `collect-banner.js` | exact response URLs, retrieval times, HTTP and extraction status |
| `collections.json` | `collect-banner.js` | real per-school/run metrics and persistence results |

**Storage is deliberately flat files, not a database** — this is a hackathon project and
the site is static. `detect.js` merges into the store: a detection younger than 24h is
reused instead of re-requesting. Committing the generated `detections.json` / `runs.json`
is how results reach the deployed site; they are always produced by real runs.

## Banner section collection

`lib/collectors/banner.js` is the only Banner parser. University configuration contains
only the official public registration URL; there are no school-specific parser branches.
Each run:

1. checks `robots.txt` and structurally verifies the configured Banner 9 page;
2. keeps an isolated Banner session/cookie jar;
3. discovers every term and selects `latest` by default (or `--term CODE` / `--term all`);
4. discovers subjects for the selected term;
5. follows `totalCount` and `pageOffset` until every section page is consumed;
6. validates every canonical section and preserves every published meeting separately;
7. upserts all stores and writes measured metrics.

Section identity is `school_id + term_id + CRN`. If Banner omits a CRN, the documented
fallback is SHA-256 of `school_id|term_id|subject|course_number|section_number`. Meeting
identity is the section identity plus a hash of its days, times, location, type and dates.
An immediate `--repeat 2` pass must create zero sections and zero meetings on pass two;
the command exits non-zero if any school has no real sections/timed meetings or if the
repeat creates duplicates.

The canonical 20-field section row exposes its first scheduled meeting for the existing
flat UI/schema. `meetings.json` is the lossless one-to-many store for all published
meeting patterns. Every section and meeting carries its source URL, retrieval timestamp
and extraction status; response-level provenance is also retained.

Verified connector configurations currently include University of West Florida,
University of Dayton and Eastern Illinois University. Appalachian State is intentionally
absent: its frozen `no_match` is never promoted or forced by Phase 3.

## Banner detection

`lib/detectors/banner.js`. Bounded discovery, cheapest signal first, never a crawler.
The whole budget is **8 requests per institution including `robots.txt`**, and each stage
runs only if the previous one has not already produced structural evidence:

| Stage | Requests | What it does |
| --- | --- | --- |
| 0 | 1 | `robots.txt`, honoured for the paths we would probe |
| 1 | 1 | institution homepage: collect Banner-looking links and registrar / class-search "hub" links |
| 2 | ≤2 | probe Banner links the institution published |
| 3 | ≤4 | follow up to 2 hub pages (registrar, class schedule, course search, self service …) and probe Banner links found on them |
| 4 | ≤3 | last resort: constructed well-known hosts `ssb.`, `banner.`, `apps.banner.`, `bannerweb.` |

Stage 3 is what finds the common real-world layout where the homepage says nothing about
registration but the registrar page links to Banner on a subdomain such as
`apps.banner.<domain>`. Hub following never leaves the institution's own domain.

Other limits: 10s timeout, 2 institutions in parallel, 750ms between institutions,
identifying User-Agent, results cached 24h.

### Evidence rules

A URL the detector constructed itself is **never** evidence. Evidence may come only from:

- the HTTP response body,
- the final URL after redirects, when the server redirected us somewhere we did not ask
  for (the server chose it, so it is real), or
- links the institution actually published on its own pages.

So a host that answers every path with a catch-all 200 cannot be classified as Banner.

### Scoring

| Signal | Weight | Structural |
| --- | --- | --- |
| `StudentRegistrationSsb` in a URL or the HTML | 0.45 | yes |
| a known Banner 9 SSB route (`/ssb/term/termSelection`, …) | 0.35 | yes |
| `/ssb/` or `/StudentSelfService/` in a URL | 0.20 | yes |
| Ellucian / Banner HTML markers | 0.15 | no |
| host is `ssb.` / `banner.` / `apps.banner.` / `bannerweb.` | 0.10 | no |
| page wording mentions Banner self-service | 0.05 | no |

`confidence = min(0.99, sum of matched weights)`. A school is classified as Banner only
when confidence ≥ 0.35 **and** at least one structural signal matched — the word
"banner" on a page can never, by itself, classify a school. Bands: **high** ≥ 0.80,
**medium** ≥ 0.55, **low** ≥ 0.35.

### Outcomes

`detected`, `no_match`, `request_failed`, `timeout`, `blocked`, `parse_failure`.
Network and parsing failures are kept distinct from `no_match` and never become
"manual review".

### Known limitations

Detection only sees what a school publishes publicly. Institutions whose class search is
behind a login, served by an older Banner 8 / custom "class schedule" application, or
reachable only from a page the bounded discovery does not visit will correctly come back
`no_match` rather than being forced to Banner. Appalachian State is a current example:
its public class search does not expose a Banner 9 structural signal within the request
budget, so it stays `no_match` until a generic improvement finds one.

## School status

| Status | Meaning |
| --- | --- |
| `live` | a real Phase 3 section collection succeeded with sections and timed meetings. |
| `supported` | platform confidently detected and a connector architecture exists. Means *platform supported*, not *collection verified*. |
| `discovering` | institution known, platform not classified yet — including every detection error. |
| `manual_review` | probed, no supported platform found: likely custom. |

Defined once in `assets/dg-status.js`, used by both the Node library and the browser.

## Deployment

Static site on Vercel with `cleanUrls`. `vercel.json` runs `npm run build`, so each deploy
imports the official directory from NCES and regenerates the schema data. The importer
never fails the build: if the source is unreachable it writes a manifest with
`status: "not_imported"` and the UI says so rather than showing invented data.

If `.edu` access is blocked in an automation environment, offline tests still exercise
fixtures for sessions, two kinds of pagination, normalization, canonical validation and
repeat-run dedupe. Run the exact live command on a network-enabled machine before calling
Phase 3 complete:

```bash
git checkout codex/phase3-banner-collector
git pull --ff-only origin codex/phase3-banner-collector
npm test
npm run collect:banner -- --schools uwf.edu,udayton.edu,eiu.edu --repeat 2 --timeout 30000
```

## Layout

```
lib/            schema, detectors, Banner collector, persistence, run recorders
scripts/        importer, detector CLI, Banner collector CLI, web-data generator
assets/         stylesheet, browser modules, generated data
test/           node:test suites (no network) and test/ui/ browser suites
```
