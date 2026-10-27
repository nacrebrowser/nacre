'use strict';
if(process.versions.electron){
 const {app,safeStorage}=require('electron'),path=require('node:path');
 const seedIndex=process.argv.indexOf('--seed'), profile=seedIndex>=0?process.argv[seedIndex+1]:null;
 if(seedIndex<0||!profile)throw Error('Explicit disposable seed required');
 if(process.env.NACRE_SMOKE_APPDATA)app.setPath('appData',process.env.NACRE_SMOKE_APPDATA);
 app.setPath('userData',profile);
 app.whenReady().then(()=>{require(path.join(__dirname,'../src/profile-integrity.cjs')).createProfileIntegrity(profile,safeStorage).write(path.join(profile,'settings.json'),'settings',{directMode:true,torCountry:'',torAutoStart:false,httpsOnly:false,clearOnQuit:false,language:'en',adBlockEnabled:false,cookiePolicy:'allow',antiFingerprint:false,theme:'light'});app.quit()}).catch(e=>{console.error(e);app.exit(1)});
 return;
}

// Temporary release smoke test: launch the packaged EXE with a fresh profile,
// switch to direct mode through the real privileged API, then load a local page.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { launch, packagedSandboxArguments } = require('./test-support/electron-fixture.cjs');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'dist', 'win-unpacked');
const exe = path.join(dir, 'Nacre.exe');
const cacheRoot = path.join(root, '.cache', 'design-package'); fs.mkdirSync(cacheRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(cacheRoot, 'run-'));
const profile = path.join(scratch, 'profile');
const appData = path.join(scratch, 'appdata');
assert.equal(fs.existsSync(path.join(process.env.APPDATA, 'Nacre/profile-location.json')), false, 'A custom installed profile pointer must not be used by this fixture');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(path.join(appData, 'Nacre'), { recursive: true });
fs.writeFileSync(path.join(appData, 'Nacre', 'profile-location.json'), JSON.stringify({ path: profile }, null, 2));
const seedEnv={...process.env, APPDATA: appData, LOCALAPPDATA: appData, NACRE_SMOKE_APPDATA: appData};
const seeded=launch([__filename,'--seed',profile],{env:seedEnv,encoding:'utf8',timeout:30000});
if(seeded.status!==0)throw Error('Profile seed failed: '+seeded.stderr);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, label, attempts = 300) {
  for (let i = 0; i < attempts; i++) {
    const value = await fn();
    if (value) return value;
    await wait(50);
  }
  throw new Error('Timed out: ' + label);
}

const requests = [];
const server = http.createServer((req, res) => {
  requests.push({ url: req.url, headers: req.headers });
  server.requests = requests;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<title>Packaged fixture</title><h1>Packaged page works</h1>' + (req.url === '/private' ? '<p>private</p>' : ''));
});

function cdp(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
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
    async evaluate(expression) {
      const result = await api.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close() { ws.close(); }
  };
  return api;
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let child;
  const sessions = []; let browser;
  try {
    const env = { ...process.env, NACRE_PORTABLE_MODE: '0', APPDATA: appData, LOCALAPPDATA: appData };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(exe, [...packagedSandboxArguments(), '--user-data-dir=' + profile, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], {
      cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data; });
    child.stdout.on('data', () => {});
    const browserUrl = await until(() => /DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(stderr)?.[1], 'packaged CDP listener');
    browser=cdp(browserUrl);
    const port = new URL(browserUrl).port;
    const list = async () => (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const target = (url) => until(async () => (await list()).find((item) => item.url === url && item.webSocketDebuggerUrl), 'target ' + url);
    const chrome = cdp((await target('nacre://app/')).webSocketDebuggerUrl);
    sessions.push(chrome);
    await until(() => chrome.evaluate('!!window.nacre'), 'privileged preload');
    assert.equal(await chrome.evaluate('document.querySelector(".footer-version").textContent.trim()'), '1.0.0 · BETA');
    await chrome.evaluate('window.__smokeState=null; window.nacre.onState((s)=>{window.__smokeState=s})');
    // Subscribe after renderer initialization, then explicitly request a state
    // producing action rather than depending on an unrelated timed UI event.
    await chrome.evaluate('window.nacre.updateSetting("sendGpc",true)');
    await until(() => chrome.evaluate('Boolean(window.__smokeState?.settings)'), 'initial state');
    console.log('settings at startup:', await chrome.evaluate('JSON.stringify({profile:window.__smokeState?.settings?.profileLocation,httpsOnly:window.__smokeState?.settings?.httpsOnly,active:window.__smokeState?.active?.url})'));
    assert.equal(await chrome.evaluate('window.__smokeState?.settings?.profileLocation'),profile,'Disposable profile path');
    assert.equal(await chrome.evaluate('window.__smokeState?.settings?.httpsOnly'),false,'Seeded settings survive integrity validation');
    await chrome.evaluate('window.nacre.navigate(' + JSON.stringify(origin + '/') + ')');
    const page = cdp((await target(origin + '/')).webSocketDebuggerUrl);
    sessions.push(page);
    await wait(2500);
    console.log('page state:', await page.evaluate('JSON.stringify({href:location.href,ready:document.readyState,title:document.title,text:document.body?.innerText?.slice(0,200)})'));
    console.log('server requests:', JSON.stringify(server.requests || []));
    await until(async () => (await page.evaluate('document.querySelector("h1")?.textContent')) === 'Packaged page works', 'packaged page render');
    assert.equal(await page.evaluate('document.title'), 'Packaged fixture');
    await page.evaluate('document.cookie="normal_design_cookie=secret; Path=/"');
    await chrome.evaluate('window.nacre.newPrivateTab()');
    await wait(500);
    await chrome.evaluate('window.nacre.navigate(' + JSON.stringify(origin + '/private') + ')');
    const privatePage = cdp((await target(origin + '/private')).webSocketDebuggerUrl);
    sessions.push(privatePage);
    await until(async () => (await privatePage.evaluate('document.querySelector("h1")?.textContent')) === 'Packaged page works', 'packaged private page');
    assert.deepEqual(await privatePage.evaluate('[typeof window.nacre,typeof process,typeof require]'), ['undefined', 'undefined', 'undefined']);
    assert.equal(await privatePage.evaluate('document.cookie.includes("normal_design_cookie")'),false);
    console.log(JSON.stringify({ status: 'PASS', version: require('../package.json').version, checks: ['packaged startup', 'version label', 'privileged API', 'direct local navigation', 'private page isolation'], report: path.join(scratch, 'profile') }, null, 2));
  } finally {
    try { await browser?.call('Browser.close'); } catch {}
    for (const session of sessions) session.close();
    browser?.close();
    if (child && child.exitCode === null) {
      await wait(500);
      if (child.exitCode === null) child.kill();
    }
    server.closeAllConnections();
    server.close();
    for(let n=0;child&&child.exitCode===null&&n<100;n++)await wait(50);
    if(path.dirname(path.resolve(scratch))!==path.resolve(cacheRoot)||!path.basename(scratch).startsWith('run-'))throw Error('Unsafe cleanup');
    fs.rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
