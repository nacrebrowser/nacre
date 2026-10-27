'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { diagnosticVerdicts, statusForBuild } = require('../src/diagnostic-verdicts.js');

const byId = (rows, id) => rows.find((row) => row.id === id);

function healthyWeb(overrides = {}) {
  return {
    page: { node: 'undefined', process: 'undefined', webgl: false, webgl2: false, languages: ['en-US', 'en'], cores: 8, canvasRed: 65, webRTC: 'undefined' },
    iframe: { node: 'undefined', process: 'undefined', webgl: false, webgl2: false, languages: ['en-US', 'en'], cores: 8, canvasRed: 65 },
    worker: { node: 'undefined', process: 'undefined', webgl: false, webgl2: false, languages: ['en-US', 'en'], cores: 8, canvasRed: 65 },
    network: { IsTor: true },
    ...overrides
  };
}

test('a successful measurement is PASS and carries its proof', () => {
  const rows = diagnosticVerdicts({
    internal: { page: { result: { javascript: true, node: 'undefined', process: 'undefined', webgl: false, webgl2: false } } },
    web: healthyWeb(),
    torExpected: true,
    fingerprintExpected: true
  });
  for (const id of ['javascript', 'internal-node', 'internal-webgl', 'page-node', 'page-webgl', 'page-language', 'page-cores', 'webrtc', 'tor-exit']) {
    assert.equal(byId(rows, id).status, 'PASS', id);
  }
  assert.deepEqual(byId(rows, 'page-language').evidence.measured, ['en-US', 'en']);
  assert.equal(byId(rows, 'page-cores').evidence.measured, 8);
  assert.equal(byId(rows, 'page-node').evidence.requireType, 'undefined');
  assert.equal(byId(rows, 'tor-exit').evidence.isTor, true);
});

test('a measured mismatch is FAIL, while the one-pixel canvas probe is only a coverage limit', () => {
  const rows = diagnosticVerdicts({
    internal: { page: { result: { javascript: true, node: 'undefined', process: 'undefined', webgl: false, webgl2: false } } },
    web: healthyWeb({ page: { node: 'undefined', process: 'undefined', webgl: false, webgl2: false, languages: ['en-US', 'fr-FR'], cores: 16, canvasRed: 64, webRTC: 'undefined' } }),
    torExpected: true,
    fingerprintExpected: true
  });
  assert.equal(byId(rows, 'page-language').status, 'FAIL');
  assert.equal(byId(rows, 'page-cores').status, 'FAIL');
  assert.equal(byId(rows, 'page-canvas').status, 'LIMITED');
  assert.equal(byId(rows, 'page-canvas').evidence.perturbed, false);
});

test('iframe and worker fingerprint mismatches are LIMITED coverage, not page failures', () => {
  const rows = diagnosticVerdicts({
    internal: { page: { result: { javascript: true, node: 'undefined', process: 'undefined', webgl: false, webgl2: false } } },
    web: healthyWeb({
      iframe: { node: 'undefined', process: 'undefined', webgl: false, webgl2: false, languages: ['en-US', 'fr-FR'], cores: 16, canvasRed: 64 },
      worker: { node: 'undefined', process: 'undefined', webgl: false, webgl2: false, languages: ['en-US', 'fr-FR'], cores: 16, canvasRed: 64 }
    }),
    torExpected: true,
    fingerprintExpected: true
  });
  for (const id of ['iframe-language', 'iframe-cores', 'iframe-canvas', 'worker-language', 'worker-cores', 'worker-canvas']) {
    assert.equal(byId(rows, id).status, 'LIMITED', id);
  }
  assert.equal(rows.filter((row) => row.status === 'FAIL').length, 0);
});

test('a probe that cannot start is NOT_STARTED and never becomes a failure', () => {
  const rows = diagnosticVerdicts({
    internal: { page: { result: { javascript: true, node: 'undefined', process: 'undefined', webgl: false, webgl2: false } } },
    web: { page: { node: 'undefined', process: 'undefined', webgl: false, webgl2: false, languages: ['en-US', 'en'], cores: 8, canvasRed: 65, webRTC: 'undefined' }, iframe: { unavailable: true, reason: 'Frame unavailable' }, worker: { unavailable: true }, network: null },
    torExpected: true,
    fingerprintExpected: true
  });
  assert.equal(byId(rows, 'iframe').status, 'NOT_STARTED');
  assert.equal(byId(rows, 'worker').status, 'NOT_STARTED');
  assert.equal(byId(rows, 'tor-exit').status, 'NOT_STARTED');
  assert.equal(rows.filter((row) => row.status === 'FAIL').length, 0);
});

test('not executed and could not start are distinct external-check states', () => {
  const internal = { page: { result: { javascript: true, node: 'undefined', process: 'undefined', webgl: false, webgl2: false } } };
  const notSelected = diagnosticVerdicts({ internal, web: healthyWeb({ network: null }), torExpected: true, externalSelected: false, fingerprintExpected: true });
  assert.equal(byId(notSelected, 'tor-exit').status, 'NOT_RUN');
  const failedToStart = diagnosticVerdicts({ internal, web: healthyWeb({ network: null }), torExpected: true, externalSelected: true, externalError: 'External diagnostic page timed out.', fingerprintExpected: true });
  assert.equal(byId(failedToStart, 'tor-exit').status, 'NOT_STARTED');
  assert.match(byId(failedToStart, 'tor-exit').detail, /timed out/);
});

test('missing internal measurement is NOT_STARTED, and missing DNS or kill-switch evidence is LIMITED', () => {
  const rows = diagnosticVerdicts({ internal: null, web: null, torExpected: true, fingerprintExpected: true });
  for (const id of ['javascript', 'internal-node', 'internal-webgl', 'page', 'iframe', 'worker', 'tor-exit']) assert.equal(byId(rows, id).status, 'NOT_STARTED', id);
  assert.equal(byId(rows, 'dns').status, 'LIMITED');
  assert.equal(byId(rows, 'kill-switch').status, 'LIMITED');
  assert.equal(byId(rows, 'developer-suite').status, 'NOT_RUN');
});

test('anti-fingerprint disabled makes fingerprint checks not applicable', () => {
  const rows = diagnosticVerdicts({
    internal: { page: { result: { javascript: true, node: 'undefined', process: 'undefined', webgl: false, webgl2: false } } },
    web: healthyWeb(),
    torExpected: false,
    fingerprintExpected: false
  });
  for (const id of ['page-language', 'page-cores', 'page-canvas', 'iframe-language', 'worker-language']) assert.equal(byId(rows, id).status, 'NOT_APPLICABLE', id);
  assert.equal(byId(rows, 'webrtc').status, 'NOT_APPLICABLE');
});

test('WebRTC availability alone is not a leak when Tor is not selected', () => {
  const rows = diagnosticVerdicts({
    internal: null,
    web: { page: { webRTC: 'function', languages: [], cores: 8, webgl: false, webgl2: false, canvasRed: 0 } },
    torExpected: false,
    fingerprintExpected: true
  });
  assert.equal(byId(rows, 'webrtc').status, 'NOT_APPLICABLE');
});

test('build status presentation never turns a stale or incomplete report into PASS', () => {
  assert.equal(statusForBuild('PASS', 'CURRENT'), 'PASS');
  assert.equal(statusForBuild('FAIL', 'CURRENT'), 'FAIL');
  assert.equal(statusForBuild('NOT_STARTED', 'CURRENT'), 'NOT_STARTED');
  assert.equal(statusForBuild('LIMITED', 'CURRENT'), 'LIMITED');
  assert.equal(statusForBuild('INCOMPLETE', 'CURRENT'), 'INCOMPLETE');
  assert.equal(statusForBuild('PASS', 'STALE'), 'NOT_RUN');
  assert.equal(statusForBuild('PASS', 'INVALID'), 'NOT_RUN');
  assert.equal(statusForBuild('unknown', 'CURRENT'), 'INCOMPLETE');
});
