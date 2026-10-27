'use strict';
// Prepares an offline clean-Windows check of the built installer. Open the
// printed .wsb file to run it; the sandbox closes itself and leaves
// installation-report.json in the results folder.
//
//   node scripts/prepare-windows-sandbox-check.cjs [dist folder]
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const setupName = 'Nacre Setup ' + version + '.exe';
const setup = path.join(path.resolve(root, process.argv[2] || 'dist'), setupName);
if (!fs.statSync(setup).isFile()) throw new Error('Installer not found: ' + setup);

const destination = path.join(root, '.cache', 'sandbox-' + Date.now());
const input = path.join(destination, 'input'), output = path.join(destination, 'results');
fs.mkdirSync(input, { recursive: true });
fs.mkdirSync(output);
fs.copyFileSync(setup, path.join(input, setupName));
// Windows PowerShell 5.1 reads a script without BOM as the ANSI code page.
fs.writeFileSync(path.join(input, 'verify.ps1'), '\uFEFF' + fs.readFileSync(path.join(__dirname, 'verify-installation-in-sandbox.ps1'), 'utf8').replace(/^\uFEFF/, ''));

const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const config = String.raw`<Configuration>
  <Networking>Disable</Networking><ClipboardRedirection>Disable</ClipboardRedirection>
  <AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><PrinterRedirection>Disable</PrinterRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>${escape(input)}</HostFolder><SandboxFolder>C:\NacreInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>${escape(output)}</HostFolder><SandboxFolder>C:\NacreResults</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\NacreInput\verify.ps1 -Version ${version}</Command></LogonCommand>
</Configuration>`;
const wsb = path.join(destination, 'Nacre-' + version + '.wsb');
fs.writeFileSync(wsb, config);
console.log(wsb);
