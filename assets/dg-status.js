/**
 * School status model - shared by the Node library (lib/status.js re-exports this
 * file) and the browser, so the UI can never disagree with the code.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DGStatus = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/**
 * Application-level school status.
 *
 * LIVE          only after a successful Phase 3 section collection. Phase 2 can
 *               never produce it - collectionVerified is always false today.
 * SUPPORTED     a platform was confidently detected AND we have a connector
 *               architecture for it. Means "platform supported", NOT "collection verified".
 * DISCOVERING   institution known, platform not confidently classified yet
 *               (including institutions never probed).
 * MANUAL_REVIEW evidence indicates a custom/unsupported setup needing investigation.
 *
 * Detection ERRORS are deliberately not statuses: request_failed / timeout /
 * blocked / parse_failure leave the school in DISCOVERING and are reported
 * separately as detection errors.
 */
var STATUS = Object.freeze({
  LIVE: 'live',
  SUPPORTED: 'supported',
  DISCOVERING: 'discovering',
  MANUAL_REVIEW: 'manual_review'
});

var LABEL = Object.freeze({
  live: 'Live',
  supported: 'Supported',
  discovering: 'Discovering',
  manual_review: 'Manual review'
});

var ERROR_RESULTS = Object.freeze(['request_failed', 'timeout', 'blocked', 'parse_failure']);

/**
 * @param {object|null} detection latest detection result for the school
 * @param {{collectionVerified?:boolean, supportedPlatforms?:string[]}} [opts]
 */
function statusFor(detection, opts = {}) {
  const supported = opts.supportedPlatforms || ['banner'];
  if (opts.collectionVerified === true) return STATUS.LIVE;      // Phase 3 only
  if (!detection) return STATUS.DISCOVERING;
  if (detection.result === 'detected' && supported.includes(detection.platform)) return STATUS.SUPPORTED;
  if (detection.result === 'detected') return STATUS.DISCOVERING; // detected, but no connector for it
  if (detection.result === 'no_match') return STATUS.MANUAL_REVIEW;
  if (ERROR_RESULTS.includes(detection.result)) return STATUS.DISCOVERING;
  return STATUS.DISCOVERING;
}

function isDetectionError(detection) {
  return !!detection && ERROR_RESULTS.includes(detection.result);
}

return { STATUS, LABEL, ERROR_RESULTS, statusFor, isDetectionError };

}));
