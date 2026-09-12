/**
 * Institution search, shared by the browser UI and the Node tests.
 * Matches on name, domain, city and state (code or full name).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DGSearch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATE_NAMES = {
    AL:'alabama',AK:'alaska',AZ:'arizona',AR:'arkansas',CA:'california',CO:'colorado',CT:'connecticut',
    DE:'delaware',DC:'district of columbia',FL:'florida',GA:'georgia',HI:'hawaii',ID:'idaho',IL:'illinois',
    IN:'indiana',IA:'iowa',KS:'kansas',KY:'kentucky',LA:'louisiana',ME:'maine',MD:'maryland',MA:'massachusetts',
    MI:'michigan',MN:'minnesota',MS:'mississippi',MO:'missouri',MT:'montana',NE:'nebraska',NV:'nevada',
    NH:'new hampshire',NJ:'new jersey',NM:'new mexico',NY:'new york',NC:'north carolina',ND:'north dakota',
    OH:'ohio',OK:'oklahoma',OR:'oregon',PA:'pennsylvania',RI:'rhode island',SC:'south carolina',
    SD:'south dakota',TN:'tennessee',TX:'texas',UT:'utah',VT:'vermont',VA:'virginia',WA:'washington',
    WV:'west virginia',WI:'wisconsin',WY:'wyoming',PR:'puerto rico',GU:'guam',VI:'virgin islands',
    AS:'american samoa',MP:'northern mariana islands'
  };

  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }

  function stateCodeFor(query) {
    var q = norm(query);
    if (q.length === 2 && STATE_NAMES[q.toUpperCase()]) return q.toUpperCase();
    for (var code in STATE_NAMES) {
      if (STATE_NAMES[code] === q) return code;
    }
    return null;
  }

  /**
   * @param {Array} institutions {unitid,name,city,state,website,domain}
   * @param {string} query
   * @param {{limit?:number}} [opts]
   * @returns {Array} best matches first
   */
  function search(institutions, query, opts) {
    opts = opts || {};
    var limit = opts.limit || 20;
    var q = norm(query);
    if (!q) return [];
    var stateCode = stateCodeFor(q);
    var out = [];

    for (var i = 0; i < institutions.length; i++) {
      var inst = institutions[i];
      var name = norm(inst.name);
      var domain = norm(inst.domain);
      var city = norm(inst.city);
      var state = norm(inst.state);
      var score = 0;

      if (domain === q || domain === q.replace(/^www\./, '')) score = 100;
      else if (name === q) score = 95;
      else if (stateCode && inst.state === stateCode) score = 40;
      else if (domain.indexOf(q) === 0) score = 80;
      else if (name.indexOf(q) === 0) score = 75;
      else if (domain.indexOf(q) > -1) score = 65;
      else if (name.indexOf(q) > -1) score = 60;
      else if (city === q) score = 55;
      else if (city.indexOf(q) === 0) score = 45;
      else if (state === q) score = 40;
      else continue;

      out.push({ score: score, inst: inst });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.inst.name).localeCompare(String(b.inst.name));
    });
    return out.slice(0, limit).map(function (r) { return r.inst; });
  }

  return { search: search, stateCodeFor: stateCodeFor, STATE_NAMES: STATE_NAMES };
}));
