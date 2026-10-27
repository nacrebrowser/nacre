'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { app, BrowserWindow, protocol, session } = require('electron');
const { isAllowedNavigationTarget, isAllowedNacreRequest } = require('../src/security-core.cjs');

const mode = process.env.NACRE_NET_AUDIT_MODE || 'proxy';
const resolverRules = process.env.NACRE_NET_AUDIT_HOST_RESOLVER_RULES;
const reportPath = process.env.NACRE_NET_AUDIT_REPORT;
const netLogPath = process.env.NACRE_NET_AUDIT_NETLOG;
const work = path.dirname(reportPath);
const state = { mode, socksRequests: [], canaryHits: 0, deniedNavigation: 0, internalRequests: 0 };
let auditServer;
let socksServer;
let browser;
let logging = false;
let finishing = false;

protocol.registerSchemesAsPrivileged([{ scheme: 'nacre', privileges: { standard: true, secure: true } }]);
app.enableSandbox();
app.setPath('userData', path.join(work, `profile-${mode}-${process.pid}`));
app.commandLine.appendSwitch('host-resolver-rules', resolverRules || 'MAP *.nacre-audit.invalid ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
for (const name of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'disable-default-apps', 'no-pings', 'disable-breakpad', 'disable-domain-reliability', 'disable-quic', 'disable-preconnect', 'dns-prefetch-disable']) app.commandLine.appendSwitch(name);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}
function page() {
  return `<!doctype html><link rel="dns-prefetch" href="//dns-prefetch.nacre-audit.invalid"><link rel="preconnect" href="http://preconnect.nacre-audit.invalid"><img src="http://image.nacre-audit.invalid/pixel"><script src="nacre://app/audit.js"></script>`;
}
function fixtureScript() {
  return `window.runAudit=async()=>{
    const names=['fetch.nacre-audit.invalid','xhr.nacre-audit.invalid','worker.nacre-audit.invalid','redirect.nacre-audit.invalid','198.51.100.42','[2001:db8::42]'];
    const out={};
    out.requests=await Promise.all(names.map(async host=>{try{await fetch('http://'+host+'/resource');return {host,result:'resolved'}}catch{return {host,result:'blocked'}}}));
    out.xhr=await new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.open('GET','http://xhr.nacre-audit.invalid/resource');xhr.onload=()=>resolve('resolved');xhr.onerror=()=>resolve('blocked');xhr.send()});
    out.internalFetch=await fetch('nacre://settings/').then(()=> 'resolved',()=> 'blocked');
    out.webrtcApi=typeof RTCPeerConnection==='function';
    out.openWindow=await new Promise(resolve=>{const popup=window.open('nacre://settings/');setTimeout(()=>resolve(Boolean(popup)),100)});
    const frame=document.createElement('iframe');frame.src='http://127.0.0.1:'+window.auditPort+'/child';document.body.appendChild(frame);
    await new Promise(resolve=>setTimeout(resolve,100));
    frame.src='nacre://settings/';
    await new Promise(resolve=>setTimeout(resolve,100));
    location.href='nacre://settings/';return out;
  }`;
}
function socksStub() {
  return net.createServer((socket) => {
    let buf = Buffer.alloc(0), stage = 0;
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0) {
        if (buf.length < 2 + buf[1]) return;
        const count = buf[1];
        buf = buf.subarray(2 + count);
        socket.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (stage !== 1 || buf.length < 5) return;
      const type = buf[3];
      const n = type === 1 ? 4 : type === 4 ? 16 : type === 3 ? buf[4] : -1;
      const start = type === 3 ? 5 : 4;
      if (n < 0 || buf.length < start + n + 2) return;
      const host = type === 1 ? [...buf.subarray(start, start + n)].join('.') : buf.subarray(start, start + n).toString().toLowerCase();
      const port = buf.readUInt16BE(start + n);
      state.socksRequests.push({ host, port });
      stage = 2;
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
      socket.on('data', () => socket.end('HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
    });
  });
}
function auditServerFactory() {
  return http.createServer((request, response) => {      if (request.url === '/canary') { state.canaryHits++; response.end('ok'); return; }
      if (request.url === '/redirect') { response.writeHead(302, { Location: 'http://redirect-target.nacre-audit.invalid/resource', 'Access-Control-Allow-Origin': '*' }); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Set-Cookie': 'fixture=marker; SameSite=None; Secure' });
      response.end('<!doctype html><title>fixture</title>');
  });
}
async function finish(error) {
  if (finishing) return;
  finishing = true;
  if (error) state.error = String(error.stack || error);
  if (logging) { try { await session.defaultSession.netLog.stopLogging(); } catch {} logging = false; }
  try { fs.writeFileSync(reportPath, JSON.stringify(state, null, 2)); } catch {}
  if (browser && !browser.isDestroyed()) browser.destroy();
  for (const server of [auditServer, socksServer]) if (server && server.listening) server.close();
  app.exit(error ? 1 : 0);
}
async function run() {
  try {
    fs.mkdirSync(work, { recursive: true });
    auditServer = auditServerFactory();
    state.auditPort = await listen(auditServer);
    socksServer = socksStub();
    state.socksPort = await listen(socksServer);
    protocol.handle('nacre', async request => {
      if (!isAllowedNacreRequest(request.url, request.method)) { state.internalRequests++; return new Response('Forbidden', { status: 403 }); }
      const url = new URL(request.url);
      if (url.hostname === 'app' && url.pathname === '/') return new Response(page(), { headers: { 'Content-Type': 'text/html' } });
      if (url.hostname === 'app' && url.pathname === '/audit.js') return new Response(fixtureScript(), { headers: { 'Content-Type': 'text/javascript' } });
      state.internalRequests++;
      return new Response('Forbidden', { status: 403 });
    });
    const ses = session.defaultSession;
    await ses.setProxy(mode === 'direct' ? { mode: 'direct' } : { mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${mode === 'stopped' ? 1 : state.socksPort}`, proxyBypassRules: '<-loopback>' });
    app.configureHostResolver({ secureDnsMode: 'off' });
    const cache = path.join(app.getPath('userData'), 'cache');
    await fs.promises.mkdir(cache, { recursive: true });
    app.setPath('cache', cache);
    await ses.netLog.startLogging(netLogPath, { captureMode: 'everything' });
    logging = true;
    browser = new BrowserWindow({ show: false, webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    browser.webContents.on('will-navigate', (event, url) => { if (!isAllowedNavigationTarget(url, { internalTab: false })) { state.deniedNavigation++; event.preventDefault(); } });
    browser.webContents.on('will-frame-navigate', (event, details) => { if (details && !details.isMainFrame && !isAllowedNavigationTarget(details.url, { internalTab: false })) { state.deniedNavigation++; event.preventDefault(); } });
    browser.webContents.on('will-redirect', (event, url) => { if (!isAllowedNavigationTarget(url, { internalTab: false })) { state.deniedNavigation++; event.preventDefault(); } });
    browser.webContents.on('will-frame-navigate', (_event, details) => { if (details && typeof details.url === 'string' && details.url.startsWith('nacre:')) state.internalNavigationAttempted = true; });
    browser.webContents.on('will-prevent-unload', (event) => event.preventDefault());
    await browser.loadURL(mode === 'direct' ? `http://127.0.0.1:${state.auditPort}/` : 'nacre://app/');
    if (mode === 'proxy') {
      state.pageResults = await browser.webContents.executeJavaScript(`window.auditPort=${state.auditPort};window.runAudit()`);
      await new Promise(resolve => setTimeout(resolve, 600));
    } else {
      await browser.webContents.executeJavaScript(`(new Image()).src='http://127.0.0.1:${state.auditPort}/canary'`);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    await finish();
  } catch (error) { await finish(error); }
}
app.whenReady().then(run).catch(finish);
process.on('uncaughtException', error => { finish(error).catch(() => app.exit(1)); });
process.on('unhandledRejection', error => { finish(error instanceof Error ? error : new Error(String(error))).catch(() => app.exit(1)); });
