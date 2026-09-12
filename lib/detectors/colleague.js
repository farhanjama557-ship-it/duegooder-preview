'use strict';
/**
 * Ellucian Colleague detector - NOT IMPLEMENTED.
 *
 * This is an interface stub so the detector registry has a uniform shape.
 * It performs no network requests and never classifies an institution.
 * Calling detect() returns result 'not_implemented'; the runner treats that as
 * "no opinion", never as a detection and never as a failure.
 */
const PLATFORM = 'colleague';

async function detect(institution) {
  return {
    school_id: (institution && institution.school_id) || null,
    school_name: (institution && institution.school_name) || null,
    domain: (institution && institution.domain) || null,
    platform: PLATFORM,
    confidence: 0,
    confidence_band: null,
    registration_url: null,
    evidence: [],
    detected_at: new Date().toISOString(),
    result: 'not_implemented',
    requests: 0,
    error: null
  };
}

module.exports = { platform: PLATFORM, implemented: false, status: 'planned', label: 'Ellucian Colleague', detect };
