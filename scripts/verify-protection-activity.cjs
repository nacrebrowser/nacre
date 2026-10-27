'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = process.env.NACRE_ACTIVITY_ROOT || path.resolve(__dirname, '..');
const output = path.join(root, '.cache/protection-activity');
fs.mkdirSync(output, { recursive: true });
if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  const entry = path.join(profile, 'verify.cjs'); fs.copyFileSync(__filename, entry);
  const env = { ...process.env, NACRE_ACTIVITY_ROOT: root, NACRE_ACTIVITY_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [entry], { env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exit(result.status ?? 1);
}
const assert = require('node:assert/strict'), http = require('node:http'), Module = require('node:module');
const { app, BrowserWindow, safeStorage } = require('electron');
const profile = process.env.NACRE_ACTIVITY_PROFILE;
app.setPath('userData', profile); app.setPath('appData', profile); app.setPath('sessionData', path.join(profile, 'session'));
BrowserWindow.prototype.show = function () {};
app.whenReady().then(() => require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage).write(path.join(profile,'settings.json'), 'settings', { directMode:true,torCountry:'',httpsOnly:false,clearOnQuit:true,adBlockEnabled:false,antiFingerprint:false,cookiePolicy:'block-all',language:'fr' }));
const filename = path.join(root, 'src/main.cjs'), main = new Module(filename, module);
main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports={tabs,createTab,closeTab,activateTab,sendState,chrome:()=>chromeView,activity:protectionActivity,internalSnapshot};',filename);
const nacre = main.exports;
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label) { for(let i=0;i<200;i++){if(await fn())return;await wait(35);}throw new Error('Timeout: '+label); }
const server = http.createServer((req,res) => {
  if (req.url === '/pixel') {
    res.writeHead(200, { 'content-type':'text/html', 'Set-Cookie':'_ga=SECRET_COOKIE_VALUE; Path=/; Max-Age=3600' });
    res.end('<!doctype html><title>Cookie fixture</title>'); return;
  }
  res.setHeader('content-type','text/html');
  res.end('<!doctype html><title>Activity fixture</title><iframe src="http://127.0.0.1:'+server.address().port+'/pixel"></iframe>');
});
async function run() {
  await app.whenReady(); await until(()=>nacre.tabs.size>0,'startup');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const sourceId = await nacre.createTab('http://127.0.0.1:'+server.address().port+'/');
  await until(()=>nacre.activity.snapshot().entries.some(entry=>entry.cookieName==='_ga'),'real cookie-header block');
  const observed = nacre.activity.snapshot().entries.find(entry=>entry.cookieName==='_ga');
  assert.equal(observed.company,'Google'); assert.equal(observed.basis,'signature'); assert.equal(observed.host,'127.0.0.1'); assert.equal(observed.action,'cookie-set-blocked');
  assert.equal(JSON.stringify(nacre.activity.snapshot()).includes('SECRET_COOKIE_VALUE'),false);
  const chrome = nacre.chrome().webContents;
  await until(()=>chrome.executeJavaScript("document.querySelector('#cookie-preview')?.textContent.includes('_ga')"),'toolbar preview');
  assert.equal(await chrome.executeJavaScript("document.querySelector('#cookie-preview').textContent.includes('Google')"),true);
  const id = await nacre.createTab('nacre://protection/',false,{contextTabId:sourceId});
  const wc = nacre.tabs.get(id).pageView.webContents;
  await until(()=>!wc.isLoading()&&wc.executeJavaScript("document.querySelector('#cookie-activity')?.textContent.includes('_ga')"),'dashboard');
  const locales = [];
  const i18n = require(path.join(root,'src/i18n.cjs'));
  for(const language of ['fr','en','de','es']) {
    await chrome.executeJavaScript('window.nacre.savePreferences('+JSON.stringify({language})+')');
    const label = i18n.t('activity.action.cookieSetBlocked',language);
    await until(()=>wc.executeJavaScript('document.documentElement.lang === '+JSON.stringify(language)+' && document.querySelector("#cookie-activity").textContent.includes('+JSON.stringify(label)+')'),'translated activity '+language);
    locales.push(language);
  }
  await wc.executeJavaScript("const search=document.querySelector('#activity-search');search.value='no-such-company';search.dispatchEvent(new Event('input')); ");
  assert.equal(await wc.executeJavaScript("document.querySelectorAll('#cookie-activity .activity-row').length"),0);
  await wc.executeJavaScript("document.querySelector('#activity-search').value='';document.querySelector('#activity-search').dispatchEvent(new Event('input'));document.querySelector('.activity-company-filter').click();");
  assert.equal(await wc.executeJavaScript("document.querySelector('#activity-search').value"),'Google');
  assert.equal(await wc.executeJavaScript("const probe=document.createElement('div');window.NacreProtectionActivity.render(probe,{available:true,scope:'normal',entries:[{company:'<img src=x onerror=alert(1)>',host:'<script>bad</script>',cookieName:'<svg>',count:1,action:'cookie-set-blocked',basis:'unknown'}]},key=>key);probe.querySelectorAll('img,script,svg').length"),0);
  const privateSourceId=await nacre.createTab('http://127.0.0.1:'+server.address().port+'/',true);
  const privateSource=nacre.tabs.get(privateSourceId);
  await until(()=>privateSource.privateActivity.snapshot().entries.some(entry=>entry.cookieName==='_ga'),'private cookie captured');
  const privateId=await nacre.createTab('nacre://protection/',true,{contextTabId:privateSourceId});
  const privateTab=nacre.tabs.get(privateId);
  assert.equal(nacre.internalSnapshot(privateTab).settings.protectionActivity.scope,'private');
  assert.equal(nacre.internalSnapshot(privateTab).settings.protectionActivity.entries[0].tabId,privateSourceId);
  await until(()=>!privateTab.pageView.webContents.isLoading()&&privateTab.pageView.webContents.executeJavaScript("document.querySelector('#cookie-activity').textContent.includes('_ga')"),'private UI');
  const normalCount=nacre.activity.snapshot().total;
  await privateTab.pageView.webContents.executeJavaScript("document.querySelector('#clear').click()");
  await until(()=>privateSource.privateActivity.snapshot().total===0,'clear private journal');
  assert.equal(nacre.activity.snapshot().total,normalCount);
  await nacre.closeTab(privateId);
  privateSource.privateActivity.record({host:'facebook.com',cookieName:'_fbp',action:'cookie-set-blocked',private:true});
  await nacre.closeTab(privateSourceId);
  assert.equal(privateSource.privateActivity.snapshot().total,0,'private journal destroyed with its tab');
  nacre.activateTab(id);
  await chrome.executeJavaScript('window.nacre.savePreferences({language:"fr"})');
  await until(()=>wc.executeJavaScript('document.documentElement.lang === "fr"'),'French preview');
  // Offscreen rendering provides a real Chromium surface without showing test
  // windows on the desktop. Populate the same renderer with the observed data.
  const preview = new BrowserWindow({show:false,width:1100,height:1100,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true}});
  await preview.loadURL('nacre://protection/');
  await preview.webContents.executeJavaScript('messages='+JSON.stringify(i18n.getMessages('fr'))+';locale="fr";requestedLocale="fr";document.documentElement.lang="fr";document.querySelectorAll("[data-i18n]").forEach(el=>{if(messages[el.dataset.i18n])el.textContent=messages[el.dataset.i18n]});applyState('+JSON.stringify({settings:{language:'fr',protectionActivity:nacre.activity.snapshot(),adBlockStats:{total:0,byType:{},bySite:{}},proxy:{mode:'direct'},cookiePolicy:'block-all',adBlockEnabled:false,antiFingerprint:false,webglMode:'disabled'}})+')');
  await wait(150);
  const image=await preview.webContents.capturePage();fs.writeFileSync(path.join(output,'preview.png'),image.toPNG());preview.destroy();
  await wc.executeJavaScript("document.querySelector('#clear').click()");
  await until(()=>nacre.activity.snapshot().total===0&&wc.executeJavaScript("document.querySelectorAll('#cookie-activity .activity-row').length === 0"),'clear journal');
  console.log('PROTECTION_ACTIVITY_RESULT '+JSON.stringify({status:'PASS',electron:process.versions.electron,locales,checks:['real filtered Set-Cookie','Google attribution','cookie values omitted','per-tab toolbar preview','search and company filter','text-only untrusted content','private snapshot and UI isolation','clear journal'],screenshot:'.cache/protection-activity/preview.png'}));
}
run().then(()=>{server.close();app.exit(0);},error=>{console.error(error.stack);server.close();app.exit(1);});
