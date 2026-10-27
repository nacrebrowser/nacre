'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { TOR_BUNDLE_VERSION, TOR_ARCHIVE_SHA256, sha256File } = require('../src/tor-integrity.cjs');
const cache = path.resolve('.cache/tor-hardening');
fs.mkdirSync(cache, { recursive: true });
const archive = path.join(cache, 'bundle.tar.gz');
async function main() {
  if (!fs.existsSync(archive) || sha256File(archive) !== TOR_ARCHIVE_SHA256) await new Promise((resolve, reject) => {
    const request = https.get(`https://dist.torproject.org/torbrowser/${TOR_BUNDLE_VERSION}/tor-expert-bundle-windows-x86_64-${TOR_BUNDLE_VERSION}.tar.gz`, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('HTTP ' + response.statusCode)); return; }
      const output = fs.createWriteStream(archive);
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    });
    request.on('error', reject);
  });
  if (sha256File(archive) !== TOR_ARCHIVE_SHA256) throw new Error('Archive digest mismatch');
  const unpack = path.join(cache, 'verified');
  fs.mkdirSync(unpack, { recursive: true });
  execFileSync('tar.exe', ['-xzf', archive, '-C', unpack], { windowsHide: true });
  const all = [];
  function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir,e.name); if(e.isDirectory())walk(f);else all.push(f); } }
  walk(unpack);
  const manifest = JSON.parse(fs.readFileSync('vendor/tor/tor.sha256.json', 'utf8'));
  const pins = {};
  for (const name of Object.keys(manifest).filter(name => !['version','archiveSha256'].includes(name))) {
    const local = path.join('vendor/tor', name);
    const expected = sha256File(local);
    if (!all.some(file => path.basename(file) === path.basename(name) && sha256File(file) === expected)) throw new Error('File not in verified archive: ' + name);
    pins[name] = expected;
  }
  const torExe = all.find(file => path.basename(file) === 'tor.exe');
  // Include every DLL from the executable directory, including subdirectories.
  for (const file of all.filter(file => file.startsWith(path.dirname(torExe) + path.sep) && /\.dll$/i.test(file))) {
    const name = path.relative(path.dirname(torExe), file).split(path.sep).join('/');
    const dest = path.join('vendor/tor', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    pins[name] = sha256File(file);
  }
  // Metadata is also pinned, rather than being an exception to the allowlist.
  pins['tor.sha256.json'] = sha256File('vendor/tor/tor.sha256.json');
  fs.writeFileSync('src/tor-file-pins.cjs', "'use strict';\nmodule.exports = Object.freeze(" + JSON.stringify(pins, null, 2) + ');\n');
  console.log('Pinned verified Tor files:', Object.keys(pins).length);
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
