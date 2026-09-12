/* Banner connector shells: filtering, pagination and detail modals.
   All values come from assets/preview-data.js and are preview examples. */
(function () {
  'use strict';
  var D = window.DG_PREVIEW || { universities: [], runs: [] };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  };
  var ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m14 7 5 5-5 5"/></svg>';
  var PER_PAGE = 10;

  /* ---------- modal (shared helper from assets/ui.js) ---------- */
  function openModal(title, sub, bodyHtml) { window.DGUI.open(title, sub, bodyHtml); }

  function kv(rows) {
    return '<table class="kv"><tbody>' + rows.map(function (r) {
      return '<tr><th>' + esc(r[0]) + '</th><td>' + r[1] + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function badge() { return '<span class="badge">Preview data</span>'; }
  function pct(c) { return c == null ? '<span class="muted-val">&mdash;</span>' : Math.round(c * 100) + '%'; }

  /* ---------- pagination control ---------- */
  function renderPager(el, page, pages, onGo) {
    if (!el) return;
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
    out += '<button class="pg" data-go="' + (page + 1) + '"' + (page === pages || pages === 0 ? ' disabled' : '') + ' aria-label="Next page">&rsaquo;</button>';
    el.innerHTML = out;
    Array.prototype.forEach.call(el.querySelectorAll('button[data-go]'), function (b) {
      b.addEventListener('click', function () { onGo(parseInt(b.getAttribute('data-go'), 10)); });
    });
  }

  /* ---------- supported universities ---------- */
  function initUniversities() {
    var body = $('suBody'); if (!body) return;
    var page = 1;
    function filtered() {
      var q = ($('suSearch').value || '').trim().toLowerCase();
      var st = $('suState').value, sc = $('suStatus').value;
      return D.universities.filter(function (u) {
        if (st && u.state !== st) return false;
        if (sc && u.status !== sc) return false;
        if (!q) return true;
        return (u.name + ' ' + u.domain + ' ' + u.state).toLowerCase().indexOf(q) > -1;
      });
    }
    function render() {
      var rows = filtered();
      var pages = Math.ceil(rows.length / PER_PAGE);
      if (page > pages) page = pages || 1;
      var slice = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
      body.innerHTML = slice.map(function (u, i) {
        var idx = D.universities.indexOf(u);
        return '<tr>' +
          '<td><span class="uni"><span class="mono-logo" style="background:' + u.color + '">' + esc(u.mono) + '</span>' + esc(u.name) + '</span></td>' +
          '<td><span class="lnk">' + esc(u.domain) + '</span></td>' +
          '<td>' + esc(u.state) + '</td>' +
          '<td><span class="sdot ' + u.statusClass + '"><i></i>' + esc(u.statusLabel) + '</span></td>' +
          '<td>' + pct(u.confidence) + '</td>' +
          '<td>' + esc(u.lastChecked) + '</td>' +
          '<td><button class="linkish" data-uni="' + idx + '">View details ' + ARROW + '</button></td>' +
          '</tr>';
      }).join('');
      $('suEmpty').style.display = rows.length ? 'none' : 'block';
      var from = rows.length ? (page - 1) * PER_PAGE + 1 : 0;
      $('suCount').textContent = 'Showing ' + from + '–' + Math.min(page * PER_PAGE, rows.length) +
        ' of ' + rows.length + ' universities (preview)';
      renderPager($('suPager'), page, pages, function (p) { page = p; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      Array.prototype.forEach.call(body.querySelectorAll('button[data-uni]'), function (b) {
        b.addEventListener('click', function () { showUni(D.universities[parseInt(b.getAttribute('data-uni'), 10)]); });
      });
    }
    function showUni(u) {
      openModal(u.name, u.domain + ' · preview detection record', badge() +
        '<div style="height:10px"></div>' +
        kv([
          ['University', esc(u.name)],
          ['Domain', esc(u.domain)],
          ['State', esc(u.state)],
          ['Detection status', '<span class="sdot ' + u.statusClass + '"><i></i>' + esc(u.statusLabel) + '</span>'],
          ['Confidence', pct(u.confidence)],
          ['Detected signals', u.signals.length
            ? '<div class="sig-list">' + u.signals.map(function (s) { return '<span class="sig">' + esc(s) + '</span>'; }).join('') + '</div>'
            : '<span class="muted-val">None matched</span>'],
          ['Registration URL', u.registrationUrl ? '<span class="mono-cell">' + esc(u.registrationUrl) + '</span>' : '<span class="muted-val">&mdash;</span>'],
          ['Last checked', esc(u.lastChecked)]
        ]) +
        '<p class="empty-soft" style="margin-top:12px">Example record. No live request has been made to this institution.</p>');
    }
    ['suSearch', 'suState', 'suStatus'].forEach(function (id) {
      $(id).addEventListener(id === 'suSearch' ? 'input' : 'change', function () { page = 1; render(); });
    });
    render();
  }

  /* ---------- recent runs ---------- */
  function initRuns() {
    var body = $('rrBody'); if (!body) return;
    var page = 1;
    function render() {
      var rows = D.runs;
      var pages = Math.ceil(rows.length / PER_PAGE);
      var slice = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
      body.innerHTML = slice.map(function (r) {
        var idx = D.runs.indexOf(r);
        var label = { success: 'Success', no_match: 'No match', failed: 'Failed' }[r.status];
        var cls = { success: 'success', no_match: 'nomatch', failed: 'failed' }[r.status];
        return '<tr>' +
          '<td class="mono-cell">' + esc(r.id) + '</td>' +
          '<td>' + esc(r.name) + '</td>' +
          '<td><span class="lnk">' + esc(r.domain) + '</span></td>' +
          '<td><span class="pill-status ' + cls + '"><span class="sdot ' + cls + '"><i></i></span>' + label + '</span></td>' +
          '<td>' + pct(r.confidence) + '</td>' +
          '<td>' + r.duration + 's</td>' +
          '<td>' + esc(r.startedAt) + '</td>' +
          '<td><button class="linkish" data-run="' + idx + '">View ' + ARROW + '</button></td>' +
          '</tr>';
      }).join('');
      $('rrCount').textContent = 'Showing ' + ((page - 1) * PER_PAGE + 1) + '–' +
        Math.min(page * PER_PAGE, rows.length) + ' of ' + rows.length + ' preview runs';
      renderPager($('rrPager'), page, pages, function (p) { page = p; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      Array.prototype.forEach.call(body.querySelectorAll('button[data-run]'), function (b) {
        b.addEventListener('click', function () { showRun(D.runs[parseInt(b.getAttribute('data-run'), 10)]); });
      });
    }
    function showRun(r) {
      var label = { success: 'Success', no_match: 'No match', failed: 'Failed' }[r.status];
      var cls = { success: 'success', no_match: 'nomatch', failed: 'failed' }[r.status];
      openModal(r.id, r.name + ' · preview detection run', badge() +
        '<div style="height:10px"></div>' +
        kv([
          ['Run ID', '<span class="mono-cell">' + esc(r.id) + '</span>'],
          ['University', esc(r.name)],
          ['Domain', esc(r.domain)],
          ['Status', '<span class="pill-status ' + cls + '"><span class="sdot ' + cls + '"><i></i></span>' + label + '</span>'],
          ['Confidence', pct(r.confidence)],
          ['Duration', r.duration + 's'],
          ['Started at', esc(r.startedAt)],
          ['Signals', r.signals.length
            ? '<div class="sig-list">' + r.signals.map(function (s) { return '<span class="sig">' + esc(s) + '</span>'; }).join('') + '</div>'
            : '<span class="muted-val">None matched</span>'],
          ['Result', esc(r.result)],
          ['Error', r.error ? esc(r.error) : '<span class="muted-val">&mdash;</span>']
        ]) +
        '<p class="empty-soft" style="margin-top:12px">Example run. No live detection has been executed.</p>');
    }
    // summary + breakdown, computed from the preview run list
    var total = D.runs.length;
    var by = { success: 0, no_match: 0, failed: 0 };
    D.runs.forEach(function (r) { by[r.status]++; });
    if ($('rrTotal')) {
      $('rrTotal').textContent = total;
      $('rrSuccess').textContent = by.success;
      $('rrNomatch').textContent = by.no_match;
      $('rrFailed').textContent = by.failed;
      [['bdSuccess', by.success], ['bdNomatch', by.no_match], ['bdFailed', by.failed]].forEach(function (p) {
        var v = Math.round(p[1] / total * 100);
        $(p[0]).style.width = v + '%';
        $(p[0] + 'Pct').textContent = v + '%';
      });
      var errs = D.runs.filter(function (r) { return r.error; }).slice(0, 4);
      $('rrErrors').innerHTML = errs.map(function (r) {
        return '<tr><td>' + esc(r.startedAt.replace(', 2026', '')) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.error) + '</td></tr>';
      }).join('');
    }
    render();
  }

  /* ---------- coverage header (computed from the preview list) ---------- */
  function initCoverage() {
    if (!$('covDetected')) return;
    var det = D.universities.filter(function (u) { return u.confidence != null; });
    var avg = det.reduce(function (a, u) { return a + u.confidence; }, 0) / (det.length || 1);
    $('covDetected').textContent = det.length;
    $('covTotal').textContent = D.universities.length;
    $('covConf').textContent = Math.round(avg * 100) + '%';
  }

  initCoverage(); initUniversities(); initRuns();
})();
