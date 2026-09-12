'use strict';
/** Detector registry. Only detectors with implemented === true ever run. */
const banner = require('./banner');
const peoplesoft = require('./peoplesoft');
const workday = require('./workday');
const colleague = require('./colleague');
const custom = require('./custom');

const DETECTORS = [banner, peoplesoft, workday, colleague, custom];

function get(platform) {
  return DETECTORS.find(d => d.platform === platform) || null;
}
function implemented() {
  return DETECTORS.filter(d => d.implemented);
}
/** Shape used by the Connectors UI so the page can never overstate capability. */
function registry() {
  return DETECTORS.map(d => ({
    platform: d.platform,
    label: d.label || (d.platform === 'banner' ? 'Ellucian Banner 9 Self-Service' : d.platform),
    implemented: !!d.implemented,
    status: d.implemented ? 'detector_available' : (d.status || 'planned')
  }));
}

module.exports = { DETECTORS, get, implemented, registry };
