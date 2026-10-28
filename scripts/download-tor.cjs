const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const { TOR_BUNDLE_VERSION: version, TOR_ARCHIVES, torPinsFor, verifyPinnedTorFiles } = require('../src/tor-integrity.cjs');

// Usage: node scripts/download-tor.cjs [--platform win32|linux] [--write-pins]
// --write-pins regenerates the pinned file digests after the archive itself
// has been verified against the digest written in src/tor-integrity.cjs.
const platformIndex = process.argv.indexOf('--platform');
const platform = platformIndex === -1 ? process.platform : process.argv[platformIndex + 1];
if (!Object.hasOwn(TOR_ARCHIVES, platform)) throw new Error(`Aucun bundle Tor pour la plateforme ${platform}.`);
const writePins = process.argv.includes('--write-pins');
const { name: archiveName, sha256: expectedHash } = TOR_ARCHIVES[platform];
const archiveUrl = `https://dist.torproject.org/torbrowser/${version}/${archiveName}`;
const root = path.join(__dirname, '..');
const cache = path.join(root, '.cache', 'tor-download');
const archive = path.join(cache, archiveName);
const unpack = path.join(cache, 'unpacked-' + platform);
const destination = path.join(root, 'vendor', platform === 'win32' ? 'tor' : 'tor-' + platform);
const pinsFile = path.join(root, 'src', platform === 'win32' ? 'tor-file-pins.cjs' : `tor-file-pins-${platform}.cjs`);
const pins = torPinsFor(platform);

// Destination name -> path inside the extracted archive. Windows keeps the
// historical lookup by file name; Linux names exact paths because the archive
// also carries a debug/ copy of tor and its libraries.
const LICENSES = { win32: ['conjure', 'libevent', 'lyrebird', 'openssl', 'tor', 'zlib'], linux: ['conjure', 'libevent', 'lyrebird', 'openssl', 'tor'] };
const LINUX_LAYOUT = {
  tor: 'tor/tor',
  'libcrypto.so.3': 'tor/libcrypto.so.3',
  'libevent-2.1.so.7': 'tor/libevent-2.1.so.7',
  'libssl.so.3': 'tor/libssl.so.3',
  geoip: 'data/geoip',
  geoip6: 'data/geoip6',
  'pluggable_transports/lyrebird': 'tor/pluggable_transports/lyrebird',
  'pluggable_transports/conjure-client': 'tor/pluggable_transports/conjure-client',
  'pt_config.json': 'tor/pluggable_transports/pt_config.json'
};
const EXECUTABLES = new Set(['tor', 'libcrypto.so.3', 'libevent-2.1.so.7', 'libssl.so.3', 'pluggable_transports/lyrebird', 'pluggable_transports/conjure-client']);

function bundleNames() {
  const base = platform === 'win32'
    ? ['tor.exe', 'geoip', 'geoip6', 'pluggable_transports/lyrebird.exe', 'pluggable_transports/conjure-client.exe', 'pt_config.json']
    : Object.keys(LINUX_LAYOUT);
  return [...base, ...LICENSES[platform].map((name) => `licenses/${name}.txt`)];
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function installedFilesMatch() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'tor.sha256.json'), 'utf8').replace(/^\uFEFF/, ''));
    return manifest.version === version && verifyPinnedTorFiles(destination, pins).valid && bundleNames().every((name) => {
      const file = path.join(destination, ...name.split('/'));
      return fs.existsSync(file) && hashFile(file) === manifest[name];
    });
  } catch { return false; }
}

function download(url, output, redirects = 0, originalHost = new URL(archiveUrl).hostname) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== originalHost || parsed.username || parsed.password || parsed.port && parsed.port !== '443') {
      return reject(new Error('Redirection Tor refusée : l’hôte HTTPS de distribution doit rester identique.'));
    }
    if (redirects > 5) return reject(new Error('Trop de redirections du serveur Tor.'));
    const request = https.get(parsed, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return reject(new Error('Redirection Tor sans destination.'));
        return download(new URL(location, parsed).href, output, redirects + 1, originalHost).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Téléchargement Tor : HTTP ${response.statusCode}.`)); }
      const stream = fs.createWriteStream(output);
      response.pipe(stream);
      stream.on('finish', () => stream.close(resolve));
      stream.on('error', reject);
    });
    request.on('error', reject);
  });
}

function findFile(directory, filename) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return file;
    if (entry.isDirectory()) {
      const match = findFile(file, filename);
      if (match) return match;
    }
  }
  return '';
}

// Installed system-wide by the Linux package: readable by every account,
// writable by none but the owner, executable only where needed. Applied on
// every run, because a copy (for example from a Windows drive) can widen them.
function applyModes() {
  if (process.platform === 'win32') return;
  for (const name of [...bundleNames(), 'tor.sha256.json']) {
    const file = path.join(destination, ...name.split('/'));
    if (fs.existsSync(file)) fs.chmodSync(file, EXECUTABLES.has(name) ? 0o755 : 0o644);
  }
  for (const directory of [destination, path.join(destination, 'licenses'), path.join(destination, 'pluggable_transports')]) {
    if (fs.existsSync(directory)) fs.chmodSync(directory, 0o755);
  }
}

(async () => {
  if (installedFilesMatch()) {
    applyModes();
    process.stdout.write('Bundle Tor existant : les empreintes locales des composants sont valides.\n');
    return;
  }
  fs.mkdirSync(cache, { recursive: true });
  // Reuse a previously downloaded archive while offline, but only after checking
  // it against the pinned Tor Project digest exactly as for a fresh download.
  if (!fs.existsSync(archive) || hashFile(archive) !== expectedHash) {
    fs.rmSync(archive, { force: true });
    await download(archiveUrl, archive);
  }
  const actualHash = hashFile(archive);
  if (actualHash !== expectedHash) {
    fs.rmSync(archive, { force: true });
    throw new Error(`Empreinte SHA-256 Tor incorrecte : ${actualHash}`);
  }
  fs.rmSync(unpack, { recursive: true, force: true });
  fs.mkdirSync(unpack, { recursive: true });
  // Windows' own bsdtar: a GNU tar earlier in PATH (Git Bash) reads "C:" as a remote host.
  const tarCommand = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const extraction = spawnSync(tarCommand, ['-xzf', archive, '-C', unpack], { stdio: 'inherit', windowsHide: true });
  if (extraction.error || extraction.status !== 0) throw extraction.error || new Error('Impossible de décompresser le bundle Tor vérifié.');
  const sources = {};
  if (platform === 'win32') {
    const torExe = findFile(unpack, 'tor.exe');
    if (!torExe) throw new Error('tor.exe absent du bundle vérifié.');
    Object.assign(sources, { 'tor.exe': torExe, geoip: findFile(unpack, 'geoip'), geoip6: findFile(unpack, 'geoip6') });
    const transportDirectory = path.join(path.dirname(torExe), 'pluggable_transports');
    sources['pluggable_transports/lyrebird.exe'] = path.join(transportDirectory, 'lyrebird.exe');
    sources['pluggable_transports/conjure-client.exe'] = path.join(transportDirectory, 'conjure-client.exe');
    sources['pt_config.json'] = path.join(transportDirectory, 'pt_config.json');
  } else {
    for (const [name, relative] of Object.entries(LINUX_LAYOUT)) sources[name] = path.join(unpack, ...relative.split('/'));
  }
  for (const name of LICENSES[platform]) sources[`licenses/${name}.txt`] = findFile(path.join(unpack, 'docs'), name + '.txt');
  const verified = { version, archiveSha256: expectedHash };
  for (const name of Object.keys(sources)) {
    const file = sources[name];
    if (!file || !fs.existsSync(file)) throw new Error(`Fichier Tor absent du bundle : ${name}`);
    verified[name] = hashFile(file);
  }
  // A fresh clone holds only the tracked manifest and licences: missing files
  // are filled from the verified archive, but a changed or extra file is refused.
  if (!writePins && fs.existsSync(destination) && verifyPinnedTorFiles(destination, pins).mismatches.some((item) => item.reason !== 'missing')) throw new Error('Bundle Tor modifié ou incomplet : restaure le dossier vendor/tor depuis une source approuvée avant de préparer Tor.');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of Object.keys(sources)) {
    const target = path.join(destination, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sources[name], target);
  }
  const temporary = path.join(destination, 'tor.sha256.json.tmp');
  fs.writeFileSync(temporary, JSON.stringify(verified, null, 2) + '\n');
  fs.renameSync(temporary, path.join(destination, 'tor.sha256.json'));
  applyModes();
  if (writePins) {
    const digests = {};
    for (const name of [...Object.keys(sources), 'tor.sha256.json']) digests[name] = hashFile(path.join(destination, ...name.split('/')));
    fs.writeFileSync(pinsFile, "'use strict';\nmodule.exports = Object.freeze(" + JSON.stringify(digests, null, 2) + ');\n');
    process.stdout.write(`Empreintes écrites dans ${path.relative(root, pinsFile)}.\n`);
  } else if (!verifyPinnedTorFiles(destination, pins).valid) {
    throw new Error('Les fichiers Tor préparés ne correspondent pas aux empreintes intégrées à Nacre.');
  }
  process.stdout.write(`Bundle Tor ${version} vérifié par empreinte SHA-256 et préparé.\n`);
})().catch((error) => {
  console.error('Préparation de Tor interrompue :', error.message);
  process.exitCode = 1;
});
