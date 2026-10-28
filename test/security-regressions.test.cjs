'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shouldFailClosed, permissionModeFor, socksToken, createCircuitBudget } = require('../src/privacy-core.cjs');
const { shouldUpdateViaTor } = require('../src/adblock-core.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');

test('regression: kill switch keeps Tor-configured sessions fail closed after process loss', () => {
  assert.equal(shouldFailClosed(true, false), true);
  assert.match(main, /handleUnexpectedTorExit\(runtime\)[\s\S]*?setSessionProxy\(ses, torProxyConfig\(1\)\)/);
  const networking = fs.readFileSync(path.join(root, 'src', 'network-security.cjs'), 'utf8');
  assert.match(networking, /proxyRules: `http=\$\{CLOSED_PROXY_HOST\}:\$\{CLOSED_PROXY_PORT\};https=\$\{CLOSED_PROXY_HOST\}:\$\{CLOSED_PROXY_PORT\};socks=\$\{CLOSED_PROXY_HOST\}:\$\{CLOSED_PROXY_PORT\}`/);
});

test('regression: Tor DNS stays inside SOCKS and Chromium DoH is disabled', () => {
  const dns = require('../src/dns-policy.cjs');
  assert.match(main, /app\.configureHostResolver\(hostResolverOptions\(torActive, settings\.secureDnsMode\)\)/);
  for (const mode of ['automatic', 'strict', undefined]) assert.deepEqual(dns.hostResolverOptions(true, mode), { secureDnsMode: 'off' });
  assert.deepEqual(dns.hostResolverOptions(false, 'automatic').secureDnsServers, ['https://dns.quad9.net/dns-query']);
  const torConfig = fs.readFileSync(path.join(root, 'src', 'tor-runtime-config.cjs'), 'utf8');
  const args = require('../src/tor-runtime-config.cjs').buildTorRuntimeArguments({ cookiePath: 'cookie', dataDirectory: 'data', geoip: 'geoip', geoip6: 'geoip6', country: 'GB' });
  assert.equal(args[args.indexOf('--SocksPort') + 1], '127.0.0.1:auto IsolateSOCKSAuth');
  assert.match(torConfig, /'--DNSPort', '0'/);
});

test('regression: WebRTC prevents non-proxied UDP on the process and every WebContents', () => {
  assert.match(main, /force-webrtc-ip-handling-policy', 'disable_non_proxied_udp'/);
  assert.match(main, /function applyWebRTCIPPolicy\(contents\)[\s\S]*?contents\.setWebRTCIPHandlingPolicy\('disable_non_proxied_udp'\)/);
  assert.match(main, /function configureWebContentsSecurity\(contents\)\s*\{\s*applyWebRTCIPPolicy\(contents\)/);
});

test('regression: certificate errors are always rejected without a bypass', () => {
  const handler = main.match(/app\.on\('certificate-error',[\s\S]{0,700}/)?.[0] || '';
  assert.match(handler, /event\.preventDefault\(\);\s*callback\(false\)/);
  assert.doesNotMatch(handler, /callback\(true\)|ignoreCertificateErrors/);
});

test('regression: circuit credentials separate domains and the 16-circuit budget never mixes active identities', () => {
  const secret = Buffer.alloc(32, 11);
  assert.notEqual(socksToken('example.co.uk', secret), socksToken('other.co.uk', secret));
  assert.equal(socksToken('example.co.uk', secret), socksToken('example.co.uk', secret));
  const budget = createCircuitBudget(16);
  for (let index = 0; index < 16; index += 1) {
    assert.equal(budget.ensure(`circuit-${index}`), true);
    assert.equal(budget.enter(`circuit-${index}`), true);
  }
  assert.equal(budget.ensure('seventeenth'), false);
});

test('regression: site permissions default to deny and only accept explicit modes', () => {
  assert.equal(permissionModeFor({}, 'example.test', 'camera'), 'deny');
  assert.equal(permissionModeFor({ 'example.test': { camera: 'allow' } }, 'example.test', 'camera'), 'allow');
  assert.equal(permissionModeFor({ 'example.test': { camera: 'unexpected' } }, 'example.test', 'camera'), 'deny');
});

test('regression: list refresh fails closed when Tor stops and keeps its active snapshot on failure', () => {
  assert.equal(shouldUpdateViaTor(true, false, false), false);
  assert.match(main, /Tor s’est arrêté; la mise à jour des listes a été interrompue sans connexion directe/);
  assert.match(main, /if \(!settings\.torCountry[\s\S]*?Mise à jour fermée[\s\S]*?Aucun repli direct/);
  const core = fs.readFileSync(path.join(root, 'src', 'adblock-core.cjs'), 'utf8');
  assert.match(core, /pointerTemporary[\s\S]*?renameSync\(pointerTemporary, path\.join\(directory, 'active\.json'\)\)/);
});

test('regression: disabling proxy uses a closed local proxy instead of inheriting the system route', () => {
  assert.match(main, /function proxyConfig\(proxy, directMode = settings\.directMode\) \{\s*if \(!proxy\.enabled\) return directMode \? \{ mode: 'system' \} : closedProxyConfig\(\)/);
  assert.match(main, /setSessionProxy\(ses, closedProxyConfig\(\)\)/);
});

test('regression: Tor bundle downloads retain TLS validation and restrict redirect hosts', () => {
  const download = fs.readFileSync(path.join(root, 'scripts', 'download-tor.cjs'), 'utf8');
  assert.match(download, /https\.get\(parsed, \(response\)/);
  assert.doesNotMatch(download, /rejectUnauthorized\s*:\s*false/);
  assert.match(download, /parsed\.protocol !== 'https:' \|\| parsed\.hostname !== originalHost/);
  assert.match(download, /return download\(new URL\(location, parsed\)\.href, output, redirects \+ 1, originalHost\)/);
  assert.match(download, /actualHash !== expectedHash/);
});

test('regression: update checks refuse offline Tor and direct mode waits for explicit consent', async () => {
  const h = await require('../scripts/red-team/harness/electron-stub.cjs').loadMainHeadless();
  const event = { sender: h.chrome, senderFrame: h.chrome.mainFrame };
  const before = h.netFetched.length;
  const status = await h.ipcHandlers.get('nacre:check-updates').fn(event);
  assert.notEqual(status.state, 'ready', 'nothing prepared without a live route');
  assert.equal(h.netFetched.length, before, 'no update fetch without live Tor');
  await assert.rejects(h.ipcHandlers.get('nacre:check-updates').fn({ sender: {}, senderFrame: {} }), Error, 'untrusted callers are refused');
  assert.equal(h.effects.some(e => e.method === 'blocked'), false, 'no host network attempt');
  let warning;
  h.electron.dialog.showMessageBox = async (_window, options) => { warning = options; return { response: 1 }; };
  await h.ipcHandlers.get('nacre:disable-proxy').fn(event);
  assert.ok(warning, 'native warning shown');
  assert.equal(warning.type, 'warning');
  assert.equal(warning.cancelId, 1);
  assert.equal(warning.defaultId, 1);
  assert.ok(warning.buttons.every(label => typeof label === 'string' && label.trim() && !/^(?:dialog|common)\./.test(label)), 'consent buttons must resolve to actual user-facing actions');
  assert.equal(h.effects.some(e => e.method === 'setProxy' && e.args[0]?.mode === 'system'), false, 'cancel never applies the system route');
});

test('regression: new profiles enable Tor and cleanup; existing clear-on-quit choice remains preserved', () => {
  assert.match(main, /settings = \{ \.\.\.defaults, torCountry: TOR_EXIT_AUTO, clearOnQuit: true, directMode: false \}/);
  const schema = require('../src/settings-schema.cjs');
  assert.equal(schema.normalizeStoredScalars({}).clearOnQuit, false);
  assert.equal(schema.normalizeStoredScalars({ clearOnQuit: true }).clearOnQuit, true);
  assert.equal(schema.applyScalarPatch({ clearOnQuit: true }, { clearOnQuit: false }).clearOnQuit, false);
  assert.match(main, /\.\.\.normalizeStoredScalars\(stored\)/);
  assert.match(main, /applyScalarPatch\(next, payload\)/);
  assert.match(main, /if \(settings\.clearOnQuit\) \{[\s\S]*?sessions\.map\(async ses => \{[\s\S]{0,600}?await attempt\(\(\) => ses\.clearData\(\{ dataTypes: \['cookies'/);
  // Only trusted sites in normal workspaces are kept; private sessions never are.
  assert.match(main, /if \(settings\.trustedSites\.length && workspaceIdentityForSession\(ses\)\)/);
});

test('regression: recently-closed tabs do not retain URLs after clearing data or with clear-on-quit', () => {
  assert.match(main, /if \(!options\.discard && !tab\.private && !settings\.clearOnQuit && tab\.url/);
  assert.match(main, /tabs\.clear\(\);\s*recentlyClosedTabs\.length = 0;/);
  assert.match(main, /if \(dataTypes\.includes\('cookies'\) \|\| dataTypes\.includes\('cache'\) \|\| dataTypes\.includes\('siteData'\)\) recentlyClosedTabs\.length = 0/);
});

test('regression: settings page initializes its query parameters before any state update', () => {
  const settings = fs.readFileSync(path.join(root, 'src', 'settings.js'), 'utf8');
  assert.match(settings, /^const params = new URLSearchParams\(location\.search\);/m);
  assert.equal((settings.match(/params\.get\('page'\)/g) || []).length, 2);
  assert.match(settings, /state\?\.settings\?\.proxy\?\.mode === 'tor' && !state\.settings\.proxy\.torError\) api\.disableProxy\(\)/);
  assert.match(settings, /api\.connectTor\(country\)/);
});

test('regression: direct-mode transition rolls back to a closed proxy if route application fails', () => {
  const handler = main.slice(main.indexOf("ipcMain.on('nacre:disable-proxy'"), main.indexOf("ipcMain.on('nacre:connect-tor'"));
  assert.match(handler, /await configureProxyImpl\(\{\}, false\);[\s\S]*?setSessionProxy\(ses, \{ mode: 'system' \}\)[\s\S]*?catch \(error\) \{[\s\S]*?settings\.directMode = false;[\s\S]*?setSessionProxy\(ses, closedProxyConfig\(\)\)/);
});

test('regression: new-tab privacy copy does not claim zero history', () => {
  const home = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.doesNotMatch(home, /zéro historique|zero history/i);
  assert.match(home, /Browsing history is not stored persistently/);
  assert.match(home, /recently closed tabs.*memory/i);
});

test('regression: malformed Nacre path encodings are rejected before URL normalization', () => {
  const security = require('../src/security-core.cjs');
  for (const path of ['/../settings.js', '/%2e%2e/settings.js', '/%252e%252e/settings.js', '/foo%2f..%2fsettings.js', '/foo\\\\..\\\\settings.js']) {
    assert.equal(security.isAllowedNacreRequest(`nacre://settings${path}`, 'GET'), false, path);
    assert.equal(security.isAllowedNavigationTarget(`nacre://settings${path}`, { internalTab: true }), false, path);
  }
  assert.equal(security.isAllowedNacreRequest('nacre://settings/settings.js', 'GET'), true);
});

test('regression: worker locale override experiment remains absent until runtime proof exists', () => {
  const locale = fs.readFileSync(path.join(root, 'src', 'frame-locale.cjs'), 'utf8');
  assert.doesNotMatch(locale, /type: 'service-worker'/);
  assert.doesNotMatch(main, /registerWorkerLocaleOverrides/);
});

test('regression: private partitions are memory-only and purged when the last tab closes', () => {
  assert.match(main, /session\.fromPartition\(partition, \{ cache: false \}\)/);
  assert.match(main, /if \(tab\.privatePartition && !Array\.from\(tabs\.values\(\)\)\.some[\s\S]*?privateSession\.clearData\(/);
  assert.doesNotMatch(main, /session\.fromPartition\(`persist:/);
});
