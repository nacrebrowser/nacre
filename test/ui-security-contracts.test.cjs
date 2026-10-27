'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('real internal DOM preserves country identities, risk notes and WebGL controls in all four active locales', { timeout: 100000 }, () => {
  const result = spawnSync(process.execPath,[path.join(__dirname,'../scripts/verify-ui-security-contracts.cjs')],{encoding:'utf8',windowsHide:true,timeout:95000});
  assert.equal(result.status,0,(result.stdout||'')+(result.stderr||''));
  const line = result.stdout.split('\n').find(line=>line.startsWith('UI_CONTRACTS_RESULT '));
  assert.ok(line,'Electron must produce the completed behavioral evidence');
  const evidence = JSON.parse(line.slice('UI_CONTRACTS_RESULT '.length));
  assert.equal(evidence.results.length,8);
  assert.ok(evidence.results.every(result=>result.status==='PASS'));
  assert.deepEqual(evidence.negativeControls,['missing-country','duplicate-country']);
});
