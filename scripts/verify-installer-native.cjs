'use strict';
// Disposable native NSIS fixtures only: never installs Nacre or changes its keys.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { prepareNsisScript } = require('./prepare-nsis-script.cjs');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache', 'electron-builder', 'nsis@1.2.1');
const bundle = fs.readdirSync(cache).find(n => fs.existsSync(path.join(cache, n, 'windows', 'Bin', 'makensis.exe')));
if (!bundle) throw new Error('Build the Windows package first to provision NSIS.');
const nsis = path.join(cache, bundle, 'windows');
const folder = fs.mkdtempSync(path.join(root, '.cache', 'nsis-native-'));
const q = p => p;
const header = 'Unicode true\nRequestExecutionLevel user\nSilentInstall silent\n!include LogicLib.nsh\n';
function compile(name, source) {
  const output = path.join(folder, name + '.exe'), script = path.join(folder, name + '.nsi');
  fs.writeFileSync(script, header + 'OutFile "' + q(output) + '"\n' + source);
  const run = spawnSync(path.join(nsis, 'Bin', 'makensis.exe'), ['/V2', script], { encoding: 'utf8', windowsHide: true, env: { ...process.env, NSISDIR: nsis }, timeout: 30000 });
  if (run.status !== 0) throw new Error('NSIS compile failed: ' + (run.error || '') + run.stdout + run.stderr);
  return output;
}
function run(exe, expected) {
  // Native NSIS fixtures can be scanned by endpoint protection after every
  // compile; a 15 s ceiling made this check intermittently time out.
  const result = spawnSync(exe, ['/S'], { windowsHide: true, timeout: 60000 });
  assert.equal(result.status, expected, String(result.error || exe));
}
async function main() {
  const probeName = 'NacreProbe' + process.pid + '.exe';
  const probeExe = path.join(folder, probeName);
  fs.copyFileSync(process.execPath, probeExe);
  const check = compile('process-check', '!define APP_EXECUTABLE_FILENAME "' + probeName + '"\n!include "' + q(path.join(root, 'scripts/installer.nsh')) + '"\nSection\n!insertmacro customCheckAppRunning\nSetErrorLevel 0\nSectionEnd\n');
  run(check, 0);
  const child = spawn(probeExe, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true, stdio: 'ignore' });
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    run(check, 2);
    assert.equal(child.exitCode, null, 'Installer must not kill the running fixture');
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  run(check, 0);

  // Use the real 7z plugin and checked-copy macro, including a Windows handle
  // that denies sharing, to prove a locked payload cannot report success.
  const sevenZipRoot = path.join(root, '.cache/electron-builder/7zip@1.0.0');
  const sevenZipBundle = fs.readdirSync(sevenZipRoot).find(n => fs.existsSync(path.join(sevenZipRoot, n, 'bin/7za.exe')));
  assert.ok(sevenZipBundle, 'Build first to provision 7zip');
  const payload = path.join(folder, 'payload.txt');
  const archive = path.join(folder, 'payload.7z');
  fs.writeFileSync(payload, 'new payload');
  const packed = spawnSync(path.join(sevenZipRoot, sevenZipBundle, 'bin/7za.exe'), ['a', archive, payload], { windowsHide: true });
  assert.equal(packed.status, 0);
  const copyTarget = path.join(folder, 'copy-target');
  fs.mkdirSync(copyTarget);
  const copiedFile = path.join(copyTarget, 'payload.txt');
  fs.writeFileSync(copiedFile, 'old payload');
  const extractionInclude = path.join(path.dirname(prepareNsisScript()), 'extractAppPackage.nsh');
  function extractionSource(lock) {
    return [
      '!include "' + q(extractionInclude) + '"',
      'Section', 'InitPluginsDir',
      'File /oname=$PLUGINSDIR\\payload.7z "' + q(archive) + '"',
      'SetOutPath "' + q(copyTarget) + '"',
      ...(lock ? ["System::Call 'kernel32::CreateFileW(w \"" + q(copiedFile) + "\", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.r3'", 'IntCmp $3 -1 0 +3 +3', 'SetErrorLevel 99', 'Quit'] : []),
      '!insertmacro extractUsing7za "$PLUGINSDIR\\payload.7z"',
      'SetErrorLevel 0', 'SectionEnd'
    ].join('\n');
  }
  run(compile('copy-locked', extractionSource(true)), 2);
  assert.equal(fs.readFileSync(copiedFile, 'utf8'), 'old payload');
  run(compile('copy-unlocked', extractionSource(false)), 0);
  assert.equal(fs.readFileSync(copiedFile, 'utf8'), 'new payload');

  // Exercise the actual patched upstream upgrade function. Substitute only its
  // registry reader so no host registration or profile is touched.
  const marker = path.join(folder, 'replacement-ran.txt');
  const replacement = compile('replacement', 'Section\nFileOpen $0 "' + q(marker) + '" w\nFileWrite $0 "replacement"\nFileClose $0\nSetErrorLevel 0\nSectionEnd\n');
  const old = compile('old-broken', 'Section\nSetErrorLevel 7\nSectionEnd\n');
  run(old, 7);
  const originalUtility = path.join(path.dirname(prepareNsisScript()), 'installUtil.nsh');
  const utility = path.join(folder, 'fixture-installUtil.nsh');
  const readFixture = '!macro readReg VAR ROOT_KEY SUB_KEY NAME\n${if} "${NAME}" == "UninstallString"\nStrCpy ${VAR} \'"' + q(old) + '"\'\n${elseif} "${NAME}" == "InstallLocation"\nStrCpy ${VAR} "' + q(folder) + '"\n${else}\nStrCpy ${VAR} ""\n${endif}\n!macroend';
  fs.writeFileSync(utility, fs.readFileSync(originalUtility, 'utf8').replace(/!macro readReg VAR ROOT_KEY SUB_KEY NAME[\s\S]*?!macroend/, () => readFixture));
  const key = 'Software\\NacreInstallerFixture-' + process.pid;
  const upgradeSource = [
    '!include FileFunc.nsh',
    '!define INSTALL_REGISTRY_KEY "' + key + '"', '!define UNINSTALL_REGISTRY_KEY "' + key + '"',
    '!define UNINSTALLER_OUT_FILE "' + q(replacement) + '"',
    '!define isDeleteAppData "0 == 1"', 'Var installMode', 'Var appExe',
    '!include "' + q(utility) + '"',
    'Section', 'InitPluginsDir', 'StrCpy $installMode "CurrentUser"',
    '!insertmacro uninstallOldVersion HKEY_CURRENT_USER',
    'SetErrorLevel $R0', 'SectionEnd'
  ].join('\n');
  const upgrade = compile('upgrade', upgradeSource);
  run(upgrade, 0);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'replacement');
  const failure = compile('upgrade-failure', upgradeSource.replace('!define UNINSTALLER_OUT_FILE "' + q(replacement) + '"', '!define UNINSTALLER_OUT_FILE "' + q(old) + '"'));
  run(failure, 2);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'replacement');
  const evidence = { status: 'PASS', time: new Date().toISOString(), checks: ['No process: proceeds', '64-bit native process: refuses silently with code 2', 'Running process is never killed', 'After process exits: proceeds', 'Locked payload: aborts with code 2 and preserves existing file', 'Unlocked payload: real 7z extraction and copy succeed', 'Installed broken uninstaller returns 7', 'Patched upgrade executes embedded replacement instead', 'Replacement failure aborts with code 2; fixture files preserved'], scope: 'Disposable NSIS fixtures with simulated registry reads; not the full Nacre installation lifecycle or SmartScreen reputation' };
  fs.writeFileSync(path.join(root, '.cache', 'installer-native-result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  // Only this invocation's mkdtemp directory; durable results are outside it.
  fs.rmSync(folder, { recursive: true, force: true });
});
