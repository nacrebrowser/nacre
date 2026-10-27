'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '..', 'src');
const read = (name) => fs.readFileSync(path.join(source, name), 'utf8');

// A <use href="#i-x"> that points at a missing <symbol> renders nothing and
// raises no error, so a button silently loses its icon.
test('every icon referenced by the browser chrome is defined in the sprite', () => {
  const defined = new Set([...read('index.html').matchAll(/<symbol id="(i-[a-z-]+)"/g)].map((match) => match[1]));
  assert.ok(defined.size > 30, 'the sprite is present');
  const missing = [];
  for (const file of ['index.html', 'renderer.js', 'experience-ui.js', 'command-palette.js', 'protection-activity-ui.js']) {
    const text = read(file);
    for (const match of text.matchAll(/href="#(i-[a-z-]+)"/g)) if (!defined.has(match[1])) missing.push(`${file}: ${match[1]}`);
    for (const match of text.matchAll(/'#(i-[a-z-]+)'/g)) if (!defined.has(match[1])) missing.push(`${file}: ${match[1]}`);
    for (const match of text.matchAll(/appendIcon\([^,()]+,\s*'([a-z-]+)'\)/g)) if (!defined.has('i-' + match[1])) missing.push(`${file}: i-${match[1]}`);
    for (const match of text.matchAll(/'#i-' \+ \(([^)]*)\)/g)) {
      for (const name of match[1].matchAll(/'([a-z-]+)'/g)) if (!defined.has('i-' + name[1])) missing.push(`${file}: i-${name[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
