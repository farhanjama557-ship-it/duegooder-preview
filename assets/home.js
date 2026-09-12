/**
 * Collection Engine homepage, rendered only from persisted Phase 2/3 output.
 *
 * The homepage describes ONE snapshot: the latest verified collection run.
 * Active schools are collections.latest.schools with status === "complete";
 * every element on the page (latest metrics, collected sections, data quality,
 * refresh intelligence, connector architecture, university and term filters)
 * is derived from those schools. Schools that appear only in historical runs
 * stay in the persisted data - they are simply not part of this snapshot.
 */
(function () {
  'use strict';
  var D = window.DGData;
  var $ = function (id) { return document.getElementById(id); };
  var esc = D.escape;
  var ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m14 7 5 5-5 5"/></svg>';
  var PAGE = 100;

  /**
   * Hero map pins. The schools themselves come from collections.latest (only
   * status "complete" ones are drawn); this table just holds where their campus
   * city sits on the existing dotted map. x/y are in the map's own 340x196
   * viewBox, projected with the same Albers parameters the map was generated
   * with, so a pin lands on the real city. A school with no entry gets no pin
   * rather than an invented position.
   */
  var CAMPUS = {
    uwf:     { short: 'UWF',    place: 'Pensacola, FL',  x: 235.8, y: 159.0, side: 'left', dy: 8 },
    udayton: { short: 'Dayton', place: 'Dayton, OH',     x: 247.6, y: 85.5,  side: 'left', dy: -8 },
    ung:     { short: 'UNG',    place: 'Dahlonega, GA',  x: 254.3, y: 125.3, side: 'left', dy: 0 }
  };
  var MAP_W = 340, MAP_H = 196;

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
    var schools = (collections.latest && collections.latest.schools || []).filter(function (s) { return s.status === 'complete'; });
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
  function orNotPublished(value) {
    return (value === null || value === undefined || value === '') ? '<span class="muted-val">Not published</span>' : esc(String(value));
  }
  function fmtStamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? esc(iso) : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }
  function shortName(name) { return String(name || '').replace(/^University of /, ''); }

  /** The public class-search entry point for a school, as configured and re-verified by each run. */
  function loadUniversityConfig() {
    return fetch('/config/banner-universities.json', { cache: 'no-cache' })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; });
  }

  Promise.all([D.sections(), D.collections(), D.terms(), D.provenance(), loadUniversityConfig()]).then(function (r) {
    var allSections = r[0], collections = r[1], allTerms = r[2], provenance = r[3], uniConfig = r[4];
    var latest = collections.latest;

    /* ---- the snapshot: schools that completed in the latest verified run ---- */
    var activeSchools = ((latest && latest.schools) || []).filter(function (s) { return s.status === 'complete'; });
    var activeIds = activeSchools.map(function (s) { return s.school_id; });
    var isActive = {};
    activeIds.forEach(function (id) { isActive[id] = true; });

    var schoolMeta = {};
    uniConfig.forEach(function (c) { schoolMeta[c.school_id] = { registration_url: c.registration_url, school_name: c.school_name, domain: c.domain }; });
    activeSchools.forEach(function (s) {
      schoolMeta[s.school_id] = schoolMeta[s.school_id] || {};
      schoolMeta[s.school_id].registration_url = s.registration_url || schoolMeta[s.school_id].registration_url;
      schoolMeta[s.school_id].school_name = s.school_name;
      schoolMeta[s.school_id].domain = s.domain;
    });

    // Current snapshot only. Historical schools stay in sections.json untouched.
    var sections = activeIds.length ? allSections.filter(function (s) { return isActive[s.school_id]; }) : allSections;

    var provBySource = {};
    provenance.forEach(function (p) { if (!provBySource[p.source_url]) provBySource[p.source_url] = p; });
    var verificationBySchool = {};
    provenance.forEach(function (p) {
      if (p.kind === 'banner_verification' && !verificationBySchool[p.school_id]) verificationBySchool[p.school_id] = p;
    });

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
      $('connectorSchoolCount').textContent = activeSchools.length;
      $('connectorSchools').innerHTML = activeSchools.map(function (s) {
        return '<div class="dnode"><span class="mono-logo" style="background:' + D.color(s.domain) + '">' +
          esc(D.mono(s.school_name)) + '</span>' + esc(shortName(s.school_name)) + '</div>';
      }).join('');
    }

    // Field completeness across the same snapshot the table shows.
    setQuality('qualityMeeting', pct(sections.filter(function (s) { return s.start_time && s.end_time; }).length, sections.length));
    setQuality('qualityInstructor', pct(sections.filter(function (s) { return !!s.instructor; }).length, sections.length));
    setQuality('qualityLocation', pct(sections.filter(function (s) { return !!s.location; }).length, sections.length));
    setQuality('qualitySource', pct(sections.filter(function (s) { return !!s.source_url; }).length, sections.length));

    /* ---- hero map: pin the verified schools of the latest run ---- */
    var pinBox = $('mapPins'), mapNote = $('mapNote');
    var pinned = activeSchools.filter(function (s) { return CAMPUS[s.school_id]; });
    function renderPins() {
      if (!pinBox) return;
      pinBox.innerHTML = pinned.map(function (s) {
        var c = CAMPUS[s.school_id];
        return '<span class="pin side-' + c.side + '" data-pin="' + esc(s.school_id) + '"' +
          ' style="left:' + (c.x / MAP_W * 100).toFixed(2) + '%;top:' + (c.y / MAP_H * 100).toFixed(2) + '%"' +
          ' title="' + esc(s.school_name) + ' · ' + esc(c.place) + '">' +
          '<span class="pin-dot"></span>' +
          '<span class="pin-label" style="transform:translateY(calc(-50% + ' + (c.dy || 0) + 'px))">' +
          '<b>' + esc(c.short) + '</b><small>' + esc(c.place) + '</small></span>' +
          '</span>';
      }).join('');
      Array.prototype.forEach.call(pinBox.querySelectorAll('[data-pin]'), function (pin) {
        pin.addEventListener('click', function () {
          var id = pin.getAttribute('data-pin');
          uniSelect.value = uniSelect.value === id ? '' : id;
          uniSelect.dispatchEvent(new Event('change'));
        });
      });
    }
    function syncPins() {
      if (!pinBox) return;
      var selected = uniSelect.value;
      Array.prototype.forEach.call(pinBox.querySelectorAll('[data-pin]'), function (pin) {
        var isSel = selected && pin.getAttribute('data-pin') === selected;
        pin.classList.toggle('sel', !!isSel);
        pin.classList.toggle('dim', !!selected && !isSel);
      });
      if (!mapNote) return;
      if (selected) {
        var school = pinned.filter(function (s) { return s.school_id === selected; })[0];
        mapNote.textContent = school
          ? school.school_name + ' · 1 of ' + pinned.length + ' verified schools in latest run'
          : pinned.length + ' verified schools in latest run';
      } else {
        mapNote.textContent = pinned.length + ' verified ' + (pinned.length === 1 ? 'school' : 'schools') + ' in latest run';
      }
    }

    /* ---- university filter: exactly the active schools ---- */
    var uniSelect = $('filterUni'), termSelect = $('filterTerm');
    activeSchools.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.school_id;
      o.textContent = s.school_name;
      uniSelect.appendChild(o);
    });

    /* ---- terms come from discovery (terms.json), not from the section rows ---- */
    var collectedTermIds = {};                       // school_id -> { term_id: true }
    sections.forEach(function (s) {
      (collectedTermIds[s.school_id] = collectedTermIds[s.school_id] || {})[s.term_id] = true;
    });

    function termEntriesFor(schoolId) {
      var scope = schoolId ? [schoolId] : activeIds;
      var inScope = {};
      scope.forEach(function (id) { inScope[id] = true; });
      var byCode = {};
      allTerms.forEach(function (t) {
        if (!inScope[t.school_id]) return;
        var e = byCode[t.code] || (byCode[t.code] = { code: t.code, labels: [], schools: [], collected: false });
        if (e.labels.indexOf(t.description) === -1) e.labels.push(t.description);
        if (e.schools.indexOf(t.school_id) === -1) e.schools.push(t.school_id);
        if (collectedTermIds[t.school_id] && collectedTermIds[t.school_id][t.code]) e.collected = true;
      });
      var list = Object.keys(byCode).map(function (code) {
        var e = byCode[code];
        e.label = e.labels[0];
        return e;
      });
      // disambiguate identical labels across different term codes (e.g. two "Fall 2026")
      var labelCount = {};
      list.forEach(function (e) { labelCount[e.label] = (labelCount[e.label] || 0) + 1; });
      list.forEach(function (e) {
        if (labelCount[e.label] > 1) {
          e.label += ' · ' + e.schools.map(function (id) {
            return shortName((schoolMeta[id] && schoolMeta[id].school_name) || id);
          }).join(', ');
        }
      });
      list.sort(function (a, b) {
        if (a.collected !== b.collected) return a.collected ? -1 : 1;
        return String(b.code).localeCompare(String(a.code));
      });
      return list;
    }

    function buildTermOptions(schoolId) {
      var previous = termSelect.value;
      var entries = termEntriesFor(schoolId);
      var collected = entries.filter(function (e) { return e.collected; });
      var discovered = entries.filter(function (e) { return !e.collected; });
      var html = '<option value="">All terms</option>';
      if (collected.length) {
        html += '<optgroup label="COLLECTED">' + collected.map(function (e) {
          return '<option value="' + esc(e.code) + '" data-collected="true">' + esc(e.label) + '</option>';
        }).join('') + '</optgroup>';
      }
      if (discovered.length) {
        html += '<optgroup label="DISCOVERED · NOT COLLECTED">' + discovered.map(function (e) {
          return '<option value="' + esc(e.code) + '" data-collected="false" disabled>' + esc(e.label) + '</option>';
        }).join('') + '</optgroup>';
      }
      termSelect.innerHTML = html;
      // keep the selection only if it is still a collected term for this university
      var stillValid = previous && collected.some(function (e) { return e.code === previous; });
      termSelect.value = stillValid ? previous : '';
    }

    /* ---- deterministic round-robin across the active schools ---- */
    function interleave(list, limit) {
      var buckets = activeIds.map(function (id) {
        return list.filter(function (s) { return s.school_id === id; });
      }).filter(function (b) { return b.length; });
      if (buckets.length < 2) return list.slice(0, limit);
      var out = [], cursor = 0, guard = 0;
      while (out.length < limit && guard < limit * (buckets.length + 1)) {
        var moved = false;
        for (var i = 0; i < buckets.length && out.length < limit; i++) {
          if (cursor < buckets[i].length) { out.push(buckets[i][cursor]); moved = true; }
        }
        cursor++; guard++;
        if (!moved) break;
      }
      return out;
    }

    /* ---- evidence modal ---- */
    var visibleRows = [];
    function kvRows(rows) {
      return '<table class="kv"><tbody>' + rows.map(function (row) {
        return '<tr><th>' + esc(row[0]) + '</th><td>' + row[1] + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    function showEvidence(section) {
      var meta = schoolMeta[section.school_id] || {};
      var connector = (latest && latest.connector) || 'banner';
      var connectorLabel = connector.charAt(0).toUpperCase() + connector.slice(1);
      var sourceProv = provBySource[section.source_url] || null;
      var verification = verificationBySchool[section.school_id] || null;
      var classSearch = meta.registration_url || (verification && verification.source_url) || null;

      var record = kvRows([
        ['University', esc(section.school_name)],
        ['Platform', esc(connectorLabel)],
        ['Term', esc(section.term_name)],
        ['Term ID', '<span class="mono-cell">' + esc(section.term_id) + '</span>'],
        ['Course', esc(section.subject + ' ' + section.course_number)],
        ['Course title', orNotPublished(section.course_title)],
        ['Section', esc(section.section_number)],
        ['CRN', orNotPublished(section.crn)],
        ['Instructor', orNotPublished(section.instructor)],
        ['Meeting days', (section.meeting_days && section.meeting_days.length) ? esc(section.meeting_days.join(', ')) : '<span class="muted-val">Not scheduled</span>'],
        ['Start time', orNotPublished(section.start_time)],
        ['End time', orNotPublished(section.end_time)],
        ['Location', orNotPublished(section.location)],
        ['Enrollment status', orNotPublished(section.enrollment_status ? label(section.enrollment_status) : null)],
        ['Seats available', (section.seats_available === null || section.seats_available === undefined) ? '<span class="muted-val">Not published</span>' : esc(String(section.seats_available))],
        ['Extraction status', esc(section.extraction_status)],
        ['Retrieved at', esc(fmtStamp(section.retrieved_at))],
        ['Connector', esc(connectorLabel)]
      ]);

      var prov = kvRows([
        ['Official registration system', classSearch ? '<span class="mono-cell">' + esc(classSearch) + '</span>' : '<span class="muted-val">—</span>'],
        ['Technical source endpoint', '<span class="mono-cell">' + esc(section.source_url) + '</span>'],
        ['Retrieval timestamp', esc(fmtStamp((sourceProv && sourceProv.retrieved_at) || section.retrieved_at))],
        ['Extraction status', esc((sourceProv && sourceProv.extraction_status) || section.extraction_status)]
      ]);

      var actions = '<div class="ev-actions">' +
        (classSearch ? '<a class="btn-dark sm" id="evOfficial" href="' + esc(classSearch) + '" target="_blank" rel="noopener">Open official class search</a>' : '') +
        '<a class="btn-ghost" id="evRaw" href="' + esc(section.source_url) + '" target="_blank" rel="noopener">Open raw API evidence</a>' +
        '</div><p class="ev-note">Technical endpoint · may require an active Banner term session</p>';

      window.DGUI.open(
        section.subject + ' ' + section.course_number + ' · ' + section.section_number,
        section.school_name + ' · canonical record',
        record + '<h4 class="ev-head">Provenance</h4>' + prov + actions
      );
    }

    /* ---- table ---- */
    function renderTable() {
      var q = ($('tableSearch').value || '').trim().toLowerCase();
      var uni = uniSelect.value, term = termSelect.value;
      var filtered = sections.filter(function (s) {
        if (uni && s.school_id !== uni) return false;
        if (term && s.term_id !== term) return false;
        return !q || (s.subject + ' ' + s.course_number + ' ' + (s.course_title || '') + ' ' + (s.instructor || '') + ' ' +
          s.school_name + ' ' + (s.location || '') + ' ' + s.section_number + ' ' + (s.crn || '')).toLowerCase().indexOf(q) > -1;
      });
      // With no university selected the demo shows an even, deterministic mix of the
      // active schools instead of whatever happens to sort first.
      visibleRows = uni ? filtered.slice(0, PAGE) : interleave(filtered, PAGE);
      $('tbody').innerHTML = visibleRows.map(function (s, i) {
        return '<tr><td><span class="uni"><span class="mono-logo" style="background:' + D.color(s.school_id) + '">' +
          esc(D.mono(s.school_name)) + '</span>' + esc(s.school_name) + '</span></td><td>' + esc(s.subject + ' ' + s.course_number) +
          '</td><td>' + esc(s.section_number) + '</td><td title="' + esc(s.instructor || 'Not published') + '">' +
          esc(s.instructor || 'Not published') + '</td><td title="' + esc(schedule(s)) + '">' +
          esc(schedule(s)) + '</td><td title="' + esc(s.location || 'Not published') + '">' +
          esc(s.location || 'Not published') + '</td><td><span class="enr' +
          enrClass(s.enrollment_status) + '"><i></i>' + esc(label(s.enrollment_status)) + '</span></td>' +
          '<td><button class="linkish" data-ev="' + i + '">View evidence ' + ARROW + '</button></td></tr>';
      }).join('');
      Array.prototype.forEach.call($('tbody').querySelectorAll('button[data-ev]'), function (btn) {
        btn.addEventListener('click', function () { showEvidence(visibleRows[Number(btn.getAttribute('data-ev'))]); });
      });
      $('sectionCount').textContent = filtered.length ? 'Showing ' + visibleRows.length.toLocaleString('en-US') + ' of ' +
        filtered.length.toLocaleString('en-US') + ' matching canonical records' : 'No matching canonical records';
      $('noresults').style.display = filtered.length ? 'none' : 'block';
    }

    $('tableSearch').addEventListener('input', renderTable);
    uniSelect.addEventListener('change', function () { buildTermOptions(uniSelect.value); renderTable(); syncPins(); });
    termSelect.addEventListener('change', renderTable);

    buildTermOptions('');
    renderPins();
    syncPins();
    renderTable();
    document.documentElement.setAttribute('data-dg-sections-ready', '1');
  });
})();
