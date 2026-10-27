'use strict';

// A production-main benchmark. Never uses the legacy no-sandbox fixture helper.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const root = process.env.NACRE_MEMORY_ROOT || path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const label = process.argv[2] || 'measurement';
  if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid evidence label');
  const folder = path.join(root, '.cache', 'memory');
  fs.mkdirSync(folder, { recursive: true });
  // A short, ordinary TEMP directory avoids the workspace's inherited Windows
  // ACLs breaking Chromium startup. The OS sandbox remains enabled.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-ram-'));
  const profile = path.join(temporary, 'profile'); fs.mkdirSync(profile);
  let electron = require('electron');
  if (process.platform === 'win32') {
    const runtime = path.join(temporary, 'runtime');
    fs.cpSync(path.dirname(electron), runtime, { recursive: true });
    electron = path.join(runtime, path.basename(electron));
  }
  const entry = path.join(profile, 'measure.cjs');
  fs.copyFileSync(__filename, entry);
  const env = { ...process.env, NACRE_MEMORY_ROOT: root, NACRE_MEMORY_PROFILE: profile };
  if (process.argv.includes('--locales')) env.NACRE_MEMORY_LOCALES = '1';
  if (process.argv.includes('--baseline')) {
    const baseline = spawnSync('git', ['show', '99dd189:src/main.cjs'], { cwd: root, encoding: 'utf8' });
    if (baseline.status !== 0) throw new Error(baseline.stderr);
    env.NACRE_MEMORY_MAIN = path.join(profile, 'baseline-main.cjs');
    fs.writeFileSync(env.NACRE_MEMORY_MAIN, baseline.stdout);
  }
  if (process.argv.includes('--baseline') || process.argv.includes('--baseline-locales')) {
    const baseline = spawnSync('git', ['show', '99dd189:src/i18n.cjs'], { cwd: root, encoding: 'utf8' });
    if (baseline.status !== 0) throw new Error(baseline.stderr);
    env.NACRE_MEMORY_I18N = path.join(profile, 'baseline-i18n.cjs');
    fs.writeFileSync(env.NACRE_MEMORY_I18N, baseline.stdout);
  }
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [entry], { env, cwd: temporary, windowsHide: true, encoding: 'utf8', timeout: 180000 });
  const evidence = { label, timestamp: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  fs.writeFileSync(path.join(folder, label + '.json'), JSON.stringify(evidence, null, 2));
  const runtimeDirectory = path.resolve(temporary, 'runtime');
  if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith('nacre-ram-') && path.dirname(runtimeDirectory) === temporary) {
    try { fs.rmSync(runtimeDirectory, { recursive: true, force: true }); } catch { /* Preserve files still held by a child. */ }
  }
  process.stdout.write((result.stdout || '').split(/\r?\n/).filter(line => !line.startsWith('MEMORY_RESULT ')).join('\n')); process.stderr.write(result.stderr || '');
  console.log('MEMORY_EXIT ' + result.status);
  process.exit(result.status === 0 ? 0 : 1);
}

const { app, safeStorage } = require('electron');
const Module = require('node:module');
const http = require('node:http');
const assert = require('node:assert/strict');
const profile = process.env.NACRE_MEMORY_PROFILE;
app.setPath('userData', profile); app.setPath('appData', profile); app.setPath('sessionData', path.join(profile, 'session'));
app.whenReady().then(() => {
  require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile, 'settings.json'), 'settings', {
    directMode: true, torCountry: '', clearOnQuit: true, adBlockEnabled: true, antiFingerprint: true, httpsOnly: true, language: 'fr'
  });
});
const filename = path.join(root, 'src/main.cjs');
if (process.env.NACRE_MEMORY_I18N) {
  const localeFilename = path.join(root, 'src/i18n.cjs');
  const localeModule = new Module(localeFilename, module);
  localeModule.filename = localeFilename; localeModule.paths = Module._nodeModulePaths(path.dirname(localeFilename));
  localeModule._compile(fs.readFileSync(process.env.NACRE_MEMORY_I18N, 'utf8'), localeFilename);
  require.cache[localeFilename] = localeModule;
}
const main = new Module(filename, module); main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
const measuredSource = fs.readFileSync(process.env.NACRE_MEMORY_MAIN || filename, 'utf8');
main._compile(measuredSource + '\nmodule.exports={tabs,createTab,closeTab,navigateTab,chrome:()=>chromeView,window:()=>win,settings:()=>settings,blocker:()=>blocker,blockerMetrics:()=>blockerLoadMetrics};', filename);
const nacre = main.exports;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 600; i++) { if (await fn()) return; await wait(50); } throw new Error('Timed out waiting for production startup/navigation'); }
const html = '<!doctype html><meta charset="utf-8"><title>Memory fixture</title><style>body{font:16px sans-serif}article{padding:8px;border:1px solid #ccc}</style>' + '<article><h2>Deterministic local content</h2><p>Memory benchmark without external resources.</p></article>'.repeat(300);
const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
const rows = [];
async function sample(stage) {
  await wait(3000);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const processes = app.getAppMetrics().map(({ pid, type, name, memory }) => ({ pid, type, name, ...memory }));
    samples.push({ processes, workingSetKiB: processes.reduce((sum, p) => sum + p.workingSetSize, 0), privateKiB: processes.reduce((sum, p) => sum + p.privateBytes, 0), main: process.memoryUsage() });
    await wait(500);
  }
  const median = key => [...samples].sort((a, b) => a[key] - b[key])[2][key];
  const row = { stage, tabs: nacre.tabs.size, workingSetMiB: median('workingSetKiB') / 1024, privateMiB: median('privateKiB') / 1024, samples };
  rows.push(row);
  console.log('MEMORY_STAGE ' + JSON.stringify({ stage, tabs: row.tabs, workingSetMiB: row.workingSetMiB, privateMiB: row.privateMiB }));
}
async function run() {
  await app.whenReady();
  await until(() => nacre.tabs.size === 1 && nacre.chrome() && !nacre.chrome().webContents.isLoading());
  // Keep both variants hidden to prevent desktop input from altering the run.
  // This measures background tabs, without changing Chromium throttling flags.
  nacre.window().hide();
  assert.equal(nacre.window().isVisible(), false);
  assert.ok(nacre.blocker(), 'real bundled Ghostery engine');
  assert.equal(nacre.settings().antiFingerprint, true);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await sample('startup');
  const first = nacre.tabs.values().next().value;
  for (let i = 1; i <= 10; i++) {
    const tab = i === 1 ? first : nacre.tabs.get(await nacre.createTab());
    const url = 'http://127.0.0.1:' + server.address().port + '/page-' + i;
    // Same per-document HTTP consent as the warning UI, for loopback only.
    tab.allowHttpOnce = url;
    await nacre.navigateTab(tab, url);
    assert.equal(tab.pageView.webContents.getURL(), url);
    const prefs = tab.pageView.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    assert.equal(await tab.pageView.webContents.executeJavaScript('typeof window.nacre'), 'undefined');
    assert.equal(nacre.tabs.size, i, 'exact tab count; reject interactive interference');
    if ([1, 5, 10].includes(i)) await sample(String(i));
  }
  for (const id of [...nacre.tabs.keys()].slice(1)) nacre.closeTab(id, { discard: true });
  await sample('closed-back-to-1');
  if (process.env.NACRE_MEMORY_LOCALES === '1') {
    const languages = require(path.join(root, 'src/i18n.cjs')).SUPPORTED_LANGUAGES;
    await nacre.chrome().webContents.executeJavaScript('(async()=>{for(const language of ' + JSON.stringify(languages) + ') await window.nacre.getMessages(language);})()');
    await sample('all-locales');
  }
  console.log('MEMORY_RESULT ' + JSON.stringify({ status: 'PASS', versions: process.versions, sourceSHA256: require('node:crypto').createHash('sha256').update(measuredSource).digest('hex'), i18nSHA256: require('node:crypto').createHash('sha256').update(fs.readFileSync(process.env.NACRE_MEMORY_I18N || path.join(root, 'src/i18n.cjs'))).digest('hex'), sandbox: true, visible: false, fixtureBytes: Buffer.byteLength(html), blocker: nacre.blockerMetrics(), rows }));
}
run().then(() => { server.close(); app.quit(); }, error => { console.error(error.stack); server.close(); app.exit(1); });
