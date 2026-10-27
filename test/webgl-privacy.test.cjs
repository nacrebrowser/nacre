'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'src', 'fingerprint-preload.cjs'), 'utf8');

test('Chromium WebGL is locked off and legacy masked preferences are ignored', () => {
  assert.match(mainSource, /const startupWebglMode = 'disabled';[\s\S]*?applyWebglDisablePolicy\(app\)/);
  assert.match(mainSource, /webglMode: 'disabled'/);
  assert.match(mainSource, /const webglMode = 'disabled'/);
  assert.match(mainSource, /next\.webglMode = 'disabled'/);
  assert.match(mainSource, /applyWebglDisablePolicy\(app\);[\s\S]*?app\.whenReady\(\)/);
  assert.doesNotMatch(mainSource, /stored\.webglMode === 'masked'/);
});

// Rendered WebGL controls and status: test/ui-security-contracts.test.cjs.

test('unreliable WebGL masking is absent and existing plugin and locale protections remain', () => {
  assert.doesNotMatch(preloadSource, /config\.webglMode === 'masked'/);
  assert.match(mainSource, /plugins: true/);
  const ua = fs.readFileSync(path.join(root, 'src', 'ua-preload.cjs'), 'utf8');
  assert.doesNotMatch(ua, /Chrome PDF Plugin|Chromium PDF Plugin|internal-pdf-viewer/);
  assert.match(ua, /'language',[\s\S]*?get: \(\) => 'en-US'/);
  assert.match(ua, /\['en-US', 'en'\]/);
  assert.match(ua, /formFactors: Object\.freeze\(\['Desktop'\]\)/);
  assert.match(ua, /hint === 'formFactors'/);
});
