'use strict';

// Runs the unmodified Windows executable through loopback CDP in a disposable
// profile. CDP is enabled ONLY for this test; no production source is replaced.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { verifyPinnedTorFiles } = require('../src/tor-integrity.cjs');
const { loadFuseApi, verifyFuseWire } = require('./electron-fuse-policy.cjs');
const asar = require(require.resolve('@electron/asar', { paths: [require.resolve('electron-builder')] }));
const root = path.resolve(__dirname, '..');
const dir = path.resolve(process.argv[2] || 'dist/win-unpacked');
const exe = path.join(dir, 'Nacre.exe');
const archive = path.join(dir, 'resources', 'app.asar');
const reportNames = { 'stabilized-final': 'windows-package-stabilized-final.json', stabilized: 'windows-package-stabilized.json', reviewed: 'windows-package-reviewed.json', final: 'windows-package-final.json' };
const reportName = Object.hasOwn(reportNames, process.argv[3]) ? reportNames[process.argv[3]] : 'windows-package.json';
const out = path.resolve(root, process.argv[4] || path.join('.cache', 'security-051', reportName));
if (!out.startsWith(path.join(root, '.cache') + path.sep)) throw new Error('Package evidence must stay in the workspace cache');
fs.mkdirSync(path.dirname(out), { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-package-051-'));
const profile = path.join(scratch, 'profile');
const results = [];
const requests = [];
const sessions = [];
let child, stderr = '', origin, frameOrigin;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 250; i++) { const value = await fn(); if (value) return value; await wait(40); }
  throw new Error('Timed out: ' + label);
}
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; }
}
function cdp(url) {
  const ws = new WebSocket(url);
  const pending = new Map(); let id = 0;
  const ready = new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id); clearTimeout(timer);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  });
  const api = {
    async call(method, params = {}) {
      await ready;
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timeout: ' + method)); }, 10000);
        pending.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    async evaluate(expression, extra = {}) {
      const result = await api.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close() { ws.close(); }
  };
  sessions.push(api); return api;
}
const server = http.createServer((req, res) => {
  requests.push({ url: req.url, cookie: req.headers.cookie || '' });
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(req.url === '/parent' ? `<title>Packaged fixture</title><iframe src="${frameOrigin}/child"></iframe>` : '<title>Packaged fixture</title>');
});
const frameServer = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Frame</title>'); });
async function main() {
  await check('All packaged src files equal the tested working source', async () => {
    let files = 0;
    const workspacePaths = [];
    function walk(relative) {
      for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const name = relative + '/' + entry.name;
        if (entry.isDirectory()) walk(name);
        else { assert.deepEqual(asar.extractFile(archive, path.normalize(name)), fs.readFileSync(path.join(root, name)), name); workspacePaths.push(name); files++; }
      }
    }
    walk('src');
    assert.ok(files > 80);
    const packagedPaths = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')).filter(name => name.startsWith('src/') && !asar.statFile(archive, path.normalize(name)).files);
    assert.deepEqual(packagedPaths.sort(), workspacePaths.sort(), 'extra or missing packaged source file');
    console.log('Matched source files:', files);
    const packagedInfo = JSON.parse(asar.extractFile(archive, 'package.json'));
    const sourceInfo = require('../package.json');
    for (const key of ['name', 'version', 'main', 'dependencies']) assert.deepEqual(packagedInfo[key], sourceInfo[key], key);
    assert.deepEqual(asar.extractFile(archive, 'PRIVACY.md'), fs.readFileSync(path.join(root, 'PRIVACY.md')));
  });
  await check('Packaged executable fuses and Tor resources match security policy', async () => {
    assert.equal(verifyFuseWire(await loadFuseApi().getCurrentFuseWire(exe)), true);
    assert.equal(verifyPinnedTorFiles(path.join(dir, 'resources', 'tor')).valid, true);
    assert.equal(asar.listPackage(archive).some(file => file.replaceAll('\\', '/').includes('/sprintf-js/')), false);
  });
  // Refuse to run if a preexisting custom-profile pointer could override the
  // command-line disposable profile. Never alter that pointer.
  const actualPointer = path.join(process.env.APPDATA, 'Nacre', 'profile-location.json');
  assert.equal(fs.existsSync(actualPointer), false, 'Custom installed profile pointer present; native test requires explicit isolation');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    directMode: true, torCountry: '', httpsOnly: false, clearOnQuit: false,
    language: 'en', adBlockEnabled: false, cookiePolicy: 'allow', antiFingerprint: false
  }));
  await Promise.all([new Promise(resolve => server.listen(0, '127.0.0.1', resolve)), new Promise(resolve => frameServer.listen(0, '127.0.0.1', resolve))]);
  origin = 'http://127.0.0.1:' + server.address().port;
  frameOrigin = 'http://127.0.0.1:' + frameServer.address().port;
  const env = { ...process.env, NACRE_PORTABLE_MODE: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(exe, ['--user-data-dir=' + profile, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', () => {});
  const browserUrl = await until(() => /DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(stderr)?.[1], 'packaged CDP listener');
  const browser = cdp(browserUrl);
  const port = new URL(browserUrl).port;
  async function target(url) {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    return list.find(item => item.url === url && item.webSocketDebuggerUrl);
  }
  const chrome = cdp((await until(() => target('nacre://app/'), 'packaged chrome')).webSocketDebuggerUrl);
  await until(() => chrome.evaluate('!!window.nacre'), 'packaged privileged preload');
  await chrome.evaluate('window.packageState = null; window.nacre.onState(state => { window.packageState = state; }); window.nacre.savePreferences({theme:"dark"})');
  await until(() => chrome.evaluate('window.packageState'), 'packaged state');
  // Chrome may publish its first snapshot before asynchronous session setup
  // has created the initial tab. Navigation has no target until that completes.
  await until(() => chrome.evaluate('Number.isSafeInteger(window.packageState.activeId) && window.packageState.tabs.some(tab=>tab.id===window.packageState.activeId)'), 'packaged initial tab ready');
  await check('Actual EXE uses only the disposable profile', async () => {
    assert.equal((await chrome.evaluate('window.packageState.settings.profileLocation')).toLowerCase(), profile.toLowerCase());
  });
  await chrome.evaluate('window.nacre.navigate(' + JSON.stringify(origin + '/parent') + ')');
  const page = cdp((await until(() => target(origin + '/parent'), 'packaged fixture')).webSocketDebuggerUrl);
  await page.call('Page.enable');
  await check('Packaged omnibox ignores real cross-origin iframe hash changes', async () => {
    const frame = await until(async () => (await page.call('Page.getFrameTree')).frameTree.childFrames?.[0]?.frame, 'packaged child frame');
    const world = await page.call('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'package-regression' });
    await page.evaluate('location.hash="package-spoof"', { contextId: world.executionContextId });
    await wait(200);
    assert.equal(await chrome.evaluate('window.packageState.active.url'), origin + '/parent');
    assert.equal(await chrome.evaluate('document.querySelector("#address").value'), origin + '/parent');
    assert.equal(await chrome.evaluate('window.packageState.active.secure'), false);
  });
  await page.evaluate('document.cookie="regular_package_cookie=must-not-leak; Path=/"');
  await check('Packaged quick cookie toggle changes the effective policy and real HTTP traffic', async () => {
    await chrome.evaluate('window.nacre.savePreferences({cookiePolicy:"block-all"})');
    await until(() => chrome.evaluate('window.packageState.settings.cookiePolicy === "block-all"'), 'packaged block-all setting');
    await page.evaluate('fetch("/cookie-mode-blocked", {credentials:"include"}).then(r => r.text())');
    assert.equal(requests.find(r => r.url === '/cookie-mode-blocked').cookie, '', 'block-all negative control');
    await chrome.evaluate('document.querySelector(\'[data-setting="blockThirdPartyCookies"]\').click()');
    await until(() => chrome.evaluate('window.packageState.settings.blockThirdPartyCookies === false'), 'packaged quick cookie toggle');
    await page.evaluate('fetch("/cookie-mode-allowed", {credentials:"include"}).then(r => r.text())');
    assert.match(requests.find(r => r.url === '/cookie-mode-allowed').cookie, /regular_package_cookie=must-not-leak/, 'clicked allow mode permits real cookie traffic');
    assert.equal(await chrome.evaluate('window.packageState.settings.cookiePolicy'), 'allow');
    await chrome.evaluate('document.querySelector(\'[data-setting="blockThirdPartyCookies"]\').click()');
    await until(() => chrome.evaluate('window.packageState.settings.blockThirdPartyCookies === true'), 'packaged quick cookie reactivation');
    assert.equal(await chrome.evaluate('window.packageState.settings.cookiePolicy'), 'block-third-party');
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
    assert.equal(saved.cookiePolicy, 'block-third-party');
    assert.equal(saved.blockThirdPartyCookies, true);
  });
  if (require('../package.json').version.startsWith('0.6.')) await check('Packaged workspace, vertical tabs, command palette and split controls execute real actions', async () => {
    const originalId=await chrome.evaluate('window.packageState.activeId');
    await chrome.evaluate('window.nacre.workspace({action:"create",name:"Package workspace"})');
    const workspaceId=await until(()=>chrome.evaluate('window.packageState.workspaces.items.find(x=>x.name==="Package workspace")?.id'),'packaged workspace');
    await chrome.evaluate('window.nacre.savePreferences({verticalTabs:true})');
    await until(()=>chrome.evaluate('document.querySelector("#workspace-select").value==='+JSON.stringify(workspaceId)),'workspace selector');
    await chrome.evaluate('window.nacre.navigate('+JSON.stringify(origin+'/workspace-left')+')');await until(()=>target(origin+'/workspace-left'),'packaged workspace left');
    const leftId=await chrome.evaluate('window.packageState.activeId');
    await chrome.evaluate('window.nacre.newTab()');await until(()=>chrome.evaluate('window.packageState.activeId!=='+leftId),'packaged second tab');
    await chrome.evaluate('window.nacre.navigate('+JSON.stringify(origin+'/workspace-right')+')');await until(()=>target(origin+'/workspace-right'),'packaged workspace right');
    assert.equal(await chrome.evaluate('window.nacre.splitView({action:"open",peerId:'+leftId+'})'),true);
    await until(()=>chrome.evaluate('window.packageState.splitView.ids.length===2'),'packaged split');
    await chrome.evaluate('document.querySelector("#commands-open").click()');
    await until(()=>chrome.evaluate('document.querySelector(".command-palette-backdrop").hidden===false'),'packaged palette');
    await chrome.evaluate('document.querySelector(".command-palette").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await until(()=>chrome.evaluate('document.querySelector(".command-palette-backdrop").hidden===true'),'packaged palette closed');
    await chrome.evaluate('window.nacre.activateTab('+originalId+')');
    await until(()=>chrome.evaluate('window.packageState.activeId==='+originalId),'packaged original tab');
    assert.deepEqual(await chrome.evaluate('window.packageState.splitView.ids'),[]);
    assert.equal(await chrome.evaluate('window.packageState.workspaces.activeId'),'personal');
  });
  await chrome.evaluate('window.nacre.newPrivateTab()');
  await until(() => chrome.evaluate('window.packageState.active.private'), 'packaged private tab');
  await chrome.evaluate('window.nacre.navigate(' + JSON.stringify(origin + '/private') + ')');
  const privatePage = cdp((await until(() => target(origin + '/private'), 'packaged private page')).webSocketDebuggerUrl);
  await check('Packaged private navigation cannot use regular cookies or privileged APIs', async () => {
    assert.equal(await privatePage.evaluate('document.cookie'), '');
    assert.equal(requests.find(r => r.url === '/private').cookie, '');
    assert.deepEqual(await privatePage.evaluate('[typeof window.nacre,typeof process,typeof require]'), ['undefined','undefined','undefined']);
  });
  await browser.call('Browser.close').catch(() => {});
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  for (const ses of sessions) ses.close();
  if (child && child.exitCode === null) { await wait(500); if (child.exitCode === null) child.kill(); }
  for (const srv of [server,frameServer]) { srv.closeAllConnections(); srv.close(); }
  const report = { directory: dir, profile, results, requests, stderr };
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ results, report: out }, null, 2));
});
