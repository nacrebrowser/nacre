'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  computeSourceDigest,
  validateManifest,
  deriveCheckStatus,
  deriveTestSuiteStatus,
  deriveManifestStatus,
  constants
} = require('../src/release-validation.cjs');

const EVIDENCE_FORMAT = 'nacre-release-validation-evidence';
const EVIDENCE_SCHEMA_VERSION = 2;
const MAX_EVIDENCE_BYTES = 256 * 1024;
const MAX_CHECKS = 32;
const MAX_LIMITATIONS = 64;
const MAX_EXIT_CODE = 0xffffffff;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+(?:\.\d+){2,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CHECK_STATUSES = constants.CHECK_STATUSES;

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return record(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isIsoTime(value) {
  return typeof value === 'string' && value.length <= 40
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function withinTimes(startedAt, finishedAt) {
  return Date.parse(startedAt) <= Date.parse(finishedAt);
}

function insideTimes(startedAt, finishedAt, outerStart, outerFinish) {
  return Date.parse(startedAt) >= Date.parse(outerStart)
    && Date.parse(finishedAt) <= Date.parse(outerFinish);
}

function validOutputDigest(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function safeCommand(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 240
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validExitCode(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0 && value <= MAX_EXIT_CODE);
}

function validSignal(value) {
  return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 32 && !/[\u0000-\u001f\u007f]/.test(value));
}

function validStageShape(stage, keys) {
  return hasExactKeys(stage, keys)
    && safeCommand(stage.command)
    && isIsoTime(stage.startedAt) && isIsoTime(stage.finishedAt) && withinTimes(stage.startedAt, stage.finishedAt)
    && validExitCode(stage.exitCode) && validSignal(stage.signal)
    && typeof stage.timedOut === 'boolean' && typeof stage.environmentFailure === 'boolean'
    && validOutputDigest(stage.outputSha256);
}

function validateEvidence(evidence) {
  const topKeys = ['format', 'schemaVersion', 'releaseVersion', 'startedAt', 'finishedAt', 'source', 'testSuite', 'checks', 'limitations'];
  if (!hasExactKeys(evidence, topKeys) || evidence.format !== EVIDENCE_FORMAT || evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION
    || typeof evidence.releaseVersion !== 'string' || !VERSION_PATTERN.test(evidence.releaseVersion)
    || !isIsoTime(evidence.startedAt) || !isIsoTime(evidence.finishedAt)
    || !withinTimes(evidence.startedAt, evidence.finishedAt)) return false;

  if (!hasExactKeys(evidence.source, ['algorithm', 'digest', 'files'])
    || evidence.source.algorithm !== 'sha256-tree-v1' || !validOutputDigest(evidence.source.digest)
    || !Number.isSafeInteger(evidence.source.files) || evidence.source.files < 0 || evidence.source.files > 4096) return false;

  const test = evidence.testSuite;
  if (!validStageShape(test, ['command', 'startedAt', 'finishedAt', 'exitCode', 'signal', 'timedOut', 'environmentFailure', 'outputSha256', 'total', 'passed', 'failed', 'cancelled', 'skipped', 'todo'])
    || !insideTimes(test.startedAt, test.finishedAt, evidence.startedAt, evidence.finishedAt)) return false;
  const counts = ['total', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];
  if (counts.some((name) => !Number.isSafeInteger(test[name]) || test[name] < 0 || test[name] > 100_000)
    || test.total !== test.passed + test.failed + test.cancelled + test.skipped + test.todo) return false;
  if (!CHECK_STATUSES.includes(deriveTestSuiteStatus(test))) return false;

  if (!Array.isArray(evidence.checks) || evidence.checks.length < 1 || evidence.checks.length > MAX_CHECKS) return false;
  const seen = new Set();
  if (!evidence.checks.every((check) => {
    if (!validStageShape(check, ['id', 'command', 'startedAt', 'finishedAt', 'exitCode', 'signal', 'timedOut', 'environmentFailure', 'outputSha256'])
      || typeof check.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(check.id) || seen.has(check.id)
      || !insideTimes(check.startedAt, check.finishedAt, evidence.startedAt, evidence.finishedAt)) return false;
    seen.add(check.id);
    return CHECK_STATUSES.includes(deriveCheckStatus(check));
  })) return false;

  if (!Array.isArray(evidence.limitations) || evidence.limitations.length > MAX_LIMITATIONS) return false;
  const checkIds = new Set(evidence.checks.map((check) => check.id));
  checkIds.add('test-suite');
  return evidence.limitations.every((limitation) => hasExactKeys(limitation, ['checkId', 'statement'])
    && checkIds.has(limitation.checkId)
    && typeof limitation.statement === 'string' && limitation.statement.length >= 1 && limitation.statement.length <= 1000);
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildManifestFromEvidence(evidence, options = {}) {
  if (!validateEvidence(evidence)) throw new Error('Release validation evidence is invalid');
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const sourceRoot = path.resolve(options.sourceRoot || path.join(repoRoot, 'src'));
  const packagePath = path.resolve(options.packagePath || path.join(repoRoot, 'package.json'));
  const builderPath = path.resolve(options.builderPath || __filename);
  const expectedVersion = options.expectedVersion || JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
  if (typeof expectedVersion !== 'string' || !VERSION_PATTERN.test(expectedVersion)
    || evidence.releaseVersion !== expectedVersion) {
    throw new Error('Evidence release version does not match package.json');
  }

  const source = computeSourceDigest(sourceRoot);
  if (evidence.source.digest !== source.digest || evidence.source.files !== source.files) {
    throw new Error('Evidence source digest does not match the current source tree');
  }

  const testSuite = { ...evidence.testSuite, status: deriveTestSuiteStatus(evidence.testSuite) };
  const checks = evidence.checks.map((check) => ({
    ...check,
    status: deriveCheckStatus(check)
  }));
  const stages = new Map(checks.map((check) => [check.id, check]));
  stages.set('test-suite', testSuite);
  const limitations = evidence.limitations.map((limitation, index) => ({
    id: 'limit-' + (index + 1),
    checkId: limitation.checkId,
    statement: limitation.statement,
    outputSha256: stages.get(limitation.checkId).outputSha256
  }));
  const status = deriveManifestStatus(testSuite, checks);
  const manifest = {
    format: constants.FORMAT,
    schemaVersion: constants.SCHEMA_VERSION,
    status,
    releaseVersion: evidence.releaseVersion,
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt,
    source,
    evidenceSha256: options.evidenceSha256 || crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
    builderSha256: hashFile(builderPath),
    testSuite,
    checks,
    limitations
  };
  if (!validateManifest(manifest)) throw new Error('Generated release validation manifest failed schema validation');
  return manifest;
}

function readEvidence(evidencePath) {
  const stat = fs.statSync(evidencePath);
  if (!stat.isFile() || stat.size > MAX_EVIDENCE_BYTES) throw new Error('Evidence file is missing or exceeds the size limit');
  const bytes = fs.readFileSync(evidencePath);
  return { bytes, evidence: JSON.parse(bytes.toString('utf8')) };
}

function atomicWrite(filePath, contents) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

function main(argv) {
  if (argv.length < 1 || argv.length > 2) {
    throw new Error('Usage: node scripts/build-release-validation-manifest.cjs <evidence.json> [src/release-validation.json]');
  }
  const repoRoot = path.resolve(__dirname, '..');
  const evidencePath = path.resolve(repoRoot, argv[0]);
  const outputPath = path.resolve(repoRoot, argv[1] || 'src/release-validation.json');
  const { bytes, evidence } = readEvidence(evidencePath);
  const manifest = buildManifestFromEvidence(evidence, {
    repoRoot,
    evidenceSha256: crypto.createHash('sha256').update(bytes).digest('hex')
  });
  atomicWrite(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, status: manifest.status, releaseVersion: manifest.releaseVersion, sourceDigest: manifest.source.digest })}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`release validation manifest: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildManifestFromEvidence, validateEvidence, constants: Object.freeze({ EVIDENCE_FORMAT, EVIDENCE_SCHEMA_VERSION }) };
