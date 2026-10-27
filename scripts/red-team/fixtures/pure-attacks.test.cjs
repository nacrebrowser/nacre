'use strict';

// Development-only red-team fixtures. Pure validators only: no network, no Electron.
// Each assertion is an attack; a failure means the attack SUCCEEDED against the build.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDownloadFilename, isRiskyOpenDownload } = require('../../../src/data-policy.cjs');
const { isAllowedNavigationTarget, isAllowedNacreRequest } = require('../../../src/security-core.cjs');
const { shouldBlockRequestCookies } = require('../../../src/cookie-policy.cjs');
const { validateBridgeLines, validateSettingsPayload } = require('../../../src/privacy-core.cjs');
const { safeFilterListUrl } = require('../../../src/adblock-core.cjs');
const { secureInternalResponse, internalErrorResponse } = require('../../../src/internal-response.cjs');

const BIDI_OR_INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

test('attack: download names cannot escape the download directory', async () => {
  const hostile = ['../../../Windows/System32/evil.exe', '..\\..\\startup\\evil.exe', 'C:\\Users\\x\\a.exe', '/etc/passwd', '\\\\attacker\\share\\a.exe'];
  for (const name of hostile) {
    const safe = sanitizeDownloadFilename(name);
    assert.ok(!/[\\/:]/.test(safe), `separator survived: ${name} -> ${safe}`);
    assert.ok(safe !== '' && safe !== '.' && safe !== '..', `degenerate name: ${name}`);
  }
});

test('attack: Windows reserved device names are neutralised', () => {
  for (const name of ['CON', 'con.txt', 'NUL.tar.gz', 'LPT1.pdf', 'com9']) {
    assert.match(sanitizeDownloadFilename(name), /^_/, name);
  }
});

test('attack: trailing dots and spaces cannot disguise an executable', () => {
  assert.equal(sanitizeDownloadFilename('invoice.exe. '), 'invoice.exe');
  assert.equal(isRiskyOpenDownload(sanitizeDownloadFilename('invoice.exe. ')), true);
});

test('attack: bidi override cannot spoof the visible extension', () => {
  // "\u202E" reverses display so "gpj.exe" appears as "exe.jpg" in Explorer-like UI.
  const spoofed = 'invoice\u202Egpj.exe';
  const safe = sanitizeDownloadFilename(spoofed);
  assert.equal(BIDI_OR_INVISIBLE.test(safe), false, `bidi/invisible survived: ${JSON.stringify(safe)}`);
});

test('attack: zero-width characters cannot hide the executable extension', () => {
  const safe = sanitizeDownloadFilename('report.ex\u200Be');
  assert.equal(BIDI_OR_INVISIBLE.test(safe), false, `invisible survived: ${JSON.stringify(safe)}`);
});

test('attack: executable detection is case-insensitive across dangerous types', () => {
  for (const name of ['a.EXE', 'a.Lnk', 'a.SCF', 'a.hta', 'a.ps1', 'a.pdf.exe', 'a.MSI']) {
    assert.equal(isRiskyOpenDownload(name), true, name);
  }
  assert.equal(isRiskyOpenDownload('a.pdf'), false);
});

test('attack: overlong download names are bounded', () => {
  assert.ok(sanitizeDownloadFilename('a'.repeat(400) + '.exe').length <= 180);
});

test('attack: nacre:// cannot be reached through non-GET methods or spoofed authorities', () => {
  assert.equal(isAllowedNacreRequest('nacre://settings/', 'POST'), false);
  assert.equal(isAllowedNacreRequest('nacre://settings/', 'PUT'), false);
  assert.equal(isAllowedNacreRequest('nacre://settings./', 'GET'), false);
  assert.equal(isAllowedNacreRequest('nacre://settings:80/', 'GET'), false);
  assert.equal(isAllowedNacreRequest('nacre://user@settings/', 'GET'), false);
  assert.equal(isAllowedNacreRequest('nacre://SETTINGS/', 'GET'), false);
});

test('attack: web-reachable schemes cannot navigate a privileged tab', () => {
  const hostile = [
    'file:///C:/Windows/win.ini',
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'blob:nacre://settings/00000000-0000-0000-0000-000000000000',
    'view-source:nacre://settings/',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x',
    'mailto:a@b.invalid',
    '\\\\attacker.invalid\\share\\x',
    'nacre://settings:8080/',
    'nacre://settings/%2e%2e/app/',
    'nacre://settings/..%5capp/'
  ];
  for (const value of hostile) {
    assert.equal(isAllowedNavigationTarget(value, { internalTab: true }), false, value);
  }
});

test('attack: web pages cannot navigate the trusted chrome view to internal tabs', () => {
  assert.equal(isAllowedNavigationTarget('nacre://settings/', { isChromeView: true }), false);
  assert.equal(isAllowedNavigationTarget('http://example.invalid/', { isChromeView: true }), false);
});

test('attack: third-party cookies are blocked for initiator-less worker and fetch requests', () => {
  assert.equal(shouldBlockRequestCookies('block-third-party', { requestUrl: 'https://third.test/', resourceType: 'serviceWorker' }), true);
  assert.equal(shouldBlockRequestCookies('block-third-party', { requestUrl: 'https://third.test/', resourceType: 'other' }), true);
  assert.equal(shouldBlockRequestCookies('block-third-party', { requestUrl: 'https://third.test/', tabUrl: 'https://first.test/', resourceType: 'xhr' }), true);
  assert.equal(shouldBlockRequestCookies('block-all', { resourceType: 'mainFrame' }), true);
});

test('attack: injected Tor directives cannot ride along in bridge lines', () => {
  const injections = [
    'obfs4 198.51.100.1:443 ' + 'A'.repeat(40) + ' cert=AAAA iat-mode=0\nControlPort 9999',
    'ExitNodes {us}',
    'snowflake 192.0.2.1:80 ' + 'B'.repeat(40) + ' url=https://x.invalid fronts=a ice=b\u0000',
    'obfs4 198.51.100.1:443 ' + 'A'.repeat(40) + ' cert=AAAA iat-mode=0 ClientTransportPlugin evil'
  ];
  for (const line of injections) {
    assert.equal(validateBridgeLines('custom', line).valid, false, line);
  }
  assert.equal(validateBridgeLines('custom', 'ExitNodes {us}').valid, false);
  assert.equal(validateBridgeLines('custom', 'ControlPort 9999').valid, false);
});

test('attack: settings payload cannot smuggle prototype or unknown keys', () => {
  assert.equal(validateSettingsPayload(JSON.parse('{"__proto__": {"polluted": true}}')), false);
  assert.equal(validateSettingsPayload(JSON.parse('{"constructor": {"prototype": {}}}')), false);
  assert.equal(validateSettingsPayload({ theme: 'dark', proxy: { mode: 'system' } }), false);
  assert.equal(validateSettingsPayload(['theme']), false);
});

test('attack: filter-list fetches cannot target loopback, LAN or userinfo URLs', () => {
  const hostile = [
    'http://example.invalid/list.txt',
    'https://127.0.0.1/list.txt',
    'https://2130706433/list.txt',
    'https://[::1]/list.txt',
    'https://192.168.1.1/list.txt',
    'https://localhost/list.txt',
    'https://localhost./list.txt',
    'https://intranet.local/list.txt',
    'https://user:pass@example.invalid/list.txt',
    'file:///C:/list.txt'
  ];
  for (const value of hostile) assert.equal(safeFilterListUrl(value), null, value);
  assert.ok(safeFilterListUrl('https://lists.example.com/list.txt'));
});

test('attack: internal responses keep strict headers even if a handler tries to weaken them', async () => {
  const response = await secureInternalResponse(Promise.resolve(new Response('x', {
    headers: { 'Content-Security-Policy': "script-src *", 'X-Frame-Options': 'ALLOWALL' }
  })));
  assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  const failed = await secureInternalResponse(Promise.reject(new Error('boom')));
  assert.equal(failed.status, 500);
  assert.match(failed.headers.get('Content-Security-Policy'), /object-src 'none'/);
  assert.throws(() => internalErrorResponse(302, 'redirect'), RangeError);
});
