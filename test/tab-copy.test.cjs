'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMainHeadless } = require('../scripts/red-team/harness/electron-stub.cjs');

let h, event, menu;
test.beforeEach(async () => {
  h = await loadMainHeadless();
  event = { sender: h.chrome, senderFrame: h.chrome.mainFrame };
  h.ipcHandlers.get('nacre:update-preferences').fn(event, { language: 'fr' });
  menu = undefined;
  h.electron.Menu.buildFromTemplate = (items) => {
    menu = items;
    return { popup() {} };
  };
});

function writes() {
  return h.effects.filter((effect) => effect.owner === 'clipboard' && effect.method === 'writeText');
}

function openMenu(url) {
  h.ipcHandlers.get('nacre:home').fn(event);
  if (url) h.ipcHandlers.get('nacre:navigate').fn(event, url);
  // The harness does not navigate Chromium: model its committed top-level URL.
  const contents = h.views.at(-1).webContents;
  contents.mainFrame.url = url || 'about:blank';
  const state = h.sends.filter((send) => send.channel === 'nacre:state').at(-1).args[0];
  h.ipcHandlers.get('nacre:tab-context').fn(event, state.activeId);
  const item = menu.find((entry) => entry.label === 'Copier l’adresse de l’onglet');
  assert.ok(item, 'tab menu provides the copy action');
  return { item, contents, id: state.activeId };
}

test('opening the menu leaves the clipboard unchanged; click copies the committed URL', () => {
  const { item } = openMenu('https://example.test/path?q=1#section');
  assert.equal(item.enabled, true);
  assert.equal(writes().length, 0);
  item.click();
  assert.deepEqual(writes().map((effect) => effect.args), [['https://example.test/path?q=1#section']]);
});

test('copy follows a top-level navigation while the menu is open', () => {
  const { item, contents } = openMenu('https://example.test/old');
  contents.mainFrame.url = 'https://example.test/new';
  item.click();
  assert.deepEqual(writes().map((effect) => effect.args), [['https://example.test/new']]);
});

test('a blank tab cannot copy its internal page URL', () => {
  const { item } = openMenu();
  assert.equal(item.enabled, false);
  item.click();
  assert.equal(writes().length, 0);
});

test('closing the target tab invalidates an already opened copy action', () => {
  const { item, id } = openMenu('https://example.test/');
  h.ipcHandlers.get('nacre:close-tab').fn(event, id);
  item.click();
  assert.equal(writes().length, 0);
});

test('destroyed contents and unsupported committed URLs are not copied', () => {
  const { item, contents } = openMenu('https://example.test/');
  contents.mainFrame.url = 'file:///C:/private/report.html';
  item.click();
  contents.mainFrame.url = 'https://example.test/';
  contents.isDestroyed = () => true;
  item.click();
  assert.equal(writes().length, 0);
});

test('copy still targets the original tab after activating another tab', async () => {
  const { item } = openMenu('https://example.test/background');
  h.ipcHandlers.get('nacre:new-tab').fn(event);
  await new Promise(setImmediate);
  h.ipcHandlers.get('nacre:navigate').fn(event, 'https://other.test/');
  h.views.at(-1).webContents.mainFrame.url = 'https://other.test/';
  item.click();
  assert.deepEqual(writes().map((effect) => effect.args), [['https://example.test/background']]);
});

test('a private tab writes to the clipboard only after an explicit click', async () => {
  h.ipcHandlers.get('nacre:new-private-tab').fn(event);
  await new Promise(setImmediate);
  const { item } = openMenu('https://example.test/private');
  const state = h.sends.filter((send) => send.channel === 'nacre:state').at(-1).args[0];
  assert.equal(state.tabs.find((tab) => tab.id === state.activeId).private, true);
  assert.equal(writes().length, 0);
  item.click();
  assert.deepEqual(writes().map((effect) => effect.args), [['https://example.test/private']]);
});

test('web content cannot open the privileged tab menu', () => {
  const attacker = h.newContents('https://attacker.test/');
  h.ipcHandlers.get('nacre:tab-context').fn({ sender: attacker, senderFrame: attacker.mainFrame }, 1);
  assert.equal(menu, undefined);
  assert.equal(writes().length, 0);
});
