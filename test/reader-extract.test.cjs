'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReaderDocument, extractionSource, MAX_BLOCKS } = require('../src/reader-extract.cjs');

test('reader documents keep supported text blocks and drop everything else', () => {
  const result = normalizeReaderDocument({
    title: '  A   useful page ',
    byline: 'Ada',
    site: 'example.org',
    lang: 'fr',
    blocks: [
      { type: 'h1', text: 'A useful page' },
      { type: 'p', text: ' First paragraph\n with spaces. ' },
      { type: 'img', text: 'ignored' },
      { type: 'p', text: 'First paragraph with spaces.' },
      { type: 'li', text: 'Item' },
      { type: 'script', text: 'alert(1)' }
    ]
  });
  assert.equal(result.title, 'A useful page');
  assert.equal(result.byline, 'Ada');
  assert.equal(result.site, 'example.org');
  assert.equal(result.lang, 'fr');
  assert.deepEqual(result.blocks.map((block) => [block.type, block.text]), [
    ['h1', 'A useful page'],
    ['p', 'First paragraph with spaces.'],
    ['li', 'Item']
  ]);
  assert.ok(result.minutes >= 1);
  assert.equal(result.truncated, true, 'dropped blocks are reported as truncation');
});

test('empty or malformed documents are rejected', () => {
  assert.equal(normalizeReaderDocument(null), null);
  assert.equal(normalizeReaderDocument({ blocks: [] }), null);
  assert.equal(normalizeReaderDocument({ blocks: [{ type: 'p', text: ' ' }] }), null);
  assert.equal(normalizeReaderDocument({ blocks: [{ type: 'img', text: 'no' }] }), null);
});

test('reader blocks are bounded and long text is clipped', () => {
  const blocks = Array.from({ length: MAX_BLOCKS + 20 }, (_, index) => ({ type: 'p', text: 'paragraph ' + index }));
  const result = normalizeReaderDocument({ title: 'Long', blocks });
  assert.equal(result.blocks.length, MAX_BLOCKS);
  assert.equal(result.truncated, true);
  const clipped = normalizeReaderDocument({ title: 'Clip', blocks: [{ type: 'p', text: 'x'.repeat(30000) }] });
  assert.equal(clipped.blocks[0].text.length, 20000);
});

test('the injected extraction source stays self-contained', () => {
  assert.equal(typeof extractionSource, 'string');
  assert.match(extractionSource, /document\.querySelector/);
  assert.doesNotMatch(extractionSource, /\brequire\s*\(/);
  assert.doesNotMatch(extractionSource, /\bprocess\./);
});
