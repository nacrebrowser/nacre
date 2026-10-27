'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMainHeadless } = require('../scripts/red-team/harness/electron-stub.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = h => ({ sender: h.chrome, senderFrame: h.chrome.mainFrame });
const state = h => h.sends.filter(send => send.channel === 'nacre:state').at(-1).args[0];

test('address navigation accepts local/domain ports and retains explicit URL scheme validation', async () => {
  const h = await loadMainHeadless();
  h.ipcHandlers.get('nacre:update-setting').fn(event(h), 'httpsOnly', false);
  for (const [input, expected] of [['localhost:3000', 'http://localhost:3000/'], ['site.com:8443', 'https://site.com:8443/'], ['https://site.com:8443/a', 'https://site.com:8443/a'], ['127.0.0.1:8080/a', 'http://127.0.0.1:8080/a']]) {
    h.ipcHandlers.get('nacre:navigate').fn(event(h), input);
    assert.equal(state(h).active.url, expected, input);
  }
  const before = state(h).active.url;
  h.ipcHandlers.get('nacre:navigate').fn(event(h), 'javascript:alert(1)');
  assert.equal(state(h).active.url, before);
});

test('popup requires a fresh gesture, stays in background and consumes the gesture', async () => {
  const h = await loadMainHeadless();
  h.ipcHandlers.get('nacre:new-tab').fn(event(h), 'https://site.test/');
  await tick();
  h.ipcHandlers.get('nacre:navigate').fn(event(h), 'https://site.test/');
  const source = h.views.at(-1).webContents;
  const before = h.views.length, activeId = state(h).activeId;
  source.windowOpenHandler({ url: 'https://popup.test/', disposition: 'foreground-tab' });
  await tick();
  assert.equal(h.views.length, before);
  h.fire(source, 'before-mouse-event', {}, { type: 'mouseUp', button: 'left' });
  source.windowOpenHandler({ url: 'https://popup.test/', disposition: 'foreground-tab' });
  await tick();
  assert.equal(h.views.length, before + 1);
  assert.equal(state(h).activeId, activeId);
  h.fire(source, 'before-mouse-event', {}, { type: 'mouseUp', button: 'left' });
  source.windowOpenHandler({ url: 'https://popup.test/again', disposition: 'foreground-tab' });
  await tick();
  assert.equal(h.views.length, before + 1, 'rate limit denies another fresh gesture immediately');
});

test('concurrent permission requests for one origin show one dialog and stale grants are rejected', async () => {
  const h = await loadMainHeadless();
  h.ipcHandlers.get('nacre:new-tab').fn(event(h), 'https://site.test/');
  await tick();
  h.ipcHandlers.get('nacre:navigate').fn(event(h), 'https://site.test/');
  const source = h.views.at(-1).webContents;
  source.mainFrame.url = 'https://site.test/';
  const active = state(h).active;
  assert.equal(h.ipcHandlers.get('nacre:apply-site-permission').fn(event(h), { tabId: active.id, origin: 'https://site.test', documentEpoch: 0, permission: 'geolocation', mode: 'ask', scope: 'temporary' }), true);
  let resolveDialog, count = 0;
  h.electron.dialog.showMessageBox = () => { count++; return new Promise(resolve => { resolveDialog = resolve; }); };
  const answers = [];
  const request = source.session.permissionRequestHandler;
  request(source, 'geolocation', value => answers.push(value), { requestingUrl: 'https://site.test/' });
  request(source, 'geolocation', value => answers.push(value), { requestingUrl: 'https://site.test/' });
  assert.equal(count, 1);
  assert.deepEqual(answers, [false]);
  source.mainFrame.url = 'https://other.test/';
  resolveDialog({ response: 1 });
  await tick();
  assert.deepEqual(answers, [false, false]);
});

test('internal resources refuse cross-site requests before reading any asset', async () => {
  const h = await loadMainHeadless();
  const handler = h.protocolHandler();
  for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://evil.test' }, { referer: 'https://evil.test/' }]) {
    const before = h.netFetched.length;
    const response = await handler(new Request('nacre://app/styles.css', { headers }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(h.netFetched.length, before);
  }
});
