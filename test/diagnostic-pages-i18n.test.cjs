'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '..', 'src');
const read = (name) => fs.readFileSync(path.join(source, name), 'utf8');
const english = JSON.parse(read('locales/en.json'));
const french = JSON.parse(read('locales/fr.json'));

// Keys are written as translate('key', 'fallback') or text('key', 'fallback'),
// or as [key, fallback] pairs. A key missing from the catalogue silently falls
// back to English, so a typo would go unnoticed.
function keysUsedBy(file) {
  const text = read(file);
  const keys = new Set();
  // Catalogue keys always contain a dot; this skips calls such as getContext('webgl').
  for (const match of text.matchAll(/(?:translate|text)\(\s*'([A-Za-z0-9_]+\.[A-Za-z0-9_.]+)'/g)) keys.add(match[1]);
  for (const match of text.matchAll(/\[\s*'((?:diagnostics|privacyCheck)\.[A-Za-z0-9_.]+)'\s*,\s*'/g)) keys.add(match[1]);
  for (const match of text.matchAll(/(?:key|noteKey):\s*'((?:diagnostics|privacyCheck)\.[A-Za-z0-9_.]+)'/g)) keys.add(match[1]);
  return keys;
}

test('the diagnostics and privacy check pages only use keys present in the catalogue', () => {
  const missing = [];
  for (const file of ['diagnostics.js', 'privacy-center.js']) {
    for (const key of keysUsedBy(file)) if (typeof english[key] !== 'string') missing.push(`${file}: ${key}`);
  }
  assert.deepEqual(missing, []);
});

test('the new wording is translated into French, not just English', () => {
  for (const key of ['diagnostics.badge.pass', 'diagnostics.headline.ok', 'diagnostics.group.limitsNote', 'privacyCheck.summary.good', 'privacyCheck.fix.revoke', 'privacyCheck.https.off']) {
    assert.notEqual(french[key], english[key], key);
  }
});

test('the privacy check no longer prints internal status codes', () => {
  const page = read('privacy-center.js');
  assert.doesNotMatch(page, /item\.detail \+ ' · ' \+ item\.status/);
  assert.doesNotMatch(page, /innerHTML/);
});

test('the diagnostics page hides the visitor IP address in the copyable report', () => {
  const page = read('diagnostics.js');
  assert.match(page, /function shareableReport\(report\)/);
  assert.match(page, /copy\.web\.network\.IP = maskAddress\(copy\.web\.network\.IP\)/);
});
