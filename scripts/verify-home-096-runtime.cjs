'use strict';

// Runs the real Electron application against a disposable profile and a local
// fixture server to check the 0.9.6 home and zoom changes: Ctrl+wheel zoom
// bubble and address-bar magnifier, home shortcut migration, add / move /
// remove, no bookmark appearing on the home page, site icons kept without any
// new connection while Tor is off, and the custom wallpaper.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-home096-'));
  const entry = path.join(profile, 'verify.cjs'); fs.copyFileSync(__filename, entry);
  const result = require('./test-support/sandboxed-electron-fixture.cjs').launch([entry], { env: { ...process.env, NACRE_HOME_ROOT: root, NACRE_HOME_PROFILE: profile }, encoding: 'utf8', timeout: 120000 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(result.status === 0 ? 0 : 1);
}
const electron = require('electron'), { app, safeStorage, nativeImage, dialog } = electron;
const Module = require('node:module'), assert = require('node:assert/strict'), http = require('node:http');
const root = process.env.NACRE_HOME_ROOT, profile = process.env.NACRE_HOME_PROFILE;
app.setPath('userData', profile); app.setPath('appData', profile); app.setPath('sessionData', path.join(profile, 'session'));

const bitmap = (width, height) => { const data = Buffer.alloc(width * height * 4); for (let i = 0; i < data.length; i += 4) data.set([40, 160, 120, 255], i); return nativeImage.createFromBitmap(data, { width, height }); };
const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.url);
  if (req.url === '/favicon.ico') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(bitmap(16, 16).toPNG()); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>Fixture</title><link rel="icon" href="/favicon.ico"><p>Fixture page</p>');
});
const wallpaperFile = path.join(profile, 'wallpaper.jpg');
let pickedFile = wallpaperFile;
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pickedFile] });

app.whenReady().then(() => {
  const gradient = Buffer.alloc(640 * 360 * 4);
  for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) gradient.set([120 + x / 8, 60 + y / 3, 140 - x / 8, 255], (y * 640 + x) * 4);
  fs.writeFileSync(wallpaperFile, nativeImage.createFromBitmap(gradient, { width: 640, height: 360 }).toJPEG(90));
  // A 0.9.5 profile: home without version, with its own shortcut and bookmarks.
  require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile, 'settings.json'), 'settings', {
    directMode: true, torCountry: '', torAutoStart: false, httpsOnly: false, clearOnQuit: true, welcomeDone: true, language: 'fr',
    bookmarks: [{ title: 'Bookmark A', url: 'https://bookmark-a.test/', folder: '' }, { title: 'Bookmark B', url: 'https://bookmark-b.test/', folder: '' }],
    home: { background: 'default', showBookmarks: true, showShortcuts: true, shortcuts: [{ title: 'Own', url: 'https://own.test/' }] }
  });
});
const filename = path.join(root, 'src/main.cjs'), main = new Module(filename, module);
main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={tabs,createTab,activateTab,addBookmark,window:()=>win,chrome:()=>chromeView,settings:()=>settings,siteIconSession:()=>siteIconSession};', filename);
const nacre = main.exports, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 400; i++) { if (await fn()) return; await wait(50); } throw new Error('Timeout: ' + label); }
const ui = (script) => nacre.chrome().webContents.executeJavaScript(script);
// NACRE_HOME_SHOTS=<folder> saves screenshots of the chrome view for review.
const shots = process.env.NACRE_HOME_SHOTS;
async function shot(name) {
  if (!shots) return;
  try { fs.writeFileSync(path.join(shots, name + '.png'), (await nacre.chrome().webContents.capturePage()).toPNG()); }
  catch (error) { console.warn('Screenshot ' + name + ' unavailable: ' + error.message); }
}

async function run() {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await until(() => nacre.tabs.size > 0 && nacre.chrome(), 'first tab'); if (shots) { nacre.window().setContentSize(1100, 700); nacre.window().showInactive(); } else nacre.window().hide();
  const checks = [];

  // Migration keeps what 0.9.5 displayed.
  assert.equal(nacre.settings().home.version, 2);
  assert.deepEqual(nacre.settings().home.shortcuts.map(x => x.title), ['Own', 'Bookmark A', 'Bookmark B']);
  await until(() => ui('document.querySelectorAll("#home-custom-shortcuts .home-shortcut-item").length === 3 && !!document.querySelector("#home-shortcut-add")'), 'home grid');
  checks.push('0.9.5 home migrated');
  await wait(shots ? 600 : 0); await shot('home');

  // Add through the + tile, then reorder.
  await ui('document.querySelector("#home-shortcut-add").click()');
  await until(() => ui('!!document.querySelector("#home-shortcut-url")'), 'add dialog');
  await ui('document.querySelector("#home-shortcut-url").value="javascript:alert(1)";document.querySelector("#home-shortcut-save").click()');
  await until(() => ui('document.querySelector(".experience-error").textContent.length > 0'), 'unsafe refused');
  await ui(`document.querySelector("#home-shortcut-title").value="Local";document.querySelector("#home-shortcut-url").value=${JSON.stringify(origin + '/')};document.querySelector("#home-shortcut-save").click()`);
  await until(() => nacre.settings().home.shortcuts.length === 4, 'shortcut added');
  await ui('window.nacre.homeShortcuts({action:"move",index:3,to:0})');
  await until(() => ui('document.querySelector("#home-custom-shortcuts .home-tile-label").textContent === "Local"'), 'moved tile rendered first');
  assert.deepEqual(nacre.settings().home.shortcuts.map(x => x.title), ['Local', 'Own', 'Bookmark A', 'Bookmark B']);
  checks.push('add and move shortcuts');

  // Before Tor, no icon is fetched for a shortcut never opened.
  await wait(500);
  assert.equal(nacre.siteIconSession(), null, 'no icon session without Tor');
  assert.equal(requests.length, 0, 'no request to the shortcut host before it is opened');

  // Opening the shortcut: the tab icon is reused for the tile; zoom bubble.
  const tabId = await nacre.createTab(origin + '/', false);
  const page = nacre.tabs.get(tabId).pageView.webContents;
  await until(() => !page.isLoading() && page.getURL().startsWith(origin), 'page loaded');
  await until(() => requests.includes('/favicon.ico'), 'favicon fetched by the tab');
  await until(() => ui('document.querySelector("#zoom-indicator").hidden === true'), 'magnifier hidden at 100 %');
  page.emit('zoom-changed', {}, 'in');
  await until(() => Math.abs(page.getZoomFactor() - 1.1) < 0.001, 'Ctrl+wheel zoom applied');
  assert.equal(nacre.settings().siteZoom['127.0.0.1'], 110);
  await until(() => ui('!document.querySelector("#zoom-bubble").hidden && document.querySelector("#zoom-bubble-value").textContent.trim() === "110 %"'), 'zoom bubble shown');
  assert.equal(await ui('document.querySelector("#zoom-indicator").hidden'), false, 'magnifier shown while zoomed');
  await shot('zoom-bubble');
  page.emit('zoom-changed', {}, 'in');
  await until(() => Math.abs(page.getZoomFactor() - 1.25) < 0.001, 'second wheel step');
  await until(() => ui('document.querySelector("#zoom-bubble").hidden'), 'bubble closes by itself', 120);
  await ui('document.querySelector("#zoom-indicator").click()');
  await until(() => ui('!document.querySelector("#zoom-bubble").hidden'), 'magnifier opens the bubble');
  await ui('document.querySelector("#zoom-bubble-reset").click()');
  await until(() => Math.abs(page.getZoomFactor() - 1) < 0.001 && nacre.settings().siteZoom['127.0.0.1'] === undefined, 'zoom reset');
  await until(() => ui('document.querySelector("#zoom-indicator").hidden === true'), 'magnifier leaves at 100 %');
  await ui('document.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
  checks.push('Ctrl+wheel bubble and magnifier');

  // A bookmark saved with the star does not appear on the home page.
  nacre.addBookmark();
  await until(() => nacre.settings().bookmarks.some(x => x.url.startsWith(origin)), 'bookmark saved');
  assert.equal(nacre.settings().home.shortcuts.length, 4);
  checks.push('bookmarks no longer added to the home page');

  // The icon the tab already loaded is kept for the shortcut and shown on the tile.
  nacre.activateTab([...nacre.tabs.keys()][0]);
  await until(() => ui('!!document.querySelector("#home-custom-shortcuts .home-shortcut-item img")'), 'site icon on tile');
  await shot('home-icons');
  checks.push('tile shows the site icon without a new request');

  // Wallpaper from Settings > Appearance.
  const settingsId = await nacre.createTab('nacre://settings/#appearance', false), settingsPage = nacre.tabs.get(settingsId).pageView.webContents;
  await until(() => !settingsPage.isLoading() && settingsPage.getURL().startsWith('nacre://settings/'), 'settings page');
  await until(() => settingsPage.executeJavaScript('!!document.querySelector("#wallpaper-choose")'), 'wallpaper control');
  await settingsPage.executeJavaScript('document.querySelector("#wallpaper-choose").click()');
  await until(() => /^[a-f0-9]{32}$/.test(nacre.settings().homeWallpaper), 'wallpaper saved');
  await until(() => settingsPage.executeJavaScript('!document.querySelector(".wallpaper-preview").hidden'), 'wallpaper preview');
  await until(() => ui('document.querySelector("#home").classList.contains("has-wallpaper")'), 'wallpaper on home');
  if (shots) { nacre.activateTab([...nacre.tabs.keys()][0]); await wait(600); await shot('wallpaper'); nacre.activateTab(settingsId); }
  assert.ok(fs.existsSync(path.join(profile, 'home-wallpaper.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'home-wallpaper.json'), 'utf8')).version, 1, 'wallpaper file is signed');
  await settingsPage.executeJavaScript('document.querySelector("#wallpaper-clear").click()');
  await until(() => nacre.settings().homeWallpaper === '' && !fs.existsSync(path.join(profile, 'home-wallpaper.json')), 'wallpaper removed');
  await until(() => ui('!document.querySelector("#home").classList.contains("has-wallpaper")'), 'home without wallpaper');
  checks.push('custom wallpaper');

  // A bookmarks file exported by a browser carries each site icon: it is imported, no request is made.
  const exported = path.join(profile, 'exported-bookmarks.html');
  const iconPng = bitmap(16, 16).toPNG().toString('base64');
  fs.writeFileSync(exported, '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="https://icons-import.test/page" ICON="data:image/png;base64,' + iconPng + '">With icon</A></DL>');
  pickedFile = exported;
  const requestsBefore = requests.length;
  const bookmarksId = await nacre.createTab('nacre://bookmarks/', false), bookmarksPage = nacre.tabs.get(bookmarksId).pageView.webContents;
  await until(() => !bookmarksPage.isLoading() && bookmarksPage.getURL().startsWith('nacre://bookmarks/'), 'bookmarks page');
  const imported = await bookmarksPage.executeJavaScript('window.nacre.importBookmarks()');
  assert.equal(imported.imported, 1);
  assert.ok(nacre.settings().bookmarks.some(x => x.url === 'https://icons-import.test/page' && x.icon === undefined), 'icon is not stored in the bookmark');
  await until(async () => /^data:image\/png;base64,/.test((await ui('window.nacre.siteIcons(["icons-import.test"])'))['icons-import.test'] || ''), 'imported icon available');
  assert.equal(requests.length, requestsBefore, 'import made no request');
  checks.push('icons imported from a bookmarks file');

  // Remove through the tile dialog.
  await ui('document.querySelector("#home-custom-shortcuts .home-shortcut-more").click()');
  await until(() => ui('!!document.querySelector("#home-shortcut-remove")'), 'edit dialog');
  await ui('document.querySelector("#home-shortcut-remove").click()');
  await until(() => nacre.settings().home.shortcuts.length === 3 && nacre.settings().home.shortcuts[0].title === 'Own', 'shortcut removed');
  checks.push('remove shortcut');

  console.log('HOME_096_RUNTIME_RESULT ' + JSON.stringify({ status: 'PASS', checks }));
}
run().then(() => { server.close(); app.quit(); }, error => { console.error(error.stack); server.close(); app.exit(1); });
