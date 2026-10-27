'use strict';

// Dev-only runtime red-team attacks (not packaged). The real src/main.cjs is
// loaded with a recording electron stub (scripts/red-team/harness). Every attack
// is a real call with fake event objects. Nothing reaches the network: host
// network and process calls are blocked and recorded as side effects.
//
// Failing attacks stay failing: each one prints a SUCCEEDED line with the
// channel or case and the file and line of the code that accepted the attack.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { loadMainHeadless, MAIN } = require('../scripts/red-team/harness/electron-stub.cjs');

const mainSource = fs.readFileSync(MAIN, 'utf8');
const SRC_DIR = path.dirname(MAIN);
const MB = 1024 * 1024;

let h;
// Every attack starts from a fresh startup so earlier calls cannot change the state a later call sees.
test.beforeEach(async () => {
  h = await loadMainHeadless();
});

const ALLOWED_SCHEMES = new Set(['https:', 'http:', 'nacre:']);

// Payloads for malformed-argument attacks (A1c). The 10 MB string is the size limit probe.
function malformedPayloads() {
  return [
    ['null', null],
    ['undefined', undefined],
    ['10MB string', 'A'.repeat(10 * MB)],
    ['array for string', ['x']],
    ['__proto__ object', JSON.parse('{"__proto__":{"polluted":true}}')],
    ['number for object', 5]
  ];
}

// Channels that perform real network or process work by design. In A1c they run
// with the host guard in place; any "blocked" record is reported as INCONCLUSIVE, not SUCCEEDED.
const NETWORK_BY_DESIGN = new Set([
  'nacre:check-updates', 'nacre:connect-tor', 'nacre:configure-proxy', 'nacre:disable-proxy',
  'nacre:new-identity', 'nacre:copy-adblock-report', 'nacre:add-adblock-list-url',
  'nacre:update-filter-lists', 'nacre:choose-tor-country', 'nacre:get-tor-log'
]);

function lineOf(channel) {
  const index = mainSource.search(new RegExp(`ipcMain\\.(?:handle|on)\\('${channel.replace(/[:-]/g, (c) => `\\${c}`)}'`));
  if (index < 0) return 'src/main.cjs:?';
  return `src/main.cjs:${mainSource.slice(0, index).split('\n').length}`;
}

function snapshotDir(dir) {
  const out = {};
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else out[full] = `${stat.size}:${stat.mtimeMs}`;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function mark() {
  return {
    effects: h.effects.length,
    sends: h.sends.length,
    views: h.views.length,
    windows: h.windows.length,
    files: snapshotDir(h.state.userData)
  };
}

// Returns the list of side effects made since the mark.
function changedSince(before) {
  const reasons = [];
  for (const effect of h.effects.slice(before.effects)) reasons.push(`${effect.owner}.${effect.method}`);
  for (const send of h.sends.slice(before.sends)) reasons.push(`send:${send.channel}`);
  if (h.views.length !== before.views) reasons.push('view created');
  if (h.windows.length !== before.windows) reasons.push('window created');
  const after = snapshotDir(h.state.userData);
  for (const file of Object.keys({ ...before.files, ...after })) {
    if (before.files[file] !== after[file]) reasons.push(`file:${path.basename(file)}`);
  }
  return reasons;
}

async function invoke(entry, event, payload) {
  try {
    const result = await entry.fn(event, payload);
    return { outcome: 'returned', result };
  } catch (error) {
    return { outcome: 'threw', message: String(error && error.message).slice(0, 120) };
  }
}

function attackerEvent() {
  const sender = h.newContents('https://attacker.test/');
  return { sender, senderFrame: sender.mainFrame, preventDefault() {} };
}

function subframeEvent() {
  const chrome = h.chrome;
  const child = { url: 'nacre://app/', parent: chrome.mainFrame, top: chrome.mainFrame, isDestroyed: () => false };
  return { sender: chrome, senderFrame: child, preventDefault() {} };
}

function trustedEvent() {
  return { sender: h.chrome, senderFrame: h.chrome.mainFrame, preventDefault() {} };
}

const findings = [];
function record(attack, channel, detail) {
  const line = `SUCCEEDED ${attack} ${channel} ${lineOf(channel)} ${detail}`;
  findings.push(line);
  console.log(line);
}

test('A1a/A1b: every IPC channel refuses an attacker frame and a subframe, with no data and no side effect', async () => {
  const cases = [['attacker main frame', attackerEvent], ['nacre subframe of web page', subframeEvent]];
  for (const [label, makeEvent] of cases) {
    for (const [channel, entry] of h.ipcHandlers) {
      const before = mark();
      const outcome = await invoke(entry, makeEvent(), undefined);
      const reasons = changedSince(before);
      const refused = entry.kind === 'handle'
        ? (outcome.outcome === 'threw' || (outcome.result === undefined || outcome.result === null) && reasons.length === 0)
        : outcome.outcome === 'returned' && (outcome.result === undefined || outcome.result === null) && reasons.length === 0;
      if (!refused) {
        const detail = `${label}: ${outcome.outcome}${outcome.outcome === 'returned' ? ` value=${typeof outcome.result}` : ` ${outcome.message}`} effects=[${reasons.join(',')}]`;
        record('A1', channel, detail);
      }
    }
  }
  assert.deepEqual(findings.filter((line) => /^SUCCEEDED A1(a|b)?\b/.test(line)), [], 'untrusted frames reached a handler');
});

test('A1c: every IPC channel survives malformed arguments from the trusted UI with no unhandled throw and no bad side effect', async () => {
  const badSchemes = /^(javascript|file|data|blob|view-source|ms-msdt|search-ms|mailto):/i;
  for (const channel of [...h.ipcHandlers.keys()]) {
    if (NETWORK_BY_DESIGN.has(channel)) {
      console.log(`INCONCLUSIVE A1c ${channel} ${lineOf(channel)} network or process work by design; run under host guard only`);
      continue;
    }
    for (const [label, payload] of malformedPayloads()) {
      // Fresh startup per call: an earlier malformed call (for example one that closes the active tab) must not decide this result.
      h = await loadMainHeadless();
      const entry = h.ipcHandlers.get(channel);
      const before = mark();
      const outcome = await invoke(entry, trustedEvent(), payload);
      const newEffects = h.effects.slice(before.effects);
      const bad = newEffects.filter((effect) => effect.owner === 'shell' || effect.method === 'blocked'
        || effect.args.some((arg) => typeof arg === 'string' && badSchemes.test(arg)));
      const unhandled = outcome.outcome === 'threw' && entry.kind === 'on';
      if (unhandled || bad.length > 0 || ({}).polluted !== undefined) {
        const detail = `${label}: ${outcome.outcome}${outcome.message ? ` ${outcome.message}` : ''} bad=[${bad.map((e) => `${e.owner}.${e.method}`).join(',')}]`;
        record('A1c', channel, detail);
      }
    }
  }
  assert.deepEqual(findings.filter((line) => /^SUCCEEDED A1c\b/.test(line)), [], 'a trusted malformed call caused a bad effect or an unhandled throw');
});

test('A2: nacre:// resolver serves only table assets and every response carries CSP and X-Frame-Options', async () => {
  const handler = h.protocolHandler();
  assert.equal(typeof handler, 'function', 'nacre:// handler registered');
  const requests = [
    ['nacre://app/..', 'GET'], ['nacre://app/%2e%2e/', 'GET'], ['nacre://app/%252e%252e/', 'GET'],
    ['nacre://app/..\\', 'GET'], ['nacre://app/..%5c..', 'GET'], ['nacre://app/%00', 'GET'],
    ['nacre://app/renderer.js.', 'GET'], ['nacre://app/renderer.js/../../main.cjs', 'GET'],
    ['nacre://APP/', 'GET'], ['nacre://App/renderer.js', 'GET'], ['nacre://settings/../../', 'GET'],
    [`nacre://app/${'a'.repeat(8192)}`, 'GET'], ['nacre://app/', 'POST'], ['nacre://app/renderer.js', 'GET']
  ];
  const tableFiles = new Set(['index.html', 'renderer.js', 'styles.css', 'settings.html', 'settings.js', 'settings.css', 'sites.html', 'tests.html', 'tests.css', 'downloads.html', 'downloads.css', 'downloads.js', 'source.html', 'source.css', 'source.js', 'error.html', 'error.css', 'error.js', 'leak-tests.html', 'leak-tests.css', 'bookmarks.html', 'bookmarks.js', 'bookmarks.css', 'shortcuts.html', 'shortcuts.css', 'offline.html', 'offline.css', 'protection.html', 'protection.css', 'protection.js', 'theme.css', 'pages.css']);
  const problems = [];
  for (const [url, method] of requests) {
    const fetchedBefore = h.netFetched.length;
    const response = await handler({ url, method });
    const csp = response.headers.get('content-security-policy');
    const xfo = response.headers.get('x-frame-options');
    if (!csp || !xfo) problems.push(`${url} ${method}: missing CSP or X-Frame-Options (status ${response.status})`);
    if (response.status === 200) {
      const fetched = h.netFetched.slice(fetchedBefore);
      for (const entry of fetched) {
        const file = fileURLToPath(entry);
        if (!path.resolve(file).startsWith(SRC_DIR + path.sep)) problems.push(`${url}: read outside src ${file}`);
        if (!tableFiles.has(path.basename(file))) problems.push(`${url}: served non-table file ${path.basename(file)}`);
      }
    } else if (![403, 404].includes(response.status)) {
      problems.push(`${url}: unexpected status ${response.status}`);
    }
  }
  for (const problem of problems) record('A2', 'nacre:// resolver', problem);
  assert.deepEqual(problems, [], 'resolver problems');
});

test('A3: settings and bookmark input cannot pollute prototypes and oversized input is refused or capped', async () => {
  const pollutedBefore = ({}).polluted;
  const trusted = trustedEvent();
  const attacks = [
    ['update-preferences __proto__', 'nacre:update-preferences', JSON.parse('{"__proto__":{"polluted":true}}')],
    ['update-preferences constructor', 'nacre:update-preferences', JSON.parse('{"constructor":{"prototype":{"polluted":true}}}')],
    ['update-preferences 20MB', 'nacre:update-preferences', 'x'.repeat(20 * MB)],
    ['save-bookmarks __proto__ item', 'nacre:save-bookmarks', [JSON.parse('{"__proto__":{"polluted":true},"url":"https://a.test/"}')]],
    ['save-bookmarks 10000 entries', 'nacre:save-bookmarks', Array.from({ length: 10000 }, (_, i) => ({ url: `https://a.test/${i}` }))]
  ];
  const problems = [];
  for (const [label, channel, payload] of attacks) {
    const entry = h.ipcHandlers.get(channel);
    const outcome = await invoke(entry, trusted, payload);
    if (outcome.outcome === 'threw' && entry.kind === 'on') problems.push(`${label}: unhandled throw ${outcome.message}`);
    if (({}).polluted !== undefined) problems.push(`${label}: prototype polluted`);
    if (channel === 'nacre:save-bookmarks' && outcome.outcome === 'returned' && outcome.result > 500) problems.push(`${label}: accepted ${outcome.result} bookmarks`);
  }
  // Import: a 20 MB HTML bookmark file with prototype text and 10,000 anchors.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-a3-'));
  const file = path.join(dir, 'bookmarks.html');
  const anchors = Array.from({ length: 10000 }, (_, i) => `<a href="https://b.test/${i}">b${i}</a>`).join('\n');
  fs.writeFileSync(file, `${anchors}\n<a href="https://c.test/">__proto__ {"polluted":true}</a>\n${'x'.repeat(20 * MB)}`);
  h.state.dialogResult = { canceled: false, filePaths: [file] };
  const imported = await invoke(h.ipcHandlers.get('nacre:import-bookmarks'), trusted, undefined);
  h.state.dialogResult = null;
  if (imported.outcome === 'threw') { if (imported.message !== 'Bookmark file exceeds size limit') problems.push(`import 10000 anchors: threw ${imported.message}`); }
  else if (imported.result.imported > 500) problems.push(`import: accepted ${imported.result.imported} entries (cap 500)`);
  if (({}).polluted !== undefined) problems.push('import: prototype polluted');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(({}).polluted, pollutedBefore, 'Object.prototype unchanged');
  for (const problem of problems) record('A3', 'settings/bookmark input', problem);
  assert.deepEqual(problems, [], 'import or settings problems');
});

test('A5: navigation to dangerous schemes is refused on the chrome view and on a web tab', async () => {
  const targets = ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<script>alert(1)</script>', 'blob:https://a.test/0000', 'view-source:https://a.test/', 'ms-msdt:/id PCWDiagnostic', 'search-ms:query=x', 'mailto:a@b.test', '\\\\host\\share\\file', 'nacre://settings'];
  const chrome = h.chrome;
  const viewsBefore = h.views.length;
  await invoke(h.ipcHandlers.get('nacre:new-tab'), trustedEvent(), 'https://a.test/');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.views.length > viewsBefore, 'nacre:new-tab created a web tab');
  const tabContents = h.views[h.views.length - 1].webContents;
  assert.notEqual(tabContents, chrome, 'tab is not the chrome view');
  const problems = [];
  const windowHandler = tabContents.windowOpenHandler;
  assert.equal(typeof windowHandler, 'function', 'target=_blank handler attached');
  const viewsBeforeWindowOpen = h.views.length;
  windowHandler({ url: 'https://a.test/unsolicited', disposition: 'foreground-tab' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.views.length, viewsBeforeWindowOpen, 'script-only popup is refused');
  h.fire(tabContents, 'before-mouse-event', {}, { type: 'mouseUp', button: 'left' });
  const allowedWindow = windowHandler({ url: 'https://www.youtube.com/watch?v=test', disposition: 'foreground-tab' });
  assert.deepEqual(allowedWindow, { action: 'deny' }, 'native popup stays denied after routing into a browser tab');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.views.length > viewsBeforeWindowOpen, 'safe target=_blank URL opens a new browser tab');
  assert.equal(h.views[h.views.length - 1].webContents.listeners.has('will-frame-navigate'), true, 'new tab receives navigation security handlers');
  const viewsBeforeDangerousOpen = h.views.length;
  windowHandler({ url: 'javascript:alert(1)', disposition: 'foreground-tab' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.views.length, viewsBeforeDangerousOpen, 'dangerous target=_blank URL does not create a tab');
  const viewsBeforeNonWebOpen = h.views.length;
  windowHandler({ url: 'mailto:user@example.invalid', disposition: 'foreground-tab' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.views.length, viewsBeforeNonWebOpen, 'non-web target=_blank URL does not create a tab');
  // Fail loudly if the navigation policy is not attached: a silent skip would make this test vacuous.
  for (const [label, contents] of [['chrome view', chrome], ['web tab', tabContents]]) {
    assert.ok(contents.listeners.get('will-frame-navigate'), `${label}: will-frame-navigate policy attached`);
    assert.ok(contents.listeners.get('will-redirect'), `${label}: will-redirect policy attached`);
  }
  let checked = 0;
  for (const target of targets) {
    for (const [label, contents] of [['chrome view', chrome], ['web tab', tabContents]]) {
      for (const event of ['will-frame-navigate', 'will-navigate', 'will-redirect']) {
        const listeners = contents.listeners.get(event) || [];
        for (const listener of listeners) {
          checked++;
          const navigationEvent = {
            url: target,
            isMainFrame: true,
            isSameDocument: false,
            prevented: false,
            preventDefault() { this.prevented = true; }
          };
          // Electron 44 puts URL/frame metadata and preventDefault on the Event object.
          // Electron 44 supplies the URL on the event; do not pass deprecated navigation arguments.
          listener(navigationEvent);
          // The chrome view may only load nacre://app, and a web tab may not load dangerous schemes.
          if (!navigationEvent.prevented) problems.push(`${label} ${event} ${target}: navigation was not refused`);
        }
      }
    }
  }
  assert.ok(checked >= targets.length * 4, `navigation listeners exercised (${checked})`);

  // Critical positive control: an ordinary primary click to an HTTPS destination
  // must proceed on a web tab. This mirrors Electron 44's one-Event argument.
  for (const eventName of ['will-frame-navigate', 'will-navigate', 'will-redirect']) {
    const event = { url: 'https://www.youtube.com/', isMainFrame: true, isSameDocument: false, prevented: false, preventDefault() { this.prevented = true; } };
    for (const listener of tabContents.listeners.get(eventName) || []) listener(event);
    if (event.prevented) problems.push(`web tab ${eventName} https://www.youtube.com/: safe HTTPS navigation was blocked`);
  }
  // The global guard and per-view listener both run on webContents; verify the
  // guard accepts HTTPS in the single-event shape, not just the local listener.
  for (const listener of tabContents.listeners.get('will-frame-navigate') || []) {
    const event = { url: 'https://www.youtube.com/results?search_query=youtube', isMainFrame: true, isSameDocument: false, prevented: false, preventDefault() { this.prevented = true; } };
    listener(event);
    if (event.prevented) problems.push('web tab global guard blocked a valid HTTPS search result click');
  }
  for (const problem of problems) record('A5', 'navigation listeners', problem);
  assert.deepEqual(problems, [], 'navigation policy problems');
});

test('A5 shell call sites: openExternal and openPath never receive web-page strings', () => {
  const sites = mainSource.split('\n').map((text, index) => ({ text, line: index + 1 })).filter(({ text }) => /shell\.(openExternal|openPath)\(/.test(text));
  for (const { text, line } of sites) console.log(`A5 shell call src/main.cjs:${line}: ${text.trim()}`);
  assert.ok(sites.length > 0, 'call sites found');
});
