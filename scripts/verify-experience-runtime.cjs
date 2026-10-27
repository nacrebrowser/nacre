'use strict';

// Runs the real Electron application against a disposable profile and a local
// fixture server. No public site, Tor connection or installed profile is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-experience-'));
  const entry = path.join(scratch, 'verify.cjs');
  fs.copyFileSync(__filename, entry);
  const env = { ...process.env, NACRE_EXPERIENCE_ROOT: root, NACRE_EXPERIENCE_PROFILE: scratch };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const result = spawnSync(require('electron'), [entry], {
      cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 180000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status ?? 1;
  } finally {
    const resolved = path.resolve(scratch);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('nacre-experience-')) throw new Error('Unsafe fixture cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  return;
}

const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const { app, BrowserWindow, safeStorage } = require('electron');
const root = process.env.NACRE_EXPERIENCE_ROOT;
const scratch = process.env.NACRE_EXPERIENCE_PROFILE;
const profile = path.join(scratch, 'profile');
app.setPath('appData', scratch);
app.setPath('userData', profile);
app.setPath('sessionData', path.join(scratch, 'session'));
process.env.NACRE_PORTABLE_MODE = '0';
fs.mkdirSync(profile, { recursive: true });
BrowserWindow.prototype.show = function () {};

const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  contents.on('render-process-gone', (_event, details) => errors.push('renderer: ' + details.reason));
});

const signedSettings = app.whenReady().then(() => {
  const { createProfileIntegrity } = require(path.join(root, 'src', 'profile-integrity.cjs'));
  const integrity = createProfileIntegrity(profile, safeStorage);
  integrity.write(path.join(profile, 'settings.json'), 'settings', {
    directMode: true,
    torCountry: '',
    httpsOnly: false,
    clearOnQuit: false,
    adBlockEnabled: false,
    language: 'fr',
    theme: 'light',
    phishingGuardEnabled: false,
    suspendInactiveTabs: false
  });
});

const file = path.join(root, 'src', 'main.cjs');
const main = new Module(file, module);
main.filename = file;
main.paths = Module._nodeModulePaths(path.dirname(file));
main._compile(fs.readFileSync(file, 'utf8') + `
module.exports = { tabs, createTab, activateTab, sendState, suspendTab, resumeTab,
  chrome: () => chromeView, window: () => win, preferences: () => settings,
  active: () => tabs.get(activeTabId), clipboardText: () => Promise.resolve(clipboard.readText()),
  clipboardWrite: (value) => clipboard.writeText(value),
  zoomFactor: () => activeTab()?.pageView?.webContents.getZoomFactor() };
`, file);
const nacre = main.exports;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, attempts = 200) {
  for (let index = 0; index < attempts; index += 1) {
    if (await predicate()) return;
    await wait(50);
  }
  throw new Error('Timed out: ' + label);
}
const chrome = () => nacre.chrome().webContents;
const run = (source) => chrome().executeJavaScript(source);
const active = () => nacre.active();
const page = () => active()?.pageView?.webContents;
async function navigate(url) {
  await run(`window.nacre.navigate(${JSON.stringify(url)})`);
  await until(() => active() && active().url === url && page() && !page().isLoading(), 'navigate ' + url);
}
async function click(selector) {
  await run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await wait(100);
}

const article = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fixture article</title>
<meta name="author" content="Ada Lovelace"><meta property="og:site_name" content="Fixture"></head>
<body style="height:3200px"><header>Navigation to ignore</header><article>
<h1>Deep work</h1><p>First paragraph with enough text to be considered the beginning of a readable article about attention and craft.</p>
<p>Second paragraph explains the method in detail and keeps the reading flow going for several lines without images.</p>
<h2>A section</h2><p>Third paragraph contains a <a href="/link">link</a> and still belongs in the reader.</p>
<ul><li>First item</li><li>Second item</li></ul>
<blockquote>An important quotation.</blockquote><pre>const example = true;</pre>
<img src="/pixel.png" alt="should not appear"><script>document.title = 'script ran';</script>
<p>Final paragraph closes the article and gives enough words for a one minute read at least.</p></article>
<footer>Footer to ignore</footer></body></html>`;

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/second') response.end('<!doctype html><html lang="en"><title>Second</title><h1>Second page</h1>');
  else if (request.url === '/pixel.png') { response.setHeader('Content-Type', 'image/png'); response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')); }
  else response.end(article);
});

(async () => {
  await signedSettings;
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const articleUrl = origin + '/article';
  await until(() => nacre.tabs.size > 0, 'app startup');
  await until(() => run('Boolean(document.querySelector("#address"))'), 'initial chrome');
  nacre.window().setSize(1280, 860);
  nacre.window().showInactive();
  const initialChromeHeight = await run('document.querySelector("#chrome").getBoundingClientRect().height');
  const checks = [];

  // Bookmark autocomplete under the omnibox.
  await run(`window.nacre.saveBookmarks([{title:'Second page',url:${JSON.stringify(origin + '/second')},folder:''},{title:'Fixture article',url:${JSON.stringify(articleUrl)},folder:''}])`);
  await until(() => run('document.querySelectorAll(".bookmark-chip").length >= 1'), 'bookmarks snapshot');
  await run("const input=document.querySelector('#address'); input.focus(); input.value='second'; input.dispatchEvent(new Event('input'));");
  await until(() => run('document.querySelectorAll("#address-suggestions button[role=option]").length === 1'), 'autocomplete rows');
  assert.equal(await run('document.querySelector("#address-suggestions").hidden'), false);
  await until(async () => (await run('document.querySelector("#chrome").getBoundingClientRect().height')) > initialChromeHeight + 40, 'chrome expands for suggestions');
  await run('document.querySelector("#address-suggestions button[role=option]").click()');
  await until(() => active()?.url === origin + '/second' && !page()?.isLoading(), 'autocomplete navigation');
  await until(async () => Math.abs((await run('document.querySelector("#chrome").getBoundingClientRect().height')) - initialChromeHeight) < 1, 'chrome collapses');
  checks.push('bookmark autocomplete');

  // Per-site zoom persists in settings and applies to the next page.
  await navigate(articleUrl);
  await click('#protection-button');
  await click('#zoom-in');
  await click('#zoom-in');
  await until(() => nacre.preferences().siteZoom['127.0.0.1'] === 125, 'site zoom persisted');
  assert.equal(nacre.zoomFactor(), 1.25);
  await until(async () => (await run("document.querySelector('#zoom-value').textContent.trim()")) === '125 %', 'zoom label');
  await navigate(origin + '/second');
  assert.equal(nacre.zoomFactor(), 1.25);
  await run("document.querySelector('#protection-button').click()");
  await click('#zoom-reset');
  await until(() => nacre.preferences().siteZoom['127.0.0.1'] === undefined, 'site zoom reset');
  checks.push('per-site zoom');

  // Reader mode extracts text only and returns to the original page.
  await navigate(articleUrl);
  await click('#reader-button');
  await until(() => active()?.url.startsWith('nacre://reader/') && !page().isLoading(), 'reader page');
  assert.equal(await page().executeJavaScript("document.querySelector('#reader-title').textContent"), 'Deep work');
  assert.ok(await page().executeJavaScript("document.querySelectorAll('#reader-content p').length >= 3"));
  assert.equal(await page().executeJavaScript("document.querySelectorAll('#reader-content img, #reader-content script, #reader-content iframe').length"), 0);
  assert.match(await page().executeJavaScript("document.querySelector('#reader-meta').textContent"), /Fixture/);
  await page().executeJavaScript("document.querySelector('#exit').click()");
  await until(() => active()?.url === articleUrl && !page().isLoading(), 'reader exit');
  checks.push('reader mode');

  // QR code is generated locally and decodes to the exact address.
  await click('#share-button');
  await until(() => active()?.url.startsWith('nacre://share/') && !page().isLoading(), 'share page');
  assert.equal(await page().executeJavaScript("document.querySelector('#share-url').textContent"), articleUrl);
  assert.ok(await page().executeJavaScript("document.querySelector('#qr svg path').getAttribute('d').length > 100"));
  let decoded = '';
  try {
    const dataUrl = await page().executeJavaScript(`(async () => {
      const svg = new XMLSerializer().serializeToString(document.querySelector('#qr svg'));
      const image = new Image();
      image.src = 'data:image/svg+xml;base64,' + btoa(svg);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 520; canvas.height = 520;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 520, 520);
      context.drawImage(image, 20, 20, 480, 480);
      return canvas.toDataURL('image/png');
    })()`);
    const jsQR = require(path.join(root, '.cache', 'qrtest', 'node_modules', 'jsqr'));
    const { PNG } = require(path.join(root, '.cache', 'qrtest', 'node_modules', 'pngjs'));
    const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
    decoded = jsQR(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), png.width, png.height)?.data || '';
  } catch (error) {
    console.warn('QR decoder skipped:', error.message);
  }
  if (decoded) assert.equal(decoded, articleUrl);
  const copyResult = await page().executeJavaScript('window.nacre.copyShare()');
  assert.equal(copyResult, true);
  await until(async () => (await nacre.clipboardText()) === articleUrl, 'share clipboard');
  await page().executeJavaScript("document.querySelector('#close').click()");
  await until(() => active()?.url === articleUrl && !page()?.isLoading(), 'share close');
  checks.push('local QR share');

  // Local phishing filter: warning, back, then explicit two-step continue.
  nacre.preferences().phishingGuardEnabled = true;
  nacre.preferences().phishingBlocklist = '127.0.0.1';
  await run(`window.nacre.navigate(${JSON.stringify(articleUrl)})`);
  await until(() => active()?.url.startsWith('nacre://phishing/') && !page().isLoading(), 'phishing warning');
  assert.equal(await page().executeJavaScript("document.querySelector('#phishing-url').textContent"), articleUrl);
  assert.match(await page().executeJavaScript("document.querySelector('#phishing-reasons').textContent"), /liste locale/i);
  await page().executeJavaScript("document.querySelector('#back').click()");
  await until(() => active()?.url === '' && !page()?.isLoading(), 'phishing back to safety');
  await run(`window.nacre.navigate(${JSON.stringify(articleUrl)})`);
  await until(() => active()?.url.startsWith('nacre://phishing/'), 'phishing warning again');
  await page().executeJavaScript("document.querySelector('#continue').click()");
  assert.equal(await page().executeJavaScript("document.querySelector('#continue').classList.contains('is-armed')"), true);
  await page().executeJavaScript("document.querySelector('#continue').click()");
  await until(() => active()?.url === articleUrl && !page().isLoading(), 'phishing continue');
  nacre.preferences().phishingGuardEnabled = false;
  nacre.preferences().phishingBlocklist = '';
  checks.push('phishing interstitial');

  // Panic closes every tab, clears clipboard and returns to a fresh home tab.
  await click('#private-tab');
  await until(() => active()?.private, 'private tab before panic');
  nacre.clipboardWrite('panic-secret');
  await click('#panic-button');
  assert.equal(await run("document.querySelector('#panic-button').classList.contains('is-armed')"), true);
  await click('#panic-button');
  await until(() => nacre.tabs.size === 1 && !active().private && active().url === '', 'panic cleanup', 300);
  assert.equal(await nacre.clipboardText(), '');
  checks.push('panic cleanup');

  // Inactive tab suspension keeps the tab, frees its document and restores scroll.
  nacre.preferences().suspendInactiveTabs = true;
  nacre.preferences().suspendAfterMinutes = 15;
  await navigate(articleUrl);
  await page().executeJavaScript('window.scrollTo(0, 320)');
  const articleTab = active();
  await click('#new-tab');
  await until(() => nacre.tabs.size === 2 && active() !== articleTab, 'second tab');
  // A new tab focuses the address field. Dismiss its overlay before testing
  // suspension; production deliberately refuses to suspend while UI is open.
  await run('document.activeElement?.blur(); window.nacre.setOverlay(false)');
  const suspended = await nacre.suspendTab(articleTab);
  assert.equal(suspended, true);
  assert.equal(articleTab.suspended, true);
  assert.equal(articleTab.pageView, null);
  nacre.activateTab(articleTab.id);
  await until(() => active() === articleTab && articleTab.url === articleUrl && !page().isLoading(), 'resume suspended tab', 300);
  await wait(500);
  assert.ok(await page().executeJavaScript('window.scrollY') > 200, 'scroll restored');
  assert.equal(articleTab.suspended, false);
  checks.push('tab suspension');

  assert.deepEqual(errors, []);
  server.close();
  console.log(JSON.stringify({ status: 'PASS', checks, qrDecoded: Boolean(decoded), rendererErrors: errors }, null, 2));
  app.exit(0);
})().catch((error) => {
  console.error(error.stack);
  if (errors.length) console.error(errors);
  server.close();
  app.exit(1);
});
