'use strict';
// Real browser sessions, local fixture only, hidden windows and disposable data.
const fs = require('node:fs');
const path = require('node:path');
const { launch, shortWindowsPath, prepareWindowsFixtureDirectory } = require(process.env.NACRE_ELECTRON_FIXTURE_HELPER || path.join(__dirname, 'test-support/electron-fixture.cjs'));
const root = process.env.NACRE_IDENTITY_ROOT || path.resolve(__dirname, '..');
const out = path.join(root, '.cache/workspace-isolation-runtime');
fs.mkdirSync(out, { recursive: true });
if (!process.versions.electron) {
  // Electron cannot write to AppData/Temp in this validation environment; keep
  // the fixture path short inside the checkout's cache directory.
  const cacheRoot = path.join(root, '.cache', 'wi');
  prepareWindowsFixtureDirectory(cacheRoot);
  const temporaryRoot = shortWindowsPath(cacheRoot);
  const profile = fs.mkdtempSync(path.join(temporaryRoot, 'run-'));
  const entry = path.join(profile, 'verify.cjs');
  fs.copyFileSync(__filename, entry);
  const env = { ...process.env, NACRE_IDENTITY_ROOT: root, NACRE_IDENTITY_PROFILE: profile, NACRE_ELECTRON_FIXTURE_HELPER: path.join(__dirname, 'test-support', 'electron-fixture.cjs') };
  let result;
  try {
    for (const phase of ['initial', 'restart', 'legacyRemoved']) {
      result = launch([entry], { env: { ...env, NACRE_IDENTITY_PHASE: phase }, encoding: 'utf8', timeout: 180000 });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      if (result.error) process.stderr.write(result.error.message + '\n');
      if (result.status !== 0) break;
    }
  } finally {
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) !== path.resolve(temporaryRoot) || !path.basename(resolved).startsWith('run-')) throw Error('Unsafe fixture cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  process.exit(result?.status ?? 1);
}
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const { app, BrowserWindow, dialog, safeStorage, session } = require('electron');
const profile = process.env.NACRE_IDENTITY_PROFILE;
app.setPath('userData', profile); app.setPath('appData', profile); app.setPath('sessionData', path.join(profile, 'session'));
BrowserWindow.prototype.show = function () {};
app.on('web-contents-created', (_event, contents) => contents.setBackgroundThrottling(false));
let confirmation = 0;
const dialogs = [];
dialog.showMessageBox = async (_parent, options) => { dialogs.push(options); return { response: confirmation }; };
app.whenReady().then(() => { if (!fs.existsSync(path.join(profile, 'settings.json'))) require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile, 'settings.json'), 'settings', {
  directMode: true, torCountry: '', httpsOnly: false, clearOnQuit: false, adBlockEnabled: false, antiFingerprint: false,
  cookiePolicy: 'allow', language: 'en', workspaces: [{ id: 'personal', name: 'Personal' }, { id: 'work', name: 'Work' }], activeWorkspace: 'personal', welcomeDone: true
}); });
const filename = process.env.NACRE_IDENTITY_SOURCE || path.join(root, 'src/main.cjs');
const main = new Module(filename, module); main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={tabs,createTab,closeTab,navigateTab,activateTab,snapshot,browserSessions,clearData,saveSettings,configureProxy,settings:()=>settings,chrome:()=>chromeView};', filename);
const nacre = main.exports;
const checks = [], hits = [];
function progress(step) { fs.writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ phase: process.env.NACRE_IDENTITY_PHASE, step, checks })); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 250; i++) { if (await fn()) return; await wait(30); } throw Error('Timeout: ' + label); }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  hits.push({ path: url.pathname, cookie: req.headers.cookie || '', auth: Boolean(req.headers.authorization) });
  if (url.pathname === '/sw.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));'); return;
  }
  if (url.pathname === '/auth' && req.headers.authorization !== 'Basic ' + Buffer.from('fixture:identity-secret').toString('base64')) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Isolated fixture"' }); res.end('Authentication required'); return;
  }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Identity fixture</title><body>Local identity test</body>');
});
const wcFor = id => nacre.tabs.get(id).pageView.webContents;
async function loaded(wc, url) { await until(() => !wc.isDestroyed() && !wc.isLoading() && (!url || wc.getURL() === url), 'page ' + (url || '')); }
const storageScript = marker => `(async()=>{
  const marker=${JSON.stringify(marker)};
  if(marker){document.cookie='identity_marker='+marker+'; Path=/; SameSite=Lax';localStorage.setItem('identity_marker',marker);}
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('identity-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('values');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  if(marker)await new Promise((resolve,reject)=>{const t=db.transaction('values','readwrite');t.objectStore('values').put(marker,'marker');t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
  const idb=await new Promise((resolve,reject)=>{const r=db.transaction('values').objectStore('values').get('marker');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});db.close();
  if(marker){const c=await caches.open('identity-fixture');await c.put('/identity-cache',new Response(marker));await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;}
  const cached=await caches.match('/identity-cache');
  return {cookie:document.cookie,local:localStorage.getItem('identity_marker'),idb,cache:cached?await cached.text():null,workers:(await navigator.serviceWorker.getRegistrations()).length};
})()`;
async function assertState(wc, marker) {
  const value = await readStorage(wc, null);
  if (marker) { assert.match(value.cookie, new RegExp('identity_marker=' + marker)); assert.equal(value.local, marker); assert.equal(value.idb, marker); assert.equal(value.cache, marker); assert.ok(value.workers > 0); }
  else { assert.doesNotMatch(value.cookie, /identity_marker=/); assert.equal(value.local, null); assert.equal(value.idb, null); assert.equal(value.cache, null); assert.equal(value.workers, 0); }
}
async function readStorage(wc, marker) {
  const value = await wc.executeJavaScript(storageScript(marker) + '.catch(e=>({fixtureError:String(e),name:e?.name,stack:e?.stack}))');
  assert.ok(!value.fixtureError, JSON.stringify(value));
  return value;
}
async function run() {
  await app.whenReady(); await until(() => nacre.chrome() && nacre.tabs.size, 'startup');
  const phase = process.env.NACRE_IDENTITY_PHASE;
  progress('startup-ready');
  const restarting = phase !== 'initial';
  const checkpoint = restarting ? JSON.parse(fs.readFileSync(path.join(profile, 'checkpoint.json'))) : null;
  await new Promise(resolve => server.listen(checkpoint?.port || 0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const chrome = nacre.chrome().webContents;
  const api = (method, ...args) => chrome.executeJavaScript('window.nacre.' + method + '(' + args.map(value => JSON.stringify(value)).join(',') + ')');
  if (restarting) {
    checks.push(...checkpoint.checks);
    if (phase === 'legacyRemoved') {
      assert.ok(!nacre.settings().workspaces.some(item => item.id === 'personal'));
      const replacement = await nacre.createTab(origin + '/legacy-not-reused', false, { workspaceId: checkpoint.replacementId });
      await loaded(wcFor(replacement)); assert.notEqual(wcFor(replacement).session, session.fromPartition('persist:nacre'));
      await assertState(wcFor(replacement), null);
      checks.push('deleting original legacy identity stays deleted after restart; new identity never inherits its partition');
      const result = { status: 'PASS', electron: process.versions.electron, checks, limits: ['Local fixture, not network packet capture or a Tor anonymity test.', 'No installer created or host browser profile used.'] };
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
      console.log('WORKSPACE_ISOLATION_RESULT ' + JSON.stringify(result));
      return false;
    }
    const personal = await nacre.createTab(origin + '/after-quit', false, { workspaceId: 'personal' });
    const work = await nacre.createTab(origin + '/after-quit', false, { workspaceId: checkpoint.workspaceId });
    await loaded(wcFor(personal)); await loaded(wcFor(work));
    assert.equal(wcFor(personal).session, session.fromPartition('persist:nacre'));
    assert.notEqual(wcFor(work).session, wcFor(personal).session);
    await assertState(wcFor(personal), null); await assertState(wcFor(work), null);
    checks.push('restart preserves identity mapping; clear-on-quit clears storage and workers of inactive identities');
    const legacy = wcFor(personal).session;
    await legacy.cookies.set({ url: origin, name: 'legacy_retired', value: 'LEGACY_RETIRED' });
    await api('workspace', { action: 'remove', id: 'personal' });
    assert.ok(!nacre.snapshot().workspaces.items.some(item => item.id === 'personal'));
    assert.deepEqual(await legacy.cookies.get({ url: origin }), []);
    const afterRemoval = await api('workspace', { action: 'create', name: 'Personal replacement' });
    const replacementId = afterRemoval.items.find(item => item.name === 'Personal replacement').id;
    nacre.settings().clearOnQuit = false; nacre.saveSettings();
    fs.writeFileSync(path.join(profile, 'checkpoint.json'), JSON.stringify({ ...checkpoint, replacementId, checks }));
    return false;
  }
  const a = await nacre.createTab(origin + '/personal', false, { workspaceId: 'personal' });
  const awc = wcFor(a), personalSession = awc.session; await loaded(awc, origin + '/personal');
  assert.equal(awc.session, session.fromPartition('persist:nacre'));
  const b = await nacre.createTab(origin + '/work', false, { workspaceId: 'work' });
  const bwc = wcFor(b), workSession = bwc.session; await loaded(bwc, origin + '/work');
  assert.notEqual(awc.session, workSession, 'Normal workspaces must use distinct native Electron sessions');
  const { SUPPORTED_LANGUAGES, getMessages } = require(path.join(root, 'src/i18n.cjs'));
  progress('identity-pages-loaded');
  confirmation = 1;
  for (const language of SUPPORTED_LANGUAGES) {
    progress('locale-' + language);
    const messages = getMessages(language);
    await api('savePreferences', { language });
    await until(() => chrome.executeJavaScript('document.documentElement.lang===' + JSON.stringify(language) + '&&document.querySelector(".workspace-bar").dataset.language===' + JSON.stringify(language) + '&&document.querySelector("#workspace-manage").textContent===' + JSON.stringify(messages['experience.spaces'])), 'workspace locale ' + language);
    await chrome.executeJavaScript('document.querySelector("#workspace-manage").click()');
    await until(() => chrome.executeJavaScript('!!document.querySelector(".experience-dialog[open]")'), 'workspace modal');
    const notes = await chrome.executeJavaScript('[...document.querySelectorAll(".experience-dialog[open] .experience-note")].map(item=>item.textContent)');
    assert.ok(notes.includes(messages['experience.isolationNote']), language + ' isolation notice: ' + JSON.stringify({ notes, expected: messages['experience.isolationNote'] }));
    assert.ok(notes.includes(messages['experience.removeNote']), language + ' removal notice');
    assert.ok(!notes.includes(messages['experience.sharedProfile']), language + ' obsolete shared-profile notice removed');
    // Hidden windows may defer the native close event until presentation.
    // Trigger only cleanup; this fixture verifies rendered copy, not close UX.
    await chrome.executeJavaScript('{const d=document.querySelector(".experience-dialog[open]");d.close();d.dispatchEvent(new Event("close"));}');
    await until(() => chrome.executeJavaScript('!document.querySelector(".experience-dialog")'), 'closed dialog removed');
    const before = dialogs.length;
    await api('workspace', { action: 'remove', id: 'work' });
    assert.equal(dialogs.length, before + 1);
    assert.equal(dialogs.at(-1).message, messages['experience.removeNote']);
    assert.equal(dialogs.at(-1).defaultId, 1);
  }
  confirmation = 0; await api('savePreferences', { language: 'en' });
  await until(() => nacre.settings().language === 'en', 'restore English');
  checks.push('workspace modal and cancel-default removal confirmation localized in all ' + SUPPORTED_LANGUAGES.length + ' catalogues');
  await readStorage(awc, 'PERSONAL'); await assertState(bwc, null);
  await readStorage(bwc, 'WORK'); await assertState(awc, 'PERSONAL'); await assertState(bwc, 'WORK');
  await bwc.executeJavaScript('fetch("/server-cookie-work")'); await awc.executeJavaScript('fetch("/server-cookie-personal")');
  assert.match(hits.find(item => item.path === '/server-cookie-work').cookie, /identity_marker=WORK/);
  assert.match(hits.find(item => item.path === '/server-cookie-personal').cookie, /identity_marker=PERSONAL/);
  checks.push('same-origin cookies, localStorage, IndexedDB, Cache API and service workers separated; legacy identity retained');
  const personalAuth = await nacre.createTab(origin + '/auth', false, { workspaceId: 'personal' });
  await until(() => BrowserWindow.getAllWindows().some(win => win.webContents.getURL() === 'nacre://auth/'), 'personal auth prompt');
  let prompt = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === 'nacre://auth/');
  await loaded(prompt.webContents);
  await prompt.webContents.executeJavaScript('document.querySelector("#username").value="fixture";document.querySelector("#password").value="identity-secret";document.querySelector("form").requestSubmit()');
  await loaded(wcFor(personalAuth), origin + '/auth');
  const authHits = hits.length;
  const workAuth = await nacre.createTab(origin + '/auth', false, { workspaceId: 'work' });
  await until(() => BrowserWindow.getAllWindows().some(win => win.webContents.getURL() === 'nacre://auth/'), 'separate work auth prompt');
  assert.ok(hits.slice(authHits).some(item => item.path === '/auth' && !item.auth));
  assert.ok(!hits.slice(authHits).some(item => item.path === '/auth' && item.auth));
  prompt = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === 'nacre://auth/'); prompt.close();
  await nacre.closeTab(workAuth); checks.push('HTTP Basic authentication cache is not shared');
  nacre.activateTab(b);
  const sitesId = await nacre.createTab('nacre://settings/sites', false, { workspaceId: 'work', contextTabId: b });
  const sites = wcFor(sitesId); await loaded(sites);
  const context = await sites.executeJavaScript('window.nacre.getSitePermissions()');
  assert.equal(context.current.tabId, b);
  const permission = { tabId: b, origin, documentEpoch: context.current.documentEpoch, permission: 'notifications', mode: 'allow', scope: 'persistent' };
  assert.equal(await sites.executeJavaScript('window.nacre.applySitePermission(' + JSON.stringify(permission) + ')'), true);
  const cookiePolicy = { tabId: b, origin, documentEpoch: context.current.documentEpoch, policy: 'block-third-party', scope: 'persistent' };
  const personalEpoch = nacre.tabs.get(a).siteControlsEpoch || 0;
  assert.equal(await sites.executeJavaScript('window.nacre.applySiteCookies(' + JSON.stringify(cookiePolicy) + ')'), true);
  await loaded(wcFor(b));
  assert.equal(nacre.tabs.get(a).siteControlsEpoch || 0, personalEpoch, 'work cookie policy must not reload the personal document');
  const oldContents = wcFor(b);
  await api('workspace', { action: 'move', id: 'personal', tabId: b });
  await until(() => oldContents.isDestroyed() && wcFor(b) !== oldContents, 'moved view replacement');
  await loaded(wcFor(b), origin + '/work'); await assertState(wcFor(b), 'PERSONAL');
  assert.equal(await sites.executeJavaScript('window.nacre.applySitePermission(' + JSON.stringify(permission) + ')'), false);
  assert.equal((await sites.executeJavaScript('window.nacre.getSitePermissions()')).current, null);
  assert.equal(nacre.snapshot().tabs.find(tab => tab.id === b).cookieHeaderPolicy, 'allow');
  const personalSitesId = await nacre.createTab('nacre://settings/sites', false, { workspaceId: 'personal', contextTabId: b });
  await loaded(wcFor(personalSitesId));
  const personalPermissions = await wcFor(personalSitesId).executeJavaScript('window.nacre.getSitePermissions()');
  assert.equal(personalPermissions.current.permissions.find(item => item.key === 'notifications').mode, 'deny');
  await nacre.closeTab(personalSitesId);
  checks.push('move destroys document, loads destination identity and rejects stale site-control authority');
  // Leave work storage in the background; session ownership must survive no tabs.
  await nacre.closeTab(sitesId);
  for (const tab of Array.from(nacre.tabs.values())) if (tab.workspaceId === 'work') await nacre.closeTab(tab.id);
  assert.ok(nacre.browserSessions().includes(workSession));
  await workSession.fetch(origin + '/inactive-route-positive');
  const inactiveHits = hits.length;
  await nacre.configureProxy({ type: 'socks5', host: '127.0.0.1', port: 1 }, true);
  await assert.rejects(workSession.fetch(origin + '/inactive-route-blocked', { signal: AbortSignal.timeout(2500) }));
  assert.equal(hits.slice(inactiveHits).some(item => item.path === '/inactive-route-blocked'), false);
  await api('disableProxy'); await until(() => nacre.settings().directMode === true, 'restore explicit direct route');
  await workSession.fetch(origin + '/inactive-route-restored');
  checks.push('route changes cover inactive identity session with server positive and negative controls');
  const identitiesBeforeReset = nacre.settings().workspaces.map(item => item.id);
  await api('resetPreferences'); await until(() => nacre.settings().directMode === false, 'preference reset');
  assert.deepEqual(nacre.settings().workspaces.map(item => item.id), identitiesBeforeReset);
  assert.ok(nacre.browserSessions().includes(workSession));
  await api('savePreferences', { httpsOnly: false, cookiePolicy: 'allow', antiFingerprint: false });
  await until(() => nacre.settings().httpsOnly === false && nacre.settings().cookiePolicy === 'allow', 'fixture preferences after reset');
  await api('disableProxy'); await until(() => nacre.settings().directMode === true, 'route after reset');
  assert.ok((await workSession.cookies.get({ url: origin })).some(cookie => cookie.name === 'identity_marker' && cookie.value === 'WORK'));
  checks.push('preference reset preserves identity mappings and separated storage');
  confirmation = 1;
  progress('remove-workspace');
  await api('workspace', { action: 'remove', id: 'work' });
  assert.ok(nacre.snapshot().workspaces.items.some(item => item.id === 'work'));
  confirmation = 0;
  await api('workspace', { action: 'remove', id: 'work' });
  assert.ok(!nacre.snapshot().workspaces.items.some(item => item.id === 'work'));
  assert.deepEqual(await workSession.cookies.get({ url: origin }), []);
  await assert.rejects(workSession.fetch(origin + '/retired-never', { signal: AbortSignal.timeout(2500) }));
  await nacre.configureProxy({ type: 'socks5', host: '127.0.0.1', port: 1 }, true);
  await api('disableProxy'); await until(() => nacre.settings().directMode === true, 'direct with retired identity');
  await assert.rejects(workSession.fetch(origin + '/retired-after-route', { signal: AbortSignal.timeout(2500) }));
  assert.ok(!hits.some(item => item.path.startsWith('/retired-')));
  assert.ok(dialogs.some(options => /cannot be undone/i.test(options.message || '') && options.defaultId === 1));
  const recreated = await api('workspace', { action: 'create', name: 'Work again' });
  progress('replacement-created');
  const newId = recreated.items.find(item => item.name === 'Work again').id;
  const fresh = await nacre.createTab(origin + '/fresh', false, { workspaceId: newId }); await loaded(wcFor(fresh));
  assert.notEqual(wcFor(fresh).session, workSession); await assertState(wcFor(fresh), null);
  checks.push('inactive identity registered, cancel-default removal clears cookies, recreated identity does not reuse old partition');
  const p1 = await nacre.createTab(origin + '/private', true), p2 = await nacre.createTab(origin + '/private', true);
  progress('private-tabs');
  await loaded(wcFor(p1)); await loaded(wcFor(p2));
  assert.notEqual(wcFor(p1).session, wcFor(p2).session); assert.notEqual(wcFor(p1).session, personalSession);
  await assertState(wcFor(p1), null); await assertState(wcFor(p2), null);
  checks.push('private tabs remain separate in-memory sessions');
  const freshSession = wcFor(fresh).session;
  await nacre.clearData({ dataTypes: ['cookies', 'cache', 'siteData'] });
  progress('global-clear-complete');
  assert.deepEqual(await personalSession.cookies.get({ url: origin }), []);
  assert.deepEqual(await freshSession.cookies.get({ url: origin }), []);
  checks.push('explicit clearing covers all identities');
  const qa = await nacre.createTab(origin + '/before-quit', false, { workspaceId: 'personal' });
  const qb = await nacre.createTab(origin + '/before-quit', false, { workspaceId: newId });
  await loaded(wcFor(qa)); await loaded(wcFor(qb));
  await readStorage(wcFor(qa), 'BEFORE_QUIT_PERSONAL');
  await readStorage(wcFor(qb), 'BEFORE_QUIT_WORK');
  for (const tab of Array.from(nacre.tabs.values())) if (tab.workspaceId === newId) await nacre.closeTab(tab.id);
  nacre.settings().clearOnQuit = true; nacre.saveSettings();
  fs.writeFileSync(path.join(profile, 'checkpoint.json'), JSON.stringify({ port: server.address().port, workspaceId: newId, checks }));
  progress('quitting-with-background-identity');
  return true;
}
run().then(quitNormally => { server.close(); if (quitNormally) app.quit(); else app.exit(0); }, error => {
  const message = String(error?.message || error);
  if (/CacheStorage/i.test(message)) {
    console.error('FIXTURE_ENVIRONMENT_ERROR The workspace-isolation fixture could not open Chromium CacheStorage in this Windows environment: ' + message);
  }
  console.error(error);
  console.error('FIXTURE_FAILURE ' + JSON.stringify({ message, name: error?.name, stack: error?.stack }));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: /CacheStorage/i.test(message) ? 'NOT_STARTED' : 'FAIL', error: message, checks }, null, 2));
  server.close(); app.exit(1);
});
