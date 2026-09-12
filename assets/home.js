/**
 * Collection Engine homepage: tabs, example chips, recent detections, and the
 * Phase-3 section preview table.
 *
 * The institution search and the discovery flow live in assets/dg-pages.js and
 * use the real IPEDS directory. The "Collected sections" table below is still
 * PREVIEW DATA: section collection is Phase 3 and has not been built.
 */
(function () {
  'use strict';
  var D = window.DGData;
  var $ = function (id) { return document.getElementById(id); };
  var esc = D.escape;
  var ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m14 7 5 5-5 5"/></svg>';

  /* ---------- tabs ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      var recent = btn.getAttribute('data-tab') === 'recent';
      $('panel-search').style.display = recent ? 'none' : 'block';
      $('panel-recent').classList.toggle('show', recent);
    });
  });

  /* ---------- example chips: kept only for schools in the real directory ---------- */
  Promise.all([D.institutions(), D.detections()]).then(function (r) {
    var institutions = r[0], detections = r[1];
    var byDomain = {};
    institutions.forEach(function (i) { byDomain[i.domain] = i; });

    Array.prototype.forEach.call(document.querySelectorAll('.ex'), function (chip) {
      var domain = chip.textContent.trim();
      if (institutions.length && !byDomain[domain]) { chip.remove(); return; }   // not in the official directory
      chip.addEventListener('click', function () {
        var input = $('uniInput');
        input.value = domain;
        input.focus();
        input.dispatchEvent(new Event('input'));
      });
    });

    /* ---------- View Recent: real detector results, newest first ---------- */
    var panel = $('panel-recent');
    if (!panel) return;
    var recent = detections.slice().sort(function (a, b) {
      return String(b.detected_at).localeCompare(String(a.detected_at));
    }).slice(0, 6);
    if (!recent.length) {
      panel.innerHTML = D.emptyState('No universities probed yet',
        'This list shows real detector results. Run <code>npm run detect -- appstate.edu</code> to populate it.');
      return;
    }
    panel.innerHTML = recent.map(function (d) {
      var inst = byDomain[d.domain];
      var name = d.school_name || (inst && inst.name) || d.domain;
      var right = d.result === 'detected'
        ? esc(d.platform) + ' · ' + D.pct(d.confidence) + ' confidence'
        : esc(d.result);
      return '<div class="recent-item" data-domain="' + esc(d.domain) + '">' +
        '<span class="mono-logo" style="background:' + D.color(d.domain) + '">' + esc(D.mono(name)) + '</span>' +
        '<div><b>' + esc(name) + '</b><small>' + esc(d.domain) + (inst ? ' · ' + esc(inst.state) : '') + '</small></div>' +
        '<span class="r">' + right + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(panel.querySelectorAll('.recent-item'), function (item) {
      item.addEventListener('click', function () {
        document.querySelector('.tab[data-tab="search"]').click();
        var input = $('uniInput');
        input.value = item.getAttribute('data-domain');
        $('discoverBtn').click();
      });
    });
  });

  /* ---------- collected sections: PREVIEW DATA until Phase 3 ---------- */
  var LOGOS = {
    'Appalachian State': { mono: 'AS', color: '#1c1c1c' },
    'Univ. of Dayton': { mono: 'UD', color: '#b8242c' },
    'Univ. of West Florida': { mono: 'WF', color: '#1f4f9c' }
  };
  var SECTIONS = [
    { uni: 'Appalachian State', course: 'CS 250', sec: '001', instr: 'Dr. M. Wilson', sched: 'Mon/Wed 10:00 AM', loc: 'Belk 210', enr: 'Open', term: 'Fall 2026' },
    { uni: 'Appalachian State', course: 'MATH 112', sec: '002', instr: 'Prof. R. Carter', sched: 'Tue/Thu 11:00 AM', loc: 'Peacock 101', enr: 'Open', term: 'Fall 2026' },
    { uni: 'Univ. of Dayton', course: 'ECO 201', sec: '001', instr: 'Dr. L. Nguyen', sched: 'Mon/Wed 1:00 PM', loc: 'Alumni 308', enr: 'Waitlist', term: 'Fall 2026' },
    { uni: 'Univ. of Dayton', course: 'CIS 110', sec: '004', instr: 'Prof. K. Patel', sched: 'Tue/Thu 9:30 AM', loc: 'Kettering 120', enr: 'Open', term: 'Spring 2026' },
    { uni: 'Univ. of West Florida', course: 'BIO 105', sec: '001', instr: 'Dr. S. Ahmed', sched: 'Mon/Wed/Fri 11:00 AM', loc: 'Science 220', enr: 'Open', term: 'Spring 2026' }
  ];
  function enrClass(v) { return v === 'Waitlist' ? ' wait' : (v === 'Closed' ? ' closed' : ''); }
  function renderTable() {
    var q = ($('tableSearch').value || '').trim().toLowerCase();
    var uni = $('filterUni').value, term = $('filterTerm').value;
    var rows = SECTIONS.filter(function (s) {
      if (uni && s.uni !== uni) return false;
      if (term && s.term !== term) return false;
      if (!q) return true;
      return (s.course + ' ' + s.instr + ' ' + s.uni + ' ' + s.loc + ' ' + s.sec).toLowerCase().indexOf(q) > -1;
    });
    $('tbody').innerHTML = rows.map(function (s) {
      var lg = LOGOS[s.uni] || { mono: 'U', color: '#5c646d' };
      return '<tr>' +
        '<td><span class="uni"><span class="mono-logo" style="background:' + lg.color + '">' + lg.mono + '</span>' + esc(s.uni) + '</span></td>' +
        '<td>' + esc(s.course) + '</td><td>' + esc(s.sec) + '</td><td>' + esc(s.instr) + '</td>' +
        '<td>' + esc(s.sched) + '</td><td>' + esc(s.loc) + '</td>' +
        '<td><span class="enr' + enrClass(s.enr) + '"><i></i>' + esc(s.enr) + '</span></td>' +
        '<td><a class="view" href="#sections">View ' + ARROW + '</a></td></tr>';
    }).join('');
    $('noresults').style.display = rows.length ? 'none' : 'block';
  }
  if ($('tbody')) {
    $('tableSearch').addEventListener('input', renderTable);
    $('filterUni').addEventListener('change', renderTable);
    $('filterTerm').addEventListener('change', renderTable);
    renderTable();
  }
})();
