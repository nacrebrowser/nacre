'use strict';
// Native lifecycle using a tiny, separately registered fixture. Never installs
// over Nacre, starts the browser, or touches the real Nacre profile.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const folder = fs.mkdtempSync(path.join(root, '.cache', 'installer-lifecycle-'));
const output = path.join(folder, 'build');
const appDir = path.join(folder, 'payload');
const guid = crypto.randomUUID();
const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(os.tmpdir(), 'Nacre-installer-validation-' + guid);
const installDir = path.join(exportDir, 'installed app');
const name = 'NacreFixture' + guid.slice(0, 8);
const calls = [];
let ownsExportDirectory = false;
function run(id, exe, args, expected, timeout = 90000) {
  // NSIS requires _?= as an unquoted final command-line tail. Quoting that
  // whole argument would launch an asynchronous temporary uninstaller copy.
  const result = spawnSync(exe, args, { cwd: folder, windowsHide: true, windowsVerbatimArguments: id === 'uninstall', encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  const text = (result.stdout || '') + (result.stderr || '') + (result.error ? String(result.error) : '');
  fs.writeFileSync(path.join(folder, id + '.log'), text);
  calls.push({ id, status: result.status, signal: result.signal, error: result.error?.code || null });
  console.log(id + ': ' + result.status);
  if (expected !== undefined) assert.equal(result.status, expected, id + ': ' + text.slice(-3000));
  return result.status;
}
function main() {
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.join(appDir, 'resources'), { recursive: true });
  // A payload executable is required by NSIS, but never launched in this test.
  fs.copyFileSync(process.execPath, path.join(appDir, name + '.exe'));
  fs.writeFileSync(path.join(appDir, 'payload.txt'), 'first payload');
  const canary = path.join(folder, 'outside-install-canary.txt');
  fs.writeFileSync(canary, 'preserve');
  const config = path.join(folder, 'config.cjs');
  fs.writeFileSync(config, `const base=require(${JSON.stringify(path.join(root, 'build/electron-builder.setup.cjs'))}); module.exports={...base,appId:${JSON.stringify('fr.nacre.fixture.' + guid)},productName:${JSON.stringify(name)},executableName:${JSON.stringify(name)},directories:{output:${JSON.stringify(output)}},nsis:{...base.nsis,guid:${JSON.stringify(guid)},artifactName:'Fixture Setup.exe',createDesktopShortcut:false,createStartMenuShortcut:false,runAfterFinish:false}};`);
  run('build', process.execPath, [path.join(root, 'scripts/run-electron-builder.cjs'), '--win', '--x64', '--prepackaged', appDir, '--config', config], 0);
  run('export-normal-files', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/export-windows-artifacts.ps1'), '-Destination', exportDir, '-Source', path.join(output, 'Fixture Setup.exe')], 0);
  ownsExportDirectory = true;
  const setup = path.join(exportDir, 'Fixture Setup.exe');
  run('install', setup, ['/S', '/currentuser', '/D=' + installDir], 0);
  assert.equal(fs.readFileSync(path.join(installDir, 'payload.txt'), 'utf8'), 'first payload');
  const uninstaller = path.join(installDir, 'Uninstall ' + name + '.exe');
  // Read back registration: an installer exit code alone cannot prove this.
  const installKey = 'HKCU\\Software\\' + guid;
  const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + guid;
  run('registration-readback', 'reg.exe', ['query', installKey], 0);
  fs.writeFileSync(path.join(installDir, 'obsolete.txt'), 'must be removed during upgrade');
  run('upgrade', setup, ['/S', '/currentuser', '/D=' + installDir], 0);
  assert.equal(fs.existsSync(path.join(installDir, 'obsolete.txt')), false);
  assert.equal(fs.readFileSync(path.join(installDir, 'payload.txt'), 'utf8'), 'first payload');
  run('uninstall', uninstaller, ['/S', '/currentuser', '_?=' + installDir], 0);
  assert.equal(fs.existsSync(path.join(installDir, name + '.exe')), false);
  assert.equal(fs.readFileSync(canary, 'utf8'), 'preserve');
  run('registration-removed', 'reg.exe', ['query', installKey], 1);
  run('uninstall-registration-removed', 'reg.exe', ['query', uninstallKey], 1);
}
let status = 'PASS';
try { main(); } catch (error) { status = 'FAIL'; console.error(error.stack); process.exitCode = 1; }
fs.writeFileSync(path.join(root, '.cache', 'installer-lifecycle-result.json'), JSON.stringify({ status, time: new Date().toISOString(), name, guid, folder, installDir, calls, scope: 'Real NSIS install/upgrade/uninstall, unique fixture app ID and keys, small payload. No browser or real Nacre profile used.' }, null, 2));
console.log('LIFECYCLE_RESULT ' + status + ' ' + folder);
if (status === 'PASS' && ownsExportDirectory) {
  fs.rmSync(exportDir, { recursive: true, force: true });
  for (const child of ['payload', 'build']) fs.rmSync(path.join(folder, child), { recursive: true, force: true });
}
