'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const between = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));

test('a Tor connection invalidates updater work before any asynchronous step', () => {
  const connect = between('async function connectTorImpl(country) {', 'sendState();');
  assert.match(connect, /torConnectingCountry = country;\n  noteRouteChange\(\);/);
  assert.doesNotMatch(connect.slice(0, connect.indexOf('noteRouteChange')), /await/, 'no await before the updater is stopped');
});

test('updater requests recheck the route before following a redirect, and have deadlines', () => {
  const request = between('async function updaterRequest(', '// The update installer replaces');
  assert.match(request, /request\.on\('redirect'[\s\S]*?updateRouteSignature\(\) !== signature\) fail\(abortError\(\)\)/);
  assert.match(request, /arm\(UPDATE_RESPONSE_TIMEOUT\)/);
  assert.match(request, /incoming\.on\('data', \(\) => arm\(UPDATE_IDLE_TIMEOUT\)\)/);
  assert.match(request, /redirect: 'manual'/);
  assert.doesNotMatch(request, /browserSessions\(\)/, 'the updater session stays out of the browser sessions');
});

test('proxy authentication for updates answers only the configured proxy, once', () => {
  const login = between("request.on('login'", "request.on('redirect'");
  assert.match(login, /proxyAuthTried \|\| !authInfo\.isProxy \|\| route\.mode !== 'proxy'/);
  assert.match(login, /String\(authInfo\.host\)\.toLowerCase\(\) !== proxy\.host \|\| Number\(authInfo\.port\) !== proxy\.port\) return callback\(\)/);
});

test('the install guard covers every folder the installer would wipe, downloads included', () => {
  const guard = between('function updateInstallGuard() {', 'function publicUpdateStatus()');
  for (const item of ["app.getPath('userData')", 'updateStagingRoot()', 'updateStatePath()', 'pointerTarget', 'settings.downloadDirectory', 'localProfiles.registryPath', 'localProfiles.profilesDirectory']) {
    assert.ok(guard.includes(item), item);
  }
  const chooser = between("ipcMain.on('nacre:choose-download-directory'", "ipcMain.on('nacre:choose-profile-location'");
  assert.match(chooser, /isPathInside\(path\.dirname\(app\.getPath\('exe'\)\), result\.filePaths\[0\]\)\) \{\n\s+tell\(/);
});

test('closing Nacre stops updater network work first; the installer is awaited before quitting', () => {
  const quit = between("app.on('before-quit'", "app.on('window-all-closed'");
  assert.match(quit, /quittingAfterClear = true;\n  if \(updater\) updater\.shutdown\(\);/);
  assert.match(main, /child\.once\('error', reject\);\n\s+child\.once\('spawn', \(\) => \{ child\.unref\(\); resolve\(\); \}\);/);
});

test('only the verified release page can be opened from the update controls', () => {
  const action = between("ipcMain.handle('nacre:update-action'", "ipcMain.handle('nacre:get-site-permissions'");
  assert.match(action, /\^https:\\\/\\\/github\\\.com\\\/nacrebrowser\\\/nacre\\\/releases\\\/tag\\\/v\\d\+\\\.\\d\+\\\.\\d\+\$/);
  assert.match(action, /isTrustedUIEvent\(event\)/);
});

test('a route change in progress blocks every updater request until it has finished', () => {
  assert.match(main, /function updateRoute\(\) \{\n  if \(routeTransitions > 0\) return \{ mode: 'transition', ready: false \};/);
  const connect = between('async function connectTorImpl(country) {', 'async function connectTorRoute(country) {');
  assert.match(connect, /routeTransitions \+= 1;\n  noteRouteChange\(\);\n  try \{ return await connectTorRoute\(country\); \}\n  finally \{ routeTransitions -= 1; \}/);
  const proxy = between('async function configureProxyImpl(payload, enabled) {', 'async function configureProxyRoute(payload, enabled) {');
  assert.match(proxy, /routeTransitions \+= 1;\n  noteRouteChange\(\);/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/updater.cjs'), 'utf8'), /if \(current\.mode === 'transition'\) return \{ state: 'error', error: 'offline' \};/);
});

test('Electron responses are read through their events, never as a Node stream', () => {
  const request = between('async function updaterRequest(', '// The update installer replaces');
  assert.match(request, /body = incomingBody\(incoming\);/);
  assert.match(request, /resolve\(\{ status: incoming\.statusCode, body \}\)/);
  assert.doesNotMatch(request, /response\.destroy|incoming\.destroy/);
});

test('incomingBody yields chunks, ends cleanly and propagates failures', async () => {
  const { EventEmitter } = require('node:events');
  const source = between('function incomingBody(incoming) {', 'function abortError() {');
  class UpdateError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const incomingBody = new Function('Buffer', 'abortError', 'UpdateError', 'const UPDATE_BUFFER_LIMIT = 64;\n' + source + '\nreturn incomingBody;')(Buffer, () => Object.assign(new Error('aborted'), { name: 'AbortError' }), UpdateError);
  const ok = new EventEmitter();
  const body = incomingBody(ok);
  setTimeout(() => { ok.emit('data', Buffer.from('ab')); ok.emit('data', Buffer.from('c')); ok.emit('end'); }, 5);
  const parts = [];
  for await (const chunk of body) parts.push(chunk.toString());
  assert.equal(parts.join(''), 'abc');
  const broken = new EventEmitter();
  const failing = incomingBody(broken);
  setTimeout(() => { broken.emit('data', Buffer.from('x')); failing.fail(new Error('timeout')); }, 5);
  await assert.rejects(async () => { for await (const _chunk of failing) { /* drain */ } }, /timeout/);
  const flood = new EventEmitter();
  const flooded = incomingBody(flood);
  flood.emit('data', Buffer.alloc(100));
  await assert.rejects(async () => { for await (const _chunk of flooded) { /* drain */ } }, { code: 'size' }, 'the buffer is bounded');
});

test('downloads saved by hand and leftover profiles inside the installation folder block updates', () => {
  const guard = between('function updateInstallGuard() {', 'function publicUpdateStatus()');
  assert.match(guard, /Array\.from\(downloads\.values\(\), \(record\) => record\.path\)/);
  assert.match(guard, /installFolderHoldsProfile\(installDirectory\)/);
  assert.match(main, /if \(updateInstallKind\(\) === 'nsis' && isPathInside\(path\.dirname\(app\.getPath\('exe'\)\), result\.filePath\)\) \{\n\s+tell\(/);
});
