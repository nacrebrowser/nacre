'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createForgetfulSites } = require('../src/forgetful-sites.cjs');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

test('forgetting retains all origins through Reader, Share and navigation until the last site owner closes', () => {
  const ledger = createForgetfulSites(), ses = {}, other = {};
  const a = { id: 1, browserSession: ses }, b = { id: 2, browserSession: ses };
  ledger.remember(a, 'https://example.test/article?secret=not-retained', ['example.test']);
  ledger.remember(a, 'nacre://reader/?id=abc', ['example.test']);
  ledger.remember(b, 'https://example.test:8443/', ['example.test']);
  ledger.remember(b, 'https://unrelated.test/', ['example.test']);
  ledger.remember({ id: 3, browserSession: other }, 'https://example.test/', ['example.test']);
  ledger.remember({ id: 4, browserSession: ses, private: true }, 'https://example.test/', ['example.test']);
  assert.deepEqual(ledger.release(a), []);
  assert.deepEqual(ledger.release(b).sort(), ['https://example.test', 'https://example.test:8443']);
  assert.deepEqual(ledger.snapshot().get(other), ['https://example.test']);
  // Failure keeps the obligation for shutdown; success removes only that origin.
  ledger.complete(ses, 'https://example.test');
  assert.deepEqual(ledger.snapshot().get(ses), ['https://example.test:8443']);
  ledger.disable('example.test');
  assert.equal(ledger.snapshot().size, 0);
});

test('a new owner is not forgotten by completion of an older cleanup', () => {
  const ledger = createForgetfulSites(), ses = {}, first = { id: 1, browserSession: ses }, second = { id: 2, browserSession: ses };
  ledger.remember(first, 'http://example.test/', ['example.test']);
  assert.equal(ledger.release(first).length, 1);
  ledger.remember(second, 'http://example.test/', ['example.test']);
  ledger.complete(ses, 'http://example.test');
  assert.deepEqual(ledger.snapshot().get(ses), ['http://example.test']);
  assert.deepEqual(ledger.release(second), ['http://example.test']);
  ledger.syncEnabled([]);
  assert.equal(ledger.snapshot().size, 0, 'resetting preferences drops obligations for disabled sites');
});

test('production suspension rechecks eligibility after its asynchronous scroll probe', async () => {
  const source = main.slice(main.indexOf('function tabIsSuspendable('), main.indexOf('function checkTabSuspension('));
  for (const change of ['active', 'pinned', 'audible', 'loading', 'split', 'overlay', 'epoch', 'cleanup', 'quit', 'unchanged']) {
    let resolveScroll, discarded = false, audible = false;
    const contents = { isDestroyed: () => false, isCurrentlyAudible: () => audible, isAudioMuted: () => false,
      executeJavaScript: () => new Promise(resolve => { resolveScroll = resolve; }) };
    const tab = { id: 1, pageView: { webContents: contents }, url: 'https://example.test/', siteControlsEpoch: 1 };
    const context = { tabs: new Map([[1, tab]]), activeTabId: 2, splitTabIds: [], identityLifecycleBusy: false,
      quittingAfterClear: false, expandedOverlay: false, safeURL: value => value,
      discardTabDocument: () => { discarded = true; }, sendState() {} };
    vm.createContext(context); vm.runInContext(source, context);
    const operation = context.suspendTab(tab);
    if (change === 'active') context.activeTabId = 1;
    if (change === 'pinned') tab.pinned = true;
    if (change === 'audible') audible = true;
    if (change === 'loading') tab.loading = true;
    if (change === 'split') context.splitTabIds = [1, 2];
    if (change === 'overlay') context.expandedOverlay = true;
    if (change === 'epoch') tab.siteControlsEpoch++;
    if (change === 'cleanup') context.identityLifecycleBusy = true;
    if (change === 'quit') context.quittingAfterClear = true;
    resolveScroll(123);
    assert.equal(await operation, change === 'unchanged', change);
    assert.equal(discarded, change === 'unchanged', change);
  }
});

test('a pending clear-site confirmation cannot act on a moved or navigated tab', async () => {
  const source = main.slice(main.indexOf('async function forgetSiteData('), main.indexOf('function registerPrivacyPreloads('));
  for (const change of ['identity', 'navigation', 'closed', 'unchanged', 'during-clear']) {
    let resolveDialog, cleared = false, reloaded = false;
    const contents = { isDestroyed: () => false, reloadIgnoringCache() { reloaded = true; } };
    const tab = { id: 1, url: 'https://example.test/', browserSession: {}, pageView: { webContents: contents }, siteControlsEpoch: 1 };
    const context = { tabs: new Map([[1, tab]]), URL, validHost: () => true, settings: { language: 'en' }, win: {},
      dialog: { showMessageBox: () => new Promise(resolve => { resolveDialog = resolve; }) }, translate: key => key,
      clearOriginData: async () => { cleared = true; if (change === 'during-clear') tab.siteControlsEpoch++; }, privatePermissionDecisions: new Map(), safeURL: value => value,
      sendState() {}, tell() {}, notify() {}, identityLifecycleBusy: false, quittingAfterClear: false, retiredSessions: new Set() };
    vm.createContext(context); vm.runInContext(source, context);
    const operation = context.forgetSiteData(tab, 'example.test');
    if (change === 'identity') tab.browserSession = {};
    if (change === 'navigation') tab.siteControlsEpoch++;
    if (change === 'closed') context.tabs.delete(tab.id);
    resolveDialog({ response: 0 });
    const accepted = change === 'unchanged' || change === 'during-clear';
    assert.equal(await operation, accepted, change);
    assert.equal(cleared, accepted, change);
    assert.equal(reloaded, change === 'unchanged', change);
  }
});
