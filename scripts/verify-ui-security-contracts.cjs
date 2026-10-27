'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require(process.env.NACRE_ELECTRON_FIXTURE_HELPER || path.join(__dirname, 'test-support/electron-fixture.cjs'));
if (!process.versions.electron) {
  const root = path.resolve(__dirname, '..');
  const cacheRoot = path.join(root, '.cache', 'ui-security-contracts'); fs.mkdirSync(cacheRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(cacheRoot, 'run-'));
  const entry = path.join(scratch, 'verify.cjs'); fs.copyFileSync(__filename, entry);
  const env = { ...process.env, NACRE_CONTRACT_ROOT: root, NACRE_CONTRACT_PROFILE: scratch, NACRE_ELECTRON_FIXTURE_HELPER: path.join(__dirname, 'test-support/electron-fixture.cjs') };
  const r = launch([entry], { cwd: root, env, encoding: 'utf8', timeout: 90000 });
  const output = (r.stdout || '') + (r.stderr || '');
  const folder = path.join(root,'.cache/security-051/stabilization-tests'); fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'ui-contracts.log'), output);
  process.stdout.write(output); if(r.error) console.error(r.error.message); process.exit(r.status ?? 1);
}
const assert = require('node:assert/strict');
const Module = require('node:module');
const { app, BrowserWindow } = require('electron');
const root = process.env.NACRE_CONTRACT_ROOT, scratch = process.env.NACRE_CONTRACT_PROFILE;
app.setPath('appData',scratch); app.setPath('userData',path.join(scratch,'profile')); app.setPath('sessionData',path.join(scratch,'session'));
process.env.NACRE_PORTABLE_MODE = '0';
fs.mkdirSync(app.getPath('userData'),{recursive:true});
app.whenReady().then(() => require(path.join(root,'src/profile-integrity.cjs')).createProfileIntegrity(app.getPath('userData'), require('electron').safeStorage).write(path.join(app.getPath('userData'),'settings.json'), 'settings', { directMode:false,torCountry:'',httpsOnly:false,clearOnQuit:true,adBlockEnabled:false,language:'en',antiFingerprint:false }));
BrowserWindow.prototype.show = function() {};
const filename = path.join(root,'src/main.cjs');
const main = new Module(filename,module); main.filename = filename; main.paths = Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename,'utf8') + '\nmodule.exports={tabs,createTab,closeTab,sendState,chrome:()=>chromeView};',filename);
const nacre = main.exports;
const i18n = require(path.join(root,'src/i18n.cjs'));
const { TOR_EXIT_COUNTRIES } = require(path.join(root,'src/tor-exit-countries.cjs'));
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn, label) { for(let i=0;i<160;i++){if(await fn())return;await wait(40);} throw new Error('Timeout '+label); }
const results = [];
function countryContract(rows, language) {
  assert.deepEqual(rows.map(row=>row.code).sort(),['AUTO',...Object.keys(TOR_EXIT_COUNTRIES)].sort());
  for(const row of rows) {
    assert.equal(row.key,'tor.country'+row.code);
    assert.equal(row.text,i18n.t(row.key,language));
  }
}
(async()=>{
  await app.whenReady(); await until(()=>nacre.tabs.size>0,'startup');
  const chrome = nacre.chrome().webContents;
  chrome.on('console-message',event=>{if(event.level==='error')console.error('UI console',event.message);});
  await until(()=>!chrome.isLoading() && chrome.getURL()==='nacre://app/','chrome document');
  await until(()=>chrome.executeJavaScript('!!window.nacre && document.readyState === "complete"'),'chrome preload');
  for(const language of ['en','fr','de','es']) {
    await chrome.executeJavaScript('window.nacre.savePreferences('+JSON.stringify({language})+')');
    await until(()=>chrome.executeJavaScript('document.documentElement.lang === '+JSON.stringify(language)),'chrome locale');
    await chrome.executeJavaScript('document.querySelector("#vpn-country-button").click()');
    const menu = await chrome.executeJavaScript(`Array.from(document.querySelectorAll('[data-vpn-option]'),el=>({code:el.dataset.vpnOption,key:el.querySelector('strong').dataset.i18n,text:el.querySelector('strong').textContent}))`);
    countryContract(menu,language);
    assert.throws(()=>countryContract(menu.slice(1),language), 'missing country must fail');
    assert.throws(()=>countryContract([...menu,menu[0]],language), 'duplicate country must fail');
    const relayKey = 'tor.exitDisclaimer';
    assert.notEqual(i18n.t(relayKey,language),relayKey,'risk note must resolve to a catalogue value');
    const relay = await chrome.executeJavaScript(`Array.from(document.querySelectorAll('[data-i18n="tor.exitDisclaimer"]'),el=>({text:el.textContent,visible:el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'}))`);
    assert.ok(relay.some(row=>row.visible && row.text===i18n.t(relayKey,language)));
    await chrome.executeJavaScript('document.querySelector("#vpn-country-button").click()');
    results.push({ contract:'country-menu-and-relay-disclaimer',language,status:'PASS' });
    const id = await nacre.createTab('nacre://settings/');
    const wc = nacre.tabs.get(id).pageView.webContents;
    await until(()=>!wc.isLoading(),'settings load');
    await until(()=>wc.executeJavaScript('document.documentElement.lang === '+JSON.stringify(language)),'settings locale');
    const settings = await wc.executeJavaScript(`({countries:Array.from(document.querySelectorAll('#tor-country option'),el=>({code:el.value,key:el.dataset.i18n,text:el.textContent})),disclaimer:document.querySelector('#tor-exit-note').textContent,webglTitle:document.querySelector('[data-i18n="settings.webglTitle"]').textContent,webglStatus:document.querySelector('#webgl-status').textContent,masked:document.querySelectorAll('option[value="masked"],input[value="masked"]').length})`);
    countryContract(settings.countries,language);
    for(const key of ['tor.exitDisclaimer','settings.webglTitle','settings.webglRuntime']) assert.notEqual(i18n.t(key,language),key);
    assert.equal(settings.disclaimer,i18n.t('tor.exitDisclaimer',language));
    assert.equal(settings.webglTitle,i18n.t('settings.webglTitle',language));
    assert.equal(settings.webglStatus,i18n.t('settings.webglRuntime',language));
    assert.equal(settings.masked,0);
    results.push({ contract:'settings-country-disclaimer-and-webgl',language,status:'PASS' });
    await nacre.closeTab(id);
  }
  console.log('UI_CONTRACTS_RESULT '+JSON.stringify({status:'PASS',results,negativeControls:['missing-country','duplicate-country']})); app.exit(0);
})().catch(error=>{console.error(error.stack);app.exit(1);});
