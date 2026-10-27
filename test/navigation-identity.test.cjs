'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMainHeadless } = require('../scripts/red-team/harness/electron-stub.cjs');

test('a subframe hash cannot change the main tab URL or secure state', async () => {
  const h = await loadMainHeadless();
  const page = h.views[1].webContents;
  page.mainFrame.url = 'http://attacker.test/';
  h.fire(page, 'did-navigate', {}, page.mainFrame.url);
  h.fire(page, 'did-navigate-in-page', {}, 'https://trusted.test/#spoof', false);
  const snapshot = h.sends.filter(s => s.channel === 'nacre:state').at(-1).args[0];
  assert.equal(snapshot.tabs[0].url, page.mainFrame.url);
  assert.equal(snapshot.tabs[0].secure, false);
  page.mainFrame.url += '#real';
  h.fire(page, 'did-navigate-in-page', {}, page.mainFrame.url, true);
  assert.equal(h.sends.filter(s => s.channel === 'nacre:state').at(-1).args[0].tabs[0].url, page.mainFrame.url);
});
