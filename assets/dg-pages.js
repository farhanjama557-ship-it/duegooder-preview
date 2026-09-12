/**
 * Homepage search, Universities directory, Connectors registry and the
 * Data & Schema pages - all rendered from the generated real data.
 */
(function () {
  'use strict';
  var D = window.DGData, S = window.DGStatus;
  var $ = function (id) { return document.getElementById(id); };
  var esc = D.escape;
  var ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m14 7 5 5-5 5"/></svg>';
  var NOT_IMPORTED = 'The institution directory has not been imported yet. Run <code>npm run import:institutions</code> ' +
    '(NCES IPEDS Directory information) and redeploy; every institution shown here comes from that official file.';

  function statusPill(key) {
    var cls = { supported: 'tag-green', live: 'tag-green', discovering: 'tag-gray', manual_review: 'tag-amber' }[key] || 'tag-gray';
    return '<span class="tag ' + cls + '">' + esc(D.statusLabel(key)) + '</span>';
  }
  function instRow(inst, detMap, collectionMap) {
    var collection = collectionMap[inst.domain] || null;
    var status = D.statusFor(inst, detMap, collectionMap);
    var platform = D.platformFor(inst, detMap, collectionMap);
    return '<tr>' +
      '<td><span class="uni"><span class="mono-logo" style="background:' + D.color(inst.domain) + '">' + esc(D.mono(inst.name)) + '</span>' + esc(inst.name) + '</span></td>' +
      '<td>' + esc(inst.domain) + '</td>' +
      '<td>' + esc(inst.state) + '</td>' +
      '<td>' + (platform ? esc(platform) : '<span class="muted-val">Unknown</span>') + '</td>' +
      '<td>' + statusPill(status) + '</td>' +
      '<td class="muted-val">' + (collection ? esc((collection.finished_at || '').slice(0, 10)) : '—') + '</td>' +
      '<td><button class="linkish" data-inst="' + esc(inst.unitid) + '">View ' + ARROW + '</button></td>' +
      '</tr>';
  }
  function showInstitution(inst, detMap, collectionMap) {
    var det = detMap[inst.domain] || null;
    var collection = collectionMap[inst.domain] || null;
    var rows = [
      ['Institution', esc(inst.name)],
      ['UNITID', '<span class="mono-cell">' + esc(inst.unitid) + '</span>'],
      ['City', esc(inst.city || '—')],
      ['State', esc(inst.state)],
      ['Website', '<span class="mono-cell">' + esc(inst.website || inst.domain) + '</span>'],
      ['Domain', esc(inst.domain)],
      ['Platform', D.platformFor(inst, detMap, collectionMap) || '<span class="muted-val">Not classified</span>'],
      ['Status', statusPill(S.statusFor(det, { collectionVerified: !!collection && collection.status === 'complete' }))],
      ['Last collection', collection ? esc(collection.finished_at || '—') + ' · ' +
        esc(collection.sections) + ' sections · ' + esc(collection.meetings) + ' meetings' : '<span class="muted-val">—</span>']
    ];
    if (det) {
      rows.push(['Detector result', esc(det.result)]);
      rows.push(['Confidence', det.result === 'detected' ? D.pct(det.confidence) : '<span class="muted-val">—</span>']);
      rows.push(['Evidence', det.evidence && det.evidence.length
        ? '<div class="sig-list">' + det.evidence.map(function (e) { return '<span class="sig">' + esc(e) + '</span>'; }).join('') + '</div>'
        : '<span class="muted-val">No signals matched</span>']);
    } else {
      rows.push(['Detector', '<span class="muted-val">This institution has not been probed yet</span>']);
    }
    window.DGUI.open(inst.name, inst.domain + ' · NCES IPEDS record', '<table class="kv"><tbody>' +
      rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>');
  }

  /* ================= homepage ================= */
  function initHome(institutions, detMap, manifest, collectionMap) {
    var input = $('uniInput'); if (!input) return;

    if ($('dgInstCount')) {
      if (manifest && manifest.status === 'imported') {
        $('dgInstCount').textContent = institutions.length.toLocaleString('en-US');
        $('dgInstSource').textContent = 'From NCES / IPEDS ' + (manifest.survey_year || '');
      } else {
        $('dgInstCount').textContent = '—';
        $('dgInstCount').classList.add('muted-val');
        $('dgInstSource').textContent = 'Directory not imported yet';
      }
    }

    var results = $('dgResults');
    var selected = null;

    function renderResults() {
      var q = input.value.trim();
      if (!q) { results.classList.remove('on'); results.innerHTML = ''; return; }
      if (!institutions.length) {
        results.innerHTML = '<div class="dgr-empty">' + NOT_IMPORTED + '</div>';
        results.classList.add('on'); return;
      }
      var hits = window.DGSearch.search(institutions, q, { limit: 8 });
      if (!hits.length) {
        results.innerHTML = '<div class="dgr-empty">No U.S. institution matches “' + esc(q) + '”.</div>';
        results.classList.add('on'); return;
      }
      results.innerHTML = hits.map(function (h, i) {
        var det = detMap[h.domain];
        return '<button class="dgr" data-pick="' + esc(h.unitid) + '">' +
          '<span class="mono-logo" style="background:' + D.color(h.domain) + '">' + esc(D.mono(h.name)) + '</span>' +
          '<span class="dgr-t"><b>' + esc(h.name) + '</b><small>' + esc(h.domain) + ' · ' + esc(h.city) + ', ' + esc(h.state) + '</small></span>' +
          '<span class="dgr-r">' + (det && det.result === 'detected' ? esc(det.platform) : '') + '</span></button>';
      }).join('');
      results.classList.add('on');
      Array.prototype.forEach.call(results.querySelectorAll('button[data-pick]'), function (b) {
        b.addEventListener('click', function () {
          var inst = institutions.filter(function (x) { return x.unitid === b.getAttribute('data-pick'); })[0];
          if (!inst) return;
          selected = inst;
          input.value = inst.domain;
          results.classList.remove('on');
          runFlow(inst);
        });
      });
    }
    input.addEventListener('input', function () { selected = null; renderResults(); });
    input.addEventListener('focus', renderResults);
    document.addEventListener('click', function (e) {
      if (!results.contains(e.target) && e.target !== input) results.classList.remove('on');
    });

    var stages = document.querySelectorAll('.stage');
    function setStage(i, cls) { if (stages[i]) { stages[i].classList.remove('act', 'done'); if (cls) stages[i].classList.add(cls); } }

    function runFlow(inst) {
      for (var i = 0; i < stages.length; i++) setStage(i, null);
      $('runline').classList.add('show');
      var det = detMap[inst.domain] || null;
      var collection = collectionMap[inst.domain] || null;
      setStage(0, 'done');
      $('runlineBadge').textContent = 'IPEDS record';
      if (collection && collection.status === 'complete') {
        setStage(1, 'done'); setStage(2, 'done'); setStage(3, 'done'); setStage(4, 'done');
        $('runlineBadge').textContent = 'Live collection';
        $('runlineText').innerHTML = esc(inst.name) + ' · <b>Banner</b> · ' + esc(collection.sections) +
          ' sections and ' + esc(collection.meetings) + ' meetings collected from public sources in ' +
          (collection.runtime_ms / 1000).toFixed(1) + 's.';
      } else if (det && det.result === 'detected') {
        setStage(1, 'done');
        $('runlineText').innerHTML = esc(inst.name) + ' · ' + esc(inst.city) + ', ' + esc(inst.state) +
          ' — <b>' + esc(det.platform) + '</b> detected (' + D.pct(det.confidence) + ' confidence, ' + esc(det.confidence_band) + '). ' +
          'No successful collection is stored yet.';
      } else if (det) {
        setStage(1, 'act');
        $('runlineText').innerHTML = esc(inst.name) + ' · ' + esc(inst.city) + ', ' + esc(inst.state) +
          ' — detector result: <b>' + esc(det.result) + '</b>' + (det.error ? ' (' + esc(det.error) + ')' : '') + '.';
      } else {
        setStage(1, 'act');
        $('runlineText').innerHTML = esc(inst.name) + ' · ' + esc(inst.city) + ', ' + esc(inst.state) +
          ' — platform not classified yet. Detection runs via <code>npm run detect -- ' + esc(inst.domain) + '</code>.';
      }
    }

    $('discoverBtn').addEventListener('click', function () {
      var q = input.value.trim();
      if (!q) { input.focus(); return; }
      if (selected) return runFlow(selected);
      var hits = window.DGSearch.search(institutions, q, { limit: 1 });
      if (hits.length) { selected = hits[0]; input.value = hits[0].domain; results.classList.remove('on'); runFlow(hits[0]); }
      else {
        $('runline').classList.add('show');
        $('runlineBadge').textContent = 'No match';
        $('runlineText').textContent = institutions.length
          ? 'No U.S. institution in the NCES IPEDS directory matches “' + q + '”.'
          : 'The institution directory has not been imported yet.';
      }
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('discoverBtn').click(); }
      if (e.key === 'Escape') results.classList.remove('on');
    });
  }

  /* ================= universities page ================= */
  function initUniversitiesPage(institutions, detMap, manifest, collectionMap) {
    var body = $('uBody'); if (!body) return;
    var PER = 25, page = 1;

    if ($('uStatInst')) {
      if (manifest && manifest.status === 'imported') {
        $('uStatInst').textContent = institutions.length.toLocaleString('en-US');
        var states = {}; institutions.forEach(function (i) { if (i.state) states[i.state] = 1; });
        $('uStatStates').textContent = Object.keys(states).length;
        $('uSource').innerHTML = 'NCES IPEDS ' + esc(manifest.survey_year || '') + ' Directory information · ' +
          institutions.length.toLocaleString('en-US') + ' institutions · imported ' + esc((manifest.retrieved_at || '').slice(0, 10));
      } else {
        $('uSource').innerHTML = 'Directory not imported yet.';
      }
    }
    if (!institutions.length) {
      $('uTable').style.display = 'none';
      $('uToolbar').style.display = 'none';
      $('uEmpty').innerHTML = D.emptyState('Institution directory not imported yet', NOT_IMPORTED);
      $('uEmpty').style.display = 'block';
      return;
    }
    var stateSel = $('uState');
    var states = {}; institutions.forEach(function (i) { if (i.state) states[i.state] = 1; });
    Object.keys(states).sort().forEach(function (s) {
      var o = document.createElement('option'); o.textContent = s; stateSel.appendChild(o);
    });

    function filtered() {
      var q = ($('uSearch').value || '').trim();
      var st = stateSel.value, pf = $('uPlatform').value, sc = $('uStatus').value;
      var base = q ? window.DGSearch.search(institutions, q, { limit: 5000 }) : institutions;
      return base.filter(function (i) {
        if (st && i.state !== st) return false;
        var det = detMap[i.domain];
        if (pf) {
          if (pf === 'unknown') { if (det && det.result === 'detected') return false; }
          else if (!(det && det.result === 'detected' && det.platform === pf)) return false;
        }
        if (sc && S.statusFor(det || null, { collectionVerified: !!collectionMap[i.domain] && collectionMap[i.domain].status === 'complete' }) !== sc) return false;
        return true;
      });
    }
    function render() {
      var rows = filtered();
      var pages = Math.ceil(rows.length / PER) || 1;
      if (page > pages) page = pages;
      // only one page of rows is ever in the DOM
      body.innerHTML = rows.slice((page - 1) * PER, page * PER).map(function (i) { return instRow(i, detMap, collectionMap); }).join('');
      $('uEmpty').style.display = rows.length ? 'none' : 'block';
      if (!rows.length) $('uEmpty').textContent = 'No institutions match this filter.';
      var from = rows.length ? (page - 1) * PER + 1 : 0;
      $('uCount').textContent = 'Showing ' + from.toLocaleString('en-US') + '–' + Math.min(page * PER, rows.length).toLocaleString('en-US') +
        ' of ' + rows.length.toLocaleString('en-US') + ' institutions';
      renderPager($('uPager'), page, pages, function (p) { page = p; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      Array.prototype.forEach.call(body.querySelectorAll('button[data-inst]'), function (b) {
        b.addEventListener('click', function () {
          var inst = institutions.filter(function (x) { return x.unitid === b.getAttribute('data-inst'); })[0];
          if (inst) showInstitution(inst, detMap, collectionMap);
        });
      });
    }
    ['uSearch', 'uState', 'uPlatform', 'uStatus'].forEach(function (id) {
      $(id).addEventListener(id === 'uSearch' ? 'input' : 'change', function () { page = 1; render(); });
    });
    render();
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

  /* ================= connectors page ================= */
  function initConnectors(detectors, detections, runs, collections) {
    if (!$('cnCards') || !detectors) return;
    var detected = detections.filter(function (d) { return d.result === 'detected'; });
    var TAG = { detector_available: ['Detector available', 'tag-green'], planned: ['Planned', 'tag-gray'], manual_review: ['Manual review', 'tag-amber'] };
    $('cnCards').innerHTML = detectors.registry.map(function (p) {
      var t = TAG[p.status] || ['Planned', 'tag-gray'];
      var isBanner = p.platform === 'banner';
      var latest = collections.latest;
      var universities = isBanner && latest ? String(latest.metrics.schools_complete) : (isBanner ? '0' : '<span class="muted-val">—</span>');
      var probed = isBanner && latest ? String(latest.metrics.sections) : (isBanner ? '0' : '<span class="muted-val">—</span>');
      var runsCount = isBanner ? String((collections.runs || []).length) : '<span class="muted-val">—</span>';
      return '<div class="card cn-card">' +
        '<div class="cn-top"><span class="cn-logo">' + LAYERS + '</span><span class="cn-name">' + esc(p.label.split(' (')[0]) + '</span>' +
        '<span class="tag ' + t[1] + '">' + (isBanner && latest ? 'Collector live' : t[0]) + '</span></div>' +
        '<p class="cn-desc">' + esc(p.label) + (p.implemented ? '. Detection and reusable Banner 9 section collection implemented.' : '. Detector not implemented.') + '</p>' +
        '<div class="cn-metrics">' +
        '<div><b>' + universities + '</b><small>collected schools</small></div>' +
        '<div><b>' + probed + '</b><small>sections</small></div>' +
        '<div><b>' + runsCount + '</b><small>collection runs</small></div></div>' +
        (p.implemented
          ? '<a class="btn-ghost cn-act" href="/connectors/banner">View detector &rarr;</a>'
          : '<button class="btn-ghost cn-act" disabled style="opacity:.55;cursor:default">Not implemented</button>') +
        '</div>';
    }).join('');
    if ($('cnSections') && collections.latest) {
      var cm = collections.latest.metrics || {}, cs = collections.latest.schools || [];
      $('cnSuccess').textContent = Number(cm.schools_complete || 0) + '/' + Number(cm.schools_processed || 0);
      $('cnRuntime').textContent = Number(cm.runtime_ms || 0) >= 60000
        ? (Number(cm.runtime_ms) / 60000).toFixed(1) + 'm' : (Number(cm.runtime_ms || 0) / 1000).toFixed(1) + 's';
      $('cnSections').textContent = Number(cm.sections || 0).toLocaleString('en-US');
      $('cnUniversities').textContent = cs.filter(function (s) { return s.status === 'complete'; })
        .map(function (s) { return s.school_name + ' (' + Number(s.sections || 0).toLocaleString('en-US') + ' sections)'; }).join(' · ');
    }
  }
  var LAYERS = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5d6a63" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 7.5 12 12l9.5-4.5L12 3Z"/><path d="M2.5 12 12 16.5 21.5 12"/><path d="M2.5 16.5 12 21l9.5-4.5"/></svg>';

  /* ================= data & schema pages ================= */
  function initSchemaPages(schema) {
    if (!schema) return;
    var CHECK_SM = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1f9d5c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
    var DASH = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#9aa1a9" stroke-width="3" stroke-linecap="round"><path d="M6 12h12"/></svg>';

    if ($('schemaCode')) {
      $('schemaCode').textContent = JSON.stringify(schema.example, null, 2);
    }
    if ($('recBody')) {
      $('recBody').innerHTML = schema.fields.map(function (f) {
        var v = schema.example[f.field];
        var shown = v === null ? '<span class="muted-val">null</span>'
          : Array.isArray(v) ? esc(v.join(', ')) : esc(String(v));
        return '<tr><td class="mono-cell">' + esc(f.field) + '</td><td>' + shown + '</td></tr>';
      }).join('');
    }
    if ($('defBody')) {
      $('defBody').innerHTML = schema.fields.map(function (f) {
        return '<tr><td class="mono-cell">' + esc(f.field) + '</td><td>' + esc(f.type) + '</td>' +
          '<td><span class="req ' + (f.required ? 'yes' : 'no') + '">' + (f.required ? CHECK_SM : DASH) + '</span></td>' +
          '<td>' + esc(f.description) + '</td></tr>';
      }).join('');
    }
    if ($('schemaGen')) {
      $('schemaGen').textContent = 'Generated from lib/schema.js — the same definition the validator enforces.';
    }
  }

  /* ---------- boot ---------- */
  Promise.all([D.institutions(), D.detectionMap(), D.manifest(), D.detectors(), D.detections(), D.runs(), D.schema(), D.collections()])
    .then(function (r) {
      var institutions = r[0], detMap = r[1], manifest = r[2], detectors = r[3], detections = r[4], runs = r[5], schema = r[6], collections = r[7];
      var collectionMap = {};
      (collections.latest && collections.latest.schools || []).forEach(function (s) {
        collectionMap[s.domain] = Object.assign({ finished_at: collections.latest.finished_at, connector: collections.latest.connector }, s);
      });
      initHome(institutions, detMap, manifest, collectionMap);
      initUniversitiesPage(institutions, detMap, manifest, collectionMap);
      initConnectors(detectors, detections, runs, collections);
      initSchemaPages(schema);
      document.documentElement.setAttribute('data-dg-ready', '1');
    });
})();
