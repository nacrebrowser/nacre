'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-phishing-'));
  const entry = path.join(profile, 'verify.cjs'); fs.copyFileSync(__filename, entry);
  const result = require('./test-support/sandboxed-electron-fixture.cjs').launch([entry], { env: { ...process.env, NACRE_PHISHING_ROOT: root, NACRE_PHISHING_PROFILE: profile }, encoding: 'utf8', timeout: 90000 });
  const out = path.join(root, '.cache/phishing-expansion'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify({ exitCode: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exit(result.status === 0 ? 0 : 1);
}
const { app, safeStorage } = require('electron'), Module = require('node:module'), assert = require('node:assert/strict');
const webNavigations = [];
app.on('web-contents-created', (_event, contents) => contents.on('did-start-navigation', (_event, url) => { if (/^https?:/i.test(url)) webNavigations.push(url); }));
const root = process.env.NACRE_PHISHING_ROOT, profile = process.env.NACRE_PHISHING_PROFILE;
app.setPath('userData', profile); app.setPath('appData', profile); app.setPath('sessionData', path.join(profile, 'session'));
app.whenReady().then(() => require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile, 'settings.json'), 'settings', { directMode: false, torCountry: '', clearOnQuit: true, adBlockEnabled: true, antiFingerprint: true, language: 'fr' }));
const filename = path.join(root, 'src/main.cjs'), main = new Module(filename, module);
main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={tabs,createTab,closeTab,window:()=>win};', filename);
const nacre = main.exports, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 600; i++) { if (await fn()) return; await wait(50); } throw new Error('Phishing fixture timeout'); }
async function run() {
  await app.whenReady(); await until(() => nacre.tabs.size > 0); nacre.window().hide();
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'src/phishing-domains.json')));
  const settingsId = await nacre.createTab('nacre://settings/#phishing', false), settings = nacre.tabs.get(settingsId).pageView.webContents;
  await until(() => !settings.isLoading() && settings.getURL().startsWith('nacre://settings/'));
  const status = await settings.executeJavaScript('window.nacre.getPhishingFeedStatus()');
  assert.equal(status.entryCount, expected.entryCount); assert.equal(status.sources.length, 3);
  const cardScript = "document.querySelector('[data-i18n=\"phishing.publicFeed\"]').parentElement.textContent";
  await until(() => settings.executeJavaScript(cardScript + '.includes("PhishDestroy")'));
  const card = await settings.executeJavaScript(cardScript);
  for (const source of expected.sources) assert.ok(card.includes(source.name));
  const target = 'https://' + expected.domains[0] + '/';
  const warningId = await nacre.createTab(target, false), warning = nacre.tabs.get(warningId).pageView.webContents;
  await until(() => !warning.isLoading() && warning.getURL().startsWith('nacre://phishing/'));
  await until(() => warning.executeJavaScript('!document.querySelector("#warning").hidden && document.querySelector("#phishing-reasons").children.length > 0'));
  const notice = await warning.executeJavaScript('window.nacre.getPhishing()');
  assert.equal(notice.url, target); assert.ok(notice.reasons.includes('public-feed')); assert.equal(notice.blocked, false);
  const text = await warning.executeJavaScript('document.querySelector("#phishing-reasons").textContent');
  assert.ok(!text.includes('phishunt.io'), 'reason applies to all approved sources');
  assert.equal(warning.getLastWebPreferences().sandbox, true); assert.equal(warning.getLastWebPreferences().contextIsolation, true);
  assert.match(await warning.session.resolveProxy(target), /127\.0\.0\.1:1/);
  assert.deepEqual(webNavigations, [], 'listed hostname never starts a web navigation');
  assert.ok(app.getAppMetrics().filter(metric => metric.type === 'Tab').every(metric => metric.sandboxed === true));
  console.log('PHISHING_FEED_RUNTIME_RESULT ' + JSON.stringify({ status: 'PASS', entryCount: status.entryCount, sourceCount: status.sources.length, displayed: card, warningBeforeNavigation: true, warningReason: text, sandbox: true, networkRoute: 'closed; no listed host contacted' }));
}
run().then(() => app.quit(), error => { console.error(error.stack); app.exit(1); });
