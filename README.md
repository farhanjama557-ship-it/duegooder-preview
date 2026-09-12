# DueGooder — public university course data

Turn any university into structured course data: detect the registration platform a
school runs, then collect its public course sections into one normalized schema.

**Status: Phase 2 (institution directory + platform detection).** Section collection —
terms, sections, instructors, meeting times, enrollment, dedupe and refresh — is Phase 3
and is not implemented. Nothing in this repository collects course sections.

## What is real, and what is not

| Area | State |
| --- | --- |
| Institution directory | Real. Imported from NCES IPEDS by `scripts/import-institutions.js`. |
| University search (homepage, Universities page) | Real. Searches the imported directory. |
| Banner platform detection | Real. `lib/detectors/banner.js` probes public pages. |
| Detection results / runs | Real. Written only by actual detector executions. |
| Normalized section schema | Real and validated (`lib/schema.js`). |
| PeopleSoft / Workday / Colleague / Custom detectors | Not implemented. Stubs that never classify anything. |
| "Collected sections" table on the homepage | **PREVIEW DATA** — labelled as such. Phase 3 replaces it. |

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
npm run detect -- --from-directory --limit 25          # detect across the imported directory
npm run build:web-data    # regenerate schema.json / detectors.json from the code
npm run build             # import + build:web-data (this is what Vercel runs)
npm run test:ui           # browser tests; needs `npx playwright install chromium`
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

**Storage is deliberately flat files, not a database** — this is a hackathon project and
the site is static. `detect.js` merges into the store: a detection younger than 24h is
reused instead of re-requesting. Committing the generated `detections.json` / `runs.json`
is how results reach the deployed site; they are always produced by real runs.

## Banner detection

`lib/detectors/banner.js`. Cheapest signal first, network probing only as needed:

1. GET the institution homepage once; scan its HTML for links that look like Banner
   self-service.
2. Fetch the best candidate registration page to confirm.
3. Only if the homepage yielded nothing, try two well-known host patterns
   (`ssb.<domain>`, `banner.<domain>`).

At most 5 requests per institution including `robots.txt`, 10s timeout, 2 institutions in
parallel, 750ms between institutions, identifying User-Agent, `robots.txt` honoured.

### Scoring

| Signal | Weight | Structural |
| --- | --- | --- |
| `StudentRegistrationSsb` in a URL or the HTML | 0.45 | yes |
| a known Banner 9 SSB route (`/ssb/term/termSelection`, …) | 0.35 | yes |
| `/ssb/` or `/StudentSelfService/` in a URL | 0.20 | yes |
| Ellucian / Banner HTML markers | 0.15 | no |
| host starts with `ssb.` / `banner.` / `bannerweb.` | 0.10 | no |
| page wording mentions Banner self-service | 0.05 | no |

`confidence = min(0.99, sum of matched weights)`. A school is classified as Banner only
when confidence ≥ 0.35 **and** at least one structural signal matched — the word
"banner" on a page can never, by itself, classify a school. Bands: **high** ≥ 0.80,
**medium** ≥ 0.55, **low** ≥ 0.35.

A URL the detector constructed itself is never treated as evidence, so a server that
answers every path with a catch-all 200 is not mistaken for Banner.

### Outcomes

`detected`, `no_match`, `request_failed`, `timeout`, `blocked`, `parse_failure`.
Network and parsing failures are kept distinct from `no_match` and never become
"manual review".

## School status

| Status | Meaning |
| --- | --- |
| `live` | a real Phase 3 section collection succeeded. **Unreachable in Phase 2.** |
| `supported` | platform confidently detected and a connector architecture exists. Means *platform supported*, not *collection verified*. |
| `discovering` | institution known, platform not classified yet — including every detection error. |
| `manual_review` | probed, no supported platform found: likely custom. |

Defined once in `assets/dg-status.js`, used by both the Node library and the browser.

## Deployment

Static site on Vercel with `cleanUrls`. `vercel.json` runs `npm run build`, so each deploy
imports the official directory from NCES and regenerates the schema data. The importer
never fails the build: if the source is unreachable it writes a manifest with
`status: "not_imported"` and the UI says so rather than showing invented data.

## Layout

```
lib/            schema, detectors, HTTP layer, run recorder, CSV/ZIP readers
scripts/        importer, detector CLI, web-data generator
assets/         stylesheet, browser modules, generated data
test/           node:test suites (no network) and test/ui/ browser suites
```
