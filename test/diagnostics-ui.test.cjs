'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { diagnosticVerdicts, statusForBuild } = require('../src/diagnostic-verdicts.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'leak-tests.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'diagnostics.js'), 'utf8');
const verdicts = fs.readFileSync(path.join(root, 'src', 'diagnostic-verdicts.js'), 'utf8');

test('diagnostics page has a default-checked external option, status list, and collapsed raw JSON', () => {
  assert.match(html, /<input id="diagnostics-external" type="checkbox" checked>/);
  assert.match(html, /<button id="diagnostics-run"/);
  assert.match(html, /id="diagnostics-status"[^>]*role="status"/);
  assert.match(html, /<details class="diagnostics-raw">[\s\S]*<pre id="diagnostics-json" role="status"/);
  assert.ok(html.indexOf('src="diagnostic-verdicts.js"') < html.indexOf('src="diagnostics.js"'));
});

test('renderer probes only its own page and sends network work through the native consent API', () => {
  assert.match(ui, /api\.runDiagnostics\(externalSelected\)/);
  assert.match(ui, /const webglCanvas = document\.createElement\('canvas'\)/);
  assert.match(ui, /const webgl2Canvas = document\.createElement\('canvas'\)/);
  assert.match(ui, /navigator\.languages/);
  assert.match(ui, /navigator\.hardwareConcurrency/);
  assert.match(ui, /status: 'DEVELOPMENT_ONLY'/);
  assert.match(ui, /rawOutput\.textContent = JSON\.stringify\(shareableReport\(report\), null, 2\)/);
  assert.doesNotMatch(ui, /new\s+Worker\s*\(|createElement\(['"]iframe['"]\)|\bfetch\s*\(|\.innerHTML\s*=/);
});

test('every verdict state has a distinct label and presentation class', () => {
  for (const state of ['PASS', 'FAIL', 'NOT_STARTED', 'NOT_RUN', 'LIMITED', 'MEASURED', 'NOT_APPLICABLE', 'INCOMPLETE']) {
    const pattern = new RegExp(state + ": Object\\.freeze\\(\\{ key: 'diagnostics\\.status\\.[A-Za-z]+'");
    assert.match(verdicts, pattern, state);
  }
  assert.match(verdicts, /fallback: 'Verified'/);
  assert.match(verdicts, /fallback: 'Measured failure'/);
  assert.match(verdicts, /fallback: 'Could not start'/);
  assert.match(verdicts, /fallback: 'Not run'/);
  assert.match(verdicts, /fallback: 'Limited coverage'/);
  assert.match(ui, /diagnostics-badge--\$\{statusMeta\(code\)\.className\}/);
});

test('build rows render evidence for success and distinct text for failures, non-starts, and non-runs', () => {
  assert.match(ui, /diagnostics\.buildVerified/);
  assert.match(ui, /diagnostics\.buildMeasuredFailure/);
  assert.match(ui, /diagnostics\.buildNotStarted/);
  assert.match(ui, /diagnostics\.buildNotRun/);
  assert.match(ui, /diagnostics\.buildLimitation/);
  assert.match(ui, /exitCodeText\(check\.exitCode\)/);
  assert.match(ui, /digestText\(check\.outputSha256\)/);
  assert.match(ui, /window\.nacreDiagnosticStatusForBuild/);
  assert.match(ui, /validation\.limitations/);
});

test('a verified failure is measured while a launch crash remains NOT_STARTED', () => {
  assert.equal(statusForBuild('FAIL', 'CURRENT'), 'FAIL');
  assert.equal(statusForBuild('NOT_STARTED', 'CURRENT'), 'NOT_STARTED');
  assert.equal(statusForBuild('NOT_RUN', 'CURRENT'), 'NOT_RUN');
  assert.equal(statusForBuild('PASS', 'STALE'), 'NOT_RUN');
});

test('verdicts never turn missing DNS or kill-switch evidence into a pass', () => {
  const internal = {
    page: {
      status: 'MEASURED',
      result: { javascript: true, node: 'undefined', process: 'undefined', webgl: false, webgl2: false }
    }
  };
  const rows = diagnosticVerdicts({ internal, web: null, torExpected: true, fingerprintExpected: true });
  assert.equal(rows.find((row) => row.id === 'javascript').status, 'PASS');
  assert.equal(rows.find((row) => row.id === 'dns').status, 'LIMITED');
  assert.equal(rows.find((row) => row.id === 'kill-switch').status, 'LIMITED');
  assert.equal(rows.find((row) => row.id === 'tor-exit').status, 'NOT_STARTED');
});

test('WebRTC API availability alone is not reported as a leak when Tor is not selected', () => {
  const rows = diagnosticVerdicts({
    internal: null,
    web: { page: { webRTC: 'function', languages: [], cores: 8, webgl: false, webgl2: false, canvasRed: 0 } },
    torExpected: false,
    fingerprintExpected: true
  });
  assert.equal(rows.find((row) => row.id === 'webrtc').status, 'NOT_APPLICABLE');
});
