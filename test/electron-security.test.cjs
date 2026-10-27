'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expectedFuses, fuseConfig, verifyFuseWire, loadFuseApi } = require('../scripts/electron-fuse-policy.cjs');
const { FuseV1Options, FuseVersion } = loadFuseApi();
const { isTrustedNacreMainFrame, isAllowedNavigationTarget, isAllowedNacreRequest, isCanonicalInternalPath } = require('../src/security-core.cjs');
const { INTERNAL_SECURITY_HEADERS } = require('../src/internal-response.cjs');

test('Electron fuse policy disables Node/debug/file extras and requires the ASAR', () => {
  const config = fuseConfig();
  assert.equal(config.version, FuseVersion.V1);
  assert.deepEqual(config, { version: FuseVersion.V1, ...expectedFuses });
  const wire = Object.fromEntries(Object.entries(expectedFuses).map(([key, value]) => [key, value ? 49 : 48]));
  wire.version = FuseVersion.V1;
  assert.equal(verifyFuseWire(wire), true);
  wire[FuseV1Options.RunAsNode] = 49;
  assert.equal(verifyFuseWire(wire), false);
});

test('IPC trust is restricted to a live trusted nacre main frame', () => {
  const frame = { url: 'nacre://settings/', isDestroyed: () => false };
  const sender = { mainFrame: frame };
  assert.equal(isTrustedNacreMainFrame({ sender, senderFrame: frame }), true);
  const attackerFrame = { ...frame, url: 'https://attacker.example' };
  assert.equal(isTrustedNacreMainFrame({ sender: { mainFrame: attackerFrame }, senderFrame: attackerFrame }), false);
  const lookalikeFrame = { ...frame, url: 'nacre://settings.evil/' };
  assert.equal(isTrustedNacreMainFrame({ sender: { mainFrame: lookalikeFrame }, senderFrame: lookalikeFrame }), false);
  assert.equal(isTrustedNacreMainFrame({ sender, senderFrame: { ...frame, url: 'nacre://settings/', isDestroyed: () => true } }), false);
});

test('navigation and internal protocol reject untrusted and dangerous schemes', () => {
  assert.equal(isAllowedNavigationTarget('https://example.org/', { internalTab: false }), true);
  assert.equal(isAllowedNavigationTarget('file:///C:/secret.txt', { internalTab: false }), false);
  assert.equal(isAllowedNavigationTarget('chrome://settings/', { internalTab: false }), false);
  assert.equal(isAllowedNavigationTarget('nacre://settings/', { internalTab: false }), false);
  assert.equal(isAllowedNavigationTarget('nacre://settings/', { internalTab: true }), true);
  assert.equal(isAllowedNavigationTarget('https://example.org/', { isChromeView: true }), false);
  assert.equal(isAllowedNacreRequest('nacre://settings/settings.js', 'GET'), true);
  assert.equal(isAllowedNacreRequest('nacre://unknown/secret', 'GET'), false);
  assert.equal(isAllowedNacreRequest('nacre://settings/', 'POST'), false);
  for (const path of ['/../settings.js', '/%2e%2e/settings.js', '/%252e%252e/settings.js', '/foo%2f..%2fsettings.js', '/foo\\\\..\\\\settings.js']) {
    assert.equal(isCanonicalInternalPath(path), false, `Internal path must reject traversal form ${path}`);
  }
  assert.equal(isCanonicalInternalPath('/settings.js'), true);
});

test('every privileged IPC handler checks the trusted internal frame', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const registrations = [...main.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'[^\n]*/g)];
  assert.ok(registrations.length >= 50, `Expected the IPC inventory, found ${registrations.length} channels`);
  for (const match of registrations) {
    const channel = match[1];
    const firstLines = main.slice(match.index, match.index + 900);
    if (channel === 'nacre:cookie-frame-policy') assert.match(firstLines, /frame\.top !== event\.sender\.mainFrame/);
    else if (channel === 'nacre:adblock:prepare-frame') assert.match(firstLines, /frame\.top !== contents\.mainFrame[\s\S]*?frame\.url !== frameUrl/);
    else if (channel === 'nacre:fingerprint-seed') assert.match(firstLines, /frame\.top !== event\.sender\.mainFrame[\s\S]*?host !== hostOf\(frame\.url\)/);
    else assert.match(firstLines, /isTrustedUIEvent\(event\)/, `Missing trusted sender check for ${channel}`);
  }
});

test('all internal responses receive frame-denial headers and pages have no unsafe-inline scripts', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
  const responses = fs.readFileSync(path.join(root, 'src', 'internal-response.cjs'), 'utf8');
  assert.equal(INTERNAL_SECURITY_HEADERS['Content-Security-Policy'].includes("frame-ancestors 'none'"), true);
  assert.equal(INTERNAL_SECURITY_HEADERS['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.match(responses, /for \(const \[name, value\] of Object\.entries\(INTERNAL_SECURITY_HEADERS\)\) headers\.set\(name, value\)/);
  const handler = main.slice(main.indexOf('function handleNacreRequest'), main.indexOf('function registerNacreProtocolForSession'));
  assert.match(handler, /internalErrorResponse\(403/);
  assert.match(handler, /internalErrorResponse\(404/);
  assert.match(handler, /secureNacreResponse\(/);
  for (const file of fs.readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, 'src', file), 'utf8');
    assert.doesNotMatch(html, /script-src[^"']*unsafe-inline|<script(?:\s[^>]*)?>\s*[^<]/i, `${file} contains an inline script policy or script`);
  }
});

test('download opening checks the final path and requires consent for a renamed executable', async () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const start = main.indexOf('async function openDownloadedFile(');
  assert.notEqual(start, -1);
  const end = main.slice(start).search(/\r?\n\}\r?\n/);
  const body = main.slice(start, start + end) + '\n}';
  const opens = [];
  const dialogs = [];
  let response = 1;
  const { isRiskyOpenDownload, isSafeAutoOpenDownload } = require('../src/data-policy.cjs');
  const open = new Function('isRiskyOpenDownload', 'isSafeAutoOpenDownload', 'translate', 'settings', 'dialog', 'win', 'tell', 'shell', 'sendState', body + '; return openDownloadedFile;')(
    isRiskyOpenDownload, isSafeAutoOpenDownload, key => key, { language: 'en' },
    { showMessageBox: async (_window, options) => { dialogs.push(options); return { response }; } },
    null, () => {}, { openPath: async target => { opens.push(target); return ''; } }, () => {}
  );
  for (const extension of ['cmd', 'exe', 'lnk', 'html', 'svg', 'ps1', 'hta', 'url']) {
    const record = { filename: 'guide.txt', path: 'C:\\Downloads\\guide.' + extension };
    await open(record, true);
    await open(record, false);
  }
  assert.deepEqual(opens, []);
  assert.equal(dialogs.length, 8);
  response = 0;
  await open({ filename: 'guide.txt', path: 'C:\\Downloads\\guide.cmd' }, false);
  await open({ filename: 'guide.txt', path: 'C:\\Downloads\\guide.txt' }, true);
  assert.deepEqual(opens, ['C:\\Downloads\\guide.cmd', 'C:\\Downloads\\guide.txt']);
});
