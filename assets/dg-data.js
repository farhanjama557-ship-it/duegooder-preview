/**
 * Browser data layer.
 *
 * Loads the generated data files and exposes them to the pages. Every file is
 * produced by real work:
 *   institutions.json  scripts/import-institutions.js  (NCES IPEDS HD)
 *   manifest.json      import provenance: source URL, survey year, count
 *   detections.json    scripts/detect.js               (real detector executions)
 *   runs.json          scripts/detect.js               (one record per execution)
 *   schema.json        scripts/build-web-data.js       (from lib/schema.js)
 *   detectors.json     scripts/build-web-data.js       (from lib/detectors/)
 *   sections.json      scripts/collect-banner.js       (canonical section records)
 *   meetings.json      scripts/collect-banner.js       (all meeting patterns)
 *   collections.json   scripts/collect-banner.js       (measured collection runs)
 *
 * When a file is absent the page shows an honest empty state. Nothing here
 * invents data.
 */
(function () {
  'use strict';

  var cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    cache[name] = fetch('/assets/data/' + name + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return cache[name];
  }

  var DGData = {
    institutions: function () { return load('institutions').then(function (d) { return Array.isArray(d) ? d : []; }); },
    manifest: function () { return load('manifest'); },
    detections: function () {
      return load('detections').then(function (d) { return (d && Array.isArray(d.detections)) ? d.detections : []; });
    },
    detectionMap: function () {
      return DGData.detections().then(function (list) {
        var m = {};
        list.forEach(function (d) { m[d.domain] = d; });
        return m;
      });
    },
    runs: function () {
      return load('runs').then(function (d) { return d && Array.isArray(d.runs) ? d : { runs: [], summary: null }; });
    },
    sections: function () {
      return load('sections').then(function (d) { return d && Array.isArray(d.sections) ? d.sections : []; });
    },
    meetings: function () {
      return load('meetings').then(function (d) { return d && Array.isArray(d.meetings) ? d.meetings : []; });
    },
    terms: function () {
      return load('terms').then(function (d) { return d && Array.isArray(d.terms) ? d.terms : []; });
    },
    subjects: function () {
      return load('subjects').then(function (d) { return d && Array.isArray(d.subjects) ? d.subjects : []; });
    },
    collections: function () {
      return load('collections').then(function (d) { return d && Array.isArray(d.runs) ? d : { latest: null, runs: [] }; });
    },
    provenance: function () {
      return load('provenance').then(function (d) { return d && Array.isArray(d.sources) ? d.sources : []; });
    },
    schema: function () { return load('schema'); },
    detectors: function () { return load('detectors'); },

    /** Status for an institution given the detection store. Mirrors lib/status.js. */
    statusFor: function (institution, detectionMap, collectionMap) {
      var det = detectionMap ? detectionMap[institution.domain] : null;
      var collection = collectionMap ? collectionMap[institution.domain] : null;
      return window.DGStatus.statusFor(det || null, { collectionVerified: !!collection && collection.status === 'complete' });
    },
    statusLabel: function (key) { return window.DGStatus.LABEL[key] || key; },

    /** Platform column: only a real detection can name a platform. */
    /**
     * Platform column. A completed collection run is stronger evidence than the
     * detector store: if a connector actually collected sections from a school,
     * that school runs that platform even when an earlier detection said no_match.
     */
    platformFor: function (institution, detectionMap, collectionMap) {
      var title = function (p) { return p.charAt(0).toUpperCase() + p.slice(1); };
      var run = collectionMap ? collectionMap[institution.domain] : null;
      if (run && run.status === 'complete' && run.connector) return title(run.connector);
      var det = detectionMap ? detectionMap[institution.domain] : null;
      if (det && det.result === 'detected') return title(det.platform);
      return null;
    },

    escape: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
      });
    },
    pct: function (c) { return c == null ? null : Math.round(c * 100) + '%'; },
    /** Initials used for the small institution avatars. */
    mono: function (name) {
      var skip = { of: 1, the: 1, and: 1, at: 1, in: 1, a: 1, for: 1 };
      var words = String(name || '').replace(/[^A-Za-z\s]/g, ' ').split(/\s+/).filter(function (w) {
        return w && !skip[w.toLowerCase()];
      });
      if (!words.length) return 'U';
      if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
      var significant = words.filter(function (w) { return !/^university|college|institute|school$/i.test(w); });
      var use = significant.length >= 2 ? significant : words;
      return (use[0][0] + use[use.length - 1][0]).toUpperCase();
    },
    color: function (seed) {
      var palette = ['#1c1c1c', '#b8242c', '#1f4f9c', '#8a1538', '#1b3d6d', '#6d1f3f', '#0b5d3b', '#4a1010', '#335c81', '#7a3b2e'];
      var h = 0, s = String(seed || '');
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return palette[h % palette.length];
    },
    /** Renders the shared "nothing here yet, and here is why" block. */
    emptyState: function (title, detail) {
      return '<div class="noresults" style="padding:34px 20px">' +
        '<b style="display:block;font-size:13px;color:#2e363d">' + DGData.escape(title) + '</b>' +
        '<span style="display:block;margin-top:6px;max-width:520px;margin-left:auto;margin-right:auto">' + detail + '</span></div>';
    }
  };

  window.DGData = DGData;
})();
