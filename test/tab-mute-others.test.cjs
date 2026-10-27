'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMainHeadless } = require('../scripts/red-team/harness/electron-stub.cjs');

let h, event, menus, changes;
test.beforeEach(async () => {
  h = await loadMainHeadless();
  event = { sender: h.chrome, senderFrame: h.chrome.mainFrame };
  h.ipcHandlers.get('nacre:update-preferences').fn(event, { language: 'fr' });
  menus = [];
  changes = [];
  h.electron.Menu.buildFromTemplate = (items) => {
    menus.push(items);
    return { popup() {} };
  };
  h.ipcHandlers.get('nacre:home').fn(event);
  observe(h.views.at(-1).webContents);
});

function observe(contents) {
  contents.setAudioMuted = (muted) => changes.push({ id: contents.id, muted });
}
function currentId() {
  return h.sends.filter((send) => send.channel === 'nacre:state').at(-1).args[0].activeId;
}
async function addTab(privateMode = false) {
  h.ipcHandlers.get(privateMode ? 'nacre:new-private-tab' : 'nacre:new-tab').fn(event);
  await new Promise(setImmediate);
  const contents = h.views.at(-1).webContents;
  observe(contents);
  return contents;
}
function openMenu(id) {
  h.ipcHandlers.get('nacre:tab-context').fn(event, id);
  const item = menus.at(-1).find((entry) => entry.label === 'Couper le son des autres onglets');
  assert.ok(item, 'tab menu provides mute-other-tabs action');
  return item;
}

test('a lone tab disables mute-other-tabs and opening the menu does not change sound', () => {
  const item = openMenu(currentId());
  assert.equal(item.enabled, false);
  item.click();
  assert.deepEqual(changes, []);
});

test('mute-other-tabs mutes normal and private siblings without changing the target', async () => {
  const target = currentId();
  const normal = await addTab();
  const privateTab = await addTab(true);
  const item = openMenu(target);
  assert.equal(item.enabled, true);
  assert.deepEqual(changes, []);
  item.click();
  assert.deepEqual(changes, [{ id: normal.id, muted: true }, { id: privateTab.id, muted: true }]);
});

test('destroyed siblings are skipped', async () => {
  const target = currentId();
  const destroyed = await addTab();
  const live = await addTab();
  destroyed.isDestroyed = () => true;
  openMenu(target).click();
  assert.deepEqual(changes, [{ id: live.id, muted: true }]);
});

test('closing the target invalidates an already opened menu action', async () => {
  const target = currentId();
  await addTab();
  const item = openMenu(target);
  h.ipcHandlers.get('nacre:close-tab').fn(event, target);
  item.click();
  assert.deepEqual(changes, []);
});

test('a tab closed while the menu is open is not muted', async () => {
  const target = currentId();
  await addTab();
  const other = currentId();
  const item = openMenu(target);
  h.ipcHandlers.get('nacre:close-tab').fn(event, other);
  item.click();
  assert.deepEqual(changes, []);
});
