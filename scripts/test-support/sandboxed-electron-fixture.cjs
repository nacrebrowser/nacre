'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const legacy = require('./electron-fixture.cjs');
let runtime;
const fixtureDirectories = new Map();
function prepareWindowsFixtureDirectory(directory) {
  if (process.platform !== 'win32') return legacy.prepareWindowsFixtureDirectory(directory);
  // CacheStorage must use an ordinary profile, rather than inherit the
  // restricted checkout's AppContainer ACL. Do not change the checkout ACL.
  if (!fixtureDirectories.has(directory)) fixtureDirectories.set(directory, fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-fixture-')));
  return fixtureDirectories.get(directory);
}
function shortWindowsPath(directory) {
  return fixtureDirectories.get(directory) || legacy.shortWindowsPath(directory);
}
function electronBinary() {
  if (process.platform !== 'win32') return require('electron');
  if (!runtime) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-sandbox-'));
    const original = require('electron');
    fs.cpSync(path.dirname(original), path.join(folder, 'runtime'), { recursive: true });
    runtime = path.join(folder, 'runtime', path.basename(original));
    process.once('exit', () => {
      const target = path.resolve(folder, 'runtime');
      if (path.dirname(folder) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('nacre-sandbox-') || path.dirname(target) !== folder) return;
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* Preserve a runtime still in use. */ }
    });
  }
  return runtime;
}
function launch(args = [], options = {}) {
  if (args.some(arg => /^--(?:no-sandbox|disable.*sandbox)/.test(arg))) throw new Error('Sandbox bypass forbidden');
  const binary = electronBinary();
  return spawnSync(binary, args, { ...options, cwd: path.dirname(binary), env: legacy.cleanEnvironment(options.env), windowsHide: true });
}
module.exports = { ...legacy, launch, electronBinary, prepareWindowsFixtureDirectory, shortWindowsPath, packagedSandboxArguments: () => [] };
