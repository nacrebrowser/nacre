'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const cli = require.resolve('electron-builder/cli.js', { paths: [root] });
const cache = path.join(root, '.cache', 'electron-builder');
const temp = path.join(root, '.cache', 'build-temp');
const fs = require('node:fs');
fs.mkdirSync(temp, { recursive: true });
const prepackagedIndex = process.argv.indexOf('--prepackaged');
if (prepackagedIndex !== -1) {
  const payloadDirectory = path.resolve(root, process.argv[prepackagedIndex + 1] || '');
  const executables = fs.readdirSync(payloadDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'));
  if (!executables.some(entry => fs.statSync(path.join(payloadDirectory, entry.name)).size > 0)) {
    throw new Error('Prepackaged application is incomplete: no application executable in ' + payloadDirectory);
  }
}

// electron-builder 26.17's NSIS 3.12 cross-platform bundle wrapper points at
// windows/makensis.exe, which is a launcher stub in this bundle. The actual
// compiler is in windows/Bin; correct the generated, ignored cache wrapper.
const nsisCache = path.join(cache, 'nsis@1.2.1');
if (fs.existsSync(nsisCache)) {
  for (const entry of fs.readdirSync(nsisCache, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const wrapper = path.join(nsisCache, entry.name, 'makensis.cmd');
    try {
      const contents = fs.readFileSync(wrapper, 'utf8');
      const corrected = contents.replace('set "MAKENSIS_EXE=%NSISDIR%\\makensis.exe"', 'set "MAKENSIS_EXE=%NSISDIR%\\Bin\\makensis.exe"');
      if (corrected !== contents) fs.writeFileSync(wrapper, corrected);
    } catch {}
  }
}
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  windowsHide: true,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_BUILDER_CACHE: cache, TEMP: temp, TMP: temp, TMPDIR: temp }
});
child.once('error', (error) => { console.error('Impossible de lancer electron-builder :', error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code === null ? 1 : code; if (signal) console.error('electron-builder arrêté par', signal); });
