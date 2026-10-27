'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch } = require('./test-support/electron-fixture.cjs');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const parent = path.join(root, '.cache'); fs.mkdirSync(parent, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(parent, 'privacy-center-'));
  try {
    for (const phase of ['personal', 'work', 'unlock']) {
      const env = { ...process.env, NACRE_PRIVACY_FIXTURE: fixture, NACRE_PRIVACY_PHASE: phase };
      const child = launch([__filename], { cwd: root, env, encoding: 'utf8', timeout: 90000 });
      process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
      assert.equal(child.status, 0, phase + ': ' + child.error);
    }
    console.log('PRIVACY CENTER: all three real Electron phases passed');
  } finally {
    if (path.dirname(path.resolve(fixture)) !== path.resolve(parent)) throw Error('Unsafe fixture cleanup');
    fs.rmSync(fixture, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow, safeStorage } = require('electron');
  const fixture = process.env.NACRE_PRIVACY_FIXTURE, phase = process.env.NACRE_PRIVACY_PHASE;
  const personal = path.join(fixture, 'personal'); fs.mkdirSync(personal, { recursive: true });
  app.setPath('userData', personal); app.setPath('sessionData', personal); app.setPath('appData', fixture);
  const password = 'Fixture only password 493!'; let prompts = 0;
  app.on('web-contents-created', (_event, wc) => wc.on('did-finish-load', () => {
    if (!wc.getURL().endsWith('/vault-prompt.html')) return;
    prompts++;
    setTimeout(() => wc.executeJavaScript(`document.querySelector('#password').value=${JSON.stringify(phase === 'unlock' && prompts === 1 ? 'wrong password' : password)};document.querySelector('#repeat').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit();`).catch(() => {}), 100);
  }));
  app.whenReady().then(() => {
    const registryPath = path.join(fixture, 'Nacre-profiles', 'profiles.json');
    const id = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf8')).selectedProfileId : 'personal';
    const data = id === 'personal' ? personal : path.join(fixture, 'Nacre-profiles', 'data', id);
    fs.mkdirSync(data, { recursive: true });
    if (!fs.existsSync(path.join(data, 'settings.json'))) require('../src/profile-integrity.cjs').createProfileIntegrity(data, safeStorage).write(path.join(data, 'settings.json'), 'settings', { language: 'en', directMode: true, torCountry: '', torAutoStart: false, clearOnQuit: false, httpsOnly: false, adBlockEnabled: false, bookmarks: [] });
  });
  const Module = require('node:module'), filename = path.join(root, 'src/main.cjs');
  const main = new Module(filename, module); main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
  main._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={tabs,createTab,settings:()=>settings,chrome:()=>chromeView};', filename);
  const nacre = main.exports;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(fn) { for (let i = 0; i < 600; i++) { if (await fn()) return; await wait(25); } throw Error('Timed out waiting for app state'); }
  app.whenReady().then(async () => {
    await until(() => nacre.chrome());
    const id = await nacre.createTab('nacre://settings/#privacy-check'); const wc = nacre.tabs.get(id).pageView.webContents;
    await until(() => !wc.isLoading());
    const run = source => wc.executeJavaScript(source);
    const invoke = (action, data) => run(`window.nacre.privacyCenter(${JSON.stringify(action)},${JSON.stringify(data)})`);
    await until(() => run('!!document.querySelector("#privacy-findings .card")'));
    let snapshot = await invoke('snapshot');
    assert.equal(await run('document.querySelector("#privacy-check").hidden'), false);
    if (phase === 'personal') {
      assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false, 'privacy controls fit the settings view');
      await invoke('apply', 'httpsOnly'); assert.equal(nacre.settings().httpsOnly, true);
      await run('window.nacre.saveBookmarks([{title:"Personal secret",url:"https://example.org/"}])');
      await invoke('profile-create', 'Work'); snapshot = await invoke('snapshot');
      assert.ok(snapshot.profiles.some(p => p.name === 'Work'));
      await invoke('vault-enable');
      assert.equal((await invoke('snapshot')).vaultEnabled, true);
      assert.ok(!fs.readFileSync(path.join(personal, 'settings.json'), 'utf8').includes('Personal secret'));
      await invoke('profile-select', snapshot.profiles.find(p => p.name === 'Work').id);
    } else if (phase === 'work') {
      assert.equal(nacre.settings().bookmarks.length, 0);
      assert.ok(snapshot.profiles.find(p => p.name === 'Work').active);
      await invoke('profile-select', 'personal');
    } else {
      assert.equal(prompts, 2, 'wrong password must cause a second prompt');
      assert.equal(nacre.settings().bookmarks[0].title, 'Personal secret');
      await invoke('vault-disable');
      assert.equal((await invoke('snapshot')).vaultEnabled, false);
      assert.ok(fs.readFileSync(path.join(personal, 'settings.json'), 'utf8').includes('Personal secret'));
    }
    console.log('PASS real Electron phase: ' + phase);
    app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
