'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FRAME_LANGUAGE_OVERRIDE, registerFrameLocaleOverrides } = require('../src/frame-locale.cjs');

test('la langue est normalisée dans chaque frame enfant, dont about:blank', async () => {
  const handlers = new Map();
  const mainFrame = { url: 'https://top.example/' };
  const calls = [];
  const contents = { mainFrame, on: (name, fn) => handlers.set(name, fn) };
  registerFrameLocaleOverrides(contents);
  const onCreated = handlers.get('frame-created');
  const makeFrame = (url) => ({ url, executeJavaScript: async (source) => { calls.push({ url, source }); } });
  onCreated({}, { frame: mainFrame });
  onCreated({}, { frame: makeFrame('https://third.example/frame') });
  onCreated({}, { frame: makeFrame('about:blank') });
  onCreated({}, { frame: makeFrame('file:///private.html') });
  onCreated({}, { frame: makeFrame('https://third.example/frame', 'nacre://settings/') });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((call) => call.url), ['https://third.example/frame', 'about:blank', 'file:///private.html', 'https://third.example/frame']);
  assert.ok(calls.every((call) => call.source === FRAME_LANGUAGE_OVERRIDE));
  assert.match(FRAME_LANGUAGE_OVERRIDE, /Object\.freeze\(\['en-US', 'en'\]\)/);
});

test('rejette un WebContents invalide', () => {
  assert.throws(() => registerFrameLocaleOverrides(null), /WebContents requis/);
});
