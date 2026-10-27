'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const i18n = require('../src/i18n.cjs');

test('locale eviction reloads identical immutable translations without retaining raw JSON modules', () => {
  const original = i18n.getMessages('fr');
  const english = i18n.getMessages('en');
  const german = i18n.getMessages('de');
  i18n.getMessages('es'); i18n.getMessages('fr'); // Refresh the LRU position.
  i18n.getMessages('it');
  assert.equal(i18n.getMessages('fr'), original, 'recently used catalogue survives');
  assert.notEqual(i18n.getMessages('de'), german, 'least recently used catalogue is evicted');
  for (const language of i18n.SUPPORTED_LANGUAGES) i18n.getMessages(language);
  const reloaded = i18n.getMessages('fr');
  assert.notEqual(reloaded, original);
  assert.deepEqual(reloaded, original);
  assert.equal(Object.isFrozen(reloaded), true);
  assert.equal(Object.getPrototypeOf(reloaded), null);
  assert.equal(i18n.getMessages('en'), english, 'English fallback stays available');
  for (const language of i18n.SUPPORTED_LANGUAGES) assert.equal(require.cache[path.resolve(__dirname, '../src/locales', language + '.json')], undefined, language + ' is not pinned by require.cache');
});
