'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256File, verifyPinnedTorFiles, TOR_FILE_PINS, secureTorRuntimeDirectory } = require('../src/tor-integrity.cjs');
const { TOR_BUNDLE_VERSION } = require('../src/tor-integrity.cjs');
const { buildTorRuntimeArguments } = require('../src/tor-runtime-config.cjs');

test('Tor runtime arguments are loopback-only, cookie-authenticated and avoid disk/DNS listeners', () => {
  const args = buildTorRuntimeArguments({
    socksPort: 20001, controlPort: 20002, cookiePath: 'profile/tor/control_auth_cookie',
    dataDirectory: 'profile/tor/runtime', geoip: 'geoip', geoip6: 'geoip6', country: 'GB'
  });
  const pairs = Object.fromEntries(Array.from({ length: args.length / 2 }, (_v, index) => [args[index * 2], args[index * 2 + 1]]));
  assert.equal(pairs['--SocksPort'], '127.0.0.1:20001 IsolateSOCKSAuth');
  assert.equal(pairs['--ControlPort'], '127.0.0.1:20002');
  assert.equal(pairs['--CookieAuthentication'], '1');
  assert.equal(pairs['--CookieAuthFile'], 'profile/tor/control_auth_cookie');
  assert.equal(pairs['--CookieAuthFileGroupReadable'], '0');
  assert.equal(pairs['--DataDirectoryGroupReadable'], '0');
  assert.equal(pairs['--AvoidDiskWrites'], '1');
  assert.equal(pairs['--SafeLogging'], '1');
  assert.equal(pairs['--DNSPort'], '0');
  assert.equal(pairs['--AutomapHostsOnResolve'], '0');
  assert.equal(pairs['--ClientOnly'], '1');
  assert.equal(pairs['--SafeSocks'], '1');
  assert.equal(pairs['--ExitNodes'], '{gb}');
  assert.equal(args.includes('--ControlPortWriteToFile'), false);
  assert.throws(() => buildTorRuntimeArguments({ socksPort: 0, controlPort: 1, cookiePath: 'a', dataDirectory: 'b', geoip: 'c', geoip6: 'd', country: 'GB' }), /Port SOCKS/);
});

test('runtime bundle pins include Tor, Lyrebird, Conjure and bridges config and detect replacement', () => {
  assert.ok(TOR_FILE_PINS['tor.exe']);
  assert.ok(TOR_FILE_PINS['pluggable_transports/lyrebird.exe']);
  assert.ok(TOR_FILE_PINS['pluggable_transports/conjure-client.exe']);
  assert.ok(TOR_FILE_PINS['pt_config.json']);
  assert.equal(TOR_BUNDLE_VERSION, '15.0.25');
  assert.doesNotMatch(Object.keys(TOR_FILE_PINS).join(' '), /snowflake\.exe/i, 'Snowflake is a Lyrebird transport, not a separate bundled executable');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-tor-pins-'));
  try {
    const contents = {};
    const pins = {};
    for (const name of ['tor.exe', 'pluggable_transports/lyrebird.exe', 'pluggable_transports/conjure-client.exe']) {
      const bytes = Buffer.from(`fixture:${name}`);
      const file = path.join(directory, ...name.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      pins[name] = sha256File(file);
      contents[name] = file;
    }
    assert.deepEqual(verifyPinnedTorFiles(directory, pins), { valid: true, mismatches: [] });
    fs.writeFileSync(contents['tor.exe'], 'tampered');
    assert.equal(verifyPinnedTorFiles(directory, pins).mismatches[0].file, 'tor.exe');
    assert.equal(verifyPinnedTorFiles(directory, { missing: '0'.repeat(64) }).mismatches[0].reason, 'missing');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Windows Tor runtime ACL is restricted to the current SID and SYSTEM', () => {
  const calls = [];
  const result = secureTorRuntimeDirectory('C:/profile/tor-runtime/random', 'win32', (file, args) => {
    calls.push({ file, args });
    if (file === 'whoami.exe') return '"MACHINE\\TestUser","S-1-5-21-123-456-789-1001"';
    return '';
  });
  assert.equal(result, 'ACL Windows limitée au compte courant et à SYSTEM');
  assert.deepEqual(calls[0], { file: 'whoami.exe', args: ['/user', '/fo', 'csv', '/nh'] });
  assert.deepEqual(calls[1], {
    file: 'icacls.exe',
    args: ['C:/profile/tor-runtime/random', '/inheritance:r', '/grant:r', '*S-1-5-21-123-456-789-1001:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F']
  });
  assert.throws(() => secureTorRuntimeDirectory('x', 'win32', () => 'bad output'), /identifier le compte Windows/);
});

test('Tor integrity pins are checked before spawn and runtime data is under userData, then deleted after exit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /verifyPinnedTorFiles\(torDirectory\)[\s\S]*?Tor ne sera pas lancé[\s\S]*?spawn\(executable, args/);
  assert.match(main, /path\.join\(app\.getPath\('userData'\), 'tor-runtime'/);
  assert.match(main, /secureTorRuntimeDirectory\(dataDirectory\)/);
  assert.match(main, /waitForTorExit\(runtime\.process, 5000\)[\s\S]*?removeTorDataDirectory\(runtime\.dataDirectory\)/);
  assert.match(main, /runtime\.output = sanitizeTorLog\(runtime\.output \+ chunk\.toString\(\)\)/);
});

