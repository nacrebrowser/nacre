'use strict';

const fs = require('node:fs');
const path = require('node:path');

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('NSIS upstream template changed; review the upgrade patch.');
  return source.replace(before, after);
}

function patchUpgradeUtility(source) {
  // Use this release's uninstaller for compatible Nacre NSIS installs. Running
  // the installed copy would retain its old PowerShell process-detection bug.
  source = replaceOnce(source,
    '!insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"',
    'File "/oname=$PLUGINSDIR\\old-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"');
  source = replaceOnce(source,
    'ExecWait \'"$uninstallerFileName" /S /KEEP_APP_DATA $0 _?=$installationDir\' $R0',
    // Never fall back to the installed, potentially broken uninstaller.
    'Goto DoesNotExist');
  source = replaceOnce(source,
    'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt\n      Return',
    'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "The previous installation could not be replaced (uninstaller exit code $R0). A file may be locked or access may be denied. Retry, or cancel; your profile is preserved." /SD IDCANCEL IDRETRY OneMoreAttempt\n      SetErrorLevel 2\n      Quit');
  return source;
}

function patchExtractionUtility(source) {
  source = replaceOnce(source,
    '    CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR',
    '    ClearErrors\n    CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR');
  const start = source.indexOf('      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)"');
  const end = source.indexOf('  RetryExtract7za:', start);
  if (start < 0 || end < 0) throw new Error('NSIS extraction template changed; review the copy failure patch.');
  // Retry the checked copy only. The upstream fallback extracts directly over
  // installed files and ignores errors, allowing a broken install to succeed.
  return source.slice(0, start) + [
    '      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Unable to copy Nacre files to $OUTDIR. Check folder permissions, available disk space and locked files. If this setup was opened from the development workspace, use the exported copy in Downloads." /SD IDCANCEL IDCANCEL AbortExtract7za',
    '      StrCpy $R1 0',
    '      Goto RetryExtract7za',
    '    ${endIf}',
    '',
    '  AbortExtract7za:',
    '    SetErrorLevel 2',
    '    Quit',
    '',
  ].join('\n') + source.slice(end);
}

function prepareNsisScript(root = path.resolve(__dirname, '..')) {
  const builder = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [path.dirname(require.resolve('electron-builder/package.json'))] }));
  if (JSON.parse(fs.readFileSync(path.join(builder, 'package.json'), 'utf8')).version !== '26.17.0') throw new Error('Review NSIS upgrade patch for this electron-builder version.');
  const templates = path.join(builder, 'templates', 'nsis');
  const output = path.join(root, '.cache', 'nacre-nsis');
  fs.mkdirSync(output, { recursive: true });
  const utility = path.join(output, 'installUtil.nsh');
  fs.writeFileSync(utility, patchUpgradeUtility(fs.readFileSync(path.join(templates, 'include', 'installUtil.nsh'), 'utf8').replace(/\r\n/g, '\n')));
  const extraction = path.join(output, 'extractAppPackage.nsh');
  fs.writeFileSync(extraction, patchExtractionUtility(fs.readFileSync(path.join(templates, 'include', 'extractAppPackage.nsh'), 'utf8').replace(/\r\n/g, '\n')));
  const functions = path.join(output, 'installer-functions.nsh');
  fs.writeFileSync(functions, replaceOnce(fs.readFileSync(path.join(templates, 'include', 'installer.nsh'), 'utf8'), '!include "extractAppPackage.nsh"', '!include "' + extraction + '"'));
  const section = path.join(output, 'installSection.nsh');
  fs.writeFileSync(section, replaceOnce(fs.readFileSync(path.join(templates, 'installSection.nsh'), 'utf8'), '!include installer.nsh', '!include "' + functions + '"'));
  let script = replaceOnce(fs.readFileSync(path.join(templates, 'installer.nsi'), 'utf8'), '!include "installUtil.nsh"', '!include "' + utility + '"');
  script = replaceOnce(script, '!include "installSection.nsh"', '!include "' + section + '"');
  const info = require(path.join(root, 'package.json'));
  const release = info.nacreVersion || info.version;
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(release)) throw new Error('Invalid Windows release version');
  // package.json keeps a semver version; Windows exposes the full release.
  script = '!undef VERSION\n!define VERSION "' + release + '"\n' + script;
  const target = path.join(output, 'installer.nsi');
  fs.writeFileSync(target, script);
  return target;
}

function installNsisTemplatePatch() {
  const target = prepareNsisScript();
  // Initialize the builder's package exports before loading its internal target
  // module directly, avoiding its circular platform-packager initialization.
  require('electron-builder');
  const builder = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [path.dirname(require.resolve('electron-builder/package.json'))] }));
  const { NsisTarget } = require(path.join(builder, 'out/targets/nsis/NsisTarget.js'));
  const marker = Symbol.for('nacre.nsis.template.patch');
  if (NsisTarget.prototype[marker]) return;
  const original = NsisTarget.prototype.computeFinalScript;
  const stock = fs.readFileSync(path.join(builder, 'templates/nsis/installer.nsi'), 'utf8');
  NsisTarget.prototype.computeFinalScript = function (script, ...args) {
    if (this.isPortable) return original.call(this, script, ...args);
    if (script !== stock) throw new Error('Unexpected NSIS script; review the Nacre template integration.');
    return original.call(this, fs.readFileSync(target, 'utf8'), ...args);
  };
  NsisTarget.prototype[marker] = true;
}

module.exports = { prepareNsisScript, patchUpgradeUtility, patchExtractionUtility, installNsisTemplatePatch };
