'use strict';

// Writes and signs the update manifest for a release, from the final files
// that will be uploaded.
//
//   node scripts/sign-update-manifest.cjs [--dist dist] [--keys <folder>] [--critical]
//   node scripts/sign-update-manifest.cjs --refresh <nacre-update.json> [--keys <folder>]
//   node scripts/sign-update-manifest.cjs --revoke <keyId> (--previous <nacre-key-revocation.json> | --first) [--keys <folder>]
//
// --refresh re-issues an existing manifest with new issued/expires dates
// (same version and files). --revoke writes the cumulative revocation list
// signed by the rescue key: the previously published list (--previous, verified
// first) plus the new key. Publish it with every later release. Every output is verified with the public keys built into Nacre.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const verify = require('../src/update-verify.cjs');
const { artifactNames } = require('./artifact-names.cjs');
const { loadPrivateKey } = require('./update-keys.cjs');

const VALIDITY_DAYS = 90;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function isoSeconds(time) {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function signatureFile(data, keyIds, prefix, keysDirectory) {
  const message = Buffer.concat([Buffer.from(prefix, 'utf8'), data]);
  const lines = keyIds.map((keyId) => `${keyId} ${crypto.sign(null, message, loadPrivateKey(keyId, keysDirectory)).toString('base64')}`);
  const text = lines.join('\n') + '\n';
  if (Buffer.byteLength(text) > verify.LIMITS.signatures) throw new Error('Fichier de signatures trop volumineux.');
  return Buffer.from(text);
}

function collectArtifacts(dist, version) {
  const names = artifactNames(version);
  const candidates = [
    { platform: 'win32', arch: 'x64', format: 'nsis', name: names.nsis },
    { platform: 'win32', arch: 'x64', format: 'portable', name: names.portable },
    { platform: 'linux', arch: 'x64', format: 'deb', name: names.deb }
  ];
  return candidates.filter((item) => fs.existsSync(path.join(dist, item.name))).map((item) => {
    const file = path.join(dist, item.name);
    return { ...item, size: fs.statSync(file).size, sha256: sha256(file) };
  });
}

function manifestKeyIds(keys) {
  return keys.filter((key) => key.role === 'manifest').map((key) => key.keyId);
}

function writeSigned(outputDirectory, name, data, signatures, check) {
  check(data, signatures);
  fs.writeFileSync(path.join(outputDirectory, name), data);
  fs.writeFileSync(path.join(outputDirectory, name + '.sig'), signatures);
  process.stdout.write(`${name} et ${name}.sig écrits et vérifiés.\n`);
}

function main() {
  const keys = require('../src/update-keys.cjs');
  const keysDirectory = argument('--keys', undefined);
  const signers = manifestKeyIds(keys);
  if (!signers.length) throw new Error('Aucune clé publique de manifeste intégrée : lance d’abord scripts/update-keys.cjs generate.');
  const checkManifest = (data, signatures) => verify.authenticateManifest({ manifestBytes: data, signatureBytes: signatures, keys });

  const revoked = argument('--revoke');
  if (revoked) {
    const rescue = keys.filter((key) => key.role === 'revocation').map((key) => key.keyId);
    let previous = [];
    const previousFile = argument('--previous');
    if (!previousFile && !process.argv.includes('--first')) {
      throw new Error('Donne la liste publiée précédente avec --previous (ou --first pour la toute première révocation).');
    }
    if (previousFile) {
      previous = verify.authenticateRevocation({ revocationBytes: fs.readFileSync(previousFile), signatureBytes: fs.readFileSync(previousFile + '.sig'), keys }).revokedKeyIds;
    }
    const revokedKeyIds = [...new Set([...previous, revoked])].sort();
    const data = Buffer.from(JSON.stringify({ schema: 1, type: 'revocation-list', revokedKeyIds, issued: isoSeconds(Date.now()) }, null, 2) + '\n');
    writeSigned(process.cwd(), 'nacre-key-revocation.json', data, signatureFile(data, rescue, verify.REVOCATION_PREFIX, keysDirectory),
      (bytes, signatures) => verify.authenticateRevocation({ revocationBytes: bytes, signatureBytes: signatures, keys }));
    return;
  }

  let manifest;
  let outputDirectory;
  const refresh = argument('--refresh');
  const issued = Date.now();
  if (refresh) {
    // The existing manifest must carry a valid signature from our own keys
    // (expiry does not matter here): never re-sign altered metadata.
    manifest = verify.authenticateManifest({ manifestBytes: fs.readFileSync(refresh), signatureBytes: fs.readFileSync(refresh + '.sig'), keys }).manifest;
    outputDirectory = path.dirname(path.resolve(refresh));
  } else {
    const version = require('../package.json').nacreVersion || require('../package.json').version;
    outputDirectory = path.resolve(argument('--dist', 'dist'));
    const artifacts = collectArtifacts(outputDirectory, version);
    if (!artifacts.length) throw new Error(`Aucun fichier de release ${version} dans ${outputDirectory}.`);
    manifest = {
      schema: 1, product: 'nacre', channel: 'stable', version,
      published: isoSeconds(issued), issued: '', expires: '',
      critical: process.argv.includes('--critical'),
      releaseUrl: `https://github.com/nacrebrowser/nacre/releases/tag/v${version}`,
      artifacts
    };
  }
  manifest = { ...manifest, issued: isoSeconds(issued), expires: isoSeconds(issued + VALIDITY_DAYS * 24 * 60 * 60 * 1000) };
  const data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  writeSigned(outputDirectory, 'nacre-update.json', data, signatureFile(data, signers, verify.MANIFEST_PREFIX, keysDirectory), checkManifest);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { signatureFile, collectArtifacts };
