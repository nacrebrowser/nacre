'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FORMAT = 'nacre-release-validation';
const SCHEMA_VERSION = 2;
const REPORT_FILE = 'release-validation.json';
const MAX_REPORT_BYTES = 256 * 1024;
const MAX_SOURCE_FILES = 4096;
const MAX_SOURCE_FILE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_CHECKS = 32;
const MAX_LIMITATIONS = 64;
const MAX_EXIT_CODE = 0xffffffff;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+(?:\.\d+){2,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CHECK_STATUSES = Object.freeze(['PASS', 'FAIL', 'NOT_STARTED', 'NOT_RUN', 'LIMITED']);
const MANIFEST_STATUSES = Object.freeze(['PASS', 'FAIL', 'INCOMPLETE']);

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value, maximum = 1_000_000) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function safeExitCode(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0 && value <= MAX_EXIT_CODE);
}

function validSignal(value) {
  return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 32 && !/[\u0000-\u001f\u007f]/.test(value));
}

function safeCommand(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 240
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validTime(value, allowNull = false) {
  if (allowNull && value === null) return true;
  if (typeof value !== 'string' || value.length > 40) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function timeRangeContains(startedAt, finishedAt, outerStartedAt, outerFinishedAt) {
  return Date.parse(startedAt) <= Date.parse(finishedAt)
    && Date.parse(startedAt) >= Date.parse(outerStartedAt)
    && Date.parse(finishedAt) <= Date.parse(outerFinishedAt);
}

function sourceFiles(root) {
  const base = path.resolve(root);
  const files = [];
  let totalBytes = 0;
  function walk(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && relative === REPORT_FILE) continue;
      if (entry.isSymbolicLink()) throw new Error('Source tree contains a symbolic link');
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        if (stat.size > MAX_SOURCE_FILE_BYTES || files.length >= MAX_SOURCE_FILES) throw new Error('Source tree exceeds validation limits');
        totalBytes += stat.size;
        if (totalBytes > MAX_SOURCE_TOTAL_BYTES) throw new Error('Source tree exceeds validation limits');
        files.push({ relative, absolute, size: stat.size });
      } else {
        throw new Error('Source tree contains an unsupported entry');
      }
    }
  }
  walk(base, '');
  files.sort((left, right) => left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0);
  return { base, files };
}

function computeSourceDigest(root = __dirname) {
  const tree = sourceFiles(root);
  const hash = crypto.createHash('sha256');
  for (const file of tree.files) {
    const contents = fs.readFileSync(file.absolute);
    if (contents.length !== file.size) throw new Error('Source changed while computing its digest');
    const fileHash = crypto.createHash('sha256').update(contents).digest('hex');
    hash.update(file.relative, 'utf8').update('\0').update(String(contents.length), 'ascii').update('\0').update(fileHash, 'ascii').update('\n');
  }
  return { algorithm: 'sha256-tree-v1', digest: hash.digest('hex'), files: tree.files.length };
}

function isLaunchFailure(stage) {
  return stage.environmentFailure === true
    || stage.timedOut === true
    || (stage.signal !== null && stage.signal !== undefined)
    || stage.exitCode === null
    || (Number.isSafeInteger(stage.exitCode) && stage.exitCode >= 0x80000000);
}

// A check that never reached application code is not a measured failure. The
// distinction is derived from the captured process result, never hand-entered.
function deriveCheckStatus(check) {
  if (!record(check)) return null;
  if (isLaunchFailure(check)) return 'NOT_STARTED';
  return check.exitCode === 0 ? 'PASS' : 'FAIL';
}

function deriveTestSuiteStatus(tests) {
  if (!record(tests)) return null;
  if (isLaunchFailure(tests)) return 'NOT_STARTED';
  if (tests.total === 0) return tests.exitCode === 0 ? 'NOT_RUN' : 'NOT_STARTED';
  if (tests.exitCode !== 0) return 'FAIL';
  if (tests.failed > 0 || tests.cancelled > 0) return 'FAIL';
  if (tests.skipped > 0 || tests.todo > 0) return 'LIMITED';
  return 'PASS';
}

function deriveManifestStatus(testSuite, checks) {
  if (!record(testSuite) || !Array.isArray(checks)) return 'INCOMPLETE';
  if (testSuite.status === 'FAIL' || checks.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (testSuite.status === 'PASS' && checks.every((check) => check.status === 'PASS')) return 'PASS';
  return 'INCOMPLETE';
}

function validateTestSuite(tests) {
  if (!record(tests) || !CHECK_STATUSES.includes(tests.status)
    || !safeCommand(tests.command)
    || !validTime(tests.startedAt) || !validTime(tests.finishedAt)
    || !safeExitCode(tests.exitCode) || !validSignal(tests.signal)
    || typeof tests.timedOut !== 'boolean' || typeof tests.environmentFailure !== 'boolean'
    || !SHA256_PATTERN.test(tests.outputSha256 || '')) return false;
  for (const name of ['total', 'passed', 'failed', 'cancelled', 'skipped', 'todo']) {
    if (!safeInteger(tests[name], 100_000)) return false;
  }
  if (tests.total !== tests.passed + tests.failed + tests.cancelled + tests.skipped + tests.todo) return false;
  const shouldPass = tests.total > 0 && tests.exitCode === 0 && tests.failed === 0 && tests.cancelled === 0 && tests.skipped === 0 && tests.todo === 0;
  return (tests.status === 'PASS') === shouldPass && tests.status === deriveTestSuiteStatus(tests);
}

function validateChecks(checks) {
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > MAX_CHECKS) return false;
  const seen = new Set();
  return checks.every((check) => {
    if (!record(check) || typeof check.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(check.id)
      || seen.has(check.id) || !CHECK_STATUSES.includes(check.status)
      || !safeCommand(check.command)
      || !validTime(check.startedAt) || !validTime(check.finishedAt)
      || !safeExitCode(check.exitCode) || !validSignal(check.signal)
      || typeof check.timedOut !== 'boolean' || typeof check.environmentFailure !== 'boolean'
      || !SHA256_PATTERN.test(check.outputSha256 || '')) return false;
    seen.add(check.id);
    return check.status === deriveCheckStatus(check);
  });
}

function validateLimitations(limitations, checks) {
  if (!Array.isArray(limitations) || limitations.length > MAX_LIMITATIONS) return false;
  const checkIds = new Set(checks.map((check) => check.id));
  checkIds.add('test-suite');
  const seen = new Set();
  return limitations.every((limitation) => {
    if (!record(limitation)
      || typeof limitation.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(limitation.id)
      || seen.has(limitation.id)
      || !checkIds.has(limitation.checkId)
      || typeof limitation.statement !== 'string' || limitation.statement.length < 1 || limitation.statement.length > 1000
      || !SHA256_PATTERN.test(limitation.outputSha256 || '')) return false;
    seen.add(limitation.id);
    return true;
  });
}

function validateManifest(value) {
  if (!record(value) || value.format !== FORMAT || value.schemaVersion !== SCHEMA_VERSION) return false;
  if (value.status === 'NOT_RUN') return Object.keys(value).length === 3;
  if (!MANIFEST_STATUSES.includes(value.status)
    || typeof value.releaseVersion !== 'string' || !VERSION_PATTERN.test(value.releaseVersion)
    || !validTime(value.startedAt) || !validTime(value.finishedAt)
    || !record(value.source) || value.source.algorithm !== 'sha256-tree-v1'
    || !SHA256_PATTERN.test(value.source.digest || '') || !safeInteger(value.source.files, MAX_SOURCE_FILES)
    || !SHA256_PATTERN.test(value.evidenceSha256 || '')
    || !SHA256_PATTERN.test(value.builderSha256 || '')
    || !validateTestSuite(value.testSuite) || !validateChecks(value.checks)
    || !validateLimitations(value.limitations, value.checks)) return false;
  if (!timeRangeContains(value.startedAt, value.finishedAt, value.startedAt, value.finishedAt)
    || !timeRangeContains(value.testSuite.startedAt, value.testSuite.finishedAt, value.startedAt, value.finishedAt)
    || value.checks.some((check) => !timeRangeContains(check.startedAt, check.finishedAt, value.startedAt, value.finishedAt))) return false;
  return value.status === deriveManifestStatus(value.testSuite, value.checks);
}

function normalizeLiveDiagnostics(value, appVersion, source) {
  const empty = {
    status: 'NOT_RUN',
    freshness: 'NOT_RUN',
    checkedAt: null,
    appVersion,
    sourceDigest: source.digest,
    checks: []
  };
  if (value === undefined || value === null) return empty;
  if (!record(value) || !validTime(value.checkedAt) || typeof value.appVersion !== 'string'
    || !VERSION_PATTERN.test(value.appVersion) || !SHA256_PATTERN.test(value.sourceDigest || '')
    || !Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > MAX_CHECKS) {
    return { ...empty, status: 'INVALID', freshness: 'INVALID' };
  }
  const checks = [];
  const seen = new Set();
  for (const item of value.checks) {
    if (!record(item) || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(item.id)
      || seen.has(item.id) || !CHECK_STATUSES.includes(item.status)) return { ...empty, status: 'INVALID', freshness: 'INVALID' };
    seen.add(item.id);
    checks.push({ id: item.id, status: item.status });
  }
  const freshness = value.appVersion === appVersion && value.sourceDigest === source.digest ? 'CURRENT' : 'STALE';
  let status;
  if (freshness === 'STALE') status = 'STALE';
  else if (checks.some((check) => check.status === 'FAIL')) status = 'FAIL';
  else if (checks.every((check) => check.status === 'PASS')) status = 'PASS';
  else status = 'INCOMPLETE';
  return {
    status,
    freshness,
    checkedAt: value.checkedAt,
    appVersion: value.appVersion,
    sourceDigest: value.sourceDigest,
    checks
  };
}

function readManifest(manifestPath) {
  try {
    const stat = fs.statSync(manifestPath);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return validateManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getReleaseValidationReport(options = {}) {
  const appVersion = typeof options.appVersion === 'string' && VERSION_PATTERN.test(options.appVersion)
    ? options.appVersion
    : '0.0.0';
  const sourceRoot = options.sourceRoot || __dirname;
  let currentSource;
  try {
    currentSource = computeSourceDigest(sourceRoot);
  } catch {
    currentSource = { algorithm: 'sha256-tree-v1', digest: '', files: 0 };
  }
  const manifestPath = options.manifestPath || path.join(sourceRoot, REPORT_FILE);
  const manifest = readManifest(manifestPath);
  let status = 'NOT_RUN';
  let freshness = 'NOT_RUN';
  if (fs.existsSync(manifestPath) && !manifest) {
    status = 'INVALID';
    freshness = 'INVALID';
  } else if (manifest && manifest.status !== 'NOT_RUN') {
    if (manifest.releaseVersion !== appVersion || manifest.source.digest !== currentSource.digest) {
      status = 'STALE';
      freshness = manifest.releaseVersion !== appVersion ? 'STALE_VERSION' : 'STALE_SOURCE';
    } else {
      status = manifest.status;
      freshness = 'CURRENT';
    }
  }
  const buildValidation = manifest ? {
    status,
    freshness,
    releaseVersion: manifest.releaseVersion || null,
    generatedAt: manifest.finishedAt || null,
    sourceDigest: manifest.source?.digest || null,
    sourceFiles: manifest.source?.files || 0,
    evidenceSha256: manifest.evidenceSha256 || null,
    builderSha256: manifest.builderSha256 || null,
    testSuite: manifest.testSuite ? {
      status: manifest.testSuite.status,
      command: manifest.testSuite.command,
      startedAt: manifest.testSuite.startedAt,
      finishedAt: manifest.testSuite.finishedAt,
      exitCode: manifest.testSuite.exitCode,
      signal: manifest.testSuite.signal,
      timedOut: manifest.testSuite.timedOut,
      environmentFailure: manifest.testSuite.environmentFailure,
      outputSha256: manifest.testSuite.outputSha256,
      total: manifest.testSuite.total,
      passed: manifest.testSuite.passed,
      failed: manifest.testSuite.failed,
      cancelled: manifest.testSuite.cancelled,
      skipped: manifest.testSuite.skipped,
      todo: manifest.testSuite.todo
    } : null,
    checks: Array.isArray(manifest.checks) ? manifest.checks.map(({ id, status: checkStatus, command, startedAt, finishedAt, exitCode, signal, timedOut, environmentFailure, outputSha256 }) => ({
      id, status: checkStatus, command, startedAt, finishedAt, exitCode, signal, timedOut, environmentFailure, outputSha256
    })) : [],
    limitations: Array.isArray(manifest.limitations) ? manifest.limitations.map(({ id, checkId, statement, outputSha256 }) => ({
      id, checkId, statement, outputSha256
    })) : []
  } : {
    status,
    freshness,
    releaseVersion: null,
    generatedAt: null,
    sourceDigest: null,
    sourceFiles: 0,
    testSuite: null,
    checks: [],
    limitations: []
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    buildValidation,
    currentDevice: normalizeLiveDiagnostics(options.liveDiagnostics, appVersion, currentSource)
  };
}

module.exports = {
  computeSourceDigest,
  validateManifest,
  getReleaseValidationReport,
  normalizeLiveDiagnostics,
  deriveCheckStatus,
  deriveTestSuiteStatus,
  deriveManifestStatus,
  constants: Object.freeze({
    FORMAT,
    SCHEMA_VERSION,
    REPORT_FILE,
    CHECK_STATUSES,
    MANIFEST_STATUSES,
    MAX_EXIT_CODE
  })
};
