'use strict';

// Signed update metadata: pure checks, no network and no file system.
// The order of the steps matters: nothing from a manifest is used before at
// least one signature from a trusted, unrevoked manifest key has verified.

const crypto = require('node:crypto');

const LIMITS = Object.freeze({
  manifest: 64 * 1024,
  signatures: 1024,
  revocation: 64 * 1024,
  artifact: 400 * 1024 * 1024
});
const MANIFEST_PREFIX = 'nacre-update-manifest-v1\n';
const REVOCATION_PREFIX = 'nacre-key-revocation-v1\n';
const RELEASE_TAG_BASE = 'https://github.com/nacrebrowser/nacre/releases/tag/v';
const MAX_VALIDITY_MS = 120 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const FORMATS = Object.freeze({ win32: Object.freeze(['nsis', 'portable']), linux: Object.freeze(['deb']) });
const ARCHES = Object.freeze(['x64']);
// Every hop of a download must stay on GitHub's release hosts.
const ALLOWED_HOSTS = Object.freeze(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const RELEASES_PATH = '/nacrebrowser/nacre/releases/';

class UpdateError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function fail(code, message) { throw new UpdateError(code, message); }

function parseVersion(value) {
  const match = typeof value === 'string' && /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.exec(value);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) fail('version', 'Invalid version.');
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value ? time : NaN;
}

// (version, issued) pairs are ordered as one value: version first, issued
// only between equal versions.
function compareSeen(left, right) {
  const byVersion = compareVersions(left.version, right.version);
  if (byVersion) return byVersion;
  const a = parseTimestamp(left.issued);
  const b = parseTimestamp(right.issued);
  return a === b ? 0 : (a < b ? -1 : 1);
}

function exactKeys(value, keys) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  fail('format', 'Binary data expected.');
}

// "<keyId> <base64 Ed25519 signature>", one to four lines.
function parseSignatureFile(bytes) {
  const buffer = asBuffer(bytes);
  if (buffer.length === 0 || buffer.length > LIMITS.signatures) fail('signature-format', 'Signature file size out of range.');
  const text = buffer.toString('latin1');
  if (!/^[\x20-\x7e\n]+$/.test(text)) fail('signature-format', 'Invalid signature file.');
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length < 1 || lines.length > 4) fail('signature-format', 'Invalid number of signatures.');
  const seen = new Set();
  return lines.map((line) => {
    const match = /^([a-z0-9-]{1,40}) ([A-Za-z0-9+/]{86}==)$/.exec(line);
    if (!match || seen.has(match[1])) fail('signature-format', 'Invalid signature line.');
    seen.add(match[1]);
    const signature = Buffer.from(match[2], 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== match[2]) fail('signature-format', 'Invalid signature.');
    return { keyId: match[1], signature };
  });
}

function publicKeyFor(key) {
  const object = crypto.createPublicKey({ key: Buffer.from(key.spki, 'base64'), format: 'der', type: 'spki' });
  if (object.asymmetricKeyType !== 'ed25519') fail('key', 'Invalid update key.');
  return object;
}

// Returns the ids of the keys whose signatures verified. A key only counts
// for its own role, and a revoked key never counts.
function verifySignatures(data, signatureBytes, { keys, role, prefix, revokedKeyIds = [] }) {
  const lines = parseSignatureFile(signatureBytes);
  const message = Buffer.concat([Buffer.from(prefix, 'utf8'), asBuffer(data)]);
  const revoked = new Set(revokedKeyIds);
  const verified = [];
  for (const { keyId, signature } of lines) {
    const key = keys.find((item) => item.keyId === keyId);
    if (!key || key.role !== role || revoked.has(keyId)) continue;
    let valid = false;
    try { valid = crypto.verify(null, message, publicKeyFor(key), signature); } catch { valid = false; }
    if (valid) verified.push(keyId);
  }
  return verified;
}

function parseJson(bytes, limit) {
  const buffer = asBuffer(bytes);
  if (buffer.length === 0 || buffer.length > limit) fail('size', 'Metadata size out of range.');
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) fail('format', 'Metadata with a BOM refused.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  try { return JSON.parse(text); } catch { fail('format', 'Unreadable metadata.'); }
}

function validateArtifact(artifact, version) {
  if (!exactKeys(artifact, ['platform', 'arch', 'format', 'name', 'size', 'sha256'])) fail('schema', 'Invalid artifact.');
  if (!Object.hasOwn(FORMATS, artifact.platform) || !FORMATS[artifact.platform].includes(artifact.format)) fail('schema', 'Invalid artifact format.');
  if (!ARCHES.includes(artifact.arch)) fail('schema', 'Invalid architecture.');
  if (typeof artifact.name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(artifact.name) || !artifact.name.includes(version)) fail('schema', 'Invalid artifact name.');
  if (!Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > LIMITS.artifact) fail('schema', 'Invalid artifact size.');
  if (typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(artifact.sha256)) fail('schema', 'Invalid artifact digest.');
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, ['schema', 'product', 'channel', 'version', 'published', 'issued', 'expires', 'critical', 'releaseUrl', 'artifacts'])) fail('schema', 'Invalid manifest fields.');
  if (manifest.schema !== 1 || manifest.product !== 'nacre' || manifest.channel !== 'stable') fail('schema', 'Manifest for another product or channel.');
  if (!parseVersion(manifest.version)) fail('schema', 'Invalid manifest version.');
  const published = parseTimestamp(manifest.published);
  const issued = parseTimestamp(manifest.issued);
  const expires = parseTimestamp(manifest.expires);
  if (![published, issued, expires].every(Number.isFinite)) fail('schema', 'Invalid manifest dates.');
  if (!(published <= issued && issued < expires && expires - issued <= MAX_VALIDITY_MS)) fail('schema', 'Invalid manifest validity period.');
  if (typeof manifest.critical !== 'boolean') fail('schema', 'Invalid critical flag.');
  if (manifest.releaseUrl !== RELEASE_TAG_BASE + manifest.version) fail('schema', 'Invalid release address.');
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length < 1 || manifest.artifacts.length > 12) fail('schema', 'Invalid artifact list.');
  const targets = new Set();
  for (const artifact of manifest.artifacts) {
    validateArtifact(artifact, manifest.version);
    const target = `${artifact.platform}/${artifact.arch}/${artifact.format}`;
    if (targets.has(target)) fail('schema', 'Duplicate artifact.');
    targets.add(target);
  }
  return manifest;
}

// Steps 1-3: size, signatures, then schema.
function authenticateManifest({ manifestBytes, signatureBytes, keys, revokedKeyIds = [] }) {
  if (asBuffer(manifestBytes).length > LIMITS.manifest) fail('size', 'Manifest too large.');
  const keyIds = verifySignatures(manifestBytes, signatureBytes, { keys, role: 'manifest', prefix: MANIFEST_PREFIX, revokedKeyIds });
  if (!keyIds.length) fail('signature', 'No valid update signature.');
  return { manifest: validateManifest(parseJson(manifestBytes, LIMITS.manifest)), keyIds };
}

// Steps 4-5: rollback and freshness against the persistent state.
function evaluateManifest(manifest, { highestSeen = null, currentVersion, now }) {
  const seen = { version: manifest.version, issued: manifest.issued };
  if (highestSeen && compareSeen(seen, highestSeen) < 0) fail('rollback', 'Metadata older than metadata already seen.');
  const issued = parseTimestamp(manifest.issued);
  if (now > parseTimestamp(manifest.expires)) fail('stale', 'Update metadata expired.');
  if (now < issued - CLOCK_SKEW_MS) fail('clock', 'Local clock earlier than the metadata.');
  return { seen, newer: compareVersions(manifest.version, currentVersion) > 0 };
}

function selectArtifact(manifest, { platform, arch, format }) {
  return manifest.artifacts.find((item) => item.platform === platform && item.arch === arch && item.format === format) || null;
}

function authenticateRevocation({ revocationBytes, signatureBytes, keys }) {
  if (asBuffer(revocationBytes).length > LIMITS.revocation) fail('size', 'Revocation too large.');
  if (!verifySignatures(revocationBytes, signatureBytes, { keys, role: 'revocation', prefix: REVOCATION_PREFIX }).length) fail('signature', 'Revocation not signed by a rescue key.');
  // The published list is cumulative: every key ever revoked, so a copy that
  // was offline during one revocation still learns it from a later list.
  const value = parseJson(revocationBytes, LIMITS.revocation);
  if (!exactKeys(value, ['schema', 'type', 'revokedKeyIds', 'issued']) || value.schema !== 1 || value.type !== 'revocation-list'
    || !Array.isArray(value.revokedKeyIds) || value.revokedKeyIds.length < 1 || value.revokedKeyIds.length > 1000
    || new Set(value.revokedKeyIds).size !== value.revokedKeyIds.length
    || !value.revokedKeyIds.every((id) => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)) || !Number.isFinite(parseTimestamp(value.issued))) {
    fail('schema', 'Invalid revocation list.');
  }
  return value;
}

// One hop of a download, including redirects. Returns the parsed URL or null.
function allowedUpdateLocation(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  if (!ALLOWED_HOSTS.includes(url.hostname)) return null;
  if (url.hostname === 'github.com' && !url.pathname.startsWith(RELEASES_PATH)) return null;
  return url;
}

module.exports = {
  LIMITS, MANIFEST_PREFIX, REVOCATION_PREFIX, ALLOWED_HOSTS, UpdateError,
  parseVersion, compareVersions, parseTimestamp, compareSeen, parseSignatureFile, verifySignatures,
  validateManifest, authenticateManifest, evaluateManifest, selectArtifact, authenticateRevocation, allowedUpdateLocation
};
