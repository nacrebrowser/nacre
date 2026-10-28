'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const packageInfo = require('../package.json');

const root = path.resolve(__dirname, '..');
const dist = path.resolve(root, process.argv[2] || 'dist');
const outputRelative = path.relative(root, dist);
if (!outputRelative || outputRelative.startsWith('..') || path.isAbsolute(outputRelative)) throw new Error('Le dossier de paquet doit rester dans le projet.');
const appDir = path.join(dist, 'win-unpacked');
const asar = path.join(appDir, 'resources', 'app.asar');
const appExe = path.join(appDir, 'Nacre.exe');
const releaseVersion = packageInfo.nacreVersion || packageInfo.version;
const names = require('./artifact-names.cjs').artifactNames(releaseVersion);
const portableZip = path.join(dist, names.portable);
const setupExe = path.join(dist, names.nsis);
const appArchive = path.join(dist, `.nacre-app-${releaseVersion}.zip`);
const sumsFile = path.join(dist, names.sums);

function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Chemin de sortie hors du dossier attendu : ${target}`);
}

function runPowerShell(script, extraEnv = {}, timeout = 30 * 60 * 1000) {
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`PowerShell a échoué (${result.status ?? result.signal ?? 'inconnu'}).`);
  return result;
}

function quoteSed(value) {
  return String(value).replace(/[\r\n]/g, ' ');
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function main() {
  if (!fs.existsSync(appExe) || !fs.existsSync(asar)) throw new Error('La build Windows win-unpacked manque. Lancez npm run build:windows.');
  assertInside(dist, portableZip);
  assertInside(dist, setupExe);
  assertInside(dist, appArchive);
  assertInside(dist, sumsFile);
  const exeVersion = fs.statSync(appExe).size > 0;
  if (!exeVersion) throw new Error('Nacre.exe est vide.');
  const resourceTor = path.join(dist, 'win-unpacked', 'resources', 'tor', 'tor.exe');
  const resourceFilters = path.join(dist, 'win-unpacked', 'resources', 'filters', 'engine.bin');
  if (!fs.existsSync(resourceTor) || !fs.existsSync(resourceFilters)) throw new Error('Les ressources Tor ou le moteur de filtres manquent du paquet.');

  const tempRoot = fs.mkdtempSync(path.join(root, '.cache', 'release-0.4.0-'));
  assertInside(path.join(root, '.cache'), tempRoot);
  const stagedSetup = path.join(tempRoot, 'setup');
  fs.mkdirSync(stagedSetup, { recursive: true });
  const stagedArchive = path.join(stagedSetup, 'nacre-app.zip');
  const stagedInstallerScript = path.join(stagedSetup, 'install.ps1');
  const stagedSed = path.join(tempRoot, 'nacre-installer.sed');
  const iexpressExe = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'iexpress.exe');

  try {
    // A previous aborted packaging can leave its temporary archive behind;
    // CreateFromDirectory refuses to overwrite an existing zip.
    if (fs.existsSync(appArchive)) fs.unlinkSync(appArchive);
    console.log(`Compression du répertoire Windows (${releaseVersion})…`);
    runPowerShell(
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:NACRE_SOURCE, $env:NACRE_ARCHIVE, [System.IO.Compression.CompressionLevel]::Optimal, $false)',
      { NACRE_SOURCE: appDir, NACRE_ARCHIVE: appArchive }
    );

    fs.copyFileSync(appArchive, portableZip);
    const portableLauncher = path.join(root, 'scripts', 'portable-launcher.cmd');
    const portableReadme = path.join(root, 'scripts', 'portable-readme.txt');
    runPowerShell(
      'Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::Open($env:NACRE_ARCHIVE, [System.IO.Compression.ZipArchiveMode]::Update); try { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $env:NACRE_LAUNCHER, "Nacre Portable.cmd", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null; [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $env:NACRE_README, "LISEZ-MOI-PORTABLE.txt", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null } finally { $zip.Dispose() }',
      { NACRE_ARCHIVE: portableZip, NACRE_LAUNCHER: portableLauncher, NACRE_README: portableReadme }
    );

    const build = spawnSync(process.execPath, [path.join(root, 'scripts/run-electron-builder.cjs'), '--win', '--x64', '--prepackaged', appDir, '--config', 'build/electron-builder.setup.cjs', '-c.directories.output=' + outputRelative], {cwd:root,stdio:'inherit',windowsHide:true});
    if(build.error) throw build.error;
    if(build.status!==0) throw Error('NSIS build failed: '+build.status);
    const outputs = [setupExe, portableZip];
    const lines = outputs.map((file) => `${sha256(file)}  ${path.basename(file)}`);
    fs.writeFileSync(sumsFile, `${lines.join(os.EOL)}${os.EOL}`, 'utf8');
    // This checkout can carry a Low mandatory integrity label. Distributing an
    // exe directly from it makes Windows run that setup at Low IL, preventing
    // writes to the real installation and registry. Export bytes into fresh
    // files in a normal user directory; never relax the workspace's ACLs.
    const exportDirectory = process.env.NACRE_RELEASE_EXPORT || path.join(os.homedir(), 'Downloads', `Nacre-${releaseVersion}-${Date.now()}`);
    runPowerShell('& $env:NACRE_EXPORT_SCRIPT -Destination $env:NACRE_EXPORT_DIRECTORY -Source @($env:NACRE_EXPORT_SETUP, $env:NACRE_EXPORT_PORTABLE, $env:NACRE_EXPORT_SUMS)', {
      NACRE_EXPORT_SCRIPT: path.join(root, 'scripts', 'export-windows-artifacts.ps1'),
      NACRE_EXPORT_DIRECTORY: exportDirectory,
      NACRE_EXPORT_SETUP: setupExe,
      NACRE_EXPORT_PORTABLE: portableZip,
      NACRE_EXPORT_SUMS: sumsFile
    });
    fs.writeFileSync(path.join(root, '.cache', 'latest-windows-export.json'), JSON.stringify({ version: releaseVersion, directory: exportDirectory, setup: path.join(exportDirectory, path.basename(setupExe)), portable: path.join(exportDirectory, path.basename(portableZip)), checksums: path.join(exportDirectory, path.basename(sumsFile)) }, null, 2));
    console.log(`Installateur : ${setupExe} (${fs.statSync(setupExe).size} octets)`);
    console.log(`Portable : ${portableZip} (${fs.statSync(portableZip).size} octets)`);
    console.log(`SHA-256 : ${sumsFile}`);
    console.log(`Distribution Windows : ${exportDirectory}`);
  } finally {
    assertInside(path.join(root, '.cache'), tempRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (fs.existsSync(appArchive)) fs.unlinkSync(appArchive);
  }
}

try { main(); }
catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
