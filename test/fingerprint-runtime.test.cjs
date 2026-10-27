'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('le smoke transmet explicitement le probe au renderer et écrit son rapport depuis le main', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-fingerprint-runtime.cjs'), 'utf8');
  assert.match(source, /const rendererProbe = async \(\) => \{/);
  assert.match(source, /executeJavaScript\('\(' \+ rendererProbe\.toString\(\) \+ '\)\(\)'\)/);
  assert.match(source, /const fs = require\('node:fs'\);[\s\S]*?fs\.writeFileSync\(output/);
  assert.match(source, /registerFrameLocaleOverrides\(win\.webContents\)/);
  assert.match(source, /assert\(result\.iframe\.webgl === false/);
  assert.doesNotMatch(source, /executeJavaScript\(\(async \(\) =>/);
});
