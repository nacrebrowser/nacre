'use strict';

// Static guard for UI wording. Nacre's Tor exit country is only requested, not
// guaranteed, and nothing in the UI may promise anonymity or zero leaks.
// Add a phrase here only when the claim it blocks is untrue or unmeasured.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const uiFiles = fs.readdirSync(srcDir).filter((name) => /\.(html|js)$/.test(name));

const forbidden = [
  { name: 'exit country promised', pattern: /relais Tor situ\u00e9 dans le pays/i },
  { name: 'exit country guaranteed', pattern: /(?:Tor|Nacre)\s+garantit\s+(?:le|ce|la)\s+(?:pays|sortie)(?!\s+(?:pas|n))/i },
  { name: 'anonymity guaranteed', pattern: /anonymat\s+garanti|totalement\s+anonyme|100\s?%\s+anonyme/i },
  { name: 'zero leak claim', pattern: /z\u00e9ro\s+fuite|aucune\s+fuite\s+possible|sans\s+aucune\s+fuite/i },
  { name: 'undetectable claim', pattern: /ind\u00e9tectable|rend\s+invisible\s+sur\s+internet/i }
];

test('UI files contain no forbidden overclaim phrases', () => {
  const violations = [];
  for (const file of uiFiles) {
    const lines = fs.readFileSync(path.join(srcDir, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const rule of forbidden) {
        if (rule.pattern.test(line)) violations.push(`${file}:${index + 1} [${rule.name}]`);
      }
    });
  }
  assert.deepEqual(violations, []);
});

// Rendered relay disclaimer: test/ui-security-contracts.test.cjs.
