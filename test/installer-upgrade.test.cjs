'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { patchUpgradeUtility, prepareNsisScript, installNsisTemplatePatch } = require('../scripts/prepare-nsis-script.cjs');

test('NSIS upgrades use the current embedded uninstaller and report actual failure', () => {
  const script = prepareNsisScript();
  assert.ok(fs.readFileSync(script, 'utf8').includes(path.join(path.dirname(script), 'installUtil.nsh')));
  const utility = fs.readFileSync(path.join(path.dirname(script), 'installUtil.nsh'), 'utf8');
  assert.ok(utility.includes('File "/oname=$PLUGINSDIR\\old-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"'));
  assert.ok(!utility.includes('ExecWait \'"$uninstallerFileName"'));
  assert.ok(!utility.includes('$(appCannotBeClosed)'));
  assert.ok(utility.includes('uninstaller exit code $R0'));
  assert.throws(() => patchUpgradeUtility('unknown upstream'), /template changed/);
});

test('native process check distinguishes absence from failures without shells or automatic kills', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/installer.nsh'), 'utf8');
  const check = source.split('!macro customCheckAppRunning')[1].split('!macroend')[0];
  assert.match(check, /nsProcess::_FindProcess/);
  assert.match(check, /\$R0 != 603/);
  assert.doesNotMatch(check, /nsExec::|_KillProcess|_CloseProcess|taskkill|powershell\.exe/i);
});

test('copy failure aborts rather than extracting unchecked over the installation', () => {
  const script = prepareNsisScript();
  const folder = path.dirname(script);
  assert.ok(fs.readFileSync(script, 'utf8').includes(path.join(folder, 'installSection.nsh')));
  assert.ok(fs.readFileSync(script, 'utf8').includes('!define VERSION "' + require('../package.json').nacreVersion + '"'));
  assert.ok(fs.readFileSync(path.join(folder, 'installSection.nsh'), 'utf8').includes(path.join(folder, 'installer-functions.nsh')));
  assert.ok(fs.readFileSync(path.join(folder, 'installer-functions.nsh'), 'utf8').includes(path.join(folder, 'extractAppPackage.nsh')));
  const extraction = fs.readFileSync(path.join(folder, 'extractAppPackage.nsh'), 'utf8');
  assert.match(extraction, /ClearErrors\n    CopyFiles/);
  assert.match(extraction, /AbortExtract7za:\n    SetErrorLevel 2\n    Quit/);
  assert.match(extraction, /Unable to copy Nacre files/);
  assert.doesNotMatch(extraction, /appCannotBeClosed|RMDir \/r/);
  assert.equal(extraction.match(/Nsis7z::Extract/g).length, 1);
});

test('packaging refuses a prepackaged directory with no application executable', () => {
  const folder = fs.mkdtempSync(path.join(__dirname, '../.cache/incomplete-payload-'));
  try {
    fs.mkdirSync(path.join(folder, 'resources'));
    const result = require('node:child_process').spawnSync(process.execPath,
      [path.join(__dirname, '../scripts/run-electron-builder.cjs'), '--prepackaged', folder],
      { encoding: 'utf8', windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Prepackaged application is incomplete/);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('template integration retains both stages of the standard uninstaller signing pipeline', () => {
  require('electron-builder');
  const builder = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [path.dirname(require.resolve('electron-builder/package.json'))] }));
  const { NsisTarget } = require(path.join(builder, 'out/targets/nsis/NsisTarget.js'));
  const stock = fs.readFileSync(path.join(builder, 'templates/nsis/installer.nsi'), 'utf8');
  const original = NsisTarget.prototype.computeFinalScript;
  const calls = [];
  NsisTarget.prototype.computeFinalScript = function (...args) { calls.push(args); return args; };
  try {
    installNsisTemplatePatch();
    for (const isInstaller of [false, true]) NsisTarget.prototype.computeFinalScript.call({ isPortable: false }, stock, isInstaller, ['x64']);
    assert.deepEqual(calls.map(args => args[1]), [false, true]);
    assert.ok(calls.every(args => args[0].includes(path.join('.cache', 'nacre-nsis', 'installUtil.nsh'))));
    assert.throws(() => NsisTarget.prototype.computeFinalScript.call({ isPortable: false }, 'changed upstream', true), /Unexpected NSIS script/);
    const config = require('../build/electron-builder.setup.cjs');
    assert.equal(config.nsis.script, undefined, 'A custom script bypasses builder uninstaller generation/signing');
  } finally {
    NsisTarget.prototype.computeFinalScript = original;
    delete NsisTarget.prototype[Symbol.for('nacre.nsis.template.patch')];
  }
});
