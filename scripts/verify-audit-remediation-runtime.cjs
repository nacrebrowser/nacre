'use strict';
const fs = require('node:fs'), path = require('node:path');
const { launch } = require('./test-support/electron-fixture.cjs');
const root = process.env.NACRE_AUDIT_ROOT || path.resolve(__dirname, '..');
const out = path.join(root, '.cache/audit-remediation'); fs.mkdirSync(out, { recursive: true });
if (!process.versions.electron) {
  const temp = path.join(out, 'fixture'); fs.mkdirSync(temp, { recursive: true });
  const profile = fs.mkdtempSync(path.join(temp, 'run-'));
  const env = { ...process.env, NACRE_AUDIT_ROOT: root, NACRE_AUDIT_PROFILE: profile };
  try { const result = launch([__filename], { env, encoding: 'utf8', timeout: 120000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.error) console.error(result.error.message); process.exitCode = result.status ?? 1;
  } finally { const resolved = path.resolve(profile); if (path.dirname(resolved) !== path.resolve(temp) || !path.basename(resolved).startsWith('run-')) throw Error('Unsafe cleanup'); fs.rmSync(resolved, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow, safeStorage } = require('electron');
  const assert = require('node:assert/strict'), http = require('node:http'), https = require('node:https'), crypto = require('node:crypto'), Module = require('node:module');
  const profile = process.env.NACRE_AUDIT_PROFILE, hits = [], checks = [];
  const tls = require('./local-tls-fixture.cjs').tlsFixture();
  app.setPath('userData', profile); app.setPath('appData', profile); app.setPath('sessionData', path.join(profile, 'session'));
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.test 127.0.0.1, EXCLUDE 127.0.0.1');
  BrowserWindow.prototype.show = function () {};
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(fn, label) { for (let n = 0; n < 300; n++) { if (await fn()) return; await wait(20); } throw Error('Timeout ' + label); }
  function handler(req, res) {
    const url = new URL(req.url, 'http://fixture.test'); hits.push({ type: 'http', host: req.headers.host, path: url.pathname, query: url.search });
    if (url.pathname === '/sw.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{const p=e.ports[0];e.waitUntil((async()=>{if(e.data.delay)await new Promise(r=>setTimeout(r,e.data.delay));try{await fetch(e.data.url,{mode:'no-cors'});p?.postMessage('allowed')}catch{p?.postMessage('blocked')}})());});`); }
    if (url.pathname === '/script.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end('self.fixtureScriptLoaded=true;'); }
    if (url.pathname === '/strict-sw.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(`importScripts('http://allow.test:${server.address().port}/script.js');self.addEventListener('install',()=>self.skipWaiting());`); }
    if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/destination?utm_source=secret&fbclid=secret&keep=yes#fragment' }); return res.end(); }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Remediation fixture</title><body>Local test</body>');
  }
  const server = http.createServer(handler), secure = https.createServer(tls, handler);
  for (const instance of [server, secure]) instance.on('upgrade', (req, socket) => { hits.push({ type: instance === secure ? 'wss' : 'ws', host: req.headers.host, path: new URL(req.url, 'http://fixture.test').pathname }); socket.destroy(); });
  app.whenReady().then(() => require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile, 'settings.json'), 'settings', {
    directMode: true, torCountry: '', httpsOnly: false, adBlockEnabled: true, antiFingerprint: true,
    adBlockCustomFilters: '||ads.test^\n||domain-rule.test^$domain=127.0.0.1', cookiePolicy: 'allow', clearOnQuit: false, language: 'en'
  }));
  const filename = path.join(root, 'src/main.cjs'), main = new Module(filename, module); main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
  main._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={tabs,createTab,closeTab,navigateTab,snapshot,browserSessions,normalActivity:()=>protectionActivity.snapshot(),settings:()=>settings,chrome:()=>chromeView};', filename);
  const nacre = main.exports;
  async function run() {
    await app.whenReady(); await until(() => nacre.chrome() && nacre.tabs.size, 'startup');
    await Promise.all([new Promise(resolve => server.listen(0, '127.0.0.1', resolve)), new Promise(resolve => secure.listen(0, '127.0.0.1', resolve))]);
    const origin = 'http://127.0.0.1:' + server.address().port, ad = 'http://ads.test:' + server.address().port;
    const id = await nacre.createTab(origin + '/page', false), tab = nacre.tabs.get(id), wc = tab.pageView.webContents, ses = wc.session;
    await until(() => !wc.isLoading() && wc.getURL() === origin + '/page', 'page');
    const api = (method, value) => nacre.chrome().webContents.executeJavaScript('window.nacre.' + method + '(' + JSON.stringify(value) + ')');
    const pageFetch = url => wc.executeJavaScript(`fetch(${JSON.stringify(url)},{mode:'no-cors'}).then(()=>true,()=>false)`);
    const swFetch = (url, contents = wc) => contents.executeJavaScript(`(async()=>{const r=await navigator.serviceWorker.ready;const c=new MessageChannel();const answer=new Promise(resolve=>{c.port1.onmessage=e=>resolve(e.data);setTimeout(()=>resolve('timeout'),4000)});r.active.postMessage({url:${JSON.stringify(url)}},[c.port2]);return answer;})()`);
    const socket = url => wc.executeJavaScript(`new Promise(resolve=>{const s=new WebSocket(${JSON.stringify(url)});s.onopen=()=>{s.close();resolve('open')};s.onerror=()=>resolve('error');setTimeout(()=>{s.close();resolve('timeout')},2000)})`);
    assert.equal(await pageFetch(ad + '/page-blocked'), false);
    await wc.executeJavaScript(`navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)`);
    const before = nacre.snapshot().settings.adBlockStats.total;
    assert.equal(await swFetch(ad + '/worker-blocked'), 'blocked');
    assert.ok(nacre.snapshot().settings.adBlockStats.total > before);
    assert.ok(!hits.some(h => h.path === '/worker-blocked'));
    assert.ok(nacre.snapshot().settings.protectionActivity.entries.some(e => e.host === 'ads.test' && e.action === 'request-blocked' && !e.site));
    checks.push('N1 page/SW blocked with server-negative control, counters and unattributed normal journal');
    nacre.settings().adBlockEnabled = false;
    assert.equal(await swFetch(ad + '/worker-positive'), 'allowed'); assert.ok(hits.some(h => h.path === '/worker-positive'));
    nacre.settings().adBlockEnabled = true;
    assert.equal(await swFetch('http://domain-rule.test:' + server.address().port + '/domain-worker'), 'blocked');
    nacre.settings().adBlockSiteExceptions = ['127.0.0.1'];
    assert.equal(await pageFetch(ad + '/page-exception'), true);
    assert.equal(await swFetch(ad + '/worker-no-top-exception'), 'blocked');
    nacre.settings().adBlockSiteExceptions = [];
    nacre.settings().adBlockMode = 'strict';
    assert.equal(await wc.executeJavaScript(`navigator.serviceWorker.register('/strict-sw.js?case=strict',{scope:'/strict-test/'}).then(()=>true,()=>false)`), false);
    assert.ok(!hits.some(h => h.path === '/strict-sw.js' && h.query === '?case=strict'));
    nacre.settings().adBlockMode = 'comfort';
    assert.equal(await wc.executeJavaScript(`navigator.serviceWorker.register('/strict-sw.js?case=comfort',{scope:'/strict-test/'}).then(()=>true,()=>false)`), true);
    assert.ok(hits.some(h => h.path === '/script.js'));
    checks.push('N1 disabled/allow, worker-source domain rule, verified page exception, unknown-top worker refusal and strict script control');
    await socket('ws://ads.test:' + server.address().port + '/ws-blocked');
    assert.ok(!hits.some(h => h.path === '/ws-blocked'));
    await socket('ws://allow.test:' + server.address().port + '/ws-positive');
    assert.ok(hits.some(h => h.path === '/ws-positive'));
    ses.setCertificateVerifyProc((request, callback) => { let valid = false; try { valid = ['ads.test', 'allow.test'].includes(request.hostname) && new crypto.X509Certificate(request.certificate.data).fingerprint256 === tls.fingerprint; } catch {} callback(valid ? 0 : -3); });
    await socket('wss://ads.test:' + secure.address().port + '/wss-blocked');
    await socket('wss://allow.test:' + secure.address().port + '/wss-positive');
    assert.ok(!hits.some(h => h.path === '/wss-blocked')); assert.ok(hits.some(h => h.path === '/wss-positive'));
    nacre.settings().httpsOnly = true; tab.httpAcceptedUrl = '';
    await socket('ws://allow.test:' + server.address().port + '/ws-https-blocked');
    assert.ok(!hits.some(h => h.path === '/ws-https-blocked'));
    tab.httpAcceptedUrl = tab.url;
    await socket('ws://allow.test:' + server.address().port + '/ws-document-exception');
    assert.ok(hits.some(h => h.path === '/ws-document-exception'));
    nacre.settings().httpsOnly = false; tab.httpAcceptedUrl = '';
    checks.push('N3 WS/WSS filter and handshake-positive controls; HTTPS-only WS refusal and exact document exception');
    assert.throws(() => ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (_d, cb) => cb({})), /Nacre owns/);
    assert.equal(await pageFetch(ad + '/guard-still-blocked'), false); assert.ok(!hits.some(h => h.path === '/guard-still-blocked'));
    checks.push('S1 attempted listener replacement rejected; real filtered request still blocked afterward');
    const sourceId = await nacre.createTab('nacre://source/?url=' + encodeURIComponent(origin + '/source-ok'), false, { workspaceId: tab.workspaceId });
    const source = nacre.tabs.get(sourceId).pageView.webContents; await until(() => !source.isLoading(), 'source page');
    await until(() => hits.some(h => h.path === '/source-ok'), 'authorized source fetch');
    const wrong = await source.executeJavaScript(`window.nacre.getSource(${JSON.stringify(origin + '/source-forbidden')}).then(()=>true,()=>false)`);
    assert.equal(wrong, false); assert.ok(!hits.some(h => h.path === '/source-forbidden'));
    checks.push('S5 source viewer allows its bound target and rejects any other target before network');
    const redirectId = await nacre.createTab(origin + '/redirect'); const redirectWc = nacre.tabs.get(redirectId).pageView.webContents;
    await until(() => !redirectWc.isLoading() && redirectWc.getURL().includes('/destination?keep=yes'), 'clean redirect');
    const destinations = hits.filter(h => h.path === '/destination'); assert.ok(destinations.length); assert.ok(destinations.every(h => h.query === '?keep=yes'));
    checks.push('S4 redirect destination never receives tracking parameters; unrelated query preserved');
    const info = await api('getSitePermissions'); assert.ok(info.labels && !Object.hasOwn(info.labels, 'display-capture'));
    const display = await wc.executeJavaScript(`navigator.mediaDevices.getDisplayMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'unexpected'},e=>e.name)`, true);
    assert.notEqual(display, 'unexpected');
    checks.push('S3 unsupported display capture absent from controls and rejected without source picker');
    const privateId = await nacre.createTab(origin + '/private', true), privateTab = nacre.tabs.get(privateId), privateWc = privateTab.pageView.webContents;
    await until(() => !privateWc.isLoading() && privateWc.getURL() === origin + '/private', 'private page');
    await privateWc.executeJavaScript(`navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)`);
    const normalCount = nacre.snapshot().settings.adBlockStats.total, normalJournal = JSON.stringify(nacre.normalActivity());
    assert.equal(await swFetch(ad + '/private-worker-blocked', privateWc), 'blocked');
    assert.ok(privateTab.privateStats.total > 0); assert.ok(privateTab.privateActivity.snapshot().entries.some(e => e.host === 'ads.test'));
    assert.equal(nacre.snapshot().settings.adBlockStats.total, normalCount); assert.equal(JSON.stringify(nacre.normalActivity()), normalJournal);
    checks.push('N1 private worker blocked and counted only in its private session journal');
    const inactiveBefore = nacre.snapshot().settings.adBlockStats.total;
    await wc.executeJavaScript(`navigator.serviceWorker.ready.then(r=>{r.active.postMessage({url:${JSON.stringify(ad + '/inactive-worker-blocked')},delay:400});return true})`);
    for (const entry of [...nacre.tabs.values()]) if (!entry.private && entry.workspaceId === tab.workspaceId) nacre.closeTab(entry.id, { discard: true });
    assert.ok(![...nacre.tabs.values()].some(entry => entry.browserSession === ses));
    await until(() => nacre.snapshot().settings.adBlockStats.total > inactiveBefore, 'inactive worker filtering');
    assert.ok(!hits.some(h => h.path === '/inactive-worker-blocked'));
    checks.push('N1 delayed Service Worker request remains blocked after all workspace documents close');
    const result = { status: 'PASS', electron: process.versions.electron, checks, hits, limits: ['Local server evidence; no global Windows packet capture or Tor/signing verification.', 'N4 native worker protection remains open; separate fingerprint diagnostics document the scope.'] };
    fs.writeFileSync(path.join(out, 'runtime-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  }
  const timeout = setTimeout(() => { console.error('Fixture timeout'); app.exit(9); }, 90000); timeout.unref();
  run().then(() => { server.close(); secure.close(); app.exit(0); }, error => { console.error(error); fs.writeFileSync(path.join(out, 'runtime-result.json'), JSON.stringify({ status: 'FAIL', error: error.stack || String(error), checks, hits }, null, 2)); server.close(); secure.close(); app.exit(1); });
}
