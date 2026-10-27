'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalProfiles, defaultProfilePaths, DEFAULT_PROFILE_ID } = require('../src/local-profiles.cjs');

function createTestStore(root, options = {}) {
  const appDataPath = path.join(root, 'AppData');
  const defaultProfilePath = path.join(appDataPath, 'Nacre');
  fs.mkdirSync(defaultProfilePath, { recursive: true });
  return createLocalProfiles({
    appDataPath,
    defaultProfilePath,
    ...options
  });
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-local-profiles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('first run keeps the existing user data as Personal and stores the registry beside profile folders', (t) => {
  const root = temporaryRoot(t);
  const store = createTestStore(root);
  const existingSettings = path.join(root, 'AppData', 'Nacre', 'settings.json');
  fs.writeFileSync(existingSettings, '{"bookmarks":["kept"]}', 'utf8');

  const personal = store.initialize();

  assert.equal(personal.id, DEFAULT_PROFILE_ID);
  assert.equal(personal.name, 'Personal');
  assert.equal(personal.path, path.join(root, 'AppData', 'Nacre'));
  assert.equal(fs.readFileSync(existingSettings, 'utf8'), '{"bookmarks":["kept"]}');
  assert.equal(path.basename(store.registryPath), 'profiles.json');
  assert.equal(fs.existsSync(store.registryPath), true);
  assert.equal(path.relative(personal.path, store.registryPath).startsWith('..'), true);
  assert.deepEqual(store.listProfiles().map((profile) => profile.name), ['Personal']);
});

test('created profile data is separate, selection survives restart, and removal retires without deleting data', (t) => {
  const root = temporaryRoot(t);
  const ids = ['111111111111111111111111', '222222222222222222222222'];
  const store = createTestStore(root, { createId: () => ids.shift() });
  const personal = store.initialize();
  const work = store.createProfile('Work');
  const shared = store.createProfile('Shared');
  const workFile = path.join(work.path, 'settings.json');
  const sharedFile = path.join(shared.path, 'settings.json');
  fs.writeFileSync(workFile, 'work data', 'utf8');
  fs.writeFileSync(sharedFile, 'shared data', 'utf8');

  assert.notEqual(work.path, personal.path);
  assert.notEqual(shared.path, work.path);
  assert.match(path.basename(work.path), /^[a-f0-9]{24}$/);
  assert.equal(work.path.includes('Work'), false);
  assert.throws(() => store.removeProfile(DEFAULT_PROFILE_ID), /cannot be removed/);
  store.selectProfile(work.id);

  const afterRestart = createTestStore(root);
  const selected = afterRestart.initialize();
  assert.equal(selected.id, work.id);
  assert.equal(selected.path, work.path);
  assert.equal(afterRestart.getRunningProfile().id, work.id);
  assert.throws(() => afterRestart.removeProfile(work.id), /currently in use/);

  afterRestart.removeProfile(shared.id);
  assert.equal(fs.readFileSync(sharedFile, 'utf8'), 'shared data');
  assert.equal(afterRestart.listProfiles().some((profile) => profile.id === shared.id), false);
  assert.equal(afterRestart.listProfiles({ includeRetired: true }).find((profile) => profile.id === shared.id).retired, true);
  assert.throws(() => afterRestart.getProfilePath(shared.id), /not available/);
  afterRestart.restoreProfile(shared.id);
  assert.equal(afterRestart.getProfilePath(shared.id), shared.path);
  assert.equal(fs.readFileSync(workFile, 'utf8'), 'work data');
  assert.throws(() => afterRestart.removeProfile(DEFAULT_PROFILE_ID), /cannot be removed/);
});

test('names and ids cannot be used for path traversal and duplicate active names are rejected', (t) => {
  const root = temporaryRoot(t);
  const store = createTestStore(root, { createId: () => '333333333333333333333333' });
  store.initialize();

  assert.throws(() => store.createProfile('../outside'), /Profile names/);
  assert.throws(() => store.createProfile('..'), /Profile names/);
  assert.throws(() => store.selectProfile('../outside'), /not available/);
  assert.throws(() => store.getProfilePath('..\\outside'), /Invalid local profile id/);
  const work = store.createProfile('Work');
  assert.throws(() => store.createProfile('work'), /already exists/);
  assert.equal(fs.existsSync(path.join(root, 'outside')), false);
  assert.equal(work.path, path.join(root, 'AppData', 'Nacre-profiles', 'data', work.id));
});

test('malformed registry is preserved for recovery and defaults to the existing Personal profile', (t) => {
  const root = temporaryRoot(t);
  const initial = createTestStore(root);
  const defaultDataPath = path.join(root, 'AppData', 'Nacre');
  const existingSettings = path.join(defaultDataPath, 'settings.json');
  fs.writeFileSync(existingSettings, 'legacy settings', 'utf8');
  fs.mkdirSync(path.dirname(initial.registryPath), { recursive: true });
  fs.writeFileSync(initial.registryPath, '{broken json', 'utf8');

  const recovered = createTestStore(root);
  const profile = recovered.initialize();

  assert.equal(profile.id, DEFAULT_PROFILE_ID);
  assert.equal(profile.path, defaultDataPath);
  assert.equal(fs.readFileSync(existingSettings, 'utf8'), 'legacy settings');
  assert.equal(JSON.parse(fs.readFileSync(recovered.registryPath, 'utf8')).selectedProfileId, DEFAULT_PROFILE_ID);
  assert.ok(fs.readdirSync(path.dirname(recovered.registryPath)).some((name) => name.startsWith('profiles.json.corrupt-')));
  assert.equal(fs.readdirSync(path.dirname(recovered.registryPath)).some((name) => name.endsWith('.tmp')), false);
});

test('registry path fields and unsafe profile ids are ignored instead of becoming data paths', (t) => {
  const root = temporaryRoot(t);
  const store = createTestStore(root);
  const registry = store.registryPath;
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  fs.writeFileSync(registry, JSON.stringify({
    version: 1,
    selectedProfileId: '../outside',
    profiles: [
      { id: 'personal', name: 'Hijacked', path: path.join(root, 'outside') },
      { id: '../outside', name: 'Outside', path: path.join(root, 'outside') },
      { id: '444444444444444444444444', name: 'Work', path: path.join(root, 'outside') }
    ]
  }), 'utf8');

  const loaded = createTestStore(root);
  const selected = loaded.initialize();

  assert.equal(selected.id, DEFAULT_PROFILE_ID);
  assert.deepEqual(loaded.listProfiles().map((profile) => profile.name), ['Personal', 'Work']);
  assert.equal(loaded.getProfilePath('444444444444444444444444'), path.join(root, 'AppData', 'Nacre-profiles', 'data', '444444444444444444444444'));
  assert.equal(fs.existsSync(path.join(root, 'outside')), false);
  assert.equal(JSON.parse(fs.readFileSync(registry, 'utf8')).profiles[0].name, 'Personal');
});

test('profile path defaults require absolute app data paths and reject overlapping storage roots', () => {
  assert.throws(() => defaultProfilePaths({ appDataPath: 'relative' }), /absolute/);
  assert.throws(() => createLocalProfiles({ defaultProfilePath: path.resolve('profile'), registryPath: path.join(path.resolve('profile'), 'profiles.json') }), /outside/);
});
