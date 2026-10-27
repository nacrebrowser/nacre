'use strict';

// Real Electron regression tests in a disposable profile. Fixtures use loopback;
// the explicit Tor group contacts Tor and its public HTTPS confirmation service.
// Native file opening and context-menu display are intercepted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-security-051-'));
  const entry = path.join(scratch, 'verify.cjs');
  fs.copyFileSync(__filename, entry);
  const env = { ...process.env, NACRE_TEST_ROOT: root, NACRE_TEST_PROFILE: scratch };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [entry, ...process.argv.slice(2)], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 180000
  });
  const output = (result.stdout || '') + (result.stderr || '');
  const out = path.join(root, '.cache', 'security-051');
  fs.mkdirSync(out, { recursive: true });
  const label = process.argv[3] || new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(out, label.replace(/[^a-zA-Z0-9_-]/g, '_') + '.log'), output);
  process.stdout.write(output);
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const Module = require('node:module');
const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const root = process.env.NACRE_TEST_ROOT;
const scratch = process.env.NACRE_TEST_PROFILE;
const groups = (process.argv[2] || 'navigation').split(',');
const results = [];
const observed = { requests: [], opens: [], dialogs: [], navigations: [] };
const menus = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await wait(30);
  }
  throw new Error('Timed out: ' + label);
}
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); }
}
app.setPath('appData', scratch);
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP nacreproxytest 127.0.0.1, MAP nacre-block-canary.invalid 127.0.0.1');
process.env.NACRE_PORTABLE_MODE = '0';
fs.mkdirSync(app.getPath('userData'), { recursive: true });
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
fs.writeFileSync(settingsFile, JSON.stringify({
  directMode: true, torCountry: '', httpsOnly: false, clearOnQuit: false,
  adBlockEnabled: groups.includes('blocker'), adBlockCustomFilters: '||nacre-block-canary.invalid^',
  language: 'en', cookiePolicy: 'allow', antiFingerprint: false,
  askDownloadLocation: true, openDownloadsAfter: true
}));
BrowserWindow.prototype.show = function () {};
const buildMenu = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = template => {
  menus.push(template);
  const menu = buildMenu(template);
  menu.popup = () => {};
  return menu;
};
shell.openPath = async target => { observed.opens.push(target); return ''; };
let dialogResponse = 1;
dialog.showMessageBox = async (_window, options) => {
  observed.dialogs.push(options); return { response: dialogResponse };
};
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(scratch, 'renamed.cmd') });
const file = path.join(root, 'src', 'main.cjs');
const main = new Module(file, module);
main.filename = file;
main.paths = Module._nodeModulePaths(path.dirname(file));
// Export references only; no production handlers or security decisions replaced.
main._compile(fs.readFileSync(process.env.NACRE_SECURITY_MAIN_SOURCE || file, 'utf8') + `
module.exports = { tabs, createTab, closeTab, navigateTab, sendState, snapshot, openDownloadedFile,
  proxyConfig, effectiveProxyConfig, torProxyConfig, loadBlocker, rebuildBlockerFromAvailableSources,
  connectTor, configureProxy, closeTorRuntime, torRuntime: () => torRuntime,
  chrome: () => chromeView, preferences: () => settings, blocker: () => blocker,
  regularSession: () => regularSession, downloads };
`, file);
const nacre = main.exports;
let origin;
let frameOrigin;
const server = http.createServer((req, res) => {
  observed.requests.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie || '' });
  if (req.url === '/download') {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="guide.txt"' });
    res.end('Inert fixture: no executable contents.');
  } else if (req.url === '/sw.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(`self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
      self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
      self.addEventListener('message', e => e.waitUntil(fetch('/cookie/sw', {credentials:'include'}).then(() => e.ports[0].postMessage('done'))));`);
  } else if (req.url.startsWith('/cookie/')) {
    res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'server_' + req.url.split('/').at(-1) + '=must-not-store; Path=/' });
    res.end('received');
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url === '/parent' ? `<title>Parent</title><iframe src="${frameOrigin}/child"></iframe>` : '<title>Fixture</title>');
  }
});
const upgradeFixture = (req, socket) => {
  observed.requests.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie || '' });
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\nSet-Cookie: server_ws=must-not-store; Path=/\r\n\r\n');
  socket.on('error', () => {});
  setTimeout(() => socket.end(), 100);
};
server.on('upgrade', upgradeFixture);
const frameServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<title>Subframe</title>');
});
async function open(url, privateMode = false) {
  const id = await nacre.createTab(url, privateMode);
  const tab = nacre.tabs.get(id);
  await until(() => tab.pageView.webContents.getURL() === url && !tab.pageView.webContents.isLoading(), url);
  return tab;
}
async function navigation() {
  const tab = await open(origin + '/parent');
  const wc = tab.pageView.webContents;
  await until(() => wc.mainFrame.frames.length > 0, 'child frame');
  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => observed.navigations.push({ url, isMainFrame }));
  await check('S01 iframe hash must not replace top-level identity or omnibox', async () => {
    await wc.mainFrame.frames[0].executeJavaScript('location.hash = "spoof"');
    await until(() => observed.navigations.some(e => e.url.endsWith('#spoof')), 'iframe hash event');
    await wait(100);
    assert.equal(wc.getURL(), origin + '/parent');
    assert.equal(tab.url, wc.getURL());
    const chrome = nacre.chrome().webContents;
    assert.equal(await chrome.executeJavaScript('document.querySelector("#address").value'), wc.getURL());
  });
  await check('S01 main-frame hash and history updates still update identity', async () => {
    await wc.executeJavaScript('history.pushState({}, "", "/parent#legitimate")');
    await until(() => tab.url === origin + '/parent#legitimate', 'top-level history state');
    assert.equal(tab.url, wc.getURL());
  });
  nacre.closeTab(tab.id);
}
async function privateContext() {
  await nacre.regularSession().cookies.set({ url: origin, name: 'regular_context', value: 'must-not-leak' });
  const tab = await open(origin + '/private', true);
  const wc = tab.pageView.webContents;
  for (const action of ['link', 'search']) {
    await check('S04 private ' + action + ' context-menu retains private session', async () => {
      // Invoke the actual native context-menu callback, identified by position,
      // without depending on translated labels or navigating a public website.
      nacre.preferences().searchEngine = 'custom';
      nacre.preferences().customSearchUrl = origin + '/search?q=%s';
      wc.emit('context-menu', {}, action === 'link' ? { linkURL: origin + '/link' } : { selectionText: 'private-canary' });
      const template = menus.at(-1);
      const before = new Set(nacre.tabs.keys());
      await template[action === 'link' ? 0 : 1].click();
      await until(() => [...nacre.tabs.keys()].some(id => !before.has(id)), 'new private child');
      const child = [...nacre.tabs.values()].find(t => !before.has(t.id));
      try {
        const expectedPath = action === 'link' ? '/link' : '/search?q=private-canary';
        await until(() => observed.requests.some(r => r.url === expectedPath), 'child request observed');
        assert.equal(observed.requests.find(r => r.url === expectedPath).cookie, '', 'private action must not send regular cookies');
        assert.equal(child.private, true);
        assert.notEqual(child.browserSession, nacre.regularSession());
        assert.equal(child.browserSession.isPersistent(), false);
      } finally { nacre.closeTab(child.id); }
    });
  }
  await check('S04 private zoom never writes hostname into settings', async () => {
    wc.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: '+', control: true });
    assert.ok(wc.getZoomFactor() > 1);
    assert.equal(Object.hasOwn(nacre.preferences().siteZoom, '127.0.0.1'), false);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).siteZoom || {}, '127.0.0.1'), false);
  });
  await check('S04 saving preferences preserves private zoom without reading normal site zoom', async () => {
    const expectedZoom = wc.getZoomFactor();
    nacre.preferences().siteZoom['127.0.0.1'] = 150;
    const targetTheme = nacre.preferences().theme === 'dark' ? 'light' : 'dark';
    await nacre.chrome().webContents.executeJavaScript('window.nacre.savePreferences(' + JSON.stringify({ theme: targetTheme }) + ')');
    await until(() => nacre.preferences().theme === targetTheme, 'changed preference applied');
    try { assert.equal(wc.getZoomFactor(), expectedZoom); }
    finally { delete nacre.preferences().siteZoom['127.0.0.1']; }
  });
  nacre.closeTab(tab.id);
  await nacre.regularSession().cookies.remove(origin, 'regular_context');
}
async function downloads() {
  const tab = await open(origin + '/downloads');
  await check('S03 a real guide.txt download saved as .cmd is never auto-opened', async () => {
    observed.opens.length = 0;
    tab.pageView.webContents.downloadURL(origin + '/download');
    await until(() => [...nacre.downloads.values()].some(d => d.path === path.join(scratch, 'renamed.cmd') && d.state === 'completed'), 'download complete');
    await wait(100);
    assert.equal(fs.readFileSync(path.join(scratch, 'renamed.cmd'), 'utf8'), 'Inert fixture: no executable contents.');
    assert.deepEqual(observed.opens, []);
  });
  await check('S03 manual opening of a restored renamed record requires consent', async () => {
    observed.opens.length = 0;
    observed.dialogs.length = 0;
    await nacre.openDownloadedFile({ filename: 'guide.txt', path: path.join(scratch, 'renamed.cmd') }, false);
    assert.equal(observed.dialogs.length, 1);
    assert.deepEqual(observed.opens, []);
  });
  await check('S03 safe final file still opens and accepted risky manual open works', async () => {
    observed.opens.length = 0;
    await nacre.openDownloadedFile({ filename: 'guide.txt', path: path.join(scratch, 'guide.txt') }, true);
    dialogResponse = 0;
    await nacre.openDownloadedFile({ filename: 'guide.txt', path: path.join(scratch, 'renamed.cmd') }, false);
    dialogResponse = 1;
    assert.deepEqual(observed.opens, [path.join(scratch, 'guide.txt'), path.join(scratch, 'renamed.cmd')]);
  });
  nacre.closeTab(tab.id);
}
async function cookies() {
  const ses = nacre.regularSession();
  await ses.cookies.set({ url: origin, name: 'cookie_canary', value: 'must-not-send' });
  nacre.preferences().cookiePolicy = 'block-all';
  const tab = await open(origin + '/cookies');
  const wc = tab.pageView.webContents;
  await check('S05 block-all strips page, WebSocket and Service Worker cookie traffic', async () => {
    await wc.executeJavaScript(`(async () => {
      await fetch('/cookie/page', {credentials:'include'});
      await new Promise(resolve => { const ws = new WebSocket(${JSON.stringify(origin.replace('http:', 'ws:') + '/cookie/ws')}); ws.onopen = () => { ws.close(); resolve(); }; ws.onerror = resolve; });
      await navigator.serviceWorker.register('/sw.js');
      const reg = await navigator.serviceWorker.ready;
      await new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = resolve; reg.active.postMessage('fetch', [channel.port2]); });
    })()`);
    for (const endpoint of ['/cookie/page', '/cookie/ws', '/cookie/sw']) {
      const request = observed.requests.find(r => r.url === endpoint);
      assert.ok(request, endpoint + ' must reach fixture');
      assert.equal(request.cookie, '', endpoint + ' leaked cookies');
    }
  });
  await check('S05 blocked server cookies are not stored, including WS and SW', async () => {
    const stored = await ses.cookies.get({ url: origin });
    assert.deepEqual(stored.filter(c => c.name.startsWith('server_')).map(c => c.name), []);
  });
  observed.documentCookieUnderBlockAll = await wc.executeJavaScript('document.cookie');
  // This is a recorded limitation, NOT a claim to block JavaScript storage.
  await wc.executeJavaScript('(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); })()');
  nacre.closeTab(tab.id);
  nacre.preferences().cookiePolicy = 'allow';
  await ses.clearStorageData({ storages: ['cookies'] });
}
async function dependencies() {
  const atLeast = (actual, minimum) => {
    const a = actual.split('.').map(Number), b = minimum.split('.').map(Number);
    for (let i = 0; i < b.length; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
    return true;
  };
  await check('S02 running Electron and Chromium meet the reviewed security floor', async () => {
    assert.ok(atLeast(process.versions.electron, '44.9.0'), process.versions.electron);
    assert.ok(atLeast(process.versions.chrome, '152.0.7977.167'), process.versions.chrome);
  });
  await check('S02 shipped Tor binary meets security release 0.4.9.14', async () => {
    const result = spawnSync(path.join(root, 'vendor', 'tor', 'tor.exe'), ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0);
    observed.torVersion = result.stdout;
    const version = /Tor version ([\d.]+)/.exec(result.stdout)?.[1];
    assert.ok(version && atLeast(version.replace(/\.$/, ''), '0.4.9.14'), result.stdout);
    assert.equal(nacre.snapshot().versions.tor, version.replace(/\.$/, ''), 'settings must report the actual pinned Tor version');
  });
}
async function proxy() {
  const ses = nacre.regularSession();
  const requests = [];
  const relay = http.createServer((req, res) => { requests.push(req.url); res.end('through-proxy'); });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  try {
    await check('S06 unconfigured Chromium session also fails closed on loopback', async () => {
      const unconfigured = session.fromPartition('nacre-test-unconfigured');
      await assert.rejects(unconfigured.fetch(origin + '/global-closed-canary', { signal: AbortSignal.timeout(4000) }));
      assert.equal(observed.requests.some(r => r.url === '/global-closed-canary'), false);
    });
    await ses.setProxy(nacre.proxyConfig({ enabled: true, type: 'http', host: '127.0.0.1', port: relay.address().port }, false));
    await ses.closeAllConnections();
    for (const host of ['127.0.0.1', 'nacreproxytest']) {
      await check('S06 manual proxy receives ' + host + ' instead of direct origin', async () => {
        const url = `http://${host}:${server.address().port}/proxy-${host}`;
        const response = await ses.fetch(url, { signal: AbortSignal.timeout(4000) });
        assert.equal(await response.text(), 'through-proxy');
        assert.ok(requests.includes(url));
        assert.equal(observed.requests.some(r => r.url === '/proxy-' + host), false);
      });
    }
    await check('S06 closed route prevents actual loopback HTTP traffic', async () => {
      await ses.setProxy(nacre.proxyConfig({ enabled: false }, false));
      await ses.closeAllConnections();
      await assert.rejects(ses.fetch(origin + '/closed-canary', { signal: AbortSignal.timeout(4000) }));
      assert.equal(observed.requests.some(r => r.url === '/closed-canary'), false);
    });
    await check('S06 stopped-Tor route prevents actual loopback HTTP traffic', async () => {
      await ses.setProxy(nacre.torProxyConfig(1));
      await ses.closeAllConnections();
      await assert.rejects(ses.fetch(origin + '/tor-closed-canary', { signal: AbortSignal.timeout(4000) }));
      assert.equal(observed.requests.some(r => r.url === '/tor-closed-canary'), false);
    });
  } finally {
    observed.proxyRequests = requests;
    await ses.setProxy({ mode: 'direct' });
    await ses.closeAllConnections();
    relay.closeAllConnections();
    await new Promise(resolve => relay.close(resolve));
  }
}
async function fingerprint() {
  nacre.preferences().antiFingerprint = true;
  const tab = await open(origin + '/fingerprint');
  const wc = tab.pageView.webContents;
  await check('S07 screen getters are finite and availability fits screen dimensions', async () => {
    const dims = await wc.executeJavaScript('({width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight})');
    for (const value of Object.values(dims)) assert.ok(Number.isFinite(value) && value > 0);
    assert.ok(dims.availWidth <= dims.width && dims.availHeight <= dims.height);
  });
  await check('S07 AudioBuffer channel views preserve writes and repeated reads', async () => {
    const data = await wc.executeJavaScript(`(() => {
      const buffer = new AudioBuffer({length:256, sampleRate:44100, numberOfChannels:1});
      const view = buffer.getChannelData(0); view.fill(0.5);
      const copy = new Float32Array(256); buffer.copyFromChannel(copy,0);
      return {copy:Array.from(copy),again:Array.from(buffer.getChannelData(0))};
    })()`);
    assert.ok(data.copy.every(n => n === 0.5), 'writes to channel view lost');
    assert.deepEqual(data.again, data.copy, 'repeated read altered user samples');
  });
  await check('S07 copyFromChannel and getChannelData expose the same protected samples', async () => {
    const data = await wc.executeJavaScript(`(() => {
      const buffer = new AudioBuffer({length:256,sampleRate:44100,numberOfChannels:1});
      buffer.copyToChannel(new Float32Array(256).fill(0.25),0);
      const copy = new Float32Array(256); buffer.copyFromChannel(copy,0);
      return {copy:Array.from(copy),view:Array.from(buffer.getChannelData(0))};
    })()`);
    assert.deepEqual(data.copy, data.view);
    assert.ok(data.copy.some(n => n !== 0.25), 'existing audio protection must not be silently removed');
  });
  observed.canvasSurfaces = await wc.executeJavaScript(`(() => {
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(128,128,128)';ctx.fillRect(0,0,1,1);
    const off=new OffscreenCanvas(1,1);const other=off.getContext('2d');other.drawImage(canvas,0,0);
    return {canvas:ctx.getImageData(0,0,1,1).data[0],offscreen:other.getImageData(0,0,1,1).data[0]};
  })()`);
  nacre.closeTab(tab.id);
  nacre.preferences().antiFingerprint = false;
}
async function blocker() {
  await check('S08 persisted custom filter blocks traffic on cold start without cache', async () => {
    assert.equal(fs.existsSync(path.join(app.getPath('userData'), 'filters', 'active.json')), false);
    const tab = await open(origin + '/blocker');
    try {
      const url = `http://nacre-block-canary.invalid:${server.address().port}/adblock-canary`;
      const result = await tab.pageView.webContents.executeJavaScript(`fetch(${JSON.stringify(url)},{mode:'no-cors'}).then(()=> 'allowed',()=> 'blocked')`);
      assert.equal(result, 'blocked');
      assert.equal(observed.requests.some(r => r.url === '/adblock-canary'), false, 'blocked request reached origin');
      assert.ok(tab.blocked > 0);
    } finally { nacre.closeTab(tab.id); }
  });
}
async function tor() {
  const ses = nacre.regularSession();
  const log = path.join(root, '.cache', 'security-051', 'tor-' + Date.now() + '-netlog.json');
  await ses.netLog.startLogging(log, { captureMode: 'everything' });
  observed.torNetLog = log;
  try {
    // No fixture mappings for the public Tor confirmation service. Production
    // startTor/connectTor, certificate checks and SOCKS bridge run unchanged.
    const connection = nacre.connectTor('GB').then(() => ({ ok: true }), error => ({ error: error.message }));
    await until(() => nacre.preferences().torCountry === 'GB', 'Tor bootstrap closed route');
    await check('Tor bootstrap blocks actual local HTTP traffic before ready', async () => {
      await assert.rejects(ses.fetch(origin + '/tor-bootstrap-canary', { signal: AbortSignal.timeout(4000) }));
      assert.equal(observed.requests.some(r => r.url === '/tor-bootstrap-canary'), false);
    });
    const connected = await connection;
    if (!connected.ok) {
      results.push({ name: 'Tor public bootstrap and egress verification', status: 'INCONCLUSIVE', error: connected.error });
      return;
    }
    await check('Tor actual egress is confirmed by the official HTTPS service', async () => {
      const response = await ses.fetch('https://check.torproject.org/api/ip', { signal: AbortSignal.timeout(20000), redirect: 'error' });
      assert.equal(response.ok, true);
      const confirmation = await response.json();
      observed.torConfirmation = confirmation;
      assert.equal(confirmation.IsTor, true);
    });
    const runtime = nacre.torRuntime();
    runtime.process.kill();
    await until(() => !nacre.torRuntime(), 'unexpected Tor exit handled');
    await check('Tor unexpected exit leaves actual HTTP traffic closed', async () => {
      await assert.rejects(ses.fetch(origin + '/tor-crash-canary', { signal: AbortSignal.timeout(4000) }));
      assert.equal(observed.requests.some(r => r.url === '/tor-crash-canary'), false);
    });
  } finally {
    await nacre.closeTorRuntime(nacre.torRuntime());
    await ses.netLog.stopLogging();
  }
}
async function transitions() {
  const ses = nacre.regularSession();
  observed.modeTimeline = [];
  const mark = mode => observed.modeTimeline.push({ mode, utc: new Date().toISOString(), pid: process.pid });
  const navigate = async suffix => {
    const tab = await open(origin + '/transition-control-' + suffix);
    try { return await tab.pageView.webContents.executeJavaScript(`fetch('/transition-${suffix}',{cache:'no-store'}).then(()=>true,()=>false)`); }
    finally { nacre.closeTab(tab.id); }
  };
  // Drive the actual trusted UI IPC. Only the native confirmation UI is
  // intercepted by this verifier, with an explicit affirmative test response.
  const direct = async () => {
    dialogResponse = 0;
    await nacre.chrome().webContents.executeJavaScript('window.nacre.disableProxy()');
    await until(()=>nacre.preferences().directMode===true,'direct mode acknowledged');
    await until(async()=>String(await ses.resolveProxy(origin))==='DIRECT','direct route applied');
  };
  await direct(); mark('direct-control');
  await check('Transition positive control actually reaches the local origin', async()=>{
    assert.equal(await navigate('direct'),true);
    assert.ok(observed.requests.some(r=>r.url==='/transition-direct'));
  });
  await nacre.configureProxy({},false); mark('closed-after-direct');
  await check('Direct to closed transition blocks an actual fresh HTTP request',async()=>{
    await assert.rejects(ses.fetch(origin+'/transition-closed',{signal:AbortSignal.timeout(4000),cache:'no-store'}));
    assert.equal(observed.requests.some(r=>r.url==='/transition-closed'),false);
  });
  await direct(); mark('direct-restored-control');
  await check('Closed to explicitly accepted direct mode restores actual traffic',async()=>{
    assert.equal(await navigate('restored'),true);
    assert.ok(observed.requests.some(r=>r.url==='/transition-restored'));
  });
  await nacre.configureProxy({},false); mark('closed-final');
  await check('Second closed transition has no direct fallback',async()=>{
    await assert.rejects(ses.fetch(origin+'/transition-final',{signal:AbortSignal.timeout(4000),cache:'no-store'}));
    assert.equal(observed.requests.some(r=>r.url==='/transition-final'),false);
  });
  dialogResponse = 1;
}
async function tls() {
  const ses = nacre.regularSession();
  const fixture = path.join(root, '.cache', 'security-051', 'tls-fixture');
  const cert = fs.readFileSync(path.join(fixture, 'cert.pem'));
  const expected = new crypto.X509Certificate(cert).fingerprint256;
  const secure = https.createServer({ cert, key: fs.readFileSync(path.join(fixture, 'key.pem')) }, (req, res) => {
    observed.requests.push({ url: req.url, cookie: req.headers.cookie || '', tls: true });
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'tls_response=must-not-store; Path=/; Secure' });
    res.end('<title>TLS fixture</title>');
  });
  secure.on('upgrade', upgradeFixture);
  await new Promise(resolve => secure.listen(0, '127.0.0.1', resolve));
  const secureOrigin = 'https://127.0.0.1:' + secure.address().port;
  await check('TLS: production trust rejects the untrusted self-signed fixture', async () => {
    // Separate native session avoids carrying the negative verifier cache into
    // the explicitly trusted header-filter fixture below.
    const untrusted = session.fromPartition('nacre-tls-negative-' + Date.now());
    await untrusted.setProxy({ mode: 'direct' });
    await assert.rejects(untrusted.fetch(secureOrigin + '/untrusted-certificate', { signal: AbortSignal.timeout(5000) }));
    await untrusted.closeAllConnections();
    assert.equal(observed.requests.some(r => r.url === '/untrusted-certificate'), false);
  });
  // Trust only the disposable fixture's exact certificate in this test session.
  // This does not test the production certificate trust decision.
  ses.setCertificateVerifyProc((request, callback) => {
    let match = false;
    try { match = request.hostname === '127.0.0.1' && new crypto.X509Certificate(request.certificate.data).fingerprint256 === expected; } catch {}
    callback(match ? 0 : -3);
  });
  observed.tlsFixtureTrust = 'Exact self-signed fixture certificate accepted in test session only; production certificate validation not tested here';
  const tunnels = [];
  const sockets = new Set();
  const relay = http.createServer((_req, res) => { res.writeHead(400); res.end(); });
  relay.on('connect', (req, downstream, head) => {
    if (req.url !== '127.0.0.1:' + secure.address().port) { downstream.destroy(); return; }
    tunnels.push(req.url);
    const upstream = net.connect(secure.address().port, '127.0.0.1', () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(downstream); downstream.pipe(upstream);
    });
    for (const socket of [downstream, upstream]) {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => socket.destroy());
    }
  });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  let tab;
  try {
    await ses.cookies.set({ url: secureOrigin, name: 'tls_canary', value: 'must-not-send', secure: true });
    nacre.preferences().cookiePolicy = 'block-all';
    tab = await open(secureOrigin + '/secure-page');
    await check('TLS: HTTPS and WSS cookie headers are absent in actual fixture traffic', async () => {
      await tab.pageView.webContents.executeJavaScript(`(async () => {
        await fetch('/secure-cookie', {credentials:'include'});
        await new Promise(resolve => { const ws=new WebSocket(${JSON.stringify(secureOrigin.replace('https:', 'wss:') + '/secure-ws')});ws.onopen=()=>{ws.close();resolve();};ws.onerror=resolve; });
      })()`);
      for (const endpoint of ['/secure-page', '/secure-cookie', '/secure-ws']) {
        const req = observed.requests.find(r => r.url === endpoint);
        assert.ok(req, endpoint); assert.equal(req.cookie, '', endpoint);
      }
      assert.equal((await ses.cookies.get({ url: secureOrigin })).some(c => c.name === 'tls_response' || c.name === 'server_ws'), false);
    });
    nacre.closeTab(tab.id); tab = null;
    await check('TLS: manual HTTP proxy carries real HTTPS through CONNECT', async () => {
      await ses.setProxy(nacre.proxyConfig({ enabled: true, type: 'http', host: '127.0.0.1', port: relay.address().port }, false));
      await ses.closeAllConnections();
      const response = await ses.fetch(secureOrigin + '/https-proxy-canary', { signal: AbortSignal.timeout(5000) });
      assert.equal(response.ok, true); await response.text();
      assert.ok(tunnels.length > 0);
      assert.ok(observed.requests.some(r => r.url === '/https-proxy-canary' && r.tls));
    });
    await check('TLS: closed proxy prevents actual direct HTTPS connection', async () => {
      await ses.setProxy(nacre.proxyConfig({ enabled: false }, false)); await ses.closeAllConnections();
      await assert.rejects(ses.fetch(secureOrigin + '/https-closed-canary', { signal: AbortSignal.timeout(4000) }));
      assert.equal(observed.requests.some(r => r.url === '/https-closed-canary'), false);
    });
  } finally {
    if (tab) nacre.closeTab(tab.id);
    observed.connectTunnels = tunnels;
    nacre.preferences().cookiePolicy = 'allow';
    ses.setCertificateVerifyProc(null);
    await ses.setProxy({ mode: 'direct' }); await ses.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    for (const srv of [relay,secure]) { srv.closeAllConnections(); srv.close(); }
  }
}
async function ipv6() {
  const ses = nacre.regularSession();
  const seen = [];
  const relaySeen = [];
  const v6 = http.createServer((req, res) => { seen.push(req.url); res.end('ipv6-origin'); });
  const relay = http.createServer((req, res) => { relaySeen.push(req.url); res.end('ipv6-proxy'); });
  try {
    await new Promise((resolve, reject) => { v6.once('error', reject); v6.listen(0, '::1', resolve); });
  } catch (error) {
    results.push({ name: 'IPv6 loopback routing', status: 'INCONCLUSIVE', error: error.message }); return;
  }
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  const url = 'http://[::1]:' + v6.address().port;
  try {
    await check('IPv6: direct negative control reaches the local fixture', async () => {
      await ses.setProxy({ mode: 'direct' }); await ses.closeAllConnections();
      assert.equal(await (await ses.fetch(url + '/v6-direct-control')).text(), 'ipv6-origin');
    });
    await check('IPv6: manual proxy receives the literal IPv6 URL', async () => {
      await ses.setProxy(nacre.proxyConfig({ enabled: true, type: 'http', host: '127.0.0.1', port: relay.address().port }, false));
      await ses.closeAllConnections();
      assert.equal(await (await ses.fetch(url + '/v6-proxy')).text(), 'ipv6-proxy');
      assert.ok(relaySeen.includes(url + '/v6-proxy'));
      assert.equal(seen.includes('/v6-proxy'), false);
    });
    await check('IPv6: closed and stopped-Tor modes do not reach local origin', async () => {
      for (const route of [nacre.proxyConfig({ enabled: false }, false), nacre.torProxyConfig(1)]) {
        await ses.setProxy(route); await ses.closeAllConnections();
        await assert.rejects(ses.fetch(url + '/v6-closed', { signal: AbortSignal.timeout(4000) }));
      }
      assert.equal(seen.includes('/v6-closed'), false);
    });
  } finally {
    observed.ipv6OriginRequests = seen; observed.ipv6ProxyRequests = relaySeen;
    await ses.setProxy({ mode: 'direct' }); await ses.closeAllConnections();
    for (const srv of [v6,relay]) { srv.closeAllConnections(); srv.close(); }
  }
}
(async () => {
  await Promise.all([new Promise(resolve => server.listen(0, '127.0.0.1', resolve)), new Promise(resolve => frameServer.listen(0, '127.0.0.1', resolve)), app.whenReady()]);
  origin = 'http://127.0.0.1:' + server.address().port;
  frameOrigin = 'http://127.0.0.1:' + frameServer.address().port;
  await until(() => nacre.tabs.size > 0, 'Nacre startup');
  await until(() => nacre.chrome().webContents.executeJavaScript('!!window.nacre && !!document.querySelector("#address")'), 'chrome preload');
  const suites = { navigation, private: privateContext, downloads, cookies, dependencies, proxy, fingerprint, blocker, tor, transitions, tls, ipv6 };
  for (const group of groups) {
    if (!suites[group]) throw new Error('Unknown group ' + group);
    await suites[group]();
  }
  console.log(JSON.stringify({ electron: process.versions.electron, chromium: process.versions.chrome, profile: scratch, results, observed }, null, 2));
  app.exit(results.some(r => r.status === 'FAIL') ? 1 : results.some(r => r.status !== 'PASS') ? 2 : 0);
})().catch(error => { console.error(error.stack); app.exit(2); });
