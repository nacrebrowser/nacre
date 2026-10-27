'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findUnproxiedFetchCalls, parseAuditSummary, evaluateAuditWithDevException, pnpmCommand } = require('../scripts/security-check.cjs');
const fs = require('node:fs');
const path = require('node:path');

const SPRINTF_AUDIT = JSON.stringify({ advisories: { 1: { github_advisory_id: 'GHSA-hp3w-g68c-fv3c', module_name: 'sprintf-js', severity: 'moderate', findings: [{ version: '1.1.3' }] } }, metadata: { vulnerabilities: { total: 1 } } });

test('security-check accepts only the exact dev-only sprintf-js advisory when absent from production', () => {
  const ok = evaluateAuditWithDevException({ stdout: SPRINTF_AUDIT, status: 1 }, '/repo/node_modules/.pnpm/electron@1/node_modules/electron\n');
  assert.equal(ok.ok, true, ok.detail);
  assert.match(ok.detail, /absent de pnpm ls --prod/);
});

test('security-check rejects the accepted advisory when production contains sprintf-js', () => {
  const bad = evaluateAuditWithDevException({ stdout: SPRINTF_AUDIT, status: 1 }, 'C:\\repo\\node_modules\\.pnpm\\sprintf-js@1.1.3\\node_modules\\sprintf-js\n');
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /arbre de production/);
});

test('security-check refuses the exception when the production listing is unreadable', () => {
  assert.equal(evaluateAuditWithDevException({ stdout: SPRINTF_AUDIT, status: 1 }, '').ok, false);
});

test('security-check rejects any advisory outside the accepted triple', () => {
  const other = JSON.stringify({ advisories: { 1: { github_advisory_id: 'GHSA-xxxx-xxxx-xxxx', module_name: 'sprintf-js', severity: 'high', findings: [{ version: '1.1.3' }] } }, metadata: { vulnerabilities: { total: 1 } } });
  assert.equal(evaluateAuditWithDevException({ stdout: other, status: 1 }, '').ok, false);
  const wrongVersion = SPRINTF_AUDIT.replace('1.1.3', '1.1.2');
  assert.equal(evaluateAuditWithDevException({ stdout: wrongVersion, status: 1 }, '').ok, false);
});

test('security-check finds main-process fetch calls without a proxied session', () => {
  const safe = [
    "await regularSession.fetch('https://check.torproject.org/api/ip')",
    "await ses.fetch(endpoint)",
    "await tab.pageView.webContents.session.fetch(url)",
    "electronNet.fetch(pathToFileURL(path.join(__dirname, 'index.html')).href)"
  ].join('\n');
  assert.deepEqual(findUnproxiedFetchCalls(safe), []);
  assert.equal(findUnproxiedFetchCalls("await fetch('https://example.test')").length, 1);
  assert.equal(findUnproxiedFetchCalls("await electronNet.fetch(remoteUrl)").length, 1);
});

test('security-check resolves pnpm through npm_execpath when pnpm is absent from PATH', () => {
  const native = path.join(__dirname, '..', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  const previous = process.env.npm_execpath;
  try {
    process.env.npm_execpath = native;
    const command = pnpmCommand();
    assert.equal(command.executable, process.execPath);
    assert.deepEqual(command.prefixArgs, [native]);
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
  }
});

test('security-check distinguishes offline advisories from an unavailable audit database', () => {
  const auditJson = JSON.stringify({ advisories: { '123': { module_name: 'sprintf-js', severity: 'moderate', github_advisory_id: 'GHSA-hp3w-g68c-fv3c', findings: [{ version: '1.1.3' }] } } });
  assert.deepEqual(parseAuditSummary({ stdout: auditJson, status: 1 }), {
    ok: false,
    detail: '1 avis identifié(s): sprintf-js@1.1.3 (moderate, GHSA-hp3w-g68c-fv3c)'
  });
  assert.match(parseAuditSummary({ stdout: '{"error":{"message":"offline cache absent"}}', status: 1 }).detail, /audit inconclusif/);
  assert.deepEqual(parseAuditSummary({ stdout: '{"advisories":{},"metadata":{"vulnerabilities":{"total":0}}}', status: 0 }), { ok: true, detail: 'aucun avis dans la base locale hors ligne' });
});
