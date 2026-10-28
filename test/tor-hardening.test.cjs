'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256File, verifyPinnedTorFiles, TOR_FILE_PINS, TOR_PLATFORM_PINS, TOR_ARCHIVES, torExecutableNames, torPinsFor, secureTorRuntimeDirectory } = require('../src/tor-integrity.cjs');
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

test('Linux bundle has its own pins, libraries and archive digest; Windows pins are untouched', () => {
  const linux = TOR_PLATFORM_PINS.linux;
  for (const name of ['tor', 'libcrypto.so.3', 'libevent-2.1.so.7', 'libssl.so.3', 'pluggable_transports/lyrebird', 'pluggable_transports/conjure-client', 'pt_config.json', 'geoip', 'geoip6', 'tor.sha256.json']) {
    assert.match(linux[name] || '', /^[0-9a-f]{64}$/, name);
  }
  assert.ok(!Object.keys(linux).some((name) => name.endsWith('.exe') || name.startsWith('debug/')), 'no Windows or debug binaries on Linux');
  assert.equal(TOR_PLATFORM_PINS.win32, TOR_FILE_PINS);
  assert.equal(TOR_ARCHIVES.win32.sha256, 'c1988c701de2f24f7d098d1d6d7f507b58f27740d097f29c246e0524d639b252');
  assert.equal(TOR_ARCHIVES.linux.sha256, '19cf18726eecb362e0f21d27afa9ea9efe5da928bfdfbb1ceb5fe54519e87f4a');
  assert.deepEqual(torExecutableNames('win32'), { tor: 'tor.exe', lyrebird: 'lyrebird.exe' });
  assert.deepEqual(torExecutableNames('linux'), { tor: 'tor', lyrebird: 'lyrebird' });
  assert.deepEqual(torPinsFor('darwin'), {}, 'an unsupported platform trusts no bundled file');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
  assert.match(main, /env: torProcessEnvironment\(bundleDirectory\)/);
  const { torVendorName, torProcessEnvironment } = require('../src/tor-integrity.cjs');
  assert.equal(torVendorName('win32'), 'tor');
  assert.equal(torVendorName('linux'), 'tor-linux');
  assert.equal(torProcessEnvironment('/b', 'linux', { PATH: '/bin' }).LD_LIBRARY_PATH, '/b');
  const windowsEnv = { PATH: 'C:\Windows' };
  assert.equal(torProcessEnvironment('C:\b', 'win32', windowsEnv), windowsEnv);
  assert.doesNotMatch(main, /torAsset\('tor\.exe'\)|'lyrebird\.exe'/);
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

