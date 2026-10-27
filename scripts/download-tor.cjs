const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const { TOR_BUNDLE_VERSION: version, TOR_ARCHIVE_SHA256: expectedHash, verifyPinnedTorFiles } = require('../src/tor-integrity.cjs');

const archiveName = `tor-expert-bundle-windows-x86_64-${version}.tar.gz`;
const archiveUrl = `https://dist.torproject.org/torbrowser/${version}/${archiveName}`;
const root = path.join(__dirname, '..');
const cache = path.join(root, '.cache', 'tor-download');
const archive = path.join(cache, archiveName);
const unpack = path.join(cache, 'unpacked');
const destination = path.join(root, 'vendor', 'tor');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function installedFilesMatch() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'tor.sha256.json'), 'utf8').replace(/^\uFEFF/, ''));
    const names = ['tor.exe', 'geoip', 'geoip6', 'pluggable_transports/lyrebird.exe', 'pluggable_transports/conjure-client.exe', 'pt_config.json', 'licenses/conjure.txt', 'licenses/libevent.txt', 'licenses/lyrebird.txt', 'licenses/openssl.txt', 'licenses/tor.txt', 'licenses/zlib.txt'];
    return manifest.version === version && verifyPinnedTorFiles(destination).valid && names.every((name) => {
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

(async () => {
  if (installedFilesMatch()) {
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
  const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const extraction = spawnSync(tarCommand, ['-xzf', archive, '-C', unpack], { stdio: 'inherit', windowsHide: true });
  if (extraction.error || extraction.status !== 0) throw extraction.error || new Error('Impossible de décompresser le bundle Tor vérifié.');
  const torExe = findFile(unpack, 'tor.exe');
  if (!torExe) throw new Error('tor.exe absent du bundle vérifié.');
  const sources = { 'tor.exe': torExe, geoip: findFile(unpack, 'geoip'), geoip6: findFile(unpack, 'geoip6') };
  const transportDirectory = path.join(path.dirname(torExe), 'pluggable_transports');
  sources['pluggable_transports/lyrebird.exe'] = path.join(transportDirectory, 'lyrebird.exe');
  sources['pluggable_transports/conjure-client.exe'] = path.join(transportDirectory, 'conjure-client.exe');
  sources['pt_config.json'] = path.join(path.dirname(torExe), 'pluggable_transports', 'pt_config.json');
  for (const name of ['conjure.txt', 'libevent.txt', 'lyrebird.txt', 'openssl.txt', 'tor.txt', 'zlib.txt']) {
    sources['licenses/' + name] = findFile(path.join(unpack, 'docs'), name);
  }
  const verified = { version, archiveSha256: expectedHash };
  for (const name of Object.keys(sources)) {
    const file = sources[name];
    if (!file || !fs.existsSync(file)) throw new Error(`Fichier Tor absent du bundle : ${name}`);
    verified[name] = hashFile(file);
  }
  // A fresh clone holds only the tracked manifest and licences: missing files
  // are filled from the verified archive, but a changed or extra file is refused.
  if (fs.existsSync(destination) && verifyPinnedTorFiles(destination).mismatches.some((item) => item.reason !== 'missing')) throw new Error('Bundle Tor modifié ou incomplet : restaure le dossier vendor/tor depuis une source approuvée avant de préparer Tor.');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of Object.keys(sources)) {
    const target = path.join(destination, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sources[name], target);
  }
  const temporary = path.join(destination, 'tor.sha256.json.tmp');
  fs.writeFileSync(temporary, JSON.stringify(verified, null, 2) + '\n');
  fs.renameSync(temporary, path.join(destination, 'tor.sha256.json'));
  process.stdout.write(`Bundle Tor ${version} vérifié par empreinte SHA-256 et préparé.\n`);
})().catch((error) => {
  console.error('Préparation de Tor interrompue :', error.message);
  process.exitCode = 1;
});
