'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.env.NACRE_ADBLOCK_ROOT||path.resolve(__dirname,'..');
const folder=path.join(root,'.cache/adblock-delivery');fs.mkdirSync(folder,{recursive:true});
if(!process.versions.electron){
 const profile=fs.mkdtempSync(path.join(folder,'profile-')),entry=path.join(profile,'verify.cjs');fs.copyFileSync(__filename,entry);
 const env={...process.env,NACRE_ADBLOCK_ROOT:root,NACRE_ADBLOCK_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const r=spawnSync(require('electron'),[entry],{env,windowsHide:true,encoding:'utf8',timeout:60000});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);
}
const {app,BrowserWindow,safeStorage}=require('electron'),http=require('node:http'),Module=require('node:module'),assert=require('node:assert/strict');
const profile=process.env.NACRE_ADBLOCK_PROFILE;app.setPath('userData',profile);app.setPath('appData',profile);app.setPath('sessionData',path.join(profile,'session'));
BrowserWindow.prototype.show=function(){};
app.whenReady().then(()=>require(path.join(root,'src/profile-integrity.cjs')).createProfileIntegrity(profile,safeStorage).write(path.join(profile,'settings.json'),'settings',{directMode:true,torCountry:'',httpsOnly:false,clearOnQuit:true,adBlockEnabled:true,antiFingerprint:false,cookiePolicy:'allow',language:'fr'}));
const filename=path.join(root,'src/main.cjs'),main=new Module(filename,module);main.filename=filename;main.paths=Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports={tabs,createTab,closeTab,chrome:()=>chromeView,installFixtureEngine:engine=>{blocker=engine},sendState};',filename);
const nacre=main.exports,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await wait(30)}throw new Error('Timeout '+label)}
const server=http.createServer((_req,res)=>{
 res.setHeader('content-type','text/html');res.end(`<!doctype html><script>window.__nacreAdProbe=true;window.__probeAtInline=window.__nacreAdProbe;window.ytInitialPlayerResponse={playerAds:[{}],adPlacements:[{}],adSlots:[{}],videoDetails:{title:'content'}};window.__parsed=JSON.parse('{"playerAds":[{}],"adPlacements":[{}],"adSlots":[{}],"videoDetails":{"title":"content"}}');</script><div class="fixture-ad">Advertisement fixture</div><p>Content fixture</p>`);
});
async function run(){
 await app.whenReady();await until(()=>nacre.tabs.size>0,'startup');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const {ElectronBlocker}=require(path.join(root,'node_modules/@ghostery/adblocker-electron'));
 const engine=ElectronBlocker.deserialize(fs.readFileSync(path.join(root,'vendor/filters/engine.bin')));
 engine.updateFromDiff({added:['127.0.0.1##+js(set-constant, __nacreAdProbe, false)','127.0.0.1##.fixture-ad']});
 const original=engine.getCosmeticsFilters.bind(engine);
 const youtube=original({url:'https://www.youtube.com/watch?v=fixture',hostname:'www.youtube.com',domain:'youtube.com',getBaseRules:true,getInjectionRules:true,getExtendedRules:true,getRulesFromHostname:true});
 assert.ok(youtube.scripts.length>0);
 engine.getCosmeticsFilters=details=>{
   const local=original(details);
   return {...local,scripts:[...youtube.scripts,...local.scripts]};
 };
 nacre.installFixtureEngine(engine);
 const results=[];
 for(const privateMode of [false,true]){
  const id=await nacre.createTab('http://127.0.0.1:'+server.address().port+'/',privateMode);
  const wc=nacre.tabs.get(id).pageView.webContents;await until(()=>!wc.isLoading(),'fixture loaded');
  const observed=await wc.executeJavaScript(`({probe:window.__nacreAdProbe,inline:window.__probeAtInline,parsedAds:!!(window.__parsed.playerAds||window.__parsed.adPlacements||window.__parsed.adSlots),playerAds:!!(window.ytInitialPlayerResponse.playerAds||window.ytInitialPlayerResponse.adPlacements||window.ytInitialPlayerResponse.adSlots),title:window.__parsed.videoDetails.title,display:getComputedStyle(document.querySelector('.fixture-ad')).display})`);
  assert.equal(observed.probe,false);assert.equal(observed.inline,false,'scriptlets must run before the page inline script');assert.equal(observed.parsedAds,false);assert.equal(observed.playerAds,false);assert.equal(observed.title,'content');assert.equal(observed.display,'none');
  results.push({private:privateMode,...observed});
 }
 const id=await nacre.createTab('nacre://settings/#adblock',false),wc=nacre.tabs.get(id).pageView.webContents;
 await until(()=>!wc.isLoading()&&wc.executeJavaScript('typeof window.nacre !== "undefined"'),'settings');
 await wc.executeJavaScript('document.querySelector("#update-filters").click()');
 await until(()=>wc.executeJavaScript('document.querySelector("#filter-update-result").textContent.includes("Tor")'),'visible update error');
 const visible=await wc.executeJavaScript(`(()=>{const button=document.querySelector('#update-filters'),message=document.querySelector('#filter-update-result');return {sameCard:button.parentElement===message.parentElement,kind:message.dataset.kind,text:message.textContent}})()`);
 assert.equal(visible.sameCard,true);assert.equal(visible.kind,'warning');
 console.log('ADBLOCK_DELIVERY_RESULT '+JSON.stringify({status:'PASS',youtubeScriptlets:youtube.scripts.length,results,updateFeedback:visible}));
}
run().then(()=>{server.close();app.exit(0)},error=>{console.error(error.stack);server.close();app.exit(1)});
