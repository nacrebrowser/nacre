'use strict';

// Real-network check of the shortcut icon fetch in a disposable profile. With
// Tor off, adding home shortcuts starts the temporary icon Tor, which must
// fetch the icons, leave browsing untouched and stop. Then the bundled Tor is
// connected and a further shortcut gets its icon through it. Needs internet
// access and takes a few minutes. Not part of `npm test`; run it with
// `npm run verify:site-icons`.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-icons-tor-'));
  const entry = path.join(profile, 'verify.cjs'); fs.copyFileSync(__filename, entry);
  const result = require('./test-support/sandboxed-electron-fixture.cjs').launch([entry], { env: { ...process.env, NACRE_ICONS_ROOT: root, NACRE_ICONS_PROFILE: profile }, encoding: 'utf8', timeout: 520000 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(result.status === 0 ? 0 : 1);
}
const { app, safeStorage, BrowserWindow } = require('electron'), Module = require('node:module'), assert = require('node:assert/strict');
const root = process.env.NACRE_ICONS_ROOT, profile = process.env.NACRE_ICONS_PROFILE;
app.setPath('userData', profile); app.setPath('appData', profile); app.setPath('sessionData', path.join(profile, 'session'));
BrowserWindow.prototype.show = function () {};
app.whenReady().then(() => require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile, 'settings.json'), 'settings', { directMode: true, torAutoStart: false, torCountry: '', language: 'en', welcomeDone: true }));
const filename = path.join(root, 'src/main.cjs'), main = new Module(filename, module);
main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={tabs,connectTor,closeTorRuntime,updateHomeShortcuts,stopIconTor,siteIcons:()=>siteIcons,state:()=>({torRuntime,torBootstrapPercent,torStartupError,iconTor,torCountry:settings.torCountry})};', filename);
const nacre = main.exports, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sites = ['www.wikipedia.org', 'github.com', 'www.mozilla.org'], connectedSite = 'www.torproject.org';
const runtimeFolders = () => { try { return fs.readdirSync(path.join(profile, 'tor-runtime')); } catch { return []; } };

async function run() {
  await app.whenReady();
  for (let i = 0; i < 200 && !nacre.tabs.size; i++) await wait(50);
  const started = Date.now();
  try {
    for (const host of sites) assert.equal(nacre.updateHomeShortcuts({ action: 'add', title: '', url: host }), true);
    assert.ok(nacre.state().iconTor, 'the temporary icon Tor starts');
    for (let i = 0; i < 3000 && nacre.state().iconTor; i++) {
      assert.equal(nacre.state().torRuntime, null, 'browsing never uses the temporary Tor');
      await wait(100);
    }
    assert.equal(nacre.state().iconTor, null, 'the temporary icon Tor stops on its own');
    assert.equal(nacre.state().torCountry, '');
    assert.deepEqual(runtimeFolders(), [], 'its temporary folder is removed');
    const found = sites.filter((host) => nacre.siteIcons().has(host));
    assert.ok(found.length >= 2, 'icons fetched by the temporary Tor: ' + found.join(', '));
    for (const host of found) assert.match(nacre.siteIcons().get(host), /^data:image\/png;base64,/);
    const backgroundSeconds = Math.round((Date.now() - started) / 1000);
    await nacre.connectTor('GB');
    assert.equal(nacre.state().torRuntime?.ready, true);
    assert.equal(nacre.updateHomeShortcuts({ action: 'add', title: '', url: connectedSite }), true);
    assert.equal(nacre.state().iconTor, null, 'a connected Tor is reused');
    for (let i = 0; i < 900 && !nacre.siteIcons().has(connectedSite); i++) await wait(100);
    assert.ok(nacre.siteIcons().has(connectedSite), 'icon fetched through the connected Tor');
    console.log('SITE_ICONS_TOR_RESULT ' + JSON.stringify({ status: 'PASS', backgroundSeconds, seconds: Math.round((Date.now() - started) / 1000), fetched: found, missing: sites.filter((host) => !found.includes(host)) }));
  } catch (error) {
    console.log('SITE_ICONS_TOR_RESULT ' + JSON.stringify({ status: 'FAIL', error: error.message, bootstrap: nacre.state().torBootstrapPercent, torError: nacre.state().torStartupError }));
    process.exitCode = 1;
  } finally { await nacre.stopIconTor(); await nacre.closeTorRuntime(nacre.state().torRuntime); }
}
run().then(() => app.exit(process.exitCode || 0), (error) => { console.error(error.message); app.exit(1); });
