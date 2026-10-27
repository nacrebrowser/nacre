'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMainHeadless } = require('../scripts/red-team/harness/electron-stub.cjs');

async function fixture() {
  const h = await loadMainHeadless();
  const event = { sender: h.chrome, senderFrame: h.chrome.mainFrame };
  const workspace = data => h.ipcHandlers.get('nacre:workspace').fn(event, data);
  await workspace({ action: 'select', id: 'work' });
  const session = h.views.at(-1).webContents.session;
  return { h, event, workspace, session };
}

test('canceling identity deletion preserves the workspace and never clears its session', async () => {
  const { h, workspace, session } = await fixture();
  let clears = 0, prompt;
  session.clearData = async () => { clears++; };
  h.electron.dialog.showMessageBox = async (_win, options) => { prompt = options; return { response: 1 }; };
  const state = await workspace({ action: 'remove', id: 'work' });
  assert.ok(state.items.some(item => item.id === 'work'));
  assert.equal(clears, 0);
  assert.equal(prompt.defaultId, 1);
  assert.equal(prompt.cancelId, 1);
});

test('failed deletion retains a recoverable identity and blocks requests through later route changes', async () => {
  const { h, event, workspace, session } = await fixture();
  h.electron.dialog.showMessageBox = async () => ({ response: 0 });
  session.clearData = async () => { throw Error('fixture disk failure'); };
  await assert.rejects(workspace({ action: 'remove', id: 'work' }), /fixture disk failure/);
  const state = await workspace({ action: 'rename', id: 'work', name: 'Recovery' });
  assert.ok(state.items.some(item => item.id === 'work'));
  let decision;
  session.webRequest.beforeRequest({ url: 'https://example.test/', resourceType: 'xhr' }, value => { decision = value; });
  assert.deepEqual(decision, { cancel: true });
  const routes = [];
  session.setProxy = async route => { routes.push(route); };
  await h.ipcHandlers.get('nacre:disable-proxy').fn(event);
  assert.ok(routes.length > 0);
  assert.ok(routes.every(route => route.mode === 'fixed_servers' && /127\.0\.0\.1:1/.test(route.proxyRules)));
  session.clearData = async () => {};
  const removed = await workspace({ action: 'remove', id: 'work' });
  assert.ok(!removed.items.some(item => item.id === 'work'));
});

test('deletion waits for in-flight tab preparation and prevents that tab from loading', async () => {
  const { h, event, workspace, session } = await fixture();
  let release;
  session.setProxy = () => new Promise(resolve => { release = resolve; });
  h.ipcHandlers.get('nacre:new-tab').fn(event);
  await Promise.resolve();
  assert.equal(typeof release, 'function');
  const viewCount = h.views.length;
  h.electron.dialog.showMessageBox = async () => ({ response: 0 });
  const removal = workspace({ action: 'remove', id: 'work' });
  await new Promise(setImmediate);
  session.setProxy = async () => {};
  release();
  const state = await removal;
  assert.ok(!state.items.some(item => item.id === 'work'));
  // A replacement tab in the surviving workspace is allowed. The prepared
  // work identity must never get another view after removal starts.
  assert.ok(h.views.slice(viewCount).every(view => view.webContents.session !== session));
});

test('quit attempts every identity cleanup and awaits slow clears despite route and storage failures', async () => {
  const { h, session } = await fixture();
  const personal = h.electron.session.fromPartition('persist:nacre');
  const events = [];
  personal.setProxy = async () => { throw Error('fixture route failure'); };
  personal.clearData = async () => { events.push('personal-clear'); throw Error('fixture storage failure'); };
  session.clearData = async () => { await new Promise(setImmediate); events.push('work-cleared'); };
  h.electron.app.exit = () => { events.push('exit'); };
  await assert.doesNotReject(h.appListeners.get('before-quit')[0]({ preventDefault() {} }));
  assert.ok(events.includes('personal-clear'));
  assert.ok(events.includes('work-cleared'));
  assert.equal(events.at(-1), 'exit');
});

test('failed explicit clear holds the barrier until other identities finish and still clears authentication', async () => {
  const { h, event, workspace, session } = await fixture();
  const personal = h.electron.session.fromPartition('persist:nacre');
  h.electron.dialog.showMessageBox = async () => ({ response: 0 });
  let release, authenticationCleared = false;
  personal.clearData = async () => { throw Error('fixture clear failure'); };
  personal.clearAuthCache = async () => { authenticationCleared = true; };
  session.clearData = () => new Promise(resolve => { release = resolve; });
  const clearing = h.ipcHandlers.get('nacre:clear-data').fn(event, { dataTypes: ['cookies', 'siteData'] }).catch(error => error);
  for (let i = 0; i < 20 && !release; i++) await new Promise(setImmediate);
  assert.equal(typeof release, 'function');
  const viewCount = h.views.length;
  const selection = workspace({ action: 'select', id: 'work' });
  try {
    await new Promise(setImmediate);
    assert.equal(h.views.length, viewCount, 'a new document must wait for the outstanding destructive clear');
  } finally { release(); await clearing; await selection; }
  assert.equal(authenticationCleared, true, 'storage failure must not skip HTTP authentication cleanup');
  assert.ok(h.views.length > viewCount);
});
