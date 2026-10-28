'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const TOR_BUNDLE_VERSION = '15.0.25';
const TOR_VERSION = '0.4.9.14';
// Tor Expert Bundle digests, as listed in the Tor Project's
// sha256sums-signed-build.txt for this version.
const TOR_ARCHIVES = Object.freeze({
  win32: Object.freeze({ name: `tor-expert-bundle-windows-x86_64-${TOR_BUNDLE_VERSION}.tar.gz`, sha256: 'c1988c701de2f24f7d098d1d6d7f507b58f27740d097f29c246e0524d639b252' }),
  linux: Object.freeze({ name: `tor-expert-bundle-linux-x86_64-${TOR_BUNDLE_VERSION}.tar.gz`, sha256: '19cf18726eecb362e0f21d27afa9ea9efe5da928bfdfbb1ceb5fe54519e87f4a' })
});
const TOR_ARCHIVE_SHA256 = TOR_ARCHIVES.win32.sha256;
// Pinned in application code (inside the ASAR), not trusted from the adjacent
// resources directory. Snowflake is implemented by lyrebird in this bundle;
// there is no separate snowflake executable.
const TOR_FILE_PINS = require('./tor-file-pins.cjs');
const TOR_PLATFORM_PINS = Object.freeze({ win32: TOR_FILE_PINS, linux: require('./tor-file-pins-linux.cjs') });

function torExecutableNames(platform = process.platform) {
  return platform === 'win32' ? { tor: 'tor.exe', lyrebird: 'lyrebird.exe' } : { tor: 'tor', lyrebird: 'lyrebird' };
}

// A checkout prepares one bundle per platform: vendor/tor (Windows, the
// historical layout) and vendor/tor-linux. Packages always use resources/tor.
function torVendorName(platform = process.platform) {
  return platform === 'win32' ? 'tor' : 'tor-' + platform;
}

// The Linux bundle ships its own OpenSSL and libevent next to tor.
function torProcessEnvironment(bundleDirectory, platform = process.platform, env = process.env) {
  return platform === 'linux' ? { ...env, LD_LIBRARY_PATH: bundleDirectory } : env;
}

// Unsupported platforms get no pins, so every bundled file is refused.
function torPinsFor(platform = process.platform) {
  return Object.hasOwn(TOR_PLATFORM_PINS, platform) ? TOR_PLATFORM_PINS[platform] : Object.freeze({});
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyPinnedTorFiles(directory, pins = torPinsFor()) {
  const mismatches = [];
  for (const [relativePath, expected] of Object.entries(pins)) {
    const file = path.join(directory, ...relativePath.split('/'));
    let actual = '';
    try { if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('Not a regular file'); actual = sha256File(file); } catch { mismatches.push({ file: relativePath, reason: 'missing' }); continue; }
    if (actual !== expected) mismatches.push({ file: relativePath, reason: 'hash-mismatch' });
  }
  const allowedDirectories = new Set(Object.keys(pins).flatMap(name => { const parts = name.split('/'); return parts.slice(0, -1).map((_part, i) => parts.slice(0, i + 1).join('/')); }));
  const walk = (relative = '') => {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) mismatches.push({ file: name, reason: 'symlink' });
      else if (entry.isDirectory() && allowedDirectories.has(name)) walk(name);
      else if (!entry.isFile() || !Object.hasOwn(pins, name)) mismatches.push({ file: name, reason: 'unexpected' });
    }
  };
  try { if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('symlink'); walk(); }
  catch { mismatches.push({ file: '.', reason: 'unreadable-directory' }); }
  return { valid: mismatches.length === 0, mismatches };
}

function secureTorRuntimeDirectory(directory, platform = process.platform, run = execFileSync) {
  if (platform === 'win32') {
    const who = run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = /S-1-(?:\d+-)+\d+/i.exec(who)?.[0];
    if (!sid) throw new Error('Impossible d’identifier le compte Windows pour protéger les données temporaires Tor.');
    run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
    return 'ACL Windows limitée au compte courant et à SYSTEM';
  }
  fs.chmodSync(directory, 0o700);
  const permissions = fs.statSync(directory).mode & 0o777;
  if ((permissions & 0o077) !== 0) throw new Error('Le dossier temporaire Tor n’est pas limité au compte courant.');
  return 'mode 0700';
}

module.exports = { TOR_BUNDLE_VERSION, TOR_VERSION, TOR_ARCHIVES, TOR_ARCHIVE_SHA256, TOR_FILE_PINS, TOR_PLATFORM_PINS, torExecutableNames, torPinsFor, torVendorName, torProcessEnvironment, sha256File, verifyPinnedTorFiles, secureTorRuntimeDirectory };
