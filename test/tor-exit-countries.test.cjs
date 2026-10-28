'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TOR_EXIT_COUNTRIES,
  isTorExitCountry,
  assertTorExitCountry,
  migrateStoredTorCountry
} = require('../src/tor-exit-countries.cjs');
const { buildTorRuntimeArguments } = require('../src/tor-runtime-config.cjs');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, 'src', file), 'utf8');
const ORIGINAL_SIX = ['DE', 'GB', 'JP', 'US', 'PL', 'NL'];
const EXPECTED_ADDITIONAL = [
  'AR', 'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CL', 'CO', 'CZ', 'DK', 'EE', 'ES',
  'FI', 'FR', 'GR', 'HK', 'HR', 'HU', 'ID', 'IE', 'IL', 'IN', 'IS', 'IT', 'KR',
  'LT', 'LU', 'LV', 'MX', 'MY', 'NO', 'NZ', 'PT', 'RO', 'RU', 'SE', 'SG', 'SI',
  'SK', 'TH', 'TR', 'TW', 'UA', 'VN', 'ZA'
];
const ALL_SUPPORTED = [...ORIGINAL_SIX, ...EXPECTED_ADDITIONAL].sort();
function readGeoIpCountries(file) {
  // The bundle prepared for this platform (vendor/tor on Windows, vendor/tor-linux on Linux).
  const rows = fs.readFileSync(path.join(root, 'vendor', require('../src/tor-integrity.cjs').torVendorName(), file), 'utf8').split(/\r?\n/);
  return new Set(rows.map((line) => line.trimEnd().split(',').at(-1)).filter((code) => /^[A-Z]{2}$/.test(code)));
}
const GEOIP_V4_COUNTRIES = readGeoIpCountries('geoip');
const GEOIP_V6_COUNTRIES = readGeoIpCountries('geoip6');

function torArgs(country) {
  return buildTorRuntimeArguments({
    socksPort: 9050,
    controlPort: 'auto',
    cookiePath: 'cookie',
    dataDirectory: 'data',
    geoip: 'geoip',
    geoip6: 'geoip6',
    country
  });
}

test('the allowlist includes the original six and the reviewed additional countries', () => {
  assert.deepEqual(Object.keys(TOR_EXIT_COUNTRIES).sort(), ALL_SUPPORTED);
  assert.ok(EXPECTED_ADDITIONAL.every((code) => !ORIGINAL_SIX.includes(code)));
  for (const code of ALL_SUPPORTED) assert.equal(typeof TOR_EXIT_COUNTRIES[code], 'string', code);
});

test('each supported code is present in both pinned GeoIP databases and reaches torrc in lowercase', () => {
  for (const code of ALL_SUPPORTED) {
    assert.equal(GEOIP_V4_COUNTRIES.has(code), true, `${code} is absent from bundled GeoIP v4`);
    assert.equal(GEOIP_V6_COUNTRIES.has(code), true, `${code} is absent from bundled GeoIP v6`);
    assert.equal(isTorExitCountry(code), true, code);
    assert.equal(assertTorExitCountry(code), code);
    const args = torArgs(code);
    assert.equal(args[args.indexOf('--ExitNodes') + 1], `{${code.toLowerCase()}}`);
    assert.equal(args[args.indexOf('--StrictNodes') + 1], '1');
  }
});

test('codes outside the allowlist, lowercase codes, and non-strings are rejected', () => {
  const rejected = ['XX', 'US;', '../x', '', 'us', 'gb', 'GB ', 'constructor', '__proto__', ['GB'], null, undefined, 42, {}];
  for (const value of rejected) {
    assert.equal(isTorExitCountry(value), false, String(value));
    assert.throws(() => assertTorExitCountry(value), TypeError, String(value));
    assert.throws(() => torArgs(value), /Pays de sortie Tor non autorisé/, String(value));
  }
});

test('stored legacy codes migrate to the canonical form, anything else becomes empty', () => {
  assert.equal(migrateStoredTorCountry('gb'), 'GB');
  assert.equal(migrateStoredTorCountry('de'), 'DE');
  assert.equal(migrateStoredTorCountry('XX'), '');
  assert.equal(migrateStoredTorCountry(['gb']), '');
  assert.equal(migrateStoredTorCountry(undefined), '');
});

test('the main-process handlers validate the country before writing state', () => {
  // main.cjs needs Electron to load, so this pins the validation call sites in its source.
  const main = read('main.cjs');
  assert.match(main, /async function connectTorImpl\(country\) \{\s*if \(torConnectingCountry\)[^\n]*\n\s*if \(!isTorExitSelection\(country\)\) throw/);
  assert.match(main, /function chooseTorCountry\(country\) \{\s*assertTorExitCountry\(country\);/);
});

// Menu DOM and localized country identity: test/ui-security-contracts.test.cjs.

test('the expanded Tor menu remains bounded and scrollable', () => {
  assert.match(read('styles.css'), /\.vpn-menu\s*\{[^}]*max-height:\s*min\([1-8]\dvh,\s*720px\)/s);
  assert.match(read('styles.css'), /\.vpn-menu\s*\{[^}]*overflow-y:\s*auto/s);
});

// Rendered country disclaimer: test/ui-security-contracts.test.cjs.

test('the IPC connect and choose handlers forward the raw value to the validating functions', () => {
  const main = read('main.cjs');
  assert.match(main, /ipcMain\.on\('nacre:connect-tor', async \(event, country\) => \{\s*if \(!isTrustedUIEvent\(event\)\) return;\s*try \{ await connectTor\(country\); \}/);
  assert.match(main, /ipcMain\.on\('nacre:choose-tor-country', \(event, country\) => \{\s*if \(!isTrustedUIEvent\(event\)\) return;\s*try \{ chooseTorCountry\(country\); \}/);
});

test('startTor rejects an unknown country before any file, port or process work', () => {
  const main = read('main.cjs');
  assert.match(main, /async function startTor\(country, \{ background = false, onSpawn \} = \{\}\) \{\s*if \(!isTorExitSelection\(country\)\) throw new Error\(TOR_EXIT_COUNTRY_ERROR\);\s*let executable = torAsset/);
});

test('the generic update-setting channel cannot write a Tor country', () => {
  const main = read('main.cjs');
  const handler = main.match(/ipcMain\.on\('nacre:update-setting',[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.ok(handler, 'the update-setting handler exists');
  assert.doesNotMatch(handler, /torCountry|torPreferredCountry/);
  assert.match(handler, /typeof value !== 'boolean'\) return;/);
});

test('stored Tor countries are migrated on load and startup goes through startTor', () => {
  const main = read('main.cjs');
  assert.match(main, /torCountry: migrateStoredTorCountry\(stored\.torCountry\)/);
  assert.match(main, /torPreferredCountry: migrateStoredTorCountry\(stored\.torPreferredCountry\)/);
  assert.match(main, /startTor\(country\)\.then/);
});

test('torrc ExitNodes is built only inside buildTorRuntimeArguments, which validates first', () => {
  const runtime = read('tor-runtime-config.cjs');
  assert.match(runtime, /if \(!isTorExitSelection\(country\)\) throw new TypeError\(TOR_EXIT_COUNTRY_ERROR\);\s*[\s\S]*'--ExitNodes', `\{\$\{country\.toLowerCase\(\)\}\}`/);
  const main = read('main.cjs');
  assert.doesNotMatch(main, /ExitNodes/);
});

test('le mode automatique AUTO est une sélection valide mais pas un pays', () => {
  const { isTorExitCountry, isTorExitSelection, assertTorExitCountry, migrateStoredTorCountry } = require('../src/tor-exit-countries.cjs');
  assert.equal(isTorExitSelection('AUTO'), true);
  assert.equal(isTorExitSelection('GB'), true);
  assert.equal(isTorExitCountry('AUTO'), false);
  assert.equal(isTorExitSelection('auto'), false);
  assert.equal(assertTorExitCountry('AUTO'), 'AUTO');
  assert.throws(() => assertTorExitCountry('XX'));
  assert.equal(migrateStoredTorCountry('auto'), 'AUTO');
  assert.equal(migrateStoredTorCountry('gb'), 'GB');
  assert.equal(migrateStoredTorCountry(undefined), '');
});

test('buildTorRuntimeArguments omet ExitNodes et StrictNodes en mode AUTO uniquement', () => {
  const { buildTorRuntimeArguments } = require('../src/tor-runtime-config.cjs');
  const base = { cookiePath: 'c', dataDirectory: 'd', geoip: 'g', geoip6: 'g6' };
  const auto = buildTorRuntimeArguments({ ...base, country: 'AUTO' });
  assert.equal(auto.includes('--ExitNodes'), false);
  assert.equal(auto.includes('--StrictNodes'), false);
  assert.equal(auto.includes('--ClientOnly'), true);
  const fixed = buildTorRuntimeArguments({ ...base, country: 'DE' });
  assert.equal(fixed[fixed.indexOf('--ExitNodes') + 1], '{de}');
  assert.equal(fixed[fixed.indexOf('--StrictNodes') + 1], '1');
  assert.throws(() => buildTorRuntimeArguments({ ...base, country: 'ZZ' }));
});

test('Tor is owned by the Nacre process and exits when it disappears', () => {
  const base = { cookiePath: 'cookie', dataDirectory: 'data', geoip: 'geoip', geoip6: 'geoip6', country: 'AUTO' };
  const owner = (args) => args[args.indexOf('--__OwningControllerProcess') + 1];
  assert.equal(owner(buildTorRuntimeArguments({ ...base, ownerPid: 4242 })), '4242');
  assert.equal(owner(buildTorRuntimeArguments(base)), String(process.pid));
  assert.throws(() => buildTorRuntimeArguments({ ...base, ownerPid: 0 }), TypeError);
});
