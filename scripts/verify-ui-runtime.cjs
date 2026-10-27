'use strict';

// Exercise the real internal UI in a disposable profile. No public websites,
// Tor connection, installed profile or production source files are touched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-ui-'));
  const entry = path.join(scratch, 'verify.cjs');
  fs.copyFileSync(__filename, entry);
  const env = { ...process.env, NACRE_UI_ROOT: root, NACRE_UI_PROFILE: scratch };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [entry], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 120000
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const assert = require('node:assert/strict');
const Module = require('node:module');
const { app, BrowserWindow } = require('electron');
const root = process.env.NACRE_UI_ROOT;
const scratch = process.env.NACRE_UI_PROFILE;
const out = path.join(root, '.cache', 'ui-preview');
fs.mkdirSync(out, { recursive: true });
app.setPath('appData', scratch);
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
process.env.NACRE_PORTABLE_MODE = '0';
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({
  directMode: true, torCountry: '', httpsOnly: false, clearOnQuit: true,
  adBlockEnabled: false, language: 'fr', theme: 'light'
}));
BrowserWindow.prototype.show = function () {};
const errors = [];
app.on('web-contents-created', (_event, wc) => {
  wc.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  wc.on('render-process-gone', (_event, details) => errors.push('renderer: ' + details.reason));
});
const file = path.join(root, 'src', 'main.cjs');
const main = new Module(file, module);
main.filename = file;
main.paths = Module._nodeModulePaths(path.dirname(file));
main._compile(fs.readFileSync(file, 'utf8') + `
module.exports = { tabs, createTab, sendState,
  chrome: () => chromeView, window: () => win, preferences: () => settings,
  active: () => tabs.get(activeTabId) };
`, file);
const nacre = main.exports;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 160; i++) {
    if (await predicate()) return;
    await wait(50);
  }
  throw new Error('Timed out: ' + label);
}
const chrome = () => nacre.chrome().webContents;
const run = (source) => chrome().executeJavaScript(source);
async function click(selector) {
  await run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await wait(120);
}
async function capture(name, contents = chrome()) {
  await wait(300);
  fs.writeFileSync(path.join(out, name + '.png'), (await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}
async function home() {
  await click('#home-button');
  await until(() => run('!document.querySelector("#home").hidden'), 'new tab');
}
async function checkInternal(selector, url) {
  await home();
  await click(selector);
  await until(() => nacre.active()?.url.startsWith(url) && !nacre.active().pageView.webContents.isLoading(), url);
  const page = nacre.active().pageView.webContents;
  await until(() => page.executeJavaScript('document.documentElement.dataset.theme === "light"'), 'page theme');
  return page;
}

(async () => {
  await app.whenReady();
  await until(() => nacre.tabs.size > 0, 'app startup');
  await until(() => run('document.querySelector(".tab") && document.documentElement.dataset.theme === "light"'), 'initial UI');
  nacre.window().setSize(1280, 860);
  // Windows does not create a Viz surface for a never-shown WebContentsView.
  // Show without taking focus; the disposable window closes at the end.
  nacre.window().showInactive();
  await capture('home-light');
  assert.equal(await run('document.querySelector("#home").hidden'), false);
  assert.equal(await run('document.querySelector("#chrome").getBoundingClientRect().height'), 88);
  await run('window.nacre.saveBookmarks([{title:"Example",url:"https://example.com/",folder:""},{title:"A longer bookmark title to verify truncation",url:"https://example.org/",folder:""}])');
  await until(() => run('document.querySelectorAll(".bookmark-chip").length === 2'), 'home bookmarks');
  await capture('home-bookmarks-light');
  await click('#privacy-link');
  assert.equal(await run('document.querySelector("#about-overlay").hidden'), false);
  await capture('privacy-light');
  await click('[data-close-about]');
  await click('#protection-button');
  assert.equal(await run('document.querySelector("#protection-panel").hidden'), false);
  await capture('protection-light');
  await click('#protection-panel [data-close]');
  await click('#vpn-country-button');
  assert.equal(await run('document.querySelector("#vpn-menu").hidden'), false);
  await capture('tor-light');
  await click('#vpn-country-button');
  const count = nacre.tabs.size;
  await click('#private-tab');
  await until(() => nacre.tabs.size === count + 1 && nacre.active()?.private, 'private tab');
  assert.equal(await run('document.querySelector("#space-label").hidden'), false);
  await capture('private-light');
  await click('.tab.active .tab-close');
  await until(() => nacre.tabs.size === count, 'close tab');
  const settings = await checkInternal('#home-settings', 'nacre://settings');
  await capture('settings-light', settings);
  await settings.executeJavaScript(`document.querySelector('a[href="#appearance"]').click()`);
  await capture('appearance-light', settings);
  await settings.executeJavaScript(`const input = document.querySelector('#find-setting'); input.value = 'cookies'; input.dispatchEvent(new Event('input'));`);
  assert.ok(await settings.executeJavaScript('document.querySelectorAll(".group[hidden]").length > 0'));
  const bookmarks = await checkInternal('#home-bookmarks', 'nacre://bookmarks');
  await until(() => bookmarks.executeJavaScript('document.querySelectorAll(".bookmark").length === 2'), 'bookmarks rows');
  await capture('bookmarks-light', bookmarks);
  const downloads = await checkInternal('#home-downloads', 'nacre://downloads');
  await capture('downloads-light', downloads);
  await home();
  await run('window.nacre.savePreferences({theme:"dark"})');
  await until(() => run('document.documentElement.dataset.theme === "dark"'), 'dark theme');
  await capture('home-dark');
  nacre.window().setSize(920, 680);
  await run('window.nacre.savePreferences({fontSize:24})');
  await until(() => run('getComputedStyle(document.documentElement).fontSize === "24px"'), 'large text');
  await capture('home-compact-large-text');
  assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false);
  assert.ok(await run('document.querySelector("#address").getBoundingClientRect().width > 100'));
  await click('#vpn-country-button');
  assert.ok(await run('document.querySelector("#vpn-menu").getBoundingClientRect().bottom <= innerHeight'));
  await capture('tor-compact-large-text');
  await click('#vpn-country-button');
  await click('#home-settings');
  await until(() => nacre.active()?.url.startsWith('nacre://settings') && !nacre.active().pageView.webContents.isLoading(), 'compact settings');
  const compactSettings = nacre.active().pageView.webContents;
  await capture('settings-compact-large-text', compactSettings);
  assert.equal(await compactSettings.executeJavaScript('document.documentElement.scrollWidth > innerWidth'), false);
  assert.ok(await compactSettings.executeJavaScript('document.querySelector("aside").getBoundingClientRect().bottom <= innerHeight'));
  await home();
  for (let i = 0; i < 8; i++) await click('#new-tab');
  const activeVisible = await run(`(() => { const active = document.querySelector('.tab.active').getBoundingClientRect(); const strip = document.querySelector('.tab-list').getBoundingClientRect(); return active.left >= strip.left - 1 && active.right <= strip.right + 1; })()`);
  assert.equal(activeVisible, true);
  await capture('tabs-overflow');
  await click('#shortcuts-button');
  await until(() => nacre.active()?.url === 'nacre://shortcuts/' && !nacre.active().pageView.webContents.isLoading(), 'home search navigation');
  assert.equal(await nacre.active().pageView.webContents.executeJavaScript('document.documentElement.dataset.theme'), 'dark');
  await home();
  const server = require('node:http').createServer((_request, response) => response.end('<title>Local UI fixture</title><h1>Navigation works</h1>'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const destination = 'http://127.0.0.1:' + server.address().port + '/';
  await run(`document.querySelector('#home-query').value = ${JSON.stringify(destination)}; document.querySelector('#home-search').requestSubmit();`);
  await until(() => nacre.active()?.url === destination && !nacre.active().pageView.webContents.isLoading(), 'home search navigation');
  assert.match(await nacre.active().pageView.webContents.executeJavaScript('document.body.textContent'), /Navigation works/);
  server.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', checks: ['new-tab', 'privacy panel', 'protection panel', 'Tor menu', 'private tab and close', 'settings and search', 'populated bookmarks', 'downloads', 'light/dark themes', 'home/settings at 920px and 24px text', 'tab overflow', 'home form navigation'], screenshots: out, rendererErrors: errors }, null, 2));
  app.exit(0);
})().catch((error) => { console.error(error.stack); if (errors.length) console.error(errors); app.exit(1); });
