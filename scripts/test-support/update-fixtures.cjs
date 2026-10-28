'use strict';

// Throwaway Ed25519 keys and manifests for the update tests. Never used by a
// build: production keys live in src/update-keys.cjs.

const crypto = require('node:crypto');

function fixtureKeys() {
  const plan = [['main-a', 'manifest'], ['main-b', 'manifest'], ['rescue-a', 'revocation']];
  const privateKeys = {};
  const keys = plan.map(([keyId, role]) => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    privateKeys[keyId] = privateKey;
    return { keyId, role, spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  });
  return { keys, privateKeys };
}

function sign(bytes, keyIds, privateKeys, prefix) {
  const message = Buffer.concat([Buffer.from(prefix, 'utf8'), bytes]);
  return Buffer.from(keyIds.map((keyId) => `${keyId} ${crypto.sign(null, message, privateKeys[keyId]).toString('base64')}`).join('\n') + '\n');
}

function manifestFixture(overrides = {}, artifactBytes = Buffer.from('installer bytes')) {
  const version = overrides.version || '1.1.1';
  const base = {
    schema: 1, product: 'nacre', channel: 'stable', version,
    published: '2026-11-05T12:00:00Z', issued: '2026-11-05T12:00:00Z', expires: '2027-01-05T12:00:00Z',
    critical: false,
    releaseUrl: `https://github.com/nacrebrowser/nacre/releases/tag/v${version}`,
    artifacts: [
      { platform: 'win32', arch: 'x64', format: 'nsis', name: `Nacre-Setup-${version}.exe`, size: artifactBytes.length, sha256: crypto.createHash('sha256').update(artifactBytes).digest('hex') },
      { platform: 'win32', arch: 'x64', format: 'portable', name: `Nacre-${version}-Portable.zip`, size: 10, sha256: 'b'.repeat(64) },
      { platform: 'linux', arch: 'x64', format: 'deb', name: `nacre_${version}_amd64.deb`, size: 10, sha256: 'a'.repeat(64) }
    ]
  };
  const manifest = { ...base, ...overrides };
  for (const key of Object.keys(manifest)) if (manifest[key] === undefined) delete manifest[key];
  return manifest;
}

module.exports = { fixtureKeys, sign, manifestFixture };
