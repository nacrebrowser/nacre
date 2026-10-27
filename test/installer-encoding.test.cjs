'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Windows PowerShell reads packaged installer paths and data-deletion consent without corrupting Unicode', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'nacre-installer-encoding-'));
  const script = path.join(directory,'install.ps1');
  // Same source/version substitution and UTF-8 write as package-windows.cjs.
  fs.writeFileSync(script,fs.readFileSync(path.join(__dirname,'../scripts/install-nacre.ps1'),'utf8').replaceAll('0.4.0','0.5.1'),'utf8');
  const result = spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'../scripts/test-support/parse-powershell-literals.ps1'),'-InputFile',script],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stderr);
  const parsed = JSON.parse(result.stdout.trim());
  assert.ok(parsed.version.startsWith('5.'),'exercise the Windows PowerShell used by the actual installer');
  const values = parsed.values.map(value=>Buffer.from(value,'base64').toString('utf8'));
  assert.ok(values.includes('Désinstaller Nacre.ps1'),'uninstaller file name retains its accents');
  assert.ok(values.includes('Désinstaller Nacre.lnk'),'uninstall shortcut retains its accents');
  assert.ok(values.includes('Installation complete'),'native installer completion dialog uses English');
  assert.ok(values.some(value=>value.includes('Supprimer aussi les données du profil Nacre standard')),'data-deletion consent retains its meaning');
});
