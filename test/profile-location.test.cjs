'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { configuredUserDataPath, writeProfileLocation } = require('../src/profile-location.cjs');

test('le mode portable utilise NacreData à côté du binaire par défaut', () => {
  const resolved = configuredUserDataPath({ portable: true, executablePath: 'C:\\Apps\\Nacre\\Nacre.exe', appDataPath: 'C:\\Users\\Test\\AppData', readFileSync: () => { throw Error(); } });
  assert.equal(resolved, path.join('C:\\Apps\\Nacre', 'NacreData'));
});

test('un chemin de profil choisi est mémorisé et prioritaire au prochain démarrage', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pointer = path.join(root, 'Nacre', 'profile-location.json');
  const chosen = path.join(root, 'elsewhere', 'Profile');
  assert.equal(writeProfileLocation(pointer, chosen, fs), path.resolve(chosen));
  assert.equal(configuredUserDataPath({ portable: false, executablePath: path.join(root, 'Nacre.exe'), appDataPath: root, readFileSync: fs.readFileSync.bind(fs) }), path.resolve(chosen));
});

test('le mode portable ignore le pointeur de profil de la version installée', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pointer = path.join(root, 'Nacre', 'profile-location.json');
  writeProfileLocation(pointer, path.join(root, 'elsewhere', 'Profile'), fs);
  const exe = path.join(root, 'portable', 'Nacre.exe');
  assert.equal(configuredUserDataPath({ portable: true, executablePath: exe, appDataPath: root, readFileSync: fs.readFileSync.bind(fs) }), path.join(root, 'portable', 'NacreData'));
});

test('refuse un chemin de profil relatif', () => {
  assert.throws(() => writeProfileLocation('unused', 'relative-profile', fs), /absolu/);
});
