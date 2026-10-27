'use strict';

const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-memory-test-'));
  const entry = path.join(profile, 'verify.cjs'); fs.copyFileSync(__filename, entry);
  const result = require('./test-support/sandboxed-electron-fixture.cjs').launch([entry], {
    env: { ...process.env, NACRE_MEMORY_TEST_ROOT: root, NACRE_MEMORY_TEST_PROFILE: profile }, encoding: 'utf8', timeout: 90000
  });
  fs.mkdirSync(path.join(root, '.cache/memory'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cache/memory/lifecycle.json'), JSON.stringify({ exitCode: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exit(result.status === 0 ? 0 : 1);
}
const { app, BaseWindow, BrowserWindow, safeStorage, webContents, ipcMain, Menu } = require('electron');
const assert = require('node:assert/strict'), Module = require('node:module');
const root = process.env.NACRE_MEMORY_TEST_ROOT, profile = process.env.NACRE_MEMORY_TEST_PROFILE;
app.setPath('userData', profile); app.setPath('appData', profile); app.setPath('sessionData', path.join(profile, 'session'));
app.whenReady().then(() => require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile, 'settings.json'), 'settings', { directMode: true, torCountry: '', adBlockEnabled: true, antiFingerprint: true, clearOnQuit: true }));
const filename = path.join(root, 'src/main.cjs'), main = new Module(filename, module);
main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={tabs,tabByContentsId,createTab,closeTab,activateTab,browserSessions,blocker:()=>blocker,chrome:()=>chromeView,window:()=>win,snapshot};', filename);
const nacre = main.exports, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 1000; i++) { if (await fn()) return; await wait(30); } throw new Error('Lifecycle timeout ' + JSON.stringify({ tabs: nacre.tabs.size, window: !!nacre.window(), visible: nacre.window()?.isVisible(), chromeUrl: nacre.chrome()?.webContents.getURL() })); }
async function run() {
  await app.whenReady(); await until(() => nacre.tabs.size > 0);
  const win = nacre.window(), chrome = nacre.chrome().webContents;
  win.show(); assert.equal(win.isVisible(), true);
  assert.ok(win instanceof BaseWindow); assert.equal(win instanceof BrowserWindow, false);
  assert.equal(win.webContents, undefined);
  const normal = nacre.tabs.values().next().value;
  const privateId = await nacre.createTab('nacre://settings/', true);
  const privateTab = nacre.tabs.get(privateId);
  await until(() => !privateTab.pageView.webContents.isLoading());
  assert.notEqual(normal.browserSession, privateTab.browserSession);
  for (const contents of [chrome, normal.pageView.webContents, privateTab.pageView.webContents]) {
    const prefs = contents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    if (contents !== normal.pageView.webContents) assert.equal(await contents.executeJavaScript('document.createElement("canvas").getContext("webgl") === null && new OffscreenCanvas(1,1).getContext("webgl2") === null'), true);
    assert.equal(contents.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp');
  }
  assert.equal(await privateTab.pageView.webContents.executeJavaScript('typeof window.nacre.onState'), 'function');
  const renderers = app.getAppMetrics().filter(metric => metric.type === 'Tab');
  assert.ok(renderers.length >= 2);
  if (process.platform === 'win32') assert.ok(renderers.every(metric => metric.sandboxed === true), 'OS sandbox is active for every renderer');
  const menuItems = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []);
  const newTabItem = menuItems.find(item => item.accelerator === 'CmdOrCtrl+T');
  assert.ok(newTabItem, 'application menu retains the new-tab shortcut');
  const tabCount = nacre.tabs.size;
  newTabItem.click(); await until(() => nacre.tabs.size === tabCount + 1 && [...nacre.tabs.values()].every(tab => tab.pageView));
  const contentCount = webContents.getAllWebContents().length;
  const mapSize = nacre.tabByContentsId.size;
  const sessionCount = nacre.browserSessions().length;
  const downloadListeners = normal.browserSession.listenerCount('will-download');
  const engine = nacre.blocker(); assert.ok(engine);
  for (let index = 0; index < 20; index++) {
    const id = await nacre.createTab('nacre://shortcuts/', false);
    const contents = nacre.tabs.get(id).pageView.webContents;
    await until(() => !contents.isLoading());
    nacre.closeTab(id, { discard: true }); await until(() => contents.isDestroyed());
  }
  assert.equal(webContents.getAllWebContents().length, contentCount);
  assert.equal(nacre.tabByContentsId.size, mapSize);
  assert.equal(nacre.browserSessions().length, sessionCount);
  assert.equal(normal.browserSession.listenerCount('will-download'), downloadListeners);
  assert.equal(nacre.blocker(), engine, 'one shared Ghostery engine throughout tab churn');
  nacre.activateTab(normal.id);
  assert.equal(nacre.snapshot().activeId, normal.id);
  win.setSize(1100, 800); win.minimize(); assert.equal(win.isMinimized(), true); win.restore();
  // Native auth prompt still accepts the renderer-free BaseWindow as parent.
  const auth = require(path.join(root, 'src/http-auth.cjs')).promptHttpAuth({ BrowserWindow, ipcMain, parent: win, contents: chrome, url: 'https://example.test/', realm: 'fixture', language: 'en' });
  await until(() => BrowserWindow.getAllWindows().length > 0);
  const prompt = BrowserWindow.getAllWindows()[0]; assert.equal(prompt.getParentWindow().id, win.id); prompt.close(); assert.equal(await auth, null);
  const owned = [chrome, ...[...nacre.tabs.values()].map(tab => tab.pageView.webContents)];
  // Keep the fixture alive to observe asynchronous native WebContents teardown.
  app.removeAllListeners('window-all-closed');
  win.close();
  await until(() => owned.every(contents => contents.isDestroyed()));
  assert.equal(nacre.tabs.size, 0); assert.equal(nacre.chrome(), null);
  assert.ok(!webContents.getAllWebContents().some(contents => owned.includes(contents)));
  console.log('MEMORY_LIFECYCLE_RESULT ' + JSON.stringify({ status: 'PASS', sandbox: true, renderers: renderers.map(({ type, sandboxed, integrityLevel }) => ({ type, sandboxed, integrityLevel })), checks: ['native window and titlebar', 'resize/minimize/restore', 'normal/private session separation', 'sandbox/contextIsolation/Node/WebGL/WebRTC', 'internal preload', 'application menu and tab activation', '20 tab open/close cycles: views, contents map, sessions and listeners return to baseline', 'one shared Ghostery engine', 'native auth parent/cancel', 'all child WebContents destroyed on close'] }));
}
run().then(() => app.quit(), error => { console.error(error.stack); app.exit(1); });
