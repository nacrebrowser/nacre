'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const verify = require('../src/update-verify.cjs');
const { fixtureKeys, manifestFixture, sign } = require('../scripts/test-support/update-fixtures.cjs');

const { keys, privateKeys } = fixtureKeys();
const NOW = Date.parse('2026-11-06T12:00:00Z');

function signedManifest(overrides = {}, signers = ['main-a']) {
  const bytes = Buffer.from(JSON.stringify(manifestFixture(overrides)));
  return { manifestBytes: bytes, signatureBytes: sign(bytes, signers, privateKeys, verify.MANIFEST_PREFIX) };
}

test('a manifest signed by a trusted manifest key is authenticated', () => {
  const { manifest, keyIds } = verify.authenticateManifest({ ...signedManifest(), keys });
  assert.equal(manifest.version, '1.1.1');
  assert.deepEqual(keyIds, ['main-a']);
});

test('altered bytes, unknown keys, revoked keys and a missing domain prefix are refused', () => {
  const good = signedManifest();
  const altered = Buffer.from(good.manifestBytes.toString().replace('1.1.1', '1.1.9'));
  assert.throws(() => verify.authenticateManifest({ manifestBytes: altered, signatureBytes: good.signatureBytes, keys }), { code: 'signature' });
  const stranger = crypto.generateKeyPairSync('ed25519');
  const foreign = sign(good.manifestBytes, ['main-a'], { 'main-a': stranger.privateKey }, verify.MANIFEST_PREFIX);
  assert.throws(() => verify.authenticateManifest({ manifestBytes: good.manifestBytes, signatureBytes: foreign, keys }), { code: 'signature' });
  assert.throws(() => verify.authenticateManifest({ ...good, keys, revokedKeyIds: ['main-a'] }), { code: 'signature' });
  const noPrefix = sign(good.manifestBytes, ['main-a'], privateKeys, '');
  assert.throws(() => verify.authenticateManifest({ manifestBytes: good.manifestBytes, signatureBytes: noPrefix, keys }), { code: 'signature' });
});

test('a key only signs for its own role, even with a valid signature and prefix', () => {
  const crossManifest = signedManifest({}, ['rescue-a']);
  assert.throws(() => verify.authenticateManifest({ ...crossManifest, keys }), { code: 'signature' });
  const revocation = Buffer.from(JSON.stringify({ schema: 1, type: 'revocation-list', revokedKeyIds: ['main-a'], issued: '2026-11-06T12:00:00Z' }));
  const byManifestKey = sign(revocation, ['main-a'], privateKeys, verify.REVOCATION_PREFIX);
  assert.throws(() => verify.authenticateRevocation({ revocationBytes: revocation, signatureBytes: byManifestKey, keys }), { code: 'signature' });
  const byRescue = sign(revocation, ['rescue-a'], privateKeys, verify.REVOCATION_PREFIX);
  assert.deepEqual(verify.authenticateRevocation({ revocationBytes: revocation, signatureBytes: byRescue, keys }).revokedKeyIds, ['main-a']);
  const single = Buffer.from(JSON.stringify({ schema: 1, type: 'revocation', revokedKeyId: 'main-a', issued: '2026-11-06T12:00:00Z' }));
  assert.throws(() => verify.authenticateRevocation({ revocationBytes: single, signatureBytes: sign(single, ['rescue-a'], privateKeys, verify.REVOCATION_PREFIX), keys }), { code: 'schema' });
});

test('rotation: an old client accepts N+2 signed by both keys; one valid line out of several is enough', () => {
  const oldClientKeys = keys.filter((key) => key.keyId !== 'main-b');
  const bothSigned = signedManifest({ version: '1.1.3' }, ['main-a', 'main-b']);
  assert.equal(verify.authenticateManifest({ ...bothSigned, keys: oldClientKeys }).manifest.version, '1.1.3');
  const newOnly = signedManifest({ version: '1.1.3' }, ['main-b']);
  assert.throws(() => verify.authenticateManifest({ ...newOnly, keys: oldClientKeys }), { code: 'signature' });
});

test('the signature file has one shared 1 KiB limit: four 40-character key ids fit, one more byte does not', () => {
  const ids = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(40)];
  const line = (id) => `${id} ${Buffer.alloc(64, 1).toString('base64')}`;
  const text = ids.map(line).join('\n') + '\n';
  assert.ok(Buffer.byteLength(text) <= verify.LIMITS.signatures);
  assert.equal(verify.parseSignatureFile(Buffer.from(text)).length, 4);
  assert.throws(() => verify.parseSignatureFile(Buffer.alloc(verify.LIMITS.signatures + 1, 0x61)), { code: 'signature-format' });
  assert.throws(() => verify.parseSignatureFile(Buffer.from([line('x'), line('x')].join('\n'))), { code: 'signature-format' });
  assert.throws(() => verify.parseSignatureFile(Buffer.from([1, 2, 3, 4, 5].map(String).map(line).join('\n'))), { code: 'signature-format' });
});

test('strict schema: unknown fields, bad versions, names, sizes, dates and duplicates are refused', () => {
  const cases = [
    { extra: true },
    { version: '1.1' },
    { version: '01.1.1' },
    { product: 'other' },
    { releaseUrl: 'https://example.com/v1.1.1' },
    { critical: 'yes' },
    { expires: '2027-06-01T00:00:00Z' },
    { issued: '2026-11-04T00:00:00Z', published: '2026-11-05T00:00:00Z' },
    { artifacts: [] }
  ];
  for (const overrides of cases) assert.throws(() => verify.validateManifest(manifestFixture(overrides)), { code: 'schema' }, JSON.stringify(overrides));
  const base = manifestFixture();
  const artifact = base.artifacts[0];
  for (const change of [{ name: 'Nacre Setup 1.1.1.exe' }, { name: 'Nacre-Setup-1.1.0.exe' }, { size: 0 }, { size: verify.LIMITS.artifact + 1 }, { sha256: 'ABC' }, { format: 'deb' }, { arch: 'arm64' }]) {
    assert.throws(() => verify.validateManifest({ ...base, artifacts: [{ ...artifact, ...change }] }), { code: 'schema' }, JSON.stringify(change));
  }
  assert.throws(() => verify.validateManifest({ ...base, artifacts: [artifact, { ...artifact }] }), { code: 'schema' });
});

test('rollback and replay use the (version, issued) pair; stale and future metadata are not used', () => {
  const manifest = manifestFixture();
  const seen = { version: '1.1.1', issued: manifest.issued };
  assert.equal(verify.evaluateManifest(manifest, { highestSeen: seen, currentVersion: '1.1.0', now: NOW }).newer, true);
  assert.throws(() => verify.evaluateManifest(manifest, { highestSeen: { version: '1.1.2', issued: '2026-11-01T00:00:00Z' }, currentVersion: '1.1.0', now: NOW }), { code: 'rollback' });
  assert.throws(() => verify.evaluateManifest(manifest, { highestSeen: { version: '1.1.1', issued: '2026-11-06T00:00:00Z' }, currentVersion: '1.1.0', now: NOW }), { code: 'rollback' });
  assert.equal(verify.evaluateManifest(manifestFixture({ version: '1.1.2', issued: '2026-11-05T11:45:00Z', published: '2026-11-05T11:45:00Z' }), { highestSeen: { version: '1.1.1', issued: '2026-11-05T12:00:00Z' }, currentVersion: '1.1.0', now: NOW }).newer, true,
    'a higher version issued slightly earlier is still newer');
  assert.throws(() => verify.evaluateManifest(manifest, { currentVersion: '1.1.0', now: Date.parse(manifest.expires) + 1000 }), { code: 'stale' });
  assert.throws(() => verify.evaluateManifest(manifest, { currentVersion: '1.1.0', now: Date.parse(manifest.issued) - 2 * 24 * 3600 * 1000 }), { code: 'clock' });
  assert.equal(verify.evaluateManifest(manifest, { currentVersion: '1.1.1', now: NOW }).newer, false);
});

test('a release older than 120 days can be refreshed: issued moves, published stays', () => {
  const refreshed = manifestFixture({ published: '2026-01-01T00:00:00Z', issued: '2026-11-05T00:00:00Z', expires: '2027-02-01T00:00:00Z' });
  assert.equal(verify.validateManifest(refreshed).published, '2026-01-01T00:00:00Z');
  const evaluation = verify.evaluateManifest(refreshed, { highestSeen: { version: '1.1.1', issued: '2026-01-01T00:00:00Z' }, currentVersion: '1.1.0', now: NOW });
  assert.deepEqual(evaluation.seen, { version: '1.1.1', issued: '2026-11-05T00:00:00Z' });
});

test('every download hop must stay on GitHub release hosts over plain HTTPS', () => {
  for (const ok of [
    'https://github.com/nacrebrowser/nacre/releases/latest/download/nacre-update.json',
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sp=r',
    'https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/abc'
  ]) assert.ok(verify.allowedUpdateLocation(ok), ok);
  for (const bad of [
    'http://github.com/nacrebrowser/nacre/releases/latest/download/nacre-update.json',
    'https://github.com/someone/else/releases/latest/download/nacre-update.json',
    'https://github.com/nacrebrowser/nacre/archive/main.zip',
    'https://github.com:8443/nacrebrowser/nacre/releases/x',
    'https://user:pass@github.com/nacrebrowser/nacre/releases/x',
    'https://evil.example/nacre/releases/',
    'https://githubusercontent.com.evil.example/x',
    'not a url'
  ]) assert.equal(verify.allowedUpdateLocation(bad), null, bad);
});
