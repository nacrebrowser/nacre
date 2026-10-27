'use strict';

// Dev-only red-team attacks (not packaged). Each test states a hypothesis and
// the expected safe result. Attacks use real helpers from src/ or the exact
// source text of functions in src/main.cjs that cannot be required without
// Electron. No network access; no real malware.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sanitizeDownloadFilename, isRiskyOpenDownload } = require('../src/data-policy.cjs');
const { isAllowedNavigationTarget, isAllowedNacreRequest } = require('../src/security-core.cjs');
const { closedProxyConfig } = require('../src/network-security.cjs');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');

// A4 hypothesis: a reserved device name survives sanitization when it is
// followed by spaces before the extension, or uses superscript digits.
// Expected: the stem is never a reserved device name.
const RESERVED_STEM = /^(CON|PRN|AUX|NUL|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3])$/i;
function reservedStem(name) {
  return RESERVED_STEM.test(name.split('.')[0].replace(/ +$/, ''));
}

test('red team A4: reserved device names are never produced, including space and superscript variants', () => {
  for (const hostile of ['CON .txt', 'NUL .pdf', 'COM\u00b9.txt', 'LPT\u00b2.log', 'COM\u00b3 .exe']) {
    const out = sanitizeDownloadFilename(hostile);
    assert.equal(reservedStem(out), false, `${JSON.stringify(hostile)} -> ${JSON.stringify(out)}`);
  }
});

test('red team A4: path separators, RTL override and overlong names are neutralised', () => {
  assert.equal(sanitizeDownloadFilename('..\\..\\x.exe'), 'x.exe');
  assert.equal(sanitizeDownloadFilename('report\u202Efdp.exe').includes('\u202E'), false);
  const long = sanitizeDownloadFilename('a'.repeat(400) + '.pdf');
  assert.ok(long.length <= 255, `length ${long.length}`);
  assert.equal(sanitizeDownloadFilename('name. '), 'name');
});

test('red team A4: script-capable and shell-triggering extensions require the confirmation path', () => {
  // Hypothesis: these Windows and browser types run code or launch a shell
  // action but are not in the risky list. Expected: flagged as risky.
  for (const name of ['x.settingcontent-ms', 'x.search-ms', 'x.jnlp', 'x.xbap', 'x.appxbundle', 'x.msixbundle', 'x.xht']) {
    assert.equal(isRiskyOpenDownload(sanitizeDownloadFilename(name)), true, name);
  }
  assert.equal(isRiskyOpenDownload('file.pdf.exe'), true);
  assert.equal(isRiskyOpenDownload('x.exe '), true);
});

// A5: navigation to non-web schemes and UNC paths from a web frame.
test('red team A5: UNC, trailing-dot and case-varied internal targets are refused', () => {
  const hostile = [
    '\\\\attacker.example\\share\\x.exe',
    'nacre://settings./settings.js',
    'NACRE://SETTINGS/',
    'nacre://settings%2e/',
    'nacre://settings/%00',
  ];
  for (const value of hostile) {
    assert.equal(isAllowedNavigationTarget(value, { isChromeView: false, internalTab: false }), false, value);
    assert.equal(isAllowedNavigationTarget(value, { isChromeView: false, internalTab: true }), false, value);
  }
});

test('red team A5: shell.openExternal is never called and openPath only receives app-owned paths', () => {
  assert.equal((mainSource.match(/shell\.openExternal\(/g) || []).length, 0);
  const openPathCalls = mainSource.match(/shell\.openPath\([^)]*\)/g) || [];
  assert.ok(openPathCalls.length >= 1);
  for (const call of openPathCalls) {
    assert.match(call, /record\.path|settings\.downloadDirectory|app\.getPath/, call);
  }
});

// A2: nacre:// path handling beyond the protocol-paths fixture.
test('red team A2: null bytes, encoded traversal and mixed-case hosts are refused by the request validator', () => {
  const hostile = [
    'nacre://settings/%2e%2e/settings.js',
    'nacre://settings/settings.js%00.html',
    'nacre://Settings/settings.js',
    'nacre://settings./settings.js',
    'nacre://settings/..%5csettings.js',
  ];
  for (const value of hostile) assert.equal(isAllowedNacreRequest(value, 'GET'), false, value);
});

// A3: prototype pollution through parsed JSON and object spread.
test('red team A3: parsed __proto__ keys do not pollute Object.prototype through the settings merge pattern', () => {
  const stored = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}');
  const defaults = { sendGpc: true };
  const merged = { ...defaults, ...stored };
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).polluted2, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(merged.polluted, undefined);
});

test('red team A3: bookmark import is bounded in bytes and count', () => {
  assert.match(mainSource, /fs\.fstatSync\(descriptor\)\.size > 5_000_000/);
  const { parseBookmarkHtml } = require('../src/hardening-core.cjs');
  assert.equal(parseBookmarkHtml('<a href="https://example.org/">x</a>'.repeat(1000), value => value).length, 500);
});

// C-01: a failed add must remove only its own entry, not restore a stale snapshot
// taken before an await (that would erase a concurrent successful add).
test('red team C-01: failed ad-block list add removes only its own entry', () => {
  assert.equal(mainSource.includes('settings.adBlockCustomLists = previousLists'), false);
  assert.match(mainSource, /settings\.adBlockCustomLists = settings\.adBlockCustomLists\.filter\(\(item\) => item\.id !== addedList\.id\);/);
});

// F1: kill switch. Run the exact proxy-selection source with a fake Tor state.
function loadProxySelectors(state) {
  const slice = (start, end) => {
    const from = mainSource.indexOf(start);
    const to = mainSource.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `marker not found: ${start}`);
    return mainSource.slice(from, to);
  };
  const code = [
    slice('function torProxyConfig(port)', 'function settingsPath()'),
    slice('function proxyConfig(proxy, directMode', 'async function configureBrowserSession'),
    '({ effectiveProxyConfig, proxyConfig })',
  ].join('\n');
  const sandbox = { closedProxyConfig, ...state };
  return vm.runInNewContext(code, sandbox);
}

test('red team F1: unreachable or mismatched Tor never falls back to direct or system routing', () => {
  const closed = closedProxyConfig();
  const cases = [
    { name: 'no proxy, no direct mode', state: { settings: { proxy: { enabled: false }, torCountry: '', directMode: false }, torRuntime: null, torConnectingCountry: '' } },
    { name: 'Tor country set, runtime missing', state: { settings: { proxy: { enabled: false }, torCountry: 'DE', directMode: false }, torRuntime: null, torConnectingCountry: '' } },
    { name: 'Tor country set, runtime for another country', state: { settings: { proxy: { enabled: false }, torCountry: 'DE', directMode: false }, torRuntime: { country: 'FR', port: 9050 }, torConnectingCountry: '' } },
    { name: 'Tor country set and direct mode on', state: { settings: { proxy: { enabled: false }, torCountry: 'DE', directMode: true }, torRuntime: null, torConnectingCountry: '' } },
    { name: 'Tor connecting, runtime not ready', state: { settings: { proxy: { enabled: false }, torCountry: '', directMode: false }, torRuntime: null, torConnectingCountry: 'DE' } },
  ];
  for (const { name, state } of cases) {
    const { effectiveProxyConfig } = loadProxySelectors(state);
    const route = effectiveProxyConfig();
    assert.notEqual(route.mode, 'system', `${name}: fell back to system`);
    assert.match(route.proxyRules, /127\.0\.0\.1:1(?!\d)/, `${name}: closed port not used: ${route.proxyRules}`);
    assert.doesNotMatch(route.proxyRules, /DIRECT/i, `${name}: direct route present`);
  }
  assert.equal(closed.proxyRules.includes('127.0.0.1:1'), true);
});

test('red team F1: the only system route is an explicit direct mode with no Tor country', () => {
  const { effectiveProxyConfig } = loadProxySelectors({ settings: { proxy: { enabled: false }, torCountry: '', directMode: true }, torRuntime: null, torConnectingCountry: '' });
  const route = effectiveProxyConfig();
  assert.equal(route.mode, 'system');
  assert.equal(Object.keys(route).length, 1);
});
