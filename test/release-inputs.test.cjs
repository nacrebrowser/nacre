'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findPrivateKeys, hasManifestKey } = require('../scripts/check-release-inputs.cjs');

test('packaging inputs are scanned for private keys, ignored files included', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-release-inputs-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'ok.cjs'), 'module.exports = 1;');
    // Built from parts: the tracked test itself must not contain a key header.
    fs.writeFileSync(path.join(root, 'src', 'deep', 'copied.txt'), 'x\n' + '-----BEGIN ' + 'PRIVATE KEY-----' + '\nabc\n');
    fs.writeFileSync(path.join(root, 'src', 'release.pem'), 'anything');
    assert.deepEqual(findPrivateKeys(root, ['src']).sort(), [path.join('src', 'deep', 'copied.txt'), path.join('src', 'release.pem')].sort());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  assert.deepEqual(findPrivateKeys(), [], 'the repository packages no private key');
});

test('a release needs a manifest key; a rescue key alone is not enough', () => {
  assert.equal(hasManifestKey([]), false);
  assert.equal(hasManifestKey([{ keyId: 'r', role: 'revocation', spki: '' }]), false);
  assert.equal(hasManifestKey([{ keyId: 'm', role: 'manifest', spki: '' }]), true);
  const config = require('../package.json');
  assert.ok(config.build.files.includes('!**/*.pem'));
  for (const script of ['prebuild:windows', 'preportable:windows', 'prebuild:linux']) assert.match(config.scripts[script], /^node scripts\/check-release-inputs\.cjs && /);
});
