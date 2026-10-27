'use strict';

// Verdict vocabulary used by the diagnostics page and the bundled build report.
// A status describes what was actually observed, never a guess:
//   PASS             a measurement ran and matched its expectation, with evidence
//   FAIL             a measurement ran and contradicted its expectation
//   NOT_STARTED      the probe could not start or complete; nothing was measured
//   NOT_RUN          the check was deliberately not executed
//   LIMITED          the check ran but its scope cannot support a pass/fail claim
//   MEASURED         a neutral measurement that is neither a pass nor a failure
//   NOT_APPLICABLE   the check does not apply to the current configuration
//   INCOMPLETE       a build report with some checks not started or not run
const STATUS_META = Object.freeze({
  PASS: Object.freeze({ key: 'diagnostics.status.pass', fallback: 'Verified', className: 'pass' }),
  FAIL: Object.freeze({ key: 'diagnostics.status.fail', fallback: 'Measured failure', className: 'fail' }),
  NOT_STARTED: Object.freeze({ key: 'diagnostics.status.notStarted', fallback: 'Could not start', className: 'not-started' }),
  NOT_RUN: Object.freeze({ key: 'diagnostics.status.notRun', fallback: 'Not run', className: 'not-run' }),
  LIMITED: Object.freeze({ key: 'diagnostics.status.limited', fallback: 'Limited coverage', className: 'limited' }),
  MEASURED: Object.freeze({ key: 'diagnostics.status.measured', fallback: 'Measured', className: 'measured' }),
  NOT_APPLICABLE: Object.freeze({ key: 'diagnostics.status.notApplicable', fallback: 'Not applicable', className: 'not-applicable' }),
  INCOMPLETE: Object.freeze({ key: 'diagnostics.status.incomplete', fallback: 'Incomplete', className: 'incomplete' })
});

const BUILD_STATUSES = Object.freeze(['PASS', 'FAIL', 'NOT_STARTED', 'NOT_RUN', 'LIMITED', 'INCOMPLETE']);

function statusForBuild(status, freshness) {
  if (freshness !== 'CURRENT') return 'NOT_RUN';
  return BUILD_STATUSES.includes(status) ? status : 'INCOMPLETE';
}

function sameList(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function diagnosticVerdicts({ internal, web, torExpected = false, fingerprintExpected = true, externalSelected = true, externalError = null }) {
  const rows = [];
  const add = (id, label, status, detail, evidence = {}) => rows.push({ id, label, status, detail, evidence });
  const base = internal?.page?.result;
  if (!base) {
    const reason = internal?.page?.reason || 'the internal page measurement did not run';
    for (const [id, label] of [
      ['javascript', 'JavaScript'],
      ['internal-node', 'Internal page: Node.js isolation'],
      ['internal-webgl', 'Internal page: WebGL disabled']
    ]) {
      add(id, label, 'NOT_STARTED', 'The internal page measurement did not start: ' + reason + '. No failure was measured.');
    }
  } else {
    add('javascript', 'JavaScript', base.javascript ? 'PASS' : 'FAIL', 'JavaScript can run in the diagnostic page.', { javascript: Boolean(base.javascript) });
    const nodeIsolated = base.node === 'undefined' && base.process === 'undefined';
    add('internal-node', 'Internal page: Node.js isolation', nodeIsolated ? 'PASS' : 'FAIL',
      'Website JavaScript must not have access to Node.js or process.',
      { requireType: base.node, processType: base.process, expected: 'undefined' });
    const webglDisabled = base.webgl === false && base.webgl2 === false;
    add('internal-webgl', 'Internal page: WebGL disabled', webglDisabled ? 'PASS' : 'FAIL',
      'Separate WebGL and WebGL 2 canvases were tested.',
      { webgl: base.webgl, webgl2: base.webgl2, expected: false });
  }

  for (const name of ['page', 'iframe', 'worker']) {
    const value = web?.[name];
    if (!value || value.unavailable) {
      const reason = value?.reason || value?.unavailableReason || (name === 'iframe' ? 'the frame was refused or did not load' : name === 'worker' ? 'the worker was refused or timed out' : 'the document probe returned no result');
      add(name, 'Website ' + name, 'NOT_STARTED', 'The ' + name + ' probe could not start: ' + reason + '. No failure was measured.');
      continue;
    }
    const nodeIsolated = value.node === 'undefined' && value.process === 'undefined';
    add(name + '-node', 'Website ' + name + ': Node.js isolation', nodeIsolated ? 'PASS' : 'FAIL',
      'Measured in an ordinary web document.',
      { requireType: value.node, processType: value.process, expected: 'undefined' });
    const webglDisabled = !value.webgl && !value.webgl2;
    add(name + '-webgl', 'Website ' + name + ': WebGL disabled', webglDisabled ? 'PASS' : 'FAIL',
      'No WebGL context should be available.',
      { webgl: Boolean(value.webgl), webgl2: Boolean(value.webgl2), expected: false });
    if (name === 'page') {
      add('webrtc', 'WebRTC API blocked under Tor', torExpected
        ? (value.webRTC === 'undefined' ? 'PASS' : 'FAIL')
        : 'NOT_APPLICABLE',
      torExpected
        ? 'Checks that the peer-connection API is unavailable. No STUN packet test was performed.'
        : 'Tor is not selected; WebRTC availability alone is not a leak.',
      { webRTC: value.webRTC, torExpected });
    }

    if (!fingerprintExpected) {
      for (const [suffix, label] of [
        ['language', 'language consistency'],
        ['cores', 'CPU value normalized'],
        ['canvas', 'Canvas readback perturbation']
      ]) {
        add(name + '-' + suffix, 'Website ' + name + ': ' + label, 'NOT_APPLICABLE',
          'The anti-fingerprinting setting is disabled; this check does not apply.', { enabled: false });
      }
      continue;
    }

    const languageMatches = sameList(value.languages, ['en-US', 'en']);
    const coresMatch = value.cores === 8;
    if (name === 'page') {
      add(name + '-language', 'Website ' + name + ': language consistency', languageMatches ? 'PASS' : 'FAIL',
        'Expected en-US/en; measured ' + JSON.stringify(value.languages) + '.',
        { measured: value.languages, expected: ['en-US', 'en'], matches: languageMatches });
      add(name + '-cores', 'Website ' + name + ': CPU value normalized', coresMatch ? 'PASS' : 'FAIL',
        'Expected 8; measured ' + value.cores + '.',
        { measured: value.cores, expected: 8, matches: coresMatch });
    } else {
      // The fingerprint preload is attached to top-level documents. A frame or
      // worker exposes its native signal even when the page is normalized, so
      // record the measurement as a coverage limit rather than a page failure.
      add(name + '-language', 'Website ' + name + ': language consistency', 'LIMITED',
        'Measured languages ' + JSON.stringify(value.languages) + ' in the ' + name + ' realm; the fingerprint preload does not cover this realm.',
        { measured: value.languages, expected: ['en-US', 'en'], matches: languageMatches, realm: name });
      add(name + '-cores', 'Website ' + name + ': CPU value normalized', 'LIMITED',
        'Measured hardwareConcurrency=' + value.cores + ' in the ' + name + ' realm; the fingerprint preload does not cover this realm.',
        { measured: value.cores, expected: 8, matches: coresMatch, realm: name });
    }
    const canvasMeasured = typeof value.canvasRed === 'number';
    add(name + '-canvas', 'Website ' + name + ': Canvas readback perturbation', 'LIMITED',
      canvasMeasured
        ? 'One sampled pixel: red channel ' + value.canvasRed + ' (baseline 64). This is a coverage limit, not a canvas-protection certification.'
        : 'The canvas probe returned no pixel value. This is a coverage limit, not a canvas-protection certification.',
      { canvasRed: value.canvasRed ?? null, baseline: 64, perturbed: canvasMeasured ? value.canvasRed !== 64 : null, realm: name });
  }

  const network = web?.network;
  if (typeof network?.IsTor === 'boolean') {
    add('tor-exit', 'Tor Project connection check', torExpected ? (network.IsTor ? 'PASS' : 'FAIL') : 'MEASURED',
      'Tor Project reports IsTor=' + network.IsTor + '. This checks one destination.',
      { isTor: network.IsTor, endpoint: 'check.torproject.org/api/ip', torExpected });
  } else if (externalSelected === false) {
    add('tor-exit', 'Tor Project connection check', 'NOT_RUN',
      'The external check was not selected. No external result was measured.', { externalSelected: false });
  } else if (externalError) {
    add('tor-exit', 'Tor Project connection check', 'NOT_STARTED',
      'The external check could not complete: ' + String(externalError).slice(0, 200) + '. No result was measured.', { externalError: String(externalError).slice(0, 200) });
  } else {
    add('tor-exit', 'Tor Project connection check', 'NOT_STARTED',
      'The external endpoint produced no usable IsTor value. No result was measured.');
  }
  add('dns', 'DNS leaks and independent network capture', 'LIMITED',
    'No independent DNS observer or packet capture is integrated. This is a coverage limit, not a pass.', { observer: false });
  add('kill-switch', 'Tor kill switch during disconnection', 'LIMITED',
    'A live disconnection test is not run because it would interrupt your browsing. This is a coverage limit, not a pass.', { liveDisconnection: false });
  add('developer-suite', 'Source regression suite', 'NOT_RUN',
    'Source tests require the checkout and Node. They are recorded separately in the bundled build validation and are not run by the packed page.', { requiresCheckout: true });
  return rows;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { diagnosticVerdicts, statusForBuild, STATUS_META, BUILD_STATUSES };
} else {
  globalThis.nacreDiagnosticVerdicts = diagnosticVerdicts;
  globalThis.nacreDiagnosticStatusForBuild = statusForBuild;
  globalThis.nacreDiagnosticStatusMeta = STATUS_META;
}
