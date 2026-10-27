'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { filterBookmarks, hostOf, MAX_SUGGESTIONS } = require('../src/address-suggestions.js');

const bookmarks = [
  { title: 'PayPal', url: 'https://www.paypal.com/signin' },
  { title: 'Documentation', url: 'https://developer.mozilla.org/en-US/docs/Web' },
  { title: 'Example', url: 'https://example.org/' },
  { title: 'Duplicate', url: 'https://example.org/' },
  { title: 'Unsafe', url: 'javascript:alert(1)' }
];

test('matches title, host and address without returning duplicates or unsafe schemes', () => {
  assert.deepEqual(filterBookmarks(bookmarks, 'paypal').map((item) => item.url), ['https://www.paypal.com/signin']);
  assert.deepEqual(filterBookmarks(bookmarks, 'example.org').map((item) => item.title), ['Example']);
  assert.deepEqual(filterBookmarks(bookmarks, 'developer').map((item) => item.title), ['Documentation']);
  assert.deepEqual(filterBookmarks(bookmarks, 'javascript'), []);
});

test('host matches rank before title matches', () => {
  const items = [
    { title: 'Notes about example', url: 'https://docs.test/example' },
    { title: 'Other', url: 'https://example.net/' }
  ];
  assert.deepEqual(filterBookmarks(items, 'example').map((item) => item.url), ['https://example.net/', 'https://docs.test/example']);
});

test('empty queries and suggestion limits are enforced', () => {
  assert.deepEqual(filterBookmarks(bookmarks, '   '), []);
  assert.deepEqual(filterBookmarks(bookmarks, 'e', 1).length, 1);
  const many = Array.from({ length: 20 }, (_, index) => ({ title: 'Page ' + index, url: 'https://site' + index + '.example/' }));
  assert.equal(filterBookmarks(many, 'page').length, MAX_SUGGESTIONS);
});

test('hostOf strips the common www prefix and tolerates malformed values', () => {
  assert.equal(hostOf('https://www.example.org/path'), 'example.org');
  assert.equal(hostOf('not a url'), '');
});
