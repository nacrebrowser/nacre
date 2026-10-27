'use strict';

// Behavioral cookie-policy regression test. It runs the real Electron session
// and Nacre network hooks in a disposable profile against local HTTPS/WSS
// fixtures. No installed profile or public endpoint is touched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-cookie-policy-'));
  const env = { ...process.env, NACRE_COOKIE_TEST_ROOT: root, NACRE_COOKIE_TEST_PROFILE: scratch };
  const probe = process.argv[3] || '';
  if (probe === 'native-prefs') env.NACRE_COOKIE_PREF_PROBE = '1';
  if (probe === 'blink-disabled') env.NACRE_COOKIE_BLINK_PROBE = '1';
  if (probe === 'cdp-third-party') env.NACRE_COOKIE_CDP_PROBE = '1';
  if (probe === 'cdp-frame-targets') env.NACRE_COOKIE_CDP_PROBE = 'frame-targets';
  if (probe === 'extension-settings') env.NACRE_COOKIE_EXTENSION_PROBE = '1';
  if (probe === 'toggle-only') env.NACRE_COOKIE_TOGGLE_PROBE = '1';
  if (probe === 'site-controls') env.NACRE_COOKIE_SITE_PROBE = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], {
    cwd: root,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 180000
  });
  const output = (result.stdout || '') + (result.stderr || '');
  const evidence = path.join(root, '.cache', 'security-051', 'stabilization-cookies');
  fs.mkdirSync(evidence, { recursive: true });
  const label = String(process.argv[2] || 'cookie-policy').replace(/[^a-zA-Z0-9_-]/g, '_');
  fs.writeFileSync(path.join(evidence, label + '.log'), output);
  process.stdout.write(output);
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const Module = require('node:module');
const { app, BrowserWindow, Menu, safeStorage, session } = require('electron');

const root = process.env.NACRE_COOKIE_TEST_ROOT;
const scratch = process.env.NACRE_COOKIE_TEST_PROFILE;
const tlsFixture = path.join(root, '.cache', 'security-051', 'tls-fixture');
const hosts = new Set(['first.test', 'middle.test', 'nested.test']);
const observed = [];
const javascriptObservations = {};
const results = [];
const nativeProbeEvents = [];

function record(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push({ name, status: 'PASS' }),
    (error) => results.push({ name, status: 'FAIL', error: error.stack || String(error) })
  );
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 300; i += 1) {
    if (await predicate()) return;
    await wait(25);
  }
  throw new Error('Timed out: ' + label);
}

app.setPath('appData', scratch);
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP first.test 127.0.0.1, MAP middle.test 127.0.0.1, MAP nested.test 127.0.0.1');
if (process.env.NACRE_COOKIE_BLINK_PROBE === '1') app.commandLine.appendSwitch('blink-settings', 'cookieEnabled=false');
process.env.NACRE_PORTABLE_MODE = '0';
fs.mkdirSync(app.getPath('userData'), { recursive: true });
if (process.env.NACRE_COOKIE_PREF_PROBE) {
  const partitionPath = path.join(app.getPath('sessionData'), 'Partitions', 'nacre');
  fs.mkdirSync(partitionPath, { recursive: true });
  fs.writeFileSync(path.join(partitionPath, 'Preferences'), JSON.stringify({
    profile: {
      block_third_party_cookies: true,
      cookie_controls_mode: 1,
      default_content_setting_values: { cookies: 2 }
    }
  }));
}
// Profiles are written with the same authenticated envelope as the application.
// A plain settings.json is treated as an unsigned migration and blocks startup.
const ready = app.whenReady().then(() => {
  const { createProfileIntegrity } = require(path.join(root, 'src', 'profile-integrity.cjs'));
  const integrity = createProfileIntegrity(app.getPath('userData'), safeStorage);
  integrity.write(path.join(app.getPath('userData'), 'settings.json'), 'settings', {
    directMode: true,
    torCountry: '',
    httpsOnly: false,
    clearOnQuit: false,
    adBlockEnabled: false,
    language: 'en',
    cookiePolicy: 'allow',
    antiFingerprint: false
  });
});

BrowserWindow.prototype.show = function () {};
const nativeBuildMenu = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (template) => {
  const menu = nativeBuildMenu(template);
  menu.popup = () => {};
  return menu;
};

const mainFile = path.join(root, 'src', 'main.cjs');
const loadedMain = new Module(mainFile, module);
loadedMain.filename = mainFile;
loadedMain.paths = Module._nodeModulePaths(path.dirname(mainFile));
const mainSource = process.env.NACRE_COOKIE_MAIN_SOURCE ? path.resolve(process.env.NACRE_COOKIE_MAIN_SOURCE) : mainFile;
if (mainSource !== mainFile && !mainSource.startsWith(path.join(root, '.cache') + path.sep)) {
  throw new Error('A baseline main source must stay in the workspace cache');
}
loadedMain._compile(fs.readFileSync(mainSource, 'utf8') + `
module.exports = {
  tabs, createTab, closeTab, sendState,
  preferences: () => settings,
  regularSession: () => regularSession,
  chrome: () => chromeView
};
`, mainFile);
const nacre = loadedMain.exports;

let port = 0;
const origin = (host) => `https://${host}:${port}`;
const cookieNames = (tag) => ({
  seed: `seed_${tag}`,
  doc: `doc_${tag}`,
  store: `store_${tag}`,
  worker: `worker_${tag}`,
  response: `response_${tag}`,
  ws: `ws_${tag}`
});

function workerSource() {
  return `
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  event.waitUntil((async () => {
    const tag = event.data.tag;
    const workerName = 'worker_' + tag;
    let setResult = 'unavailable';
    let cookies = [];
    try {
      if (self.cookieStore) {
        await self.cookieStore.set({ name: workerName, value: '1', path: '/', sameSite: 'none' });
        setResult = 'resolved';
        cookies = (await self.cookieStore.getAll()).map(cookie => cookie.name);
      }
    } catch (error) { setResult = error.name + ': ' + error.message; }
    await fetch('/observe-worker?tag=' + encodeURIComponent(tag), { credentials: 'include' });
    event.ports[0].postMessage({ setResult, cookies });
  })());
});`;
}

function leafSource(tag) {
  return `<!doctype html><meta charset="utf-8"><script>
(async () => {
  const tag = ${JSON.stringify(tag)};
  const docName = 'doc_' + tag;
  const storeName = 'store_' + tag;
  document.cookie = docName + '=1; Path=/; SameSite=None; Secure';
  let storeSet = 'unavailable';
  let storeNames = [];
  try {
    if (window.cookieStore) {
      await cookieStore.set({ name: storeName, value: '1', path: '/', sameSite: 'none' });
      storeSet = 'resolved';
      storeNames = (await cookieStore.getAll()).map(cookie => cookie.name);
    }
  } catch (error) { storeSet = error.name + ': ' + error.message; }
  await fetch('/observe-page?tag=' + encodeURIComponent(tag), { credentials: 'include' });
  await new Promise(resolve => {
    const ws = new WebSocket(location.origin.replace('https:', 'wss:') + '/observe-ws?tag=' + encodeURIComponent(tag));
    ws.onopen = () => { ws.close(); resolve(); };
    ws.onerror = resolve;
  });
  let worker = { setResult: 'unavailable', cookies: [] };
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.register('/worker.js?tag=' + encodeURIComponent(tag), { scope: '/scope-' + tag + '/' });
    let active = registration.active;
    for (let attempt = 0; !active && attempt < 200; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
      active = registration.active;
    }
    if (!active) throw new Error('service worker did not activate');
    worker = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('service worker message timeout')), 10000);
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
      active.postMessage({ tag }, [channel.port2]);
    });
  }
  const report = {
    marker: 'nacre-cookie-policy', tag,
    documentCookie: document.cookie,
    navigatorCookieEnabled: navigator.cookieEnabled,
    storeSet, storeNames, worker
  };
  // Cookie-header filtering cannot stop a script relaying readable identifiers
  // in the body of a credentialless request. Observe this at the receiving server.
  await fetch(${JSON.stringify(origin('middle.test'))} + '/relay?tag=' + encodeURIComponent(tag), {
    method: 'POST', mode: 'no-cors', credentials: 'omit', body: JSON.stringify(report)
  });
  top.postMessage(report, '*');
})().catch(error => top.postMessage({ marker: 'nacre-cookie-policy', tag, error: error.stack || String(error) }, '*'));
</script>`;
}

const server = https.createServer({
  cert: fs.readFileSync(path.join(tlsFixture, 'cert.pem')),
  key: fs.readFileSync(path.join(tlsFixture, 'key.pem'))
}, (req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  const url = new URL(req.url, 'https://' + host);
  const observation = { kind: 'https', host, path: url.pathname, tag: url.searchParams.get('tag') || '', cookie: req.headers.cookie || '' };
  observed.push(observation);
  if (url.pathname === '/relay') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', () => { observation.body = body; res.writeHead(204); res.end(); });
    return;
  }
  if (url.pathname === '/worker.js') {
    res.writeHead(200, { 'content-type': 'application/javascript', 'service-worker-allowed': '/' });
    res.end(workerSource());
    return;
  }
  if (url.pathname === '/leaf') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(leafSource(url.searchParams.get('tag') || 'unknown'));
    return;
  }
  if (url.pathname === '/middle') {
    const tag = url.searchParams.get('tag') || 'unknown';
    res.writeHead(200, { 'content-type': 'text/html' });
    const leafHost = url.searchParams.get('returnToTop') === '1' ? 'first.test' : 'nested.test';
    res.end(`<!doctype html><iframe src="${origin(leafHost)}/leaf?tag=${encodeURIComponent(tag)}"></iframe>`);
    return;
  }
  if (url.pathname.startsWith('/observe-')) {
    const tag = url.searchParams.get('tag') || 'unknown';
    res.writeHead(200, {
      'content-type': 'text/plain',
      'set-cookie': `${cookieNames(tag).response}=1; Path=/; SameSite=None; Secure`
    });
    res.end('observed');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><body>top</body>');
});

// HTTP top-level page embedding HTTPS at the same registrable hostname.
// A secure descendant is allowed; the policy must still distinguish the sites.
const insecureServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><body>HTTP top</body>');
});

server.on('upgrade', (req, socket) => {
  const host = String(req.headers.host || '').split(':')[0];
  const url = new URL(req.url, 'https://' + host);
  const tag = url.searchParams.get('tag') || 'unknown';
  observed.push({ kind: 'wss', host, path: url.pathname, tag, cookie: req.headers.cookie || '' });
  const accept = crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept +
    `\r\nSet-Cookie: ${cookieNames(tag).ws}=1; Path=/; SameSite=None; Secure\r\n\r\n`);
  socket.on('error', () => {});
  setTimeout(() => socket.end(), 30);
});

async function open(url) {
  const id = await nacre.createTab(url, false);
  const tab = nacre.tabs.get(id);
  assert.ok(tab, 'tab must be created');
  await until(() => !tab.pageView.webContents.isLoading() && tab.pageView.webContents.getURL() === url, 'page load ' + url);
  return tab;
}

async function seedCookie(ses, host, name) {
  await ses.cookies.set({
    url: origin(host),
    name,
    value: '1',
    path: '/',
    secure: true,
    sameSite: 'no_restriction'
  });
}

function assertContainsCookie(value, name, expected, label) {
  assert.equal(new RegExp('(?:^|;\\s*)' + name + '=1(?:;|$)').test(String(value || '')), expected, label);
}

async function runFrameScenario(policy, tag, crossSite, crossScheme = false, siteControl = null) {
  const ses = nacre.regularSession();
  if (policy !== null) nacre.preferences().cookiePolicy = policy;
  const targetHost = crossSite === true ? 'nested.test' : 'first.test';
  await seedCookie(ses, targetHost, cookieNames(tag).seed);
  const topOrigin = crossScheme ? `http://first.test:${insecureServer.address().port}` : origin('first.test');
  const tab = await open(topOrigin + '/top?tag=' + tag);
  try {
    if (siteControl) {
      const accepted = await nacre.chrome().webContents.executeJavaScript('window.nacre.applySiteCookies(' + JSON.stringify({ tabId: tab.id, origin: topOrigin, documentEpoch: tab.siteControlsEpoch || 0, policy: siteControl.policy, scope: siteControl.scope }) + ')');
      assert.equal(accepted, true, 'site cookie control accepted by the real trusted IPC');
    }
    tab.pageView.webContents.on('console-message', (_event, details) => console.error('fixture console:', details.message));
    if (policy === 'block-third-party' && process.env.NACRE_COOKIE_CDP_PROBE) {
      const debuggerApi = tab.pageView.webContents.debugger;
      debuggerApi.attach('1.3');
      const controls = {
        enableThirdPartyCookieRestriction: true,
        disableThirdPartyCookieMetadata: false,
        disableThirdPartyCookieHeuristics: false
      };
      const configure = async (sessionId) => {
        await debuggerApi.sendCommand('Network.enable', {}, sessionId);
        await debuggerApi.sendCommand('Network.setCookieControls', controls, sessionId);
      };
      if (process.env.NACRE_COOKIE_CDP_PROBE === 'frame-targets') {
        debuggerApi.on('message', async (_event, method, params) => {
          if (method !== 'Target.attachedToTarget') return;
          const entry = { type: params.targetInfo.type, url: params.targetInfo.url, configured: false };
          nativeProbeEvents.push(entry);
          try {
            await configure(params.sessionId);
            await debuggerApi.sendCommand('Target.setAutoAttach', {
              autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
              filter: [{ type: 'iframe' }, { exclude: true }]
            }, params.sessionId);
            entry.configured = true;
          } catch (error) { entry.error = String(error.message || error); }
          finally {
            await debuggerApi.sendCommand('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {});
          }
        });
        await debuggerApi.sendCommand('Target.setAutoAttach', {
          autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
          filter: [{ type: 'iframe' }, { exclude: true }]
        });
      }
      await configure();
      tab.pageView.webContents.reload();
      await until(() => !tab.pageView.webContents.isLoading(), 'reload after Network.setCookieControls');
    }
    const frameUrl = crossSite
      ? origin('middle.test') + '/middle?tag=' + tag + (crossSite === 'return-to-top' ? '&returnToTop=1' : '')
      : origin('first.test') + '/leaf?tag=' + tag;
    const result = await tab.pageView.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture message timeout')), 15000);
      addEventListener('message', event => {
        if (event.data && event.data.marker === 'nacre-cookie-policy' && event.data.tag === ${JSON.stringify(tag)}) {
          clearTimeout(timer); resolve(event.data);
        }
      }, { once: false });
      const frame = document.createElement('iframe');
      frame.src = ${JSON.stringify(frameUrl)};
      document.body.append(frame);
    })`);
    if (result.error) throw new Error(result.error);
    return result;
  } finally {
    nacre.closeTab(tab.id);
  }
}

function traffic(tag, host, path) {
  return observed.find((entry) => entry.tag === tag && entry.host === host && entry.path === path);
}

(async () => {
  await Promise.all([
    new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)),
    new Promise((resolve) => insecureServer.listen(0, '127.0.0.1', resolve)),
    app.whenReady()
  ]);
  port = server.address().port;
  await until(() => nacre.tabs.size > 0, 'Nacre startup');
  const ses = nacre.regularSession();
  const expectedFingerprint = new crypto.X509Certificate(fs.readFileSync(path.join(tlsFixture, 'cert.pem'))).fingerprint256;
  ses.setCertificateVerifyProc((request, callback) => {
    let trusted = false;
    try {
      trusted = hosts.has(request.hostname) && new crypto.X509Certificate(request.certificate.data).fingerprint256 === expectedFingerprint;
    } catch {}
    callback(trusted ? 0 : -3);
  });

  if (process.env.NACRE_COOKIE_EXTENSION_PROBE === '1') {
    const extensionPath = path.join(scratch, 'cookie-extension-probe');
    fs.mkdirSync(extensionPath);
    fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Cookie settings capability probe', version: '1.0', permissions: ['contentSettings']
    }));
    fs.writeFileSync(path.join(extensionPath, 'probe.html'), '<!doctype html><title>Local capability probe</title>');
    const extension = await ses.extensions.loadExtension(extensionPath);
    const capabilityWindow = new BrowserWindow({ show: false, webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    try {
      await capabilityWindow.loadURL('chrome-extension://' + extension.id + '/probe.html');
      const capability = await capabilityWindow.webContents.executeJavaScript(`({
        contentSettingsType: typeof chrome.contentSettings,
        cookiesSetType: typeof chrome.contentSettings?.cookies?.set
      })`);
      nativeProbeEvents.push({ type: 'extension-capability', ...capability });
    } finally {
      capabilityWindow.destroy();
      ses.extensions.removeExtension(extension.id);
    }
  }

  if (process.env.NACRE_COOKIE_SITE_PROBE === '1') {
    for (const scope of ['persistent', 'temporary']) {
      const tag = 'site_' + scope;
      await runFrameScenario('allow', tag, true, false, { policy: 'block-all', scope });
      await record('site ' + scope + ': block-all overrides global allow for nested HTTPS/WSS and detached ServiceWorker traffic', () => {
        for (const pathName of ['/leaf', '/observe-page', '/observe-ws', '/observe-worker']) {
          const entry = traffic(tag, 'nested.test', pathName);
          assert.ok(entry, pathName + ' request observed'); assert.equal(entry.cookie, '', pathName + ' cookie header blocked');
        }
      });
      await record('site ' + scope + ': response cookies are blocked and only persistent rules enter preferences', async () => {
        const names = cookieNames(tag), cookies = await ses.cookies.get({ url: origin('nested.test') });
        assert.deepEqual(cookies.filter(item => [names.response, names.ws].includes(item.name)).map(item => item.name), []);
        const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
        assert.equal(Object.hasOwn(saved.siteCookiePolicies || {}, 'first.test'), scope === 'persistent');
      });
      const cleanupTab = await open(origin('first.test') + '/top?tag=site_cleanup');
      assert.equal(await nacre.chrome().webContents.executeJavaScript('window.nacre.applySiteCookies(' + JSON.stringify({ tabId: cleanupTab.id, origin: origin('first.test'), documentEpoch: cleanupTab.siteControlsEpoch || 0, policy: 'default', scope: 'persistent' }) + ')'), true);
      nacre.closeTab(cleanupTab.id);
      await ses.clearData({ dataTypes: ['cookies', 'serviceWorkers'] });
    }
    const tag = 'site_allow';
    await runFrameScenario('block-all', tag, false, false, { policy: 'allow', scope: 'temporary' });
    await record('site allow exception: identified first-party HTTPS and WSS retain cookies', () => {
      for (const pathName of ['/observe-page', '/observe-ws']) {
        const entry = traffic(tag, 'first.test', pathName); assert.ok(entry); assertContainsCookie(entry.cookie, cookieNames(tag).seed, true, pathName + ' explicit exception');
      }
    });
    await record('site allow exception never relaxes the global policy for a detached worker', () => {
      const entry = traffic(tag, 'first.test', '/observe-worker'); assert.ok(entry); assert.equal(entry.cookie, '');
    });
    console.log(JSON.stringify({ electron: process.versions.electron, chromium: process.versions.chrome, results, observed }, null, 2));
    server.closeAllConnections(); server.close(); insecureServer.closeAllConnections(); insecureServer.close();
    app.exit(results.some(result => result.status === 'FAIL') ? 1 : 0); return;
  }

  if (process.env.NACRE_COOKIE_TOGGLE_PROBE === '1') {
    const chrome = nacre.chrome().webContents;
    await record('startup: quick cookie indicator matches the effective saved policy', async () => {
      assert.equal(nacre.preferences().cookiePolicy, 'allow', 'fixture starts with a saved allow policy');
      assert.equal(nacre.preferences().blockThirdPartyCookies, false, 'legacy indicator derives from the effective policy');
      await until(() => chrome.executeJavaScript(`document.querySelector('[data-setting="blockThirdPartyCookies"]')?.classList.contains('is-on') === false`), 'startup indicator reflects allow');
    });
    for (const [initialPolicy, enable] of [['allow', true], ['block-third-party', false], ['block-all', false]]) {
      const tag = 'toggle_' + initialPolicy.replaceAll('-', '_');
      await record(`quick cookie toggle: ${initialPolicy} to ${enable ? 'block-third-party' : 'allow'} changes real HTTPS and WSS traffic`, async () => {
        nacre.preferences().cookiePolicy = initialPolicy;
        nacre.preferences().blockThirdPartyCookies = initialPolicy !== 'allow';
        nacre.sendState();
        await until(() => chrome.executeJavaScript(`document.querySelector('[data-setting="blockThirdPartyCookies"]')?.classList.contains('is-on') === ${initialPolicy !== 'allow'}`), 'quick toggle initial state');
        await chrome.executeJavaScript(`document.querySelector('[data-setting="blockThirdPartyCookies"]').click()`);
        await until(() => nacre.preferences().blockThirdPartyCookies === enable, 'quick toggle IPC received');
        await runFrameScenario(null, tag, true);
        for (const pathName of ['/observe-page', '/observe-ws']) {
          const entry = traffic(tag, 'nested.test', pathName);
          assert.ok(entry, pathName + ' real request received');
          assertContainsCookie(entry.cookie, cookieNames(tag).seed, !enable, pathName + ' follows the clicked setting');
        }
        assert.equal(nacre.preferences().cookiePolicy, enable ? 'block-third-party' : 'allow', 'effective policy synchronized');
        const persisted = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
        assert.equal(persisted.cookiePolicy, nacre.preferences().cookiePolicy, 'effective policy saved');
        assert.equal(persisted.blockThirdPartyCookies, enable, 'indicator saved consistently');
      });
      await ses.clearData({ dataTypes: ['cookies', 'serviceWorkers'] });
    }
    for (const policy of ['allow', 'block-third-party']) {
      await record(`preferences: explicit ${policy} policy overrides a contradictory legacy indicator`, async () => {
        nacre.preferences().cookiePolicy = policy === 'allow' ? 'block-third-party' : 'allow';
        await chrome.executeJavaScript(`window.nacre.savePreferences({ cookiePolicy: ${JSON.stringify(policy)}, blockThirdPartyCookies: ${policy === 'allow'} })`);
        await until(() => nacre.preferences().cookiePolicy === policy, 'preferences IPC received');
        const tag = 'preferences_' + policy.replaceAll('-', '_');
        await runFrameScenario(null, tag, true);
        for (const pathName of ['/observe-page', '/observe-ws']) {
          const entry = traffic(tag, 'nested.test', pathName);
          assert.ok(entry, pathName + ' preference request received');
          assertContainsCookie(entry.cookie, cookieNames(tag).seed, policy === 'allow', pathName + ' follows explicit policy');
        }
        assert.equal(nacre.preferences().blockThirdPartyCookies, policy !== 'allow', 'indicator follows explicit policy');
        const persisted = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
        assert.equal(persisted.cookiePolicy, policy);
        assert.equal(persisted.blockThirdPartyCookies, policy !== 'allow');
      });
      await ses.clearData({ dataTypes: ['cookies', 'serviceWorkers'] });
    }
    console.log(JSON.stringify({ electron: process.versions.electron, chromium: process.versions.chrome, results, observed }, null, 2));
    server.closeAllConnections(); server.close();
    insecureServer.closeAllConnections(); insecureServer.close();
    app.exit(results.some(result => result.status === 'FAIL') ? 1 : 0);
    return;
  }

  const allowTag = 'allow';
  const allow = await runFrameScenario('allow', allowTag, false);
  javascriptObservations.allow = allow;
  await record('allow: document.cookie and Cookie Store remain usable', () => {
    const names = cookieNames(allowTag);
    assertContainsCookie(allow.documentCookie, names.seed, true, 'seed cookie readable');
    assertContainsCookie(allow.documentCookie, names.doc, true, 'document.cookie write readable');
    assert.ok(allow.storeNames.includes(names.store), 'Cookie Store write readable');
    assert.ok(allow.worker.cookies.includes(names.worker), 'worker Cookie Store write readable');
  });
  await record('allow: HTTP, WSS and Service Worker traffic carries cookies', () => {
    for (const pathName of ['/observe-page', '/observe-ws', '/observe-worker']) {
      const entry = traffic(allowTag, 'first.test', pathName);
      assert.ok(entry, pathName + ' traffic observed');
      assertContainsCookie(entry.cookie, cookieNames(allowTag).seed, true, pathName + ' carries seed cookie');
    }
  });
  await ses.clearData({ dataTypes: ['cookies', 'serviceWorkers'] });

  const thirdTag = 'thirdparty';
  const firstParty = await runFrameScenario('block-third-party', thirdTag + '_first', false);
  const thirdParty = await runFrameScenario('block-third-party', thirdTag, true);
  javascriptObservations.firstParty = firstParty;
  javascriptObservations.thirdParty = thirdParty;
  await record('block-third-party: first-party document and worker cookies remain usable', () => {
    const names = cookieNames(thirdTag + '_first');
    assertContainsCookie(firstParty.documentCookie, names.seed, true, 'first-party seed readable');
    assertContainsCookie(firstParty.documentCookie, names.doc, true, 'first-party write readable');
    assert.ok(firstParty.storeNames.includes(names.store), 'first-party Cookie Store write readable');
    assert.ok(firstParty.worker.cookies.includes(names.worker), 'first-party worker Cookie Store write readable');
  });
  await record('block-third-party: same-site framed HTTPS and WSS preserve first-party cookies', () => {
    for (const pathName of ['/top', '/leaf', '/observe-page', '/observe-ws']) {
      const entry = traffic(thirdTag + '_first', 'first.test', pathName);
      assert.ok(entry, pathName + ' first-party positive control observed');
      assertContainsCookie(entry.cookie, cookieNames(thirdTag + '_first').seed, true, pathName + ' first-party cookie preserved');
    }
  });
  await record('block-third-party: nested cross-site document and Cookie Store access are blocked', () => {
    const names = cookieNames(thirdTag);
    assertContainsCookie(thirdParty.documentCookie, names.seed, false, 'third-party seed hidden');
    assertContainsCookie(thirdParty.documentCookie, names.doc, false, 'third-party document write rejected');
    assert.equal(thirdParty.storeNames.includes(names.store), false, 'third-party Cookie Store write rejected');
    assert.equal(thirdParty.worker.cookies.includes(names.worker), false, 'third-party worker Cookie Store write rejected');
  });
  await record('block-third-party: nested framed HTTP and WSS traffic omits cookies', () => {
    for (const pathName of ['/observe-page', '/observe-ws']) {
      const entry = traffic(thirdTag, 'nested.test', pathName);
      assert.ok(entry, pathName + ' nested traffic observed');
      assert.equal(entry.cookie, '', pathName + ' must not carry cookies');
    }
  });
  await record('block-third-party: script-readable cookie identifiers cannot be relayed in a credentialless POST', () => {
    const relay = traffic(thirdTag, 'middle.test', '/relay');
    assert.ok(relay && relay.body, 'collector received the real request body');
    assert.equal(relay.cookie, '', 'collector request carries no Cookie header');
    assert.equal(relay.body.includes(cookieNames(thirdTag).seed), false, 'third-party cookie identifier must not be script-readable and relayed');
  });
  await record('block-third-party: nested detached Service Worker traffic omits cookies', () => {
    const entry = traffic(thirdTag, 'nested.test', '/observe-worker');
    assert.ok(entry, 'detached worker traffic observed');
    assert.equal(entry.cookie, '', 'detached worker must not carry cookies');
  });
  await record('block-third-party: response cookies from nested frames and detached workers are not stored', async () => {
    const names = cookieNames(thirdTag);
    const stored = await ses.cookies.get({ url: origin('nested.test') });
    assert.deepEqual(stored.filter(cookie => [names.response, names.ws].includes(cookie.name)).map(cookie => cookie.name), []);
  });
  await record('block-third-party: detached first-party worker also omits cookies without a provable top frame', () => {
    const entry = traffic(thirdTag + '_first', 'first.test', '/observe-worker');
    assert.ok(entry, 'first-party detached worker traffic observed');
    assert.equal(entry.cookie, '', 'detached worker cannot be classified from its own initiator');
  });
  const schemeTag = 'crossscheme';
  javascriptObservations.crossScheme = await runFrameScenario('block-third-party', schemeTag, false, true);
  await record('block-third-party: HTTP top to HTTPS and WSS on the same hostname omits cookies', () => {
    for (const pathName of ['/observe-page', '/observe-ws']) {
      const entry = traffic(schemeTag, 'first.test', pathName);
      assert.ok(entry, pathName + ' cross-scheme traffic observed');
      assert.equal(entry.cookie, '', pathName + ' must omit cookies across schemes');
    }
  });
  const ancestorTag = 'crossancestor';
  javascriptObservations.crossAncestor = await runFrameScenario('block-third-party', ancestorTag, 'return-to-top');
  await record('block-third-party: A to B to A frame ancestry cannot restore first-party network cookies', async () => {
    for (const pathName of ['/leaf', '/observe-page', '/observe-ws']) {
      const entry = traffic(ancestorTag, 'first.test', pathName);
      assert.ok(entry, pathName + ' cross-site ancestor traffic observed');
      assert.equal(entry.cookie, '', pathName + ' must omit cookies through a cross-site ancestor');
    }
    const names = cookieNames(ancestorTag);
    const stored = await ses.cookies.get({ url: origin('first.test') });
    assert.deepEqual(stored.filter(cookie => [names.response, names.ws].includes(cookie.name)).map(cookie => cookie.name), []);
  });
  await ses.clearData({ dataTypes: ['cookies', 'serviceWorkers'] });

  const allTag = 'blockall';
  const blocked = await runFrameScenario('block-all', allTag, false);
  javascriptObservations.blockAll = blocked;
  await record('block-all: document, Cookie Store and worker cookie access are blocked', () => {
    const names = cookieNames(allTag);
    assert.equal(blocked.navigatorCookieEnabled, false, 'native renderer reports cookies disabled');
    assertContainsCookie(blocked.documentCookie, names.seed, false, 'seed cookie hidden');
    assertContainsCookie(blocked.documentCookie, names.doc, false, 'document write rejected');
    assert.equal(blocked.storeNames.includes(names.store), false, 'Cookie Store write rejected');
    assert.equal(blocked.worker.cookies.includes(names.worker), false, 'worker Cookie Store write rejected');
  });
  await record('block-all: HTTP, WSS and Service Worker traffic omits cookies', () => {
    for (const pathName of ['/observe-page', '/observe-ws', '/observe-worker']) {
      const entry = traffic(allTag, 'first.test', pathName);
      assert.ok(entry, pathName + ' traffic observed');
      assert.equal(entry.cookie, '', pathName + ' must not carry cookies');
    }
  });
  await record('block-all: script-readable cookie identifiers cannot be relayed in a credentialless POST', () => {
    const relay = traffic(allTag, 'middle.test', '/relay');
    assert.ok(relay && relay.body, 'collector received the real request body');
    assert.equal(relay.cookie, '', 'collector request carries no Cookie header');
    assert.equal(relay.body.includes(cookieNames(allTag).seed), false, 'blocked cookie identifier must not be script-readable and relayed');
  });

  const stored = await ses.cookies.get({});
  await record('blocked contexts do not persist response, WebSocket or script cookies', () => {
    const { seed, ...newCookies } = cookieNames(allTag);
    const blockedNames = new Set(Object.values(newCookies));
    assert.deepEqual(stored.filter((cookie) => blockedNames.has(cookie.name)).map((cookie) => cookie.name), []);
  });

  console.log(JSON.stringify({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    profile: scratch,
    results,
    observed,
    javascriptObservations,
    nativeProbeEvents
  }, null, 2));
  server.closeAllConnections();
  server.close();
  insecureServer.closeAllConnections();
  insecureServer.close();
  app.exit(results.some((result) => result.status === 'FAIL') ? 1 : 0);
})().catch((error) => {
  console.error(error.stack || error);
  console.error(JSON.stringify({ observed, nativeProbeEvents }, null, 2));
  server.closeAllConnections();
  server.close();
  app.exit(2);
});
