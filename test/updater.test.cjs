'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const verify = require('../src/update-verify.cjs');
const store = require('../src/update-state.cjs');
const { createUpdater } = require('../src/updater.cjs');
const { fixtureKeys, manifestFixture, sign } = require('../scripts/test-support/update-fixtures.cjs');

const { keys, privateKeys } = fixtureKeys();
const NOW = Date.parse('2026-11-06T12:00:00Z');
const INSTALLER = Buffer.from('signed installer bytes');
const LATEST = 'https://github.com/nacrebrowser/nacre/releases/latest/download/';

// A fake GitHub: latest/download/* redirects to a release-assets URL.
function fakeGitHub({ manifest = manifestFixture({}, INSTALLER), signers = ['main-a'], installer = INSTALLER, revocation = null, redirectTo = 'https://release-assets.githubusercontent.com/asset/' } = {}) {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const files = new Map([
    ['nacre-update.json', manifestBytes],
    ['nacre-update.json.sig', sign(manifestBytes, signers, privateKeys, verify.MANIFEST_PREFIX)],
    [manifest.artifacts[0].name, installer]
  ]);
  if (revocation) {
    const bytes = Buffer.from(JSON.stringify(revocation));
    files.set('nacre-key-revocation.json', bytes);
    files.set('nacre-key-revocation.json.sig', sign(bytes, ['rescue-a'], privateKeys, verify.REVOCATION_PREFIX));
  }
  const log = [];
  async function request(url, { signal, onRedirect }) {
    log.push(url);
    if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const name = decodeURIComponent(url.split('/').pop());
    const target = redirectTo + name;
    if (!onRedirect(target)) throw new verify.UpdateError('location', 'redirect refused');
    log.push(target);
    if (!files.has(name)) return { status: 404, body: [] };
    const bytes = files.get(name);
    return { status: 200, body: (async function* () { for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7); })() };
  }
  return { request, log, files };
}

function harness(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-updater-'));
  const spawned = [];
  let quits = 0;
  const statuses = [];
  const github = overrides.github || fakeGitHub();
  const routeState = { mode: 'tor', ready: true, ...overrides.route };
  const consentState = { value: overrides.consent || 'unset' };
  const updater = createUpdater({
    currentVersion: overrides.currentVersion || '1.1.0', platform: overrides.platform || 'win32', arch: 'x64', installKind: overrides.installKind || 'nsis',
    statePath: path.join(directory, 'update-state.json'), stagingRoot: path.join(directory, 'updates'), keys,
    route: () => routeState, consent: () => consentState.value, request: overrides.request || github.request,
    now: () => overrides.now || NOW, installGuard: overrides.installGuard || (() => ''),
    spawnInstaller: async (file, args) => {
      if (overrides.onSpawn) await overrides.onSpawn();
      if (overrides.spawnFails) throw Object.assign(new Error('spawn EPERM'), { code: 'EPERM' });
      spawned.push({ file, args });
    },
    quit: () => { quits += 1; },
    setTimer: overrides.setTimer, clearTimer: overrides.clearTimer,
    onStatus: (status) => statuses.push(status)
  });
  return { directory, updater, spawned, statuses, github, routeState, consentState, get quits() { return quits; },
    statePath: path.join(directory, 'update-state.json'), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('Tor route: check, download, verify, then install silently and restart only when asked', async () => {
  const h = harness();
  try {
    const status = await h.updater.check();
    assert.equal(status.state, 'ready');
    assert.ok(h.github.log.every((url) => verify.allowedUpdateLocation(url)), 'every hop allowed');
    assert.equal(await h.updater.installNow({ relaunch: true }), true);
    assert.deepEqual(h.spawned[0].args, ['/S', '--updated', '--force-run']);
    assert.equal(h.quits, 1);
    assert.equal(fs.readFileSync(h.spawned[0].file).toString(), INSTALLER.toString());
    const state = store.readState(h.statePath);
    assert.equal(state.pending.version, '1.1.1');
    assert.equal(state.pending.attempts, 1);
    assert.equal(await h.updater.installOnQuit(), false, 'never started twice');
  } finally { h.cleanup(); }
});

test('closing normally with a ready package installs without restarting Nacre', async () => {
  const h = harness();
  try {
    await h.updater.check();
    assert.equal(await h.updater.installOnQuit(), true);
    assert.deepEqual(h.spawned[0].args, ['/S', '--updated']);
    assert.equal(h.quits, 0);
  } finally { h.cleanup(); }
});

test('no request at all when Tor is not ready, or in Standard mode without consent', async () => {
  for (const [route, consent, expected] of [[{ mode: 'tor', ready: false }, 'allow', 'error'], [{ mode: 'direct', ready: true }, 'unset', 'consent'], [{ mode: 'direct', ready: true }, 'deny', 'disabled'], [{ mode: 'proxy', ready: true }, 'unset', 'consent']]) {
    const h = harness({ route, consent });
    try {
      const status = await h.updater.check();
      assert.equal(status.state, expected);
      assert.equal(h.github.log.length, 0, JSON.stringify(route) + consent);
    } finally { h.cleanup(); }
  }
  const h = harness({ route: { mode: 'direct', ready: true }, consent: 'allow' });
  try { assert.equal((await h.updater.check()).state, 'ready'); } finally { h.cleanup(); }
});

test('a route change during a download aborts it, removes the partial file and sends nothing more', async () => {
  let updaterRef;
  const github = fakeGitHub();
  const request = async (url, options) => {
    if (url.endsWith('.exe')) {
      updaterRef.onRouteChange();
      return { status: 200, body: (async function* () {
        yield Buffer.from('signed ');
        if (options.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        yield Buffer.from('installer bytes');
      })() };
    }
    return github.request(url, options);
  };
  const h = harness({ github, request });
  updaterRef = h.updater;
  try {
    const status = await h.updater.check();
    assert.equal(status.state, 'error');
    assert.equal(status.error, 'route-changed');
    assert.deepEqual(fs.readdirSync(path.join(h.directory, 'updates')), [], 'partial download removed');
    assert.equal(h.updater.hasReady(), false);
  } finally { h.cleanup(); }
});

test('tampered installer, refused redirect and rollback are refused without installing', async () => {
  const tampered = harness({ github: fakeGitHub({ installer: Buffer.from('signed installer bytez') }) });
  try {
    assert.equal((await tampered.updater.check()).error, 'integrity');
    assert.equal(await tampered.updater.installNow({ relaunch: false }), false);
    assert.equal(tampered.spawned.length, 0);
  } finally { tampered.cleanup(); }
  const redirected = harness({ github: fakeGitHub({ redirectTo: 'https://evil.example/' }) });
  try { assert.equal((await redirected.updater.check()).error, 'location'); } finally { redirected.cleanup(); }
  const rollback = harness();
  try {
    store.writeState(rollback.statePath, { ...store.emptyState(), highestSeen: { version: '1.1.2', issued: '2026-11-01T00:00:00Z' } });
    assert.equal((await rollback.updater.check()).error, 'rollback');
  } finally { rollback.cleanup(); }
});

test('a revocation or a newer state after staging blocks the installation at the last moment', async () => {
  const h = harness();
  try {
    assert.equal((await h.updater.check()).state, 'ready');
    store.updateState(h.statePath, (state) => ({ ...state, revokedKeyIds: ['main-a'] }));
    assert.equal(await h.updater.installNow({ relaunch: true }), false);
    assert.equal(h.spawned.length, 0);
    assert.equal(h.updater.hasReady(), false);
  } finally { h.cleanup(); }
  const advanced = harness();
  try {
    await advanced.updater.check();
    store.updateState(advanced.statePath, (state) => ({ ...state, highestSeen: { version: '1.1.3', issued: '2026-11-06T00:00:00Z' } }));
    assert.equal(await advanced.updater.installNow({ relaunch: true }), false);
    assert.equal(advanced.spawned.length, 0);
  } finally { advanced.cleanup(); }
});

test('a signed cumulative revocation list is stored for good and stops a manifest signed only by a revoked key', async () => {
  // A copy offline during the first revocation still learns it from the later, cumulative list.
  const github = fakeGitHub({ revocation: { schema: 1, type: 'revocation-list', revokedKeyIds: ['main-a', 'main-b'], issued: '2026-11-06T00:00:00Z' } });
  const h = harness({ github });
  try {
    assert.equal((await h.updater.check()).error, 'signature');
    assert.deepEqual(store.readState(h.statePath).revokedKeyIds, ['main-a', 'main-b']);
  } finally { h.cleanup(); }
});

test('the install guard (profile inside the installation folder) blocks automatic installation', async () => {
  const h = harness({ installGuard: () => 'profile-in-install-dir' });
  try {
    await h.updater.check();
    assert.equal(await h.updater.installNow({ relaunch: true }), false);
    assert.equal(h.statuses.at(-1).error, 'profile-in-install-dir');
    assert.equal(h.spawned.length, 0);
  } finally { h.cleanup(); }
});

test('failed installations are detected at startup and stop after two attempts', async () => {
  const h = harness();
  try {
    store.writeState(h.statePath, { ...store.emptyState(), pending: { version: '1.1.1', attempts: 2, startedAt: '2026-11-06T10:00:00Z' } });
    assert.equal((await h.updater.settlePreviousInstall()).error, 'install-failed');
    const status = await h.updater.check();
    assert.equal(status.state, 'available');
    assert.equal(status.error, 'install-failed');
  } finally { h.cleanup(); }
  const done = harness({ currentVersion: '1.1.1' });
  try {
    store.writeState(done.statePath, { ...store.emptyState(), pending: { version: '1.1.1', attempts: 1, startedAt: '2026-11-06T10:00:00Z' } });
    assert.equal((await done.updater.settlePreviousInstall()).state, 'updated');
    assert.equal(store.readState(done.statePath).pending, null);
  } finally { done.cleanup(); }
});

test('portable and .deb copies are only told that a version is available', async () => {
  for (const [installKind, platform] of [['portable', 'win32'], ['deb', 'linux']]) {
    const h = harness({ installKind, platform });
    try {
      const status = await h.updater.check();
      assert.equal(status.state, 'available');
      assert.equal(status.releaseUrl, 'https://github.com/nacrebrowser/nacre/releases/tag/v1.1.1');
      assert.ok(!h.github.log.some((url) => url.endsWith('.exe')));
    } finally { h.cleanup(); }
  }
});

test('an unwritable security state means no installation', async () => {
  const h = harness();
  try {
    await h.updater.check();
    fs.writeFileSync(h.statePath, 'damaged');
    assert.equal(await h.updater.installNow({ relaunch: true }), false);
    assert.equal(h.spawned.length, 0);
    assert.equal(h.statuses.at(-1).error, 'state');
  } finally { h.cleanup(); }
});

test('the installer is re-hashed right before it is started', async () => {
  const h = harness();
  try {
    await h.updater.check();
    const staged = fs.readdirSync(path.join(h.directory, 'updates'));
    const file = path.join(h.directory, 'updates', staged[0], 'Nacre-Setup-1.1.1.exe');
    fs.writeFileSync(file, crypto.randomBytes(INSTALLER.length));
    assert.equal(await h.updater.installNow({ relaunch: true }), false);
    assert.equal(h.spawned.length, 0);
  } finally { h.cleanup(); }
});

test('if the installer cannot start, Nacre stays open and reports it', async () => {
  const h = harness({ spawnFails: true });
  try {
    await h.updater.check();
    assert.equal(await h.updater.installNow({ relaunch: true }), false);
    assert.equal(h.quits, 0, 'Nacre does not quit without a running installer');
    assert.equal(h.statuses.at(-1).error, 'launch-failed');
    assert.equal(h.updater.hasReady(), true, 'the verified package is kept for a later try');
    assert.equal(h.statuses.at(-1).state, 'error', 'the failure is shown, not hidden behind "Restart to update"');
  } finally { h.cleanup(); }
});

test('a blocked installation is reported instead of the ready package', async () => {
  const h = harness({ installGuard: () => 'profile-in-install-dir' });
  try {
    await h.updater.check();
    assert.equal(await h.updater.installNow({ relaunch: true }), false);
    assert.equal(h.spawned.length, 0);
    assert.deepEqual([h.statuses.at(-1).state, h.statuses.at(-1).error], ['error', 'profile-in-install-dir']);
  } finally { h.cleanup(); }
});

test('ownership of the shared state is held until the installer has started', async () => {
  let probe;
  const h = harness({ onSpawn: async () => { probe = await store.acquireOwnership(path.join(h.directory, 'update-state.json')); } });
  try {
    await h.updater.check();
    assert.equal(await h.updater.installNow({ relaunch: false }), true);
    assert.equal(probe, null, 'another process could not take ownership during the launch');
  } finally { h.cleanup(); }
});

test('turning automatic updates off during a running check stops all later checks', async () => {
  const timers = [];
  const setTimer = (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; };
  const clearTimer = (timer) => { const index = timers.indexOf(timer); if (index !== -1) timers.splice(index, 1); };
  let updaterRef;
  const github = fakeGitHub();
  const request = async (url, options) => { if (url.endsWith('nacre-update.json')) updaterRef.stop(); return github.request(url, options); };
  const h = harness({ github, request, setTimer, clearTimer });
  updaterRef = h.updater;
  try {
    h.updater.start(1000);
    const first = timers.shift();
    first.callback();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(timers.length, 0, 'no new timer after stop()');
  } finally { h.cleanup(); }
});

test('failed downloads back off 1 h, 6 h, then 24 h instead of retrying every hour', async () => {
  const timers = [];
  const setTimer = (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; };
  const clearTimer = (timer) => { const index = timers.indexOf(timer); if (index !== -1) timers.splice(index, 1); };
  const h = harness({ github: fakeGitHub({ installer: Buffer.from('tampered bytes!!!!!!!!') }), setTimer, clearTimer });
  try {
    h.updater.start(1);
    const delays = [];
    for (let round = 0; round < 4; round += 1) {
      timers.shift().callback();
      for (let wait = 0; wait < 50 && !timers.length; wait += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      delays.push(timers[0].delay);
    }
    assert.deepEqual(delays, [3600000, 21600000, 86400000, 86400000]);
  } finally { h.updater.stop(); h.cleanup(); }
});

test('after shutdown no check starts and the current one is aborted', async () => {
  const h = harness();
  try {
    h.updater.shutdown();
    const before = h.github.log.length;
    await h.updater.check();
    assert.equal(h.github.log.length, before);
  } finally { h.cleanup(); }
});

test('a release without a package for this system is not announced', async () => {
  const manifest = manifestFixture({}, INSTALLER);
  manifest.artifacts = manifest.artifacts.filter((item) => item.platform === 'win32');
  const h = harness({ installKind: 'deb', platform: 'linux', github: fakeGitHub({ manifest }) });
  try {
    assert.equal((await h.updater.check()).state, 'current');
  } finally { h.cleanup(); }
});

test('a prepared critical update stays visible when a later check fails', async () => {
  const manifest = manifestFixture({ critical: true }, INSTALLER);
  let offline = false;
  const github = fakeGitHub({ manifest });
  const request = async (url, options) => { if (offline) throw new Error('network down'); return github.request(url, options); };
  const h = harness({ github, request });
  try {
    assert.equal((await h.updater.check()).state, 'ready');
    offline = true;
    const status = await h.updater.check();
    assert.equal(status.state, 'ready');
    assert.equal(status.critical, true);
    assert.equal(status.error, 'offline');
  } finally { h.cleanup(); }
});

test('responses are cancelled whenever reading stops early', async () => {
  let cancelled = 0;
  const github = fakeGitHub();
  const request = async (url, options) => {
    const response = await github.request(url, options);
    response.body = Object.assign(response.status === 404 ? (async function* () {})() : response.body, { cancel: () => { cancelled += 1; } });
    return response;
  };
  const h = harness({ github, request });
  try {
    await h.updater.check();
    assert.ok(cancelled >= 4, 'revocation (404), manifest, signature and installer responses are all closed');
  } finally { h.cleanup(); }
});
