/** Collection Engine homepage, rendered only from persisted Phase 2/3 output. */
(function () {
  'use strict';
  var D = window.DGData;
  var $ = function (id) { return document.getElementById(id); };
  var esc = D.escape;
  var ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m14 7 5 5-5 5"/></svg>';

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      var recent = btn.getAttribute('data-tab') === 'recent';
      $('panel-search').style.display = recent ? 'none' : 'block';
      $('panel-recent').classList.toggle('show', recent);
    });
  });

  Promise.all([D.institutions(), D.detections(), D.collections()]).then(function (r) {
    var institutions = r[0], detections = r[1], collections = r[2];
    var byDomain = {};
    institutions.forEach(function (i) { byDomain[i.domain] = i; });
    Array.prototype.forEach.call(document.querySelectorAll('.ex'), function (chip) {
      var domain = chip.textContent.trim();
      if (institutions.length && !byDomain[domain]) { chip.remove(); return; }
      chip.addEventListener('click', function () {
        var input = $('uniInput'); input.value = domain; input.focus(); input.dispatchEvent(new Event('input'));
      });
    });

    var panel = $('panel-recent');
    if (!panel) return;
    var schools = collections.latest && collections.latest.schools || [];
    if (schools.length) {
      panel.innerHTML = schools.map(function (s) {
        return '<div class="recent-item" data-domain="' + esc(s.domain) + '">' +
          '<span class="mono-logo" style="background:' + D.color(s.domain) + '">' + esc(D.mono(s.school_name)) + '</span>' +
          '<div><b>' + esc(s.school_name) + '</b><small>' + esc(s.domain) + ' · Banner · ' + esc((s.selected_terms || []).join(', ')) + '</small></div>' +
          '<span class="r">' + Number(s.sections || 0).toLocaleString('en-US') + ' sections · ' +
          Number(s.meetings || 0).toLocaleString('en-US') + ' meetings</span></div>';
      }).join('');
    } else {
      var recent = detections.slice().sort(function (a, b) { return String(b.detected_at).localeCompare(String(a.detected_at)); }).slice(0, 6);
      panel.innerHTML = recent.length ? recent.map(function (d) {
        var inst = byDomain[d.domain], name = d.school_name || (inst && inst.name) || d.domain;
        return '<div class="recent-item" data-domain="' + esc(d.domain) + '"><span class="mono-logo" style="background:' +
          D.color(d.domain) + '">' + esc(D.mono(name)) + '</span><div><b>' + esc(name) + '</b><small>' + esc(d.domain) +
          '</small></div><span class="r">' + esc(d.result) + '</span></div>';
      }).join('') : D.emptyState('No collection runs yet', 'Run <code>npm run collect:banner</code> to populate real sections.');
    }
    Array.prototype.forEach.call(panel.querySelectorAll('.recent-item'), function (item) {
      item.addEventListener('click', function () {
        document.querySelector('.tab[data-tab="search"]').click();
        $('uniInput').value = item.getAttribute('data-domain'); $('discoverBtn').click();
      });
    });
  });

  function pct(n, total) { return total ? Math.round(n / total * 100) : 0; }
  function setQuality(id, value) { $(id).textContent = value + '%'; $(id + 'Bar').style.width = value + '%'; }
  function fmtRuntime(ms) {
    if (!Number.isFinite(ms)) return '—';
    return ms >= 60000 ? (ms / 60000).toFixed(1) + 'm' : (ms / 1000).toFixed(1) + 's';
  }
  function fmtTime(value) {
    if (!value) return '';
    var p = value.split(':'), h = Number(p[0]), suffix = h >= 12 ? 'PM' : 'AM';
    return ((h + 11) % 12 + 1) + ':' + p[1] + ' ' + suffix;
  }
  function schedule(section) {
    var day = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
    var days = (section.meeting_days || []).map(function (d) { return day[d] || d; }).join('/');
    var time = fmtTime(section.start_time);
    return (days + (days && time ? ' ' : '') + time) || 'Not scheduled';
  }
  function enrClass(value) { return value === 'waitlist' ? ' wait' : (value === 'closed' || value === 'cancelled' ? ' closed' : ''); }
  function label(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Not published'; }

  Promise.all([D.sections(), D.collections()]).then(function (r) {
    var sections = r[0], collections = r[1], latest = collections.latest;
    if (latest) {
      var m = latest.metrics || {};
      $('latestBadge').textContent = latest.status === 'complete' ? 'Verified run' : latest.status;
      $('metricSchools').textContent = Number(m.schools_processed || 0).toLocaleString('en-US');
      $('metricSections').textContent = Number(m.sections || 0).toLocaleString('en-US');
      $('metricMeetings').textContent = Number(m.meetings || 0).toLocaleString('en-US');
      $('metricRuntime').textContent = fmtRuntime(m.runtime_ms);
      $('metricCost').textContent = '$' + Number(m.direct_cost_usd || 0).toFixed(2);
      $('metricFailures').textContent = Number(m.failures || 0).toLocaleString('en-US');
      var ps = latest.persistence && latest.persistence.sections || {};
      $('refreshMatched').textContent = Number((ps.unchanged || 0) + (ps.updated || 0)).toLocaleString('en-US');
      $('refreshUpdated').textContent = Number(ps.updated || 0).toLocaleString('en-US');
      $('refreshNew').textContent = Number(ps.created || 0).toLocaleString('en-US');
      $('refreshDuplicates').textContent = Number(ps.duplicates_prevented || 0).toLocaleString('en-US');
      $('refreshRequests').textContent = Number(m.http_requests || 0).toLocaleString('en-US');
      var schoolRuns = latest.schools || [];
      $('connectorSchoolCount').textContent = schoolRuns.filter(function (s) { return s.status === 'complete'; }).length;
      $('connectorSchools').innerHTML = schoolRuns.map(function (s) {
        return '<div class="dnode"><span class="mono-logo" style="background:' + D.color(s.domain) + '">' +
          esc(D.mono(s.school_name)) + '</span>' + esc(s.school_name.replace(/^University of /, '')) + '</div>';
      }).join('');
    }

    setQuality('qualityMeeting', pct(sections.filter(function (s) { return s.start_time && s.end_time; }).length, sections.length));
    setQuality('qualityInstructor', pct(sections.filter(function (s) { return !!s.instructor; }).length, sections.length));
    setQuality('qualityLocation', pct(sections.filter(function (s) { return !!s.location; }).length, sections.length));
    setQuality('qualitySource', pct(sections.filter(function (s) { return !!s.source_url; }).length, sections.length));

    var universities = Array.from(new Set(sections.map(function (s) { return s.school_name; }))).sort();
    var terms = Array.from(new Set(sections.map(function (s) { return s.term_name; }))).sort();
    universities.forEach(function (name) { var o = document.createElement('option'); o.value = o.textContent = name; $('filterUni').appendChild(o); });
    terms.forEach(function (name) { var o = document.createElement('option'); o.value = o.textContent = name; $('filterTerm').appendChild(o); });

    function renderTable() {
      var q = ($('tableSearch').value || '').trim().toLowerCase(), uni = $('filterUni').value, term = $('filterTerm').value;
      var filtered = sections.filter(function (s) {
        if (uni && s.school_name !== uni) return false;
        if (term && s.term_name !== term) return false;
        return !q || (s.subject + ' ' + s.course_number + ' ' + (s.instructor || '') + ' ' + s.school_name + ' ' +
          (s.location || '') + ' ' + s.section_number + ' ' + (s.crn || '')).toLowerCase().indexOf(q) > -1;
      });
      var rows = filtered.slice(0, 100);
      $('tbody').innerHTML = rows.map(function (s) {
        return '<tr><td><span class="uni"><span class="mono-logo" style="background:' + D.color(s.school_id) + '">' +
          esc(D.mono(s.school_name)) + '</span>' + esc(s.school_name) + '</span></td><td>' + esc(s.subject + ' ' + s.course_number) +
          '</td><td>' + esc(s.section_number) + '</td><td>' + esc(s.instructor || 'Not published') + '</td><td>' +
          esc(schedule(s)) + '</td><td>' + esc(s.location || 'Not published') + '</td><td><span class="enr' +
          enrClass(s.enrollment_status) + '"><i></i>' + esc(label(s.enrollment_status)) + '</span></td><td><a class="view" target="_blank" rel="noopener" href="' +
          esc(s.source_url) + '">Source ' + ARROW + '</a></td></tr>';
      }).join('');
      $('sectionCount').textContent = filtered.length ? 'Showing ' + rows.length.toLocaleString('en-US') + ' of ' +
        filtered.length.toLocaleString('en-US') + ' matching canonical records' : 'No matching canonical records';
      $('noresults').style.display = filtered.length ? 'none' : 'block';
    }
    $('tableSearch').addEventListener('input', renderTable);
    $('filterUni').addEventListener('change', renderTable);
    $('filterTerm').addEventListener('change', renderTable);
    renderTable();
  });
})();
