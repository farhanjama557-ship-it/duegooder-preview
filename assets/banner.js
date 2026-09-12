/**
 * Banner connector pages, rendered from real detector and collection output.
 *
 * Sources: assets/data/detections.json and assets/data/runs.json, both written
 * only by scripts/detect.js executing the detector in lib/detectors/banner.js.
 * If those files are absent or empty the pages say so; nothing is invented.
 */
(function () {
  'use strict';
  var D = window.DGData, S = window.DGStatus;
  var $ = function (id) { return document.getElementById(id); };
  var esc = D.escape;
  var ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m14 7 5 5-5 5"/></svg>';
  var PER_PAGE = 10;

  var RESULT_LABEL = {
    detected: 'Detected', no_match: 'No match', timeout: 'Timeout',
    request_failed: 'Request failed', blocked: 'Blocked', parse_failure: 'Parse failure'
  };
  var RESULT_CLASS = {
    detected: 'success', no_match: 'nomatch', timeout: 'failed',
    request_failed: 'failed', blocked: 'failed', parse_failure: 'failed'
  };

  function detectionLabel(d) {
    if (!d) return 'Not probed yet';
    if (d.result !== 'detected') return RESULT_LABEL[d.result] || d.result;
    var band = d.confidence_band ? d.confidence_band.charAt(0).toUpperCase() + d.confidence_band.slice(1) : '';
    return 'Detected (' + band + ' confidence)';
  }
  function detectionClass(d) {
    if (!d) return 'discovering';
    if (d.result === 'detected') return d.confidence_band === 'high' ? 'high' : (d.confidence_band === 'medium' ? 'med' : 'low');
    if (d.result === 'no_match') return 'manual';
    return 'failed';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function kv(rows) {
    return '<table class="kv"><tbody>' + rows.map(function (r) {
      return '<tr><th>' + esc(r[0]) + '</th><td>' + r[1] + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function evidenceHtml(list) {
    if (!list || !list.length) return '<span class="muted-val">No signals matched</span>';
    return '<div class="sig-list">' + list.map(function (s) { return '<span class="sig">' + esc(s) + '</span>'; }).join('') + '</div>';
  }
  function renderPager(el, page, pages, onGo) {
    if (!el) return;
    if (pages <= 1) { el.innerHTML = ''; return; }
    var out = '<button class="pg" data-go="' + (page - 1) + '"' + (page === 1 ? ' disabled' : '') + ' aria-label="Previous page">&lsaquo;</button>';
    var list = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1) list.push(i);
      else if (list[list.length - 1] !== '…') list.push('…');
    }
    list.forEach(function (i) {
      out += i === '…' ? '<span class="pg dots">…</span>'
        : '<button class="pg' + (i === page ? ' on' : '') + '" data-go="' + i + '">' + i + '</button>';
    });
    out += '<button class="pg" data-go="' + (page + 1) + '"' + (page === pages ? ' disabled' : '') + ' aria-label="Next page">&rsaquo;</button>';
    el.innerHTML = out;
    Array.prototype.forEach.call(el.querySelectorAll('button[data-go]'), function (b) {
      b.addEventListener('click', function () { onGo(parseInt(b.getAttribute('data-go'), 10)); });
    });
  }
  var NO_DETECTIONS = 'No detector executions are stored yet. Run <code>npm run detect -- appstate.edu udayton.edu uwf.edu</code> ' +
    'from a machine with network access; this page renders whatever real results that produces.';

  /* ---------- coverage header ---------- */
  function initCoverage(detections) {
    if (!$('covDetected')) return;
    var detected = detections.filter(function (d) { return d.result === 'detected'; });
    var confs = detected.map(function (d) { return d.confidence; });
    $('covDetected').textContent = detected.length;
    $('covTotal').textContent = detections.length;
    $('covConf').textContent = confs.length
      ? Math.round(confs.reduce(function (a, b) { return a + b; }, 0) / confs.length * 100) + '%'
      : '—';
  }

  function initCollectionOverview(collections) {
    if (!$('bcSections')) return;
    var latest = collections && collections.latest;
    if (!latest) return;
    var m = latest.metrics || {}, schools = latest.schools || [];
    $('bcSuccess').textContent = Number(m.schools_complete || 0) + '/' + Number(m.schools_processed || 0);
    $('bcRuntime').textContent = Number(m.runtime_ms || 0) >= 60000
      ? (Number(m.runtime_ms) / 60000).toFixed(1) + 'm' : (Number(m.runtime_ms || 0) / 1000).toFixed(1) + 's';
    $('bcSections').textContent = Number(m.sections || 0).toLocaleString('en-US');
    $('bcUniversities').textContent = schools.filter(function (s) { return s.status === 'complete'; })
      .map(function (s) { return s.school_name + ' (' + Number(s.sections || 0).toLocaleString('en-US') + ' sections)'; }).join(' · ') ||
      'No successful collections stored yet.';
  }

  /* ---------- supported universities ---------- */
  function initUniversities(detections) {
    var body = $('suBody'); if (!body) return;
    var page = 1;

    if (!detections.length) {
      $('suTable').style.display = 'none';
      $('suToolbar').style.display = 'none';
      $('suEmpty').innerHTML = D.emptyState('No detection results yet', NO_DETECTIONS);
      $('suEmpty').style.display = 'block';
      $('suCount').textContent = '';
      return;
    }
    // state filter options come from the data we actually have
    var states = {};
    detections.forEach(function (d) { if (d.state) states[d.state] = 1; });
    var stateSel = $('suState');
    Object.keys(states).sort().forEach(function (s) {
      var o = document.createElement('option'); o.textContent = s; stateSel.appendChild(o);
    });

    function filtered() {
      var q = ($('suSearch').value || '').trim().toLowerCase();
      var st = stateSel.value, sc = $('suStatus').value;
      return detections.filter(function (d) {
        if (st && d.state !== st) return false;
        if (sc) {
          if (sc === 'detected_high' || sc === 'detected_med' || sc === 'detected_low') {
            var want = { detected_high: 'high', detected_med: 'medium', detected_low: 'low' }[sc];
            if (!(d.result === 'detected' && d.confidence_band === want)) return false;
          } else if (d.result !== sc) return false;
        }
        if (!q) return true;
        return ((d.school_name || '') + ' ' + d.domain + ' ' + (d.state || '')).toLowerCase().indexOf(q) > -1;
      });
    }
    function render() {
      var rows = filtered();
      var pages = Math.ceil(rows.length / PER_PAGE) || 1;
      if (page > pages) page = pages;
      body.innerHTML = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(function (d) {
        var i = detections.indexOf(d);
        var name = d.school_name || d.domain;
        return '<tr>' +
          '<td><span class="uni"><span class="mono-logo" style="background:' + D.color(d.domain) + '">' + esc(D.mono(name)) + '</span>' + esc(name) + '</span></td>' +
          '<td><span class="lnk">' + esc(d.domain) + '</span></td>' +
          '<td>' + esc(d.state || '—') + '</td>' +
          '<td><span class="sdot ' + detectionClass(d) + '"><i></i>' + esc(detectionLabel(d)) + '</span></td>' +
          '<td>' + (d.result === 'detected' ? D.pct(d.confidence) : '<span class="muted-val">—</span>') + '</td>' +
          '<td>' + esc(fmtDate(d.detected_at)) + '</td>' +
          '<td><button class="linkish" data-uni="' + i + '">View details ' + ARROW + '</button></td>' +
          '</tr>';
      }).join('');
      $('suEmpty').style.display = rows.length ? 'none' : 'block';
      if (!rows.length) $('suEmpty').textContent = 'No universities match this filter.';
      var from = rows.length ? (page - 1) * PER_PAGE + 1 : 0;
      $('suCount').textContent = 'Showing ' + from + '–' + Math.min(page * PER_PAGE, rows.length) +
        ' of ' + rows.length + ' detector results';
      renderPager($('suPager'), page, pages, function (p) { page = p; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      Array.prototype.forEach.call(body.querySelectorAll('button[data-uni]'), function (b) {
        b.addEventListener('click', function () { showDetection(detections[parseInt(b.getAttribute('data-uni'), 10)]); });
      });
    }
    function showDetection(d) {
      window.DGUI.open(d.school_name || d.domain, d.domain + ' · detector result', kv([
        ['University', esc(d.school_name || '—')],
        ['Domain', esc(d.domain)],
        ['State', esc(d.state || '—')],
        ['Detection status', '<span class="sdot ' + detectionClass(d) + '"><i></i>' + esc(detectionLabel(d)) + '</span>'],
        ['Confidence', d.result === 'detected' ? D.pct(d.confidence) + ' (' + esc(d.confidence_band) + ')' : '<span class="muted-val">—</span>'],
        ['School status', esc(D.statusLabel(S.statusFor(d)))],
        ['Detected signals', evidenceHtml(d.evidence)],
        ['Registration URL', d.registration_url ? '<span class="mono-cell">' + esc(d.registration_url) + '</span>' : '<span class="muted-val">—</span>'],
        ['Requests made', d.requests == null ? '—' : d.requests],
        ['Last checked', esc(fmtDateTime(d.detected_at))],
        ['Error', d.error ? esc(d.error) : '<span class="muted-val">—</span>']
      ]) + '<p class="empty-soft" style="margin-top:12px">Produced by lib/detectors/banner.js against public pages.</p>');
    }
    ['suSearch', 'suState', 'suStatus'].forEach(function (id) {
      $(id).addEventListener(id === 'suSearch' ? 'input' : 'change', function () { page = 1; render(); });
    });
    render();
  }

  /* ---------- recent collection runs ---------- */
  function initRuns(store) {
    var body = $('rrBody'); if (!body) return;
    var runs = store.runs || [];
    var page = 1;

    if (!runs.length) {
      $('rrTable').style.display = 'none';
      $('rrEmptyWrap').innerHTML = D.emptyState('No collection runs recorded yet',
        'Run <code>npm run collect:banner</code>; this page only renders measured collection output.');
      $('rrCount').textContent = '';
      ['rrTotal', 'rrSuccess', 'rrNomatch', 'rrFailed'].forEach(function (id) { $(id).textContent = '0'; });
      ['bdSuccess', 'bdNomatch', 'bdFailed'].forEach(function (id) { $(id).style.width = '0'; $(id + 'Pct').textContent = '—'; });
      $('rrErrors').innerHTML = '<tr><td colspan="3" style="color:#6d757e">No errors recorded yet.</td></tr>';
      return;
    }
    var complete = runs.filter(function (r) { return r.status === 'complete'; }).length;
    var partial = runs.filter(function (r) { return r.status !== 'complete' && r.status !== 'failed'; }).length;
    var failed = runs.length - complete - partial;
    var pcts = [complete, partial, failed].map(function (n) { return runs.length ? Math.floor(n / runs.length * 100) : 0; });
    pcts[0] += 100 - pcts[0] - pcts[1] - pcts[2];
    $('rrTotal').textContent = runs.length;
    $('rrSuccess').textContent = complete;
    $('rrNomatch').textContent = partial;
    $('rrFailed').textContent = failed;
    {
      [['bdSuccess', pcts[0]], ['bdNomatch', pcts[1]], ['bdFailed', pcts[2]]].forEach(function (p) {
        $(p[0]).style.width = p[1] + '%';
        $(p[0] + 'Pct').textContent = p[1] + '%';
      });
    }
    var errs = [];
    runs.forEach(function (r) { (r.schools || []).forEach(function (s) { if (s.error) errs.push({ at: r.started_at, school: s.school_name || s.domain, error: s.error }); }); });
    $('rrErrors').innerHTML = errs.length ? errs.slice(0, 5).map(function (r) {
      return '<tr><td>' + esc(fmtDateTime(r.at)) + '</td><td>' + esc(r.school) + '</td><td>' + esc(r.error) + '</td></tr>';
    }).join('') : '<tr><td colspan="3" style="color:#6d757e">No errors recorded.</td></tr>';

    function render() {
      var pages = Math.ceil(runs.length / PER_PAGE) || 1;
      body.innerHTML = runs.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(function (r) {
        var i = runs.indexOf(r);
        var cls = r.status === 'complete' ? 'success' : (r.status === 'failed' ? 'failed' : 'nomatch');
        var m = r.metrics || {}, names = (r.schools || []).map(function (s) { return s.school_name; }).join(', ');
        return '<tr>' +
          '<td class="mono-cell">' + esc(r.run_id) + '</td>' +
          '<td>' + esc(names || '—') + '</td>' +
          '<td><span class="lnk">Banner</span></td>' +
          '<td><span class="pill-status ' + cls + '"><span class="sdot ' + cls + '"><i></i></span>' + esc(r.status) + '</span></td>' +
          '<td>' + Number(m.sections || 0).toLocaleString('en-US') + '</td>' +
          '<td>' + (Number(m.runtime_ms || 0) / 1000).toFixed(1) + 's</td>' +
          '<td>' + esc(fmtDateTime(r.started_at)) + '</td>' +
          '<td><button class="linkish" data-run="' + i + '">View ' + ARROW + '</button></td>' +
          '</tr>';
      }).join('');
      $('rrCount').textContent = 'Showing ' + ((page - 1) * PER_PAGE + 1) + '–' +
        Math.min(page * PER_PAGE, runs.length) + ' of ' + runs.length + ' collection runs';
      renderPager($('rrPager'), page, pages, function (p) { page = p; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      Array.prototype.forEach.call(body.querySelectorAll('button[data-run]'), function (b) {
        b.addEventListener('click', function () { showRun(runs[parseInt(b.getAttribute('data-run'), 10)]); });
      });
    }
    function showRun(r) {
      var cls = r.status === 'complete' ? 'success' : 'failed', m = r.metrics || {};
      window.DGUI.open(r.run_id, 'Banner collection run', kv([
        ['Run ID', '<span class="mono-cell">' + esc(r.run_id) + '</span>'],
        ['Schools processed', esc(String(m.schools_processed || 0))],
        ['Status', '<span class="pill-status ' + cls + '"><span class="sdot ' + cls + '"><i></i></span>' + esc(r.status) + '</span>'],
        ['Sections', Number(m.sections || 0).toLocaleString('en-US')],
        ['Meetings', Number(m.meetings || 0).toLocaleString('en-US')],
        ['Meetings with times', Number(m.meetings_with_times || 0).toLocaleString('en-US')],
        ['Duration', (Number(m.runtime_ms || 0) / 1000).toFixed(1) + 's'],
        ['HTTP requests', Number(m.http_requests || 0).toLocaleString('en-US')],
        ['Failures', Number(m.failures || 0).toLocaleString('en-US')],
        ['Manual intervention', Number(m.manual_intervention || 0).toLocaleString('en-US')],
        ['Direct cost', '$' + Number(m.direct_cost_usd || 0).toFixed(2)],
        ['Started', esc(fmtDateTime(r.started_at))],
        ['Finished', esc(fmtDateTime(r.finished_at))],
        ['Persistence', r.persistence ? esc(JSON.stringify(r.persistence.sections)) : '<span class="muted-val">—</span>']
      ]));
    }
    render();
  }

  /* ---------- technical details ---------- */
  function initTechnical(detectors, detections) {
    if (!$('tdSignals')) return;
    var b = detectors && detectors.banner;
    if (b) {
      $('tdSignals').innerHTML = b.signals.map(function (s) {
        return '<li>' + CHECK + '<span>' + esc(s.label) + ' <span class="muted-val">(weight ' + s.weight +
          (s.structural ? ', structural' : '') + ')</span></span></li>';
      }).join('');
      $('tdRoutes').innerHTML = b.routes.map(function (r) {
        return '<div class="ep"><code>/StudentRegistrationSsb' + esc(r) + '</code></div>';
      }).join('') + b.well_known_hosts.map(function (h) {
        return '<div class="ep"><code>' + esc(h) + '.&lt;domain&gt;</code><small>well-known Banner host pattern</small></div>';
      }).join('');
      $('tdLimits').innerHTML = [
        ['Timeout', b.timeout_ms + 'ms per request'],
        ['Concurrency', b.concurrency + ' institutions in parallel'],
        ['Delay', b.delay_ms + 'ms between institutions'],
        ['Requests', 'at most ' + b.max_requests_per_school + ' per institution (incl. robots.txt)'],
        ['Discovery', 'homepage, then up to ' + (b.max_hub_pages || 2) + ' registrar / class-search pages, then ' + b.well_known_hosts.length + ' well-known hosts'],
        ['Cache', 'results reused for ' + b.cache_ttl_hours + 'h'],
        ['robots.txt', 'checked before probing']
      ].map(function (r) { return '<div>' + CLOCK + '<span>' + esc(r[0]) + ': ' + esc(r[1]) + '</span></div>'; }).join('');
      $('tdBands').innerHTML = ['high ≥ ' + b.bands.HIGH, 'medium ≥ ' + b.bands.MEDIUM, 'low ≥ ' + b.bands.MIN,
        'below ' + b.bands.MIN + ' → no match'].map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('');
      $('tdUa').textContent = b.user_agent;
    }
    // Example detection: a real stored result if we have one.
    var real = detections.filter(function (d) { return d.result === 'detected'; })[0] || detections[0] || null;
    if (real) {
      $('tdExample').textContent = JSON.stringify(real, null, 2);
      $('tdExampleBadge').textContent = 'Detection result';
      $('tdExampleNote').textContent = 'Real output from lib/detectors/banner.js for ' + real.domain + ', stored in assets/data/detections.json.';
    } else {
      $('tdExample').textContent = '// No detection has been executed yet.\n' +
        '// Run: npm run detect -- appstate.edu udayton.edu uwf.edu\n' +
        '// This panel shows the real stored result once one exists.';
      $('tdExampleBadge').textContent = 'No result yet';
      $('tdExampleNote').textContent = 'Nothing is shown here until the detector has actually run.';
    }
  }
  var CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1f9d5c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/></svg>';
  var CLOCK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7d868e" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>';

  /* ---------- boot ---------- */
  Promise.all([D.detections(), D.runs(), D.detectors(), D.institutions(), D.collections()]).then(function (res) {
    var detections = res[0], runs = res[1], detectors = res[2], institutions = res[3], collections = res[4];
    // attach state/name from the directory where the detector did not have it
    var byDomain = {};
    institutions.forEach(function (i) { byDomain[i.domain] = i; });
    detections.forEach(function (d) {
      var inst = byDomain[d.domain];
      if (inst) { d.state = d.state || inst.state; d.school_name = d.school_name || inst.name; }
    });
    (runs.runs || []).forEach(function (r) {
      var inst = byDomain[r.domain];
      if (inst) r.school_name = r.school_name || inst.name;
    });
    initCoverage(detections);
    initCollectionOverview(collections);
    initUniversities(detections);
    initRuns(collections);
    initTechnical(detectors, detections);
  });
})();
