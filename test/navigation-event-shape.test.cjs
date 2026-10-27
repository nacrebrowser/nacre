'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');

function navigationHandler(eventName) {
  const start = main.indexOf(`.on('${eventName}',`);
  assert.notEqual(start, -1, `${eventName} handler exists`);
  const end = main.indexOf('\n  });', start);
  assert.notEqual(end, -1, `${eventName} handler closes`);
  return main.slice(start, end);
}

test('Electron navigation handlers read URL and main-frame metadata from the event', () => {
  for (const eventName of ['will-frame-navigate', 'will-redirect', 'will-navigate']) {
    const handler = navigationHandler(eventName);
    assert.match(handler, /\bevent\.url\b/, `${eventName} reads event.url`);
    assert.match(handler, /\bevent\.isMainFrame\b/, `${eventName} reads event.isMainFrame`);
  }
});

test('will-navigate uses its legacy URL argument only as a fallback', () => {
  const handler = navigationHandler('will-navigate');
  assert.match(handler, /\(event, legacyUrl\)\s*=>/);
  assert.match(handler, /event && typeof event\.url === 'string' \? event\.url : legacyUrl/);
  assert.equal((handler.match(/\blegacyUrl\b/g) || []).length, 2);
});

test('will-frame-navigate and will-redirect do not use second-argument fallbacks', () => {
  for (const eventName of ['will-frame-navigate', 'will-redirect']) {
    const handler = navigationHandler(eventName);
    assert.match(handler, /\(event\)\s*=>/);
    assert.doesNotMatch(handler, /\b(details|legacyUrl)\b/);
  }
});
