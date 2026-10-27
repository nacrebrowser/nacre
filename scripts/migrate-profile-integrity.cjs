'use strict';
// Explicit, offline trust-on-first-use migration. Never called by app startup.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const profile = process.argv[process.argv.indexOf('--profile') + 1];
if (!process.argv.includes('--profile') || !process.argv.includes('--accept-unsigned') || !profile || !path.isAbsolute(profile)) throw new Error('Usage: node scripts/migrate-profile-integrity.cjs --profile ABSOLUTE_PATH --accept-unsigned');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const { app, safeStorage } = require('electron');
app.setName('Nacre'); app.setPath('userData', profile);
app.whenReady().then(() => {
  const file = path.join(profile, 'settings.json');
  if (fs.statSync(file).size > 5_000_000) throw new Error('Profile too large');
  const raw = fs.readFileSync(file, 'utf8');
  const stored = JSON.parse(raw);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || Object.hasOwn(stored, 'payload') || Object.hasOwn(stored, 'hmac')) throw new Error('Expected legacy unsigned settings object');
  fs.copyFileSync(file, file + '.before-integrity-' + Date.now(), fs.constants.COPYFILE_EXCL);
  require('../src/profile-integrity.cjs').createProfileIntegrity(profile, safeStorage).write(file, 'settings', stored);
  console.log('Legacy settings explicitly accepted, backed up and signed.');
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
