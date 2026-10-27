'use strict';

// Development-only: exercise real settings change events in Electron with an
// isolated profile, without opening public websites or the installed profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const root = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-languages-'));
  const entry = path.join(scratch, 'verify.cjs');
  fs.copyFileSync(__filename, entry);
  const env = { ...process.env, NACRE_LANGUAGE_ROOT: root, NACRE_LANGUAGE_PROFILE: scratch };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [entry], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 90000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const assert = require('node:assert/strict');
const Module = require('node:module');
const { app, BrowserWindow, Menu } = require('electron');
const root = process.env.NACRE_LANGUAGE_ROOT;
const scratch = process.env.NACRE_LANGUAGE_PROFILE;
app.setPath('appData', scratch);
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
process.env.NACRE_PORTABLE_MODE = '0';
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ directMode: true, torCountry: '', adBlockEnabled: false, language: 'en' }));
BrowserWindow.prototype.show = function () {};
const file = path.join(root, 'src', 'main.cjs');
const main = new Module(file, module);
main.filename = file;
main.paths = Module._nodeModulePaths(path.dirname(file));
main._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports = { createTab, chrome: () => chromeView, active: () => tabs.get(activeTabId) };\n', file);
const nacre = main.exports;
const { getMessages } = require(path.join(root, 'src', 'i18n.cjs'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 160; i++) { if (await predicate()) return; await wait(50); }
  throw Error('Timed out: ' + label);
}
const results = [];
async function mainTest() {
  await app.whenReady();
  await until(() => nacre.active(), 'startup');
  await nacre.createTab('nacre://settings/');
  await until(() => nacre.active()?.pageView.webContents.getURL() === 'nacre://settings/' && !nacre.active().pageView.webContents.isLoading(), 'settings load');
  const page = nacre.active().pageView.webContents;
  const chrome = nacre.chrome().webContents;
  await until(() => page.executeJavaScript('document.documentElement.lang === "en" && Boolean(window.nacre)'), 'initial language');
  assert.deepEqual(await page.executeJavaScript('Array.from(document.querySelector("#language").options, item => item.value)'), ['en','fr','de','es']);
  for (const language of ['fr','de','es','en']) {
    const messages = getMessages(language);
    await page.executeJavaScript(`document.querySelector('#language').value = ${JSON.stringify(language)}; document.querySelector('#language').dispatchEvent(new Event('change', { bubbles: true }));`);
    await until(() => page.executeJavaScript(`document.documentElement.lang === ${JSON.stringify(language)} && document.querySelector('[data-i18n="settings.language"]').textContent === ${JSON.stringify(messages['settings.language'])}`), language + ' settings');
    await until(() => chrome.executeJavaScript(`document.documentElement.lang === ${JSON.stringify(language)} && document.querySelector('#address').placeholder === ${JSON.stringify(messages['address.placeholder'])}`), language + ' browser toolbar');
    assert.equal(Menu.getApplicationMenu().items[0].label, messages['menu.file']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).language, language);
    results.push({ scenario: `${language}: settings, toolbar, native menu, persisted preference`, status: 'PASS' });
  }
  // Reopening settings must use the stored preference, without restarting Nacre.
  await nacre.createTab('nacre://settings/');
  await until(() => !nacre.active().pageView.webContents.isLoading() && nacre.active().pageView.webContents.getURL() === 'nacre://settings/', 'reopened settings');
  await until(() => nacre.active().pageView.webContents.executeJavaScript('document.documentElement.lang === "en" && document.querySelector("#language").value === "en"'), 'reopened language');
  results.push({ scenario: 'new settings tab retains the selected language', status: 'PASS' });
}
mainTest().then(() => finish(0), error => { results.push({ status: 'FAIL', error: error.stack }); finish(1); });
function finish(code) {
  const directory = path.join(root, '.cache', 'languages-fix');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'electron-runtime.json'), JSON.stringify({ results }, null, 2));
  console.log(JSON.stringify({ results }, null, 2));
  app.exit(code);
}
