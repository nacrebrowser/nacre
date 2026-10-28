'use strict';

// Run before every Windows or Linux package build.
//  - A release must carry at least one update manifest key, or installed
//    copies could never update. NACRE_ALLOW_KEYLESS_BUILD=1 allows a local
//    test build without keys; it is reported as such.
//  - No private key may sit in the files that get packaged, including files
//    Git ignores (a key copied by mistake would otherwise reach app.asar).

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const PACKAGED_ROOTS = ['src', 'build', 'vendor', 'package.json', 'LICENSE.md', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md'];
const PRIVATE_KEY = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/;

function findPrivateKeys(base = root, entries = PACKAGED_ROOTS) {
  const found = [];
  const visit = (target) => {
    let stat;
    try { stat = fs.lstatSync(target); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) { for (const entry of fs.readdirSync(target)) visit(path.join(target, entry)); return; }
    const relative = path.relative(base, target);
    if (/\.(?:pem|key|p12|pfx)$/i.test(target)) { found.push(relative); return; }
    if (stat.size > 50 * 1024 * 1024) return;
    // Only the text header matters; binary files are read as latin1.
    if (PRIVATE_KEY.test(fs.readFileSync(target, 'latin1'))) found.push(relative);
  };
  for (const entry of entries) visit(path.join(base, entry));
  return found;
}

function hasManifestKey(keys = require('../src/update-keys.cjs')) {
  return keys.some((key) => key.role === 'manifest');
}

if (require.main === module) {
  const keys = findPrivateKeys();
  if (keys.length) {
    console.error('Clé privée trouvée dans les fichiers à empaqueter : ' + keys.join(', '));
    process.exitCode = 1;
  } else if (!hasManifestKey()) {
    if (process.env.NACRE_ALLOW_KEYLESS_BUILD === '1') {
      console.warn('Build de test sans clé de mise à jour : elle ne pourra jamais se mettre à jour. Ne pas la publier.');
    } else {
      console.error('Aucune clé de mise à jour intégrée : lance `node scripts/update-keys.cjs generate`, ou NACRE_ALLOW_KEYLESS_BUILD=1 pour un simple test local.');
      process.exitCode = 1;
    }
  }
}

module.exports = { findPrivateKeys, hasManifestKey };
