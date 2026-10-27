'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  computeSourceDigest,
  validateManifest,
  getReleaseValidationReport,
  deriveCheckStatus,
  deriveTestSuiteStatus,
  deriveManifestStatus
} = require('../src/release-validation.cjs');
const { buildManifestFromEvidence, validateEvidence, constants: builderConstants } = require('../scripts/build-release-validation-manifest.cjs');

const START = '2026-10-23T10:00:00.000Z';
const FINISH = '2026-10-23T10:01:00.000Z';
const STAGE_START = '2026-10-23T10:00:10.000Z';
const STAGE_FINISH = '2026-10-23T10:00:55.000Z';
const HASH = crypto.createHash('sha256').update('captured command output').digest('hex');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-release-validation-'));
  const sourceRoot = path.join(directory, 'src');
  fs.mkdirSync(sourceRoot);
  fs.writeFileSync(path.join(sourceRoot, 'app.cjs'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '0.9.4.2' }));
  return {
    directory,
    sourceRoot,
    manifestPath: path.join(sourceRoot, 'release-validation.json'),
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

function stage(overrides = {}) {
  return {
    command: 'node --test --test-reporter=tap',
    startedAt: STAGE_START,
    finishedAt: STAGE_FINISH,
    exitCode: 0,
    signal: null,
    timedOut: false,
    environmentFailure: false,
    outputSha256: HASH,
    ...overrides
  };
}

function evidenceFor(sourceRoot, changes = {}) {
  const source = computeSourceDigest(sourceRoot);
  return {
    format: builderConstants.EVIDENCE_FORMAT,
    schemaVersion: builderConstants.EVIDENCE_SCHEMA_VERSION,
    releaseVersion: '0.9.4.2',
    startedAt: START,
    finishedAt: FINISH,
    source,
    testSuite: {
      ...stage(),
      total: 4,
      passed: 4,
      failed: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    checks: [{
      id: 'verify-audit',
      ...stage({ command: 'npm run verify:audit' })
    }],
    limitations: [],
    ...changes
  };
}

function build(f, evidence, options = {}) {
  return buildManifestFromEvidence(evidence, {
    repoRoot: f.directory,
    sourceRoot: f.sourceRoot,
    packagePath: path.join(f.directory, 'package.json'),
    expectedVersion: '0.9.4.2',
    ...options
  });
}

test('source digest is stable and excludes its generated manifest only', () => {
  const f = fixture();
  try {
    const first = computeSourceDigest(f.sourceRoot);
    fs.writeFileSync(f.manifestPath, '{"status":"PASS"}');
    assert.deepEqual(computeSourceDigest(f.sourceRoot), first);
    fs.appendFileSync(path.join(f.sourceRoot, 'app.cjs'), '// changed\n');
    assert.notEqual(computeSourceDigest(f.sourceRoot).digest, first.digest);
  } finally {
    f.cleanup();
  }
});

test('manifest status is derived from recorded exit codes and test counts', () => {
  const f = fixture();
  try {
    const passing = build(f, evidenceFor(f.sourceRoot));
    assert.equal(passing.status, 'PASS');
    assert.equal(passing.testSuite.status, 'PASS');
    assert.equal(passing.checks[0].status, 'PASS');
    assert.equal(validateManifest(passing), true);
    assert.equal(validateEvidence(evidenceFor(f.sourceRoot)), true);

    const failedEvidence = evidenceFor(f.sourceRoot);
    failedEvidence.checks[0].exitCode = 1;
    const failed = build(f, failedEvidence);
    assert.equal(failed.status, 'FAIL');
    assert.equal(failed.checks[0].status, 'FAIL');

    const skippedEvidence = evidenceFor(f.sourceRoot);
    skippedEvidence.testSuite.skipped = 1;
    skippedEvidence.testSuite.passed = 3;
    const skipped = build(f, skippedEvidence);
    assert.equal(skipped.testSuite.status, 'LIMITED');
    assert.equal(skipped.status, 'INCOMPLETE');

    const emptyEvidence = evidenceFor(f.sourceRoot);
    emptyEvidence.testSuite = {
      ...emptyEvidence.testSuite,
      total: 0,
      passed: 0
    };
    const empty = build(f, emptyEvidence);
    assert.equal(empty.testSuite.status, 'NOT_RUN');
    assert.equal(empty.status, 'INCOMPLETE');
  } finally {
    f.cleanup();
  }
});

test('launch crashes and timeouts are not reported as measured failures', () => {
  const f = fixture();
  try {
    const crashedEvidence = evidenceFor(f.sourceRoot);
    crashedEvidence.checks[0].exitCode = 0x80000003;
    crashedEvidence.checks[0].outputSha256 = crypto.createHash('sha256').update('Electron launch crash').digest('hex');
    const crashed = build(f, crashedEvidence);
    assert.equal(crashed.checks[0].status, 'NOT_STARTED');
    assert.equal(crashed.checks[0].exitCode, 0x80000003, 'the real NTSTATUS value is preserved');
    assert.equal(crashed.status, 'INCOMPLETE');
    assert.equal(validateManifest(crashed), true);

    const timeoutEvidence = evidenceFor(f.sourceRoot);
    timeoutEvidence.checks[0] = {
      ...timeoutEvidence.checks[0],
      exitCode: null,
      signal: 'SIGTERM',
      timedOut: true
    };
    const timedOut = build(f, timeoutEvidence);
    assert.equal(timedOut.checks[0].status, 'NOT_STARTED');
    assert.equal(timedOut.status, 'INCOMPLETE');

    const environmentEvidence = evidenceFor(f.sourceRoot);
    environmentEvidence.checks[0].exitCode = 1;
    environmentEvidence.checks[0].environmentFailure = true;
    const environment = build(f, environmentEvidence);
    assert.equal(environment.checks[0].status, 'NOT_STARTED');
    assert.equal(deriveCheckStatus(environment.checks[0]), 'NOT_STARTED');

    const suiteCrash = evidenceFor(f.sourceRoot);
    suiteCrash.testSuite.exitCode = 0x80000003;
    suiteCrash.testSuite.environmentFailure = true;
    const suite = build(f, suiteCrash);
    assert.equal(suite.testSuite.status, 'NOT_STARTED');
    assert.equal(suite.status, 'INCOMPLETE');
  } finally {
    f.cleanup();
  }
});

test('coverage limits are attached to the producing capture and keep their output hash', () => {
  const f = fixture();
  try {
    const evidence = evidenceFor(f.sourceRoot);
    evidence.limitations = [
      { checkId: 'verify-audit', statement: 'Local fixture only; no packet capture.' },
      { checkId: 'test-suite', statement: 'One platform-specific test was skipped.' }
    ];
    const manifest = build(f, evidence);
    assert.equal(manifest.status, 'PASS');
    assert.equal(manifest.limitations.length, 2);
    assert.equal(manifest.limitations[0].outputSha256, manifest.checks[0].outputSha256);
    assert.equal(manifest.limitations[1].outputSha256, manifest.testSuite.outputSha256);
    assert.equal(validateManifest(manifest), true);
  } finally {
    f.cleanup();
  }
});

test('derivation helpers distinguish every recorded outcome', () => {
  assert.equal(deriveCheckStatus({ exitCode: 0, signal: null, timedOut: false, environmentFailure: false }), 'PASS');
  assert.equal(deriveCheckStatus({ exitCode: 1, signal: null, timedOut: false, environmentFailure: false }), 'FAIL');
  assert.equal(deriveCheckStatus({ exitCode: 0x80000003, signal: null, timedOut: false, environmentFailure: false }), 'NOT_STARTED');
  assert.equal(deriveCheckStatus({ exitCode: null, signal: 'SIGTERM', timedOut: true, environmentFailure: false }), 'NOT_STARTED');
  assert.equal(deriveCheckStatus({ exitCode: 1, signal: null, timedOut: false, environmentFailure: true }), 'NOT_STARTED');
  assert.equal(deriveTestSuiteStatus({ exitCode: 0, signal: null, timedOut: false, environmentFailure: false, total: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 }), 'NOT_RUN');
  assert.equal(deriveTestSuiteStatus({ exitCode: 0, signal: null, timedOut: false, environmentFailure: false, total: 4, passed: 3, failed: 0, cancelled: 0, skipped: 1, todo: 0 }), 'LIMITED');
  assert.equal(deriveManifestStatus({ status: 'PASS' }, [{ status: 'NOT_STARTED' }]), 'INCOMPLETE');
  assert.equal(deriveManifestStatus({ status: 'FAIL' }, [{ status: 'PASS' }]), 'FAIL');
  assert.equal(deriveManifestStatus({ status: 'PASS' }, [{ status: 'PASS' }]), 'PASS');
});

test('builder rejects evidence from a different source tree, version, or malformed schema', () => {
  const f = fixture();
  try {
    const stale = evidenceFor(f.sourceRoot);
    fs.appendFileSync(path.join(f.sourceRoot, 'app.cjs'), '// changed after checks\n');
    assert.throws(() => build(f, stale), /source digest/);

    const wrongVersion = evidenceFor(f.sourceRoot);
    wrongVersion.releaseVersion = '0.9.4';
    assert.throws(() => build(f, wrongVersion), /release version/);

    const injected = evidenceFor(f.sourceRoot);
    injected.status = 'PASS';
    assert.throws(() => build(f, injected), /evidence is invalid/);

    const oldSchema = evidenceFor(f.sourceRoot);
    oldSchema.schemaVersion = 1;
    assert.throws(() => build(f, oldSchema), /evidence is invalid/);
  } finally {
    f.cleanup();
  }
});

test('reader marks version or source mismatches stale and reports live diagnostics separately', () => {
  const f = fixture();
  try {
    const manifest = build(f, evidenceFor(f.sourceRoot));
    fs.writeFileSync(f.manifestPath, JSON.stringify(manifest));
    const digest = computeSourceDigest(f.sourceRoot).digest;
    const current = getReleaseValidationReport({
      appVersion: '0.9.4.2',
      sourceRoot: f.sourceRoot,
      manifestPath: f.manifestPath,
      liveDiagnostics: { checkedAt: FINISH, appVersion: '0.9.4.2', sourceDigest: digest, checks: [{ id: 'profile-load', status: 'PASS' }] }
    });
    assert.equal(current.buildValidation.status, 'PASS');
    assert.equal(current.buildValidation.testSuite.total, 4);
    assert.equal(current.buildValidation.testSuite.status, 'PASS');
    assert.equal(current.buildValidation.checks[0].command, 'npm run verify:audit');
    assert.equal(current.buildValidation.checks[0].exitCode, 0);
    assert.deepEqual(current.buildValidation.limitations, []);
    assert.equal(current.currentDevice.status, 'PASS');
    assert.equal(current.currentDevice.freshness, 'CURRENT');

    assert.equal(getReleaseValidationReport({ appVersion: '0.9.5', sourceRoot: f.sourceRoot, manifestPath: f.manifestPath }).buildValidation.status, 'STALE');
    fs.appendFileSync(path.join(f.sourceRoot, 'app.cjs'), '// post-build change\n');
    const staleSource = getReleaseValidationReport({ appVersion: '0.9.4.2', sourceRoot: f.sourceRoot, manifestPath: f.manifestPath });
    assert.equal(staleSource.buildValidation.status, 'STALE');
    assert.equal(staleSource.buildValidation.freshness, 'STALE_SOURCE');
    assert.equal(staleSource.currentDevice.status, 'NOT_RUN');
  } finally {
    f.cleanup();
  }
});

test('missing, not-run, and invalid manifests never become PASS', () => {
  const f = fixture();
  try {
    assert.equal(getReleaseValidationReport({ appVersion: '0.9.4.2', sourceRoot: f.sourceRoot, manifestPath: f.manifestPath }).buildValidation.status, 'NOT_RUN');
    fs.writeFileSync(f.manifestPath, JSON.stringify({ format: 'nacre-release-validation', schemaVersion: 2, status: 'NOT_RUN' }));
    assert.equal(getReleaseValidationReport({ appVersion: '0.9.4.2', sourceRoot: f.sourceRoot, manifestPath: f.manifestPath }).buildValidation.status, 'NOT_RUN');
    fs.writeFileSync(f.manifestPath, '{broken');
    assert.equal(getReleaseValidationReport({ appVersion: '0.9.4.2', sourceRoot: f.sourceRoot, manifestPath: f.manifestPath }).buildValidation.status, 'INVALID');
  } finally {
    f.cleanup();
  }
});

test('CLI writes a validated manifest atomically from evidence for the current checkout', () => {
  const repoRoot = path.join(__dirname, '..');
  const cacheRoot = path.join(repoRoot, '.cache');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(cacheRoot, 'nacre-release-validation-cli-'));
  try {
    const startedAt = new Date().toISOString();
    const finishedAt = new Date(Date.parse(startedAt) + 1000).toISOString();
    const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    const evidence = {
      format: builderConstants.EVIDENCE_FORMAT,
      schemaVersion: builderConstants.EVIDENCE_SCHEMA_VERSION,
      releaseVersion: packageVersion,
      startedAt,
      finishedAt,
      source: computeSourceDigest(path.join(repoRoot, 'src')),
      testSuite: {
        command: 'node --test --test-reporter=tap',
        startedAt,
        finishedAt,
        exitCode: 0,
        signal: null,
        timedOut: false,
        environmentFailure: false,
        outputSha256: HASH,
        total: 1,
        passed: 1,
        failed: 0,
        cancelled: 0,
        skipped: 0,
        todo: 0
      },
      checks: [{
        id: 'fixture-check',
        command: 'node scripts/fixture-check.cjs',
        startedAt,
        finishedAt,
        exitCode: 0,
        signal: null,
        timedOut: false,
        environmentFailure: false,
        outputSha256: HASH
      }],
      limitations: []
    };
    const evidencePath = path.join(directory, 'evidence.json');
    const outputPath = path.join(directory, 'release-validation.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence));
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts', 'build-release-validation-manifest.cjs'),
      evidencePath,
      outputPath
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(validateManifest(manifest), true);
    assert.equal(manifest.status, 'PASS');
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.evidenceSha256, crypto.createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
