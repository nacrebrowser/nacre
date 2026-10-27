'use strict';
// Adds or updates interface strings in every catalogue under src/locales.
// Usage: node scripts/add-locale-keys.cjs strings.json
// strings.json: { "key": { "en": "English text", "fr": "Texte", ... }, ... }
// Languages without a translation receive the English text, so every
// catalogue keeps the same key set (required by test/i18n.test.cjs).
// Region variants fall back to their base language first (fr-CA -> fr).
const fs = require('node:fs');
const path = require('node:path');

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/add-locale-keys.cjs strings.json');
  process.exit(2);
}
const strings = JSON.parse(fs.readFileSync(input, 'utf8'));
const directory = path.join(__dirname, '..', 'src', 'locales');
for (const [key, values] of Object.entries(strings)) {
  if (!values || typeof values.en !== 'string') throw new Error('Missing English text for ' + key);
}
let changed = 0;
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
  const language = file.slice(0, -5);
  const base = language.split('-')[0];
  const target = path.join(directory, file);
  const raw = fs.readFileSync(target, 'utf8');
  const catalogue = JSON.parse(raw);
  for (const [key, values] of Object.entries(strings)) {
    catalogue[key] = values[language] ?? values[base] ?? values.en;
  }
  fs.writeFileSync(target, JSON.stringify(catalogue, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  changed++;
}
console.log(`Updated ${Object.keys(strings).length} keys in ${changed} catalogues.`);
