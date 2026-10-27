'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('renderer-free native window retains protected views, native auth and child cleanup', { timeout: 100000 }, () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/verify-memory-runtime.cjs')], { encoding: 'utf8', timeout: 95000 });
  assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''));
  assert.match(result.stdout, /MEMORY_LIFECYCLE_RESULT .*"status":"PASS"/);
  assert.match(result.stdout, /"sandbox":true/);
});
