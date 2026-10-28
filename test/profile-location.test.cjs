'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { configuredUserDataPath, writeProfileLocation } = require('../src/profile-location.cjs');

test('le mode portable utilise NacreData à côté du binaire par défaut', () => {
  const apps = path.resolve('/Apps/Nacre');
  const resolved = configuredUserDataPath({ portable: true, executablePath: path.join(apps, 'Nacre.exe'), appDataPath: path.resolve('/Users/Test/AppData'), readFileSync: () => { throw Error(); } });
  assert.equal(resolved, path.join(apps, 'NacreData'));
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

test('a profile cannot be placed inside the installation folder, which updates replace', (t) => {
  const { isPathInside } = require('../src/profile-location.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const install = path.join(root, 'Programs', 'Nacre');
  fs.mkdirSync(install, { recursive: true });
  assert.equal(isPathInside(install, path.join(install, 'Profile')), true);
  assert.equal(isPathInside(install, install), true);
  assert.equal(isPathInside(install, path.join(root, 'Programs', 'NacreData')), false, 'a sibling with a common prefix is outside');
  assert.equal(isPathInside(install, path.join(root, 'Elsewhere')), false);
  assert.equal(isPathInside('C:\\Programs\\Nacre', 'c:\\programs\\nacre\\x', 'win32'), process.platform === 'win32');
  const pointer = path.join(root, 'Nacre', 'profile-location.json');
  assert.throws(() => writeProfileLocation(pointer, path.join(install, 'Profile'), fs, install), /dossier d’installation/);
  assert.equal(writeProfileLocation(pointer, path.join(root, 'Profile'), fs, install), path.join(root, 'Profile'));
});

test('a child folder whose name starts with two dots is still inside', (t) => {
  const { isPathInside } = require('../src/profile-location.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-dots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(isPathInside(root, path.join(root, '..profile')), true);
  assert.equal(isPathInside(root, path.join(root, '..', 'sibling')), false);
  assert.equal(isPathInside(path.join(root, 'a'), path.dirname(root)), false);
});
