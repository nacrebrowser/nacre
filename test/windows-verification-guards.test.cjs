'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('clean-Windows installer verifier refuses to touch an ordinary host profile', { skip: process.platform !== 'win32' || process.env.USERNAME === 'WDAGUtilityAccount' }, () => {
  const result = spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'../scripts/verify-installation-in-sandbox.ps1')],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.notEqual(result.status,0,'must refuse execution before any installer or deletion');
  assert.match(result.stderr,/only inside the Nacre Windows Sandbox configuration/);
});
