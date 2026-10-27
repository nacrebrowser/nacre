'use strict';
const fs = require('node:fs'), path = require('node:path');
const { launch } = require('./test-support/electron-fixture.cjs');
const root = process.env.NACRE_CONTINUATION_ROOT || path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const cacheRoot = path.join(root, '.cache', 'continuation-fixture'); fs.mkdirSync(cacheRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(cacheRoot, 'run-'));
  const env = { ...process.env, NACRE_CONTINUATION_ROOT: root, NACRE_CONTINUATION_PROFILE: profile };
  try {
    for (const phase of ['exercise', 'restart']) {
      const child = launch([__filename], {
        cwd: root, env: { ...env, NACRE_CONTINUATION_PHASE: phase }, encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024
      });
      process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
      if (child.error || child.status !== 0) throw child.error || Error(`Electron ${phase} exited ${child.status}`);
    }
    const report = JSON.parse(fs.readFileSync(path.join(profile, 'result.json')));
    const destination = path.join(root, '.cache/continuation-2026-10-23');
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'lifecycle-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
  finally {
    if (path.dirname(path.resolve(profile)) !== path.resolve(cacheRoot) || !path.basename(profile).startsWith('run-')) throw Error('Unsafe cleanup');
    fs.rmSync(profile, { recursive: true, force: true });
  }
} else {
  const assert = require('node:assert/strict'), http = require('node:http'), Module = require('node:module');
  const { app, BrowserWindow, safeStorage } = require('electron');
  const profile = process.env.NACRE_CONTINUATION_PROFILE, phase = process.env.NACRE_CONTINUATION_PHASE || process.argv.at(-1), reportFile = path.join(profile, 'result.json');
  const previous = phase === 'restart' ? JSON.parse(fs.readFileSync(reportFile)) : null;
  app.setPath('appData', profile); app.setPath('userData', profile); app.setPath('sessionData', path.join(profile, 'session'));
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.test 127.0.0.1');
  BrowserWindow.prototype.show = function () {};
  if (phase === 'exercise') app.whenReady().then(() => {
    require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile, 'settings.json'), 'settings', {
      directMode: true, torCountry: '', httpsOnly: false, clearOnQuit: false, adBlockEnabled: false,
      antiFingerprint: false, cookiePolicy: 'allow', language: 'en', phishingGuardEnabled: false,
      forgetSiteOnClose: ['a.test'], suspendInactiveTabs: false, welcomeDone: true
    });
  }).catch(error => { console.error('WRITE_SETTINGS_FAIL ' + (error.stack || error)); app.exit(1); });
  const filename = path.join(root, 'src/main.cjs'), main = new Module(filename, module);
  main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
  main._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={tabs,createTab,closeTab,navigateTab,openReaderForTab,openShareForTab,suspendTab,activateTab,settings:()=>settings,chrome:()=>chromeView,pendingClears:()=>[...pendingSiteClears.values()]};', filename);
  const nacre = main.exports, checks = previous?.checks || [];
  app.on('web-contents-created', (_event, wc) => {
    wc.on('did-fail-load', (_errorEvent, code, description, validatedURL, isMainFrame) => {
      console.error('LOAD_FAIL ' + JSON.stringify({ code, description, validatedURL, isMainFrame }));
    });
  });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, label) { for (let n = 0; n < 300; n++) { if (await check()) return; await wait(20); } throw Error('Timeout: ' + label); }
  const handler = (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Article</title><article><h1>Fixture article</h1>' + '<p>This local article has enough text for the reader extraction and contains no external resources.</p>'.repeat(30) + '</article>'); };
  const servers = [http.createServer(handler), http.createServer(handler)];
  async function page(url, workspaceId) {
    const id = await nacre.createTab(url, false, workspaceId ? { workspaceId } : {}), tab = nacre.tabs.get(id);
    try {
      await until(() => tab.pageView && !tab.pageView.webContents.isLoading() && tab.pageView.webContents.getURL() === url, 'page ' + url);
    } catch (error) {
      const wc = tab?.pageView?.webContents;
      console.error('PAGE_STATE ' + JSON.stringify({ requested: url, current: wc && !wc.isDestroyed() ? wc.getURL() : null, loading: wc && !wc.isDestroyed() ? wc.isLoading() : null, title: wc && !wc.isDestroyed() ? wc.getTitle() : null }));
      throw error;
    }
    return tab;
  }
  const run = (tab, source) => tab.pageView.webContents.executeJavaScript(source);
  const settledClears = async () => { await Promise.all(nacre.pendingClears()); };
  const timeout = setTimeout(() => { console.error('Lifecycle fixture timeout'); app.exit(8); }, 80000); timeout.unref();
  app.whenReady().then(async () => {
    await until(() => nacre.chrome() && nacre.tabs.size, 'startup');
    await Promise.all(servers.map((server, index) => new Promise(resolve => server.listen(previous?.ports[index] || 0, '127.0.0.1', resolve))));
    const ports = servers.map(server => server.address().port), a = 'http://a.test:' + ports[0] + '/', a2 = 'http://a.test:' + ports[1] + '/', b = 'http://b.test:' + ports[0] + '/';
    if (phase === 'restart') {
      const tab = await page(a, previous.workspaceId);
      assert.equal(await run(tab, 'localStorage.getItem("quitSecret")'), null);
      assert.ok(!(await tab.browserSession.cookies.get({ domain: 'a.test' })).some(cookie => cookie.name === 'quitSecret'));
      const untouched = await page(b, previous.workspaceId);
      assert.equal(await run(untouched, 'localStorage.getItem("control")'), 'kept');
      checks.push('restart verifies Reader-source cookie and localStorage removed at quit, unrelated origin retained');
      fs.writeFileSync(reportFile, JSON.stringify({ ...previous, status: 'PASS', checks, limits: ['Local HTTP fixtures; no global packet capture, Tor anonymity, installed setup or forensic-erasure validation.'] }, null, 2));
      servers.forEach(server => server.close()); app.quit(); return;
    }
    const first = await page(a), workspaceId = first.workspaceId, second = await page(a2, workspaceId), unrelated = await page(b, workspaceId);
    await run(first, 'localStorage.setItem("secret","one");document.cookie="secret=one;path=/;max-age=3600"');
    await run(second, 'localStorage.setItem("secret","two")');
    await run(unrelated, 'localStorage.setItem("control","kept")');
    const state = await nacre.chrome().webContents.executeJavaScript('window.nacre.workspace({action:"create",name:"Control identity"})');
    const otherId = state.activeId;
    const other = await page(a, otherId);
    await run(other, 'localStorage.setItem("identityControl","kept");document.cookie="identityControl=kept;path=/;max-age=3600"');
    const ses = first.browserSession;
    assert.equal(nacre.openShareForTab(first), true);
    await until(() => first.url.startsWith('nacre://share/') && !first.pageView.webContents.isLoading(), 'Share transition');
    nacre.closeTab(first.id, { discard: true }); await settledClears();
    assert.ok((await ses.cookies.get({ domain: 'a.test' })).some(cookie => cookie.name === 'secret'));
    nacre.closeTab(second.id, { discard: true }); await settledClears();
    assert.ok(!(await ses.cookies.get({ domain: 'a.test' })).some(cookie => cookie.name === 'secret'));
    const one = await page(a, workspaceId), two = await page(a2, workspaceId);
    assert.equal(await run(one, 'localStorage.getItem("secret")'), null);
    assert.equal(await run(two, 'localStorage.getItem("secret")'), null);
    assert.equal(await run(other, 'localStorage.getItem("identityControl")'), 'kept');
    assert.equal(await run(unrelated, 'localStorage.getItem("control")'), 'kept');
    checks.push('Share close retains site data while another port is open, last close clears both origins; other site and identity retained');
    await run(one, 'localStorage.setItem("navigationSecret","set")');
    await nacre.navigateTab(one, b); nacre.closeTab(one.id, { discard: true });
    nacre.closeTab(two.id, { discard: true }); await settledClears();
    const revisited = await page(a, workspaceId);
    assert.equal(await run(revisited, 'localStorage.getItem("navigationSecret")'), null);
    checks.push('navigation away preserves the original cleanup obligation');
    // Reopening must wait for the old identity's pending origin clear; a late
    // cleanup must not silently erase data newly written by the reopened page.
    const nativeClear = ses.clearData;
    let enterClear, releaseClear;
    const startedClear = new Promise(resolve => { enterClear = resolve; });
    ses.clearData = async function (options) {
      enterClear(); await new Promise(resolve => { releaseClear = resolve; });
      return nativeClear.call(this, options);
    };
    nacre.closeTab(revisited.id, { discard: true });
    await startedClear;
    const reopenedId = await nacre.createTab(a, false, { workspaceId });
    const reopened = nacre.tabs.get(reopenedId);
    await wait(50);
    assert.notEqual(reopened.pageView.webContents.getURL(), a);
    releaseClear(); await settledClears();
    ses.clearData = nativeClear;
    await until(() => !reopened.pageView.webContents.isLoading() && reopened.pageView.webContents.getURL() === a, 'reopen after pending cleanup');
    checks.push('reopening waits for an in-flight origin clear before loading');
    // Exercise the real async suspension race without changing production code.
    const contents = reopened.pageView.webContents, nativeExecute = contents.executeJavaScript;
    nacre.activateTab(unrelated.id);
    let releaseScroll;
    contents.executeJavaScript = () => new Promise(resolve => { releaseScroll = resolve; });
    const pending = nacre.suspendTab(reopened);
    nacre.activateTab(reopened.id); releaseScroll(100);
    assert.equal(await pending, false); assert.equal(contents.isDestroyed(), false);
    contents.executeJavaScript = nativeExecute;
    checks.push('reactivating a tab during suspension preserves its renderer');
    await run(reopened, 'localStorage.setItem("quitSecret","set");document.cookie="quitSecret=set;path=/;max-age=3600"');
    assert.equal(await nacre.openReaderForTab(reopened), true);
    await until(() => reopened.url.startsWith('nacre://reader/') && !reopened.pageView.webContents.isLoading(), 'Reader transition');
    await until(() => run(reopened, 'document.querySelector("#reader-content")?.textContent.includes("local article")'), 'Reader content rendered');
    fs.writeFileSync(reportFile, JSON.stringify({ status: 'QUIT_PENDING', workspaceId, ports, checks, electron: process.versions.electron }, null, 2));
    servers.forEach(server => server.close()); app.quit();
  }).catch(error => { console.error(error.stack || error); servers.forEach(server => server.close()); app.exit(1); });
}
