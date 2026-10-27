'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
if(!process.versions.electron){
 const root=path.resolve(__dirname,'..'),label=String(process.argv[2]||'experience').replace(/[^a-zA-Z0-9_-]/g,'_');
 const out=path.join(root,'.cache','release-060',label+'.log');if(fs.existsSync(out))throw Error('Refuse to overwrite '+out);
 const env={...process.env,NACRE_EXPERIENCE_ROOT:root,NACRE_EXPERIENCE_PROFILE:fs.mkdtempSync(path.join(os.tmpdir(),'nacre-experience-')),NACRE_EXPERIENCE_MODE:process.argv[3]||'all',NACRE_EXPERIENCE_LABEL:label};
 if(process.argv[4])env.NACRE_EXPERIENCE_SOURCE=path.resolve(root,process.argv[4]);delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(require('electron'),[__filename],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:240000});
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,(run.stdout||'')+(run.stderr||''));
 process.stdout.write(run.stdout||'');process.stderr.write(run.stderr||'');if(run.error)console.error(run.error.message);
 if(run.status===0&&env.NACRE_EXPERIENCE_MODE==='all'){
  const restored=spawnSync(require('electron'),[__filename],{cwd:root,env:{...env,NACRE_EXPERIENCE_MODE:'restore'},windowsHide:true,encoding:'utf8',timeout:90000});
  fs.writeFileSync(path.join(root,'.cache/release-060',label+'-restore.log'),(restored.stdout||'')+(restored.stderr||''));process.stdout.write(restored.stdout||'');process.stderr.write(restored.stderr||'');process.exit(restored.status??1);
 }process.exit(run.status??1);
}
const assert=require('node:assert/strict'),https=require('node:https'),crypto=require('node:crypto'),Module=require('node:module');
const {app,BrowserWindow}=require('electron');
const root=process.env.NACRE_EXPERIENCE_ROOT,profile=process.env.NACRE_EXPERIENCE_PROFILE;
const results=[],requests=[],errors=[],screenshots=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let n=0;n<240;n++){if(await fn())return;await wait(40);}throw Error('Timed out: '+label);}
async function record(name,fn){try{await fn();results.push({name,status:'PASS'});console.error('PASS '+name);}catch(error){results.push({name,status:'FAIL',error:error.stack||String(error)});console.error('FAIL '+name+': '+error.message);}}
app.setPath('appData',profile);app.setPath('userData',path.join(profile,'profile'));app.setPath('sessionData',path.join(profile,'session'));
app.commandLine.appendSwitch('host-resolver-rules','MAP first.fixture.test 127.0.0.1, MAP private.fixture.test 127.0.0.1, MAP ads.fixture.test 127.0.0.1');
process.env.NACRE_PORTABLE_MODE='0';fs.mkdirSync(app.getPath('userData'),{recursive:true});
if(process.env.NACRE_EXPERIENCE_MODE!=='restore')fs.writeFileSync(path.join(app.getPath('userData'),'settings.json'),JSON.stringify({directMode:true,torCountry:'',httpsOnly:false,clearOnQuit:false,adBlockEnabled:false,language:'en',antiFingerprint:false,cookiePolicy:'allow'}));
else assert.equal(fs.existsSync(path.join(app.getPath('userData'),'settings.json')),true,'restored profile must exist');
BrowserWindow.prototype.show=function(){};
app.on('web-contents-created',(_event,wc)=>wc.on('console-message',event=>{if(event.level==='error')errors.push(event.message);}));
const source=process.env.NACRE_EXPERIENCE_SOURCE||path.join(root,'src/main.cjs');
if(source!==path.join(root,'src/main.cjs')&&!source.startsWith(path.join(root,'.cache')+path.sep))throw Error('Baseline source must be in workspace cache');
const entry=path.join(root,'src/main.cjs'),main=new Module(entry,module);main.filename=entry;main.paths=Module._nodeModulePaths(path.dirname(entry));
main._compile(fs.readFileSync(source,'utf8')+`\nmodule.exports={tabs,createTab,closeTab,navigateTab,sendState,snapshot,settings:()=>settings,chrome:()=>chromeView,window:()=>win,active:()=>tabs.get(activeTabId),setBlocker:value=>{blocker=value;}};`,entry);
const nacre=main.exports;
const cert=fs.readFileSync(path.join(root,'.cache/security-051/tls-fixture/cert.pem'));
const fingerprint=new crypto.X509Certificate(cert).fingerprint256;
const server=https.createServer({cert,key:fs.readFileSync(path.join(root,'.cache/security-051/tls-fixture/key.pem'))},(req,res)=>{
 requests.push({host:req.headers.host,url:req.url,cookie:req.headers.cookie||''});res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');
 res.end('<!doctype html><title>'+new URL(req.url,'https://fixture.test').pathname.slice(1)+'</title><h1>Local Nacre fixture</h1>');
});
server.on('upgrade',(req,socket)=>{
 requests.push({host:req.headers.host,url:req.url,cookie:req.headers.cookie||''});
 const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.on('error',()=>{});setTimeout(()=>socket.end(),40);
});
let port;
const url=(pathname,host='first.fixture.test')=>'https://'+host+':'+port+pathname;
function trust(ses){ses.setCertificateVerifyProc((request,callback)=>{let exact=false;try{exact=new crypto.X509Certificate(request.certificate.data).fingerprint256===fingerprint;}catch{}callback(exact&&['first.fixture.test','private.fixture.test','ads.fixture.test'].includes(request.hostname)?0:-3);});}
async function open(destination,privateMode=false,context={}){
 const id=await nacre.createTab('',privateMode,context),tab=nacre.tabs.get(id);assert.ok(tab);trust(tab.browserSession);
 if(destination){await nacre.navigateTab(tab,destination);await until(()=>!tab.pageView.webContents.isLoading()&&tab.pageView.webContents.getURL()===destination,'page '+destination);}return tab;
}
const chrome=()=>nacre.chrome().webContents;
const run=code=>chrome().executeJavaScript(code);
async function apiCall(method,data){if((method==="applySitePermission"||method==="applySiteCookies")&&data.documentEpoch===undefined)data={...data,documentEpoch:nacre.tabs.get(data.tabId)?.siteControlsEpoch||0};return run('window.nacre.'+method+'('+JSON.stringify(data)+')');}
async function click(selector){await run('document.querySelector('+JSON.stringify(selector)+').click()');await wait(70);}
async function capture(name,contents=chrome()){
 nacre.window().showInactive();let lastError;
 if(contents!==chrome()){
  const tab=Array.from(nacre.tabs.values()).find(item=>item.pageView.webContents===contents);
  assert.ok(tab?.pageView.getBounds().width>0,'captured native page must be visible');
  contents.debugger.attach('1.3');
  try{await wait(350);const {data}=await contents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});const file=path.join(root,'.cache/release-060',process.env.NACRE_EXPERIENCE_LABEL+'-'+name+'.png');const bytes=Buffer.from(data,'base64');assert.ok(bytes.length>1000);fs.writeFileSync(file,bytes);screenshots.push(path.relative(root,file));return;}
  finally{contents.debugger.detach();}
 }
 for(let attempt=0;attempt<3;attempt++){
  await wait(350);
  try{const bitmap=await contents.capturePage(undefined,{stayHidden:true,stayAwake:true});assert.equal(bitmap.isEmpty(),false);const file=path.join(root,'.cache/release-060',process.env.NACRE_EXPERIENCE_LABEL+'-'+name+'.png');fs.writeFileSync(file,bitmap.toPNG());screenshots.push(path.relative(root,file));return;}
  catch(error){lastError=error;if(!String(error).includes('UnknownVizError'))throw error;}
 }throw lastError;
}
async function stateFor(tab){await tab.pageView.webContents.executeJavaScript('window.__auditState=null;window.nacre.onState(value=>{window.__auditState=value;});true');nacre.sendState();let state;await until(async()=>{state=await tab.pageView.webContents.executeJavaScript('window.__auditState');return !!state;},'internal state');return state;}
async function activate(tab){await apiCall('activateTab',tab.id);await until(()=>nacre.active()?.id===tab.id,'activate tab');}
async function blockedFetch(tab){return tab.pageView.webContents.executeJavaScript('fetch('+JSON.stringify(url('/ad.js','ads.fixture.test'))+').then(()=>false,()=>true)');}
async function siteDraftChecks(){
 for(const kind of ['permission','cookies'])await record(kind+' UI edits are drafts until Apply and temporary decisions expire without persistent grants',async()=>{
  const target=await open(url('/draft-'+kind,'ads.fixture.test'));await apiCall('openSiteSettings');
  await until(()=>nacre.active()?.url==='nacre://settings/sites','draft controls');const panel=nacre.active(),page=panel.pageView.webContents;
  await until(()=>page.executeJavaScript('!!document.querySelector("#permission-notifications")'),'draft form');
  const saved=()=>JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8'));
  let passed=false;try{
   const selector=kind==='permission'?'#permission-notifications':'#site-cookie-policy';
   const value=kind==='permission'?'allow':'block-all';
   await page.executeJavaScript('const control=document.querySelector('+JSON.stringify(selector)+');control.value='+JSON.stringify(value)+';control.dispatchEvent(new Event("change"));true');
   await wait(150);
   assert.equal(saved().sitePermissions?.['ads.fixture.test']?.notifications,undefined,'editing permission mode must not persist');
   assert.equal(saved().siteCookiePolicies?.['ads.fixture.test'],undefined,'editing cookie policy must not persist');
   const scope=kind==='permission'?'#permission-notifications-scope':'#site-cookie-scope';
   await page.executeJavaScript('const duration=document.querySelector('+JSON.stringify(scope)+');duration.value="temporary";duration.dispatchEvent(new Event("change"));true');
   nacre.sendState();await wait(200);
   assert.equal(await page.executeJavaScript('document.querySelector('+JSON.stringify(selector)+').value'),value,'state updates preserve unsubmitted draft');
   await page.executeJavaScript('document.querySelector('+JSON.stringify(kind==='permission'?'#site-permission-apply-notifications':'#site-cookie-apply')+').click()');
   await until(()=>kind==='cookies'?target.cookiePolicyOverride?.policy==='block-all':target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state==="granted")'),'temporary decision applied');
   await nacre.navigateTab(target,url('/draft-expired-'+kind,'ads.fixture.test'));await until(()=>!target.pageView.webContents.isLoading(),'draft navigation');
   assert.equal(await target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state)'),'denied');
   assert.equal(target.cookiePolicyOverride,null);
   assert.equal(saved().sitePermissions?.['ads.fixture.test']?.notifications,undefined);
   assert.equal(saved().siteCookiePolicies?.['ads.fixture.test'],undefined);
   passed=true;
  }finally{if(!passed)await page.executeJavaScript('window.nacre.resetSitePermissions("ads.fixture.test")');nacre.closeTab(panel.id);nacre.closeTab(target.id);}
 });
}
async function internalReuseChecks(){
 for(const [method,destination]of [['openBookmarks','nacre://bookmarks/'],['openDownloads','nacre://downloads/']])await record(method+' reuse activates the matching workspace and exits unrelated split panes',async()=>{
  await apiCall('workspace',{action:'select',id:'personal'});await apiCall(method);
  await until(()=>nacre.active()?.url===destination,'initial internal page');const original=nacre.active();
  await apiCall('workspace',{action:'select',id:'work'});
  const left=await open(url('/reuse-left')),right=await open(url('/reuse-right'));
  await apiCall('splitView',{action:'open',peerId:left.id});assert.equal(nacre.snapshot().splitView.ids.length,2);
  await apiCall(method);await until(()=>nacre.active()?.id===original.id,'reused internal page');
  assert.equal(nacre.snapshot().workspaces.activeId,original.workspaceId);
  assert.deepEqual(nacre.snapshot().splitView.ids,[]);
  assert.ok(original.pageView.getBounds().width>0);
  assert.equal(left.pageView.getBounds().width,0);assert.equal(right.pageView.getBounds().width,0);
  nacre.closeTab(left.id);nacre.closeTab(right.id);nacre.closeTab(original.id);
 });
}
async function resetChecks(){await record('preference reset reconciles custom workspaces, split views and temporary site decisions',async()=>{
 await apiCall('workspace',{action:'create',name:'Reset workspace'});const target=await open(url('/reset-left')),peer=await open(url('/reset-right'));
 await apiCall('applySitePermission',{tabId:target.id,origin:new URL(target.url).origin,documentEpoch:target.siteControlsEpoch||0,permission:'notifications',mode:'allow',scope:'temporary'});
 await apiCall('applySiteCookies',{tabId:target.id,origin:new URL(target.url).origin,documentEpoch:target.siteControlsEpoch||0,policy:'block-all',scope:'temporary'});
 await apiCall('splitView',{action:'open',peerId:target.id});
 const {dialog}=require('electron'),original=dialog.showMessageBox;dialog.showMessageBox=async()=>({response:0});
 try{await apiCall('resetPreferences');await until(()=>nacre.settings().directMode===false,'preferences reset');await wait(100);}
 finally{dialog.showMessageBox=original;}
 assert.equal(target.workspaceId,'personal');assert.equal(peer.workspaceId,'personal');assert.deepEqual(nacre.snapshot().splitView.ids,[]);
 assert.equal(nacre.snapshot().workspaces.activeId,'personal');assert.equal(peer.pageView.getBounds().width>0,true);
 assert.equal(target.cookiePolicyOverride,null);
 assert.equal(await target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state)'),'denied');
});}
async function workspaceFailureChecks(){
 await record('failed private session setup keeps normal workspace and visible navigation target',async()=>{
  const before=await open(url('/normal-session-failure')),prototype=Object.getPrototypeOf(before.browserSession),original=prototype.setProxy;
  prototype.setProxy=async()=>{throw Error('Injected private session setup failure');};
  try{await apiCall('workspace',{action:'select',id:'private'});}finally{prototype.setProxy=original;}
  assert.equal(nacre.snapshot().workspaces.activeId,before.workspaceId);assert.equal(nacre.active(),before);assert.equal(before.pageView.getBounds().width>0,true);
 });
 await record('tab limit cannot label a persistent normal navigation target as private',async()=>{
  const target=await open(url('/normal-cap'));while(nacre.tabs.size<24)await nacre.createTab('',false);
  await activate(target);await apiCall('workspace',{action:'select',id:'private'});
  assert.equal(nacre.snapshot().workspaces.activeId,'personal');assert.equal(nacre.active(),target);assert.equal(target.private,false);assert.ok(target.pageView.getBounds().width>0);
  await apiCall('navigate',url('/normal-after-refused-private'));await until(()=>!target.pageView.webContents.isLoading(),'normal cap navigation');assert.equal(nacre.active().workspaceId,'personal');
 });
}
async function staleDocumentChecks(){for(const kind of ['permission','cookies'])await record(kind+' Apply rejects a stale document after same-origin navigation',async()=>{
 const target=await open(url('/epoch-'+kind));await apiCall('openSiteSettings');await until(()=>nacre.active()?.url==='nacre://settings/sites','epoch panel');
 const panel=nacre.active(),page=panel.pageView.webContents,{current}=await page.executeJavaScript('window.nacre.getSitePermissions()');
 const payload={tabId:target.id,origin:current.origin,documentEpoch:current.documentEpoch,scope:'temporary',...(kind==='permission'?{permission:'notifications',mode:'allow'}:{policy:'block-all'})};
 await nacre.navigateTab(target,url('/epoch-next-'+kind));await until(()=>!target.pageView.webContents.isLoading(),'epoch navigation');
 const accepted=await page.executeJavaScript('window.nacre.'+(kind==='permission'?'applySitePermission':'applySiteCookies')+'('+JSON.stringify(payload)+')');assert.equal(accepted,false);
 nacre.closeTab(panel.id);nacre.closeTab(target.id);
});}
async function homeResetChecks(){await record('home editor refuses unsafe shortcuts and resets only local home preferences',async()=>{
 await until(()=>run('!!document.querySelector("#home-shortcut-add")'),'home add tile');
 await click('#home-shortcut-add');await until(()=>run('!!document.querySelector("#home-shortcut-url")'),'shortcut form');
 await run('document.querySelector("#home-shortcut-url").value="javascript:alert(1)";document.querySelector("#home-shortcut-save").click()');
 await until(()=>run('document.querySelector(".experience-error")?.textContent.length>0'),'unsafe shortcut refused');
 assert.equal(await run('!!document.querySelector(".experience-dialog[open]")'),true);assert.equal(nacre.settings().home.shortcuts.length,0);
 await run('document.querySelector("#home-shortcut-title").value="Local";document.querySelector("#home-shortcut-url").value='+JSON.stringify(url('/reset-shortcut'))+';document.querySelector("#home-shortcut-save").click()');
 await until(()=>nacre.settings().home.shortcuts.length===1,'shortcut saved');
 await until(()=>run('!document.querySelector(".experience-dialog[open]")'),'shortcut dialog closed');
 await click('#home-customize');await until(()=>run('!!document.querySelector("#home-background")'),'home form');
 await run('document.querySelector("#home-background").value="slate";document.querySelector("#home-customize-save").click()');
 await until(()=>nacre.settings().home.background==='slate','home changes saved');
 await click('#home-customize');await until(()=>run('!!document.querySelector("#home-customize-reset")'),'home reset button');await click('#home-customize-reset');
 await until(()=>nacre.settings().home.background==='default','home reset applied');
 assert.equal(nacre.settings().home.shortcuts.length,1,'reset keeps the shortcuts the user placed');
 await apiCall('homeShortcuts',{action:'remove',index:0});await until(()=>nacre.settings().home.shortcuts.length===0,'shortcut removed');
 assert.equal(requests.length,0);const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8'));assert.deepEqual(saved.home,{version:2,background:'default',showShortcuts:true,shortcuts:[]});
 await apiCall('savePreferences',{searchEngine:'custom',customSearchUrl:url('/home-search-fixture')+'?q=%s'});
 await run('document.querySelector("#home-query").value="local search";document.querySelector("#home-search").requestSubmit()');
 await until(()=>requests.some(request=>request.url==='/home-search-fixture?q=local%20search'),'home search uses selected engine');
});}
async function midiChecks(){await record('offered MIDI system-message permission controls the real native permission query',async()=>{
 const target=await open(url('/midi'));await apiCall('openSiteSettings');await until(()=>nacre.active()?.url==='nacre://settings/sites','MIDI panel');const page=nacre.active().pageView.webContents;
 const {current}=await page.executeJavaScript('window.nacre.getSitePermissions()');const sysex=current.permissions.find(item=>item.key.toLowerCase().replaceAll('-','')==='midisysex');assert.ok(sysex);
 for(const permission of ['midi',sysex.key])assert.equal(await page.executeJavaScript('window.nacre.applySitePermission('+JSON.stringify({tabId:target.id,origin:current.origin,documentEpoch:current.documentEpoch,permission,mode:'allow',scope:'temporary'})+')'),true);
 assert.equal(await target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"midi",sysex:true}).then(value=>value.state)'),'granted');
 await nacre.navigateTab(target,url('/midi-next'));await until(()=>!target.pageView.webContents.isLoading(),'MIDI navigation');
 assert.equal(await target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"midi",sysex:true}).then(value=>value.state)'),'denied');
});}
async function resetSiteChecks(){await record('reset all normal site rules revokes every normal temporary grant and preserves private isolation',async()=>{
 const first=await open(url('/reset-rule-first')),second=await open(url('/reset-rule-second')),privateTab=await open(url('/reset-rule-private'),true);
 for(const tab of [first,second,privateTab]){
  const data={tabId:tab.id,origin:new URL(tab.url).origin,scope:'temporary'};
  assert.equal(await apiCall('applySitePermission',{...data,permission:'notifications',mode:'allow'}),true);
  assert.equal(await apiCall('applySiteCookies',{...data,policy:'block-all'}),true);
 }
 const panel=await open('nacre://settings/sites',false);
 await panel.pageView.webContents.executeJavaScript('window.nacre.resetSitePermissions("*")');await wait(100);
 for(const tab of [first,second]){
  assert.equal(await tab.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state)'),'denied');assert.equal(tab.cookiePolicyOverride,null);
 }
 assert.equal(await privateTab.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state)'),'granted');assert.equal(privateTab.cookiePolicyOverride.policy,'block-all');
});}
async function privateStateChecks(){
 const {ElectronBlocker}=require('@ghostery/adblocker-electron');nacre.setBlocker(ElectronBlocker.parse('||ads.fixture.test^'));nacre.settings().adBlockEnabled=true;
 const normal=await open(url('/normal-stats'));assert.equal(await blockedFetch(normal),true);
 const privateTab=await open(url('/private-secret','private.fixture.test'),true);assert.equal(await blockedFetch(privateTab),true);
 const dashboard=await open('nacre://protection/',false,{contextTabId:normal.id,workspaceId:normal.workspaceId});
 const state=await stateFor(dashboard);
 await record('normal internal snapshot excludes private tab identity and URLs',()=>{
  assert.equal(JSON.stringify(state).includes('/private-secret'),false);assert.equal(state.tabs.some(tab=>tab.private),false);
 });
 await record('normal dashboard statistics exclude blocked private hostnames and requests',()=>{
  assert.equal(state.settings.adBlockStats.total,1);assert.equal(Object.hasOwn(state.settings.adBlockStats.bySite,'private.fixture.test'),false);
  assert.equal(state.settings.adBlockStats.bySite['first.fixture.test'].total,1);
 });
 nacre.settings().adBlockEnabled=false;
 return {normal,privateTab,dashboard};
}
(async()=>{
 await Promise.all([app.whenReady(),new Promise(r=>server.listen(0,'127.0.0.1',r))]);port=server.address().port;
 await until(()=>nacre.tabs.size>0&&nacre.chrome(),'startup');
  trust(nacre.active().browserSession);
 await until(()=>run('!!window.nacre&&!!document.querySelector("#new-tab")'),'renderer');
 if(process.env.NACRE_EXPERIENCE_MODE==='restore'){
  await record('fresh Electron process restores normal workspace names and vertical preference',()=>{assert.equal(nacre.settings().workspaces.some(x=>x.name==='Saved workspace'),true);assert.equal(nacre.settings().verticalTabs,true);});
  await record('fresh process restores local home choices without loading shortcut sites',()=>{assert.equal(nacre.settings().home.background,'forest');assert.equal(nacre.settings().home.shortcuts.length,1);assert.equal(requests.length,0);});
  await record('fresh process restores no private tabs, URLs or selected private workspace',()=>{assert.equal(Array.from(nacre.tabs.values()).some(x=>x.private||x.url.includes('private.fixture.test')),false);const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8'));assert.notEqual(saved.activeWorkspace,'private');assert.equal(saved.workspaces.some(x=>x.id==='private'),false);assert.equal(JSON.stringify(saved).includes('private.fixture.test'),false);});
  await record('fresh process contains no grants from temporary UI decisions',()=>{assert.equal(nacre.settings().sitePermissions?.['ads.fixture.test']?.notifications,undefined);assert.equal(nacre.settings().siteCookiePolicies?.['ads.fixture.test'],undefined);});
 }else if(process.env.NACRE_EXPERIENCE_MODE==='private-state'){await privateStateChecks();}
 else if(process.env.NACRE_EXPERIENCE_MODE==='site-drafts'){await siteDraftChecks();}
 else if(process.env.NACRE_EXPERIENCE_MODE==='internal-reuse'){await internalReuseChecks();}
 else if(process.env.NACRE_EXPERIENCE_MODE==='reset'){await resetChecks();}
 else if(process.env.NACRE_EXPERIENCE_MODE==='workspace-failures'){await workspaceFailureChecks();}
 else if(process.env.NACRE_EXPERIENCE_MODE==='stale-document'){await staleDocumentChecks();}
 else if(process.env.NACRE_EXPERIENCE_MODE==='home-reset'){await homeResetChecks();}
 else if(process.env.NACRE_EXPERIENCE_MODE==='midi'){await midiChecks();}
 else if(process.env.NACRE_EXPERIENCE_MODE==='reset-sites'){await resetSiteChecks();}
 else {
  await until(()=>run('!!document.querySelector("#workspace-select")&&document.querySelector("#commands-open").textContent==="Commands and search"'),'experience catalog');
  nacre.window().setSize(1280,860);nacre.window().showInactive();
  await record('home preferences persist through real controls and shortcuts navigate without automatic remote requests',async()=>{
   await click('#home-customize');await until(()=>run('!!document.querySelector(".experience-dialog[open]")'),'home editor');
   await run('document.querySelector("#home-background").value="forest";document.querySelector("#home-shortcut-editor").value='+JSON.stringify('Local shortcut | '+url('/shortcut'))+';document.querySelector("#home-customize-save").click()');
   await until(()=>nacre.settings().home.shortcuts.length===1,'home saved');assert.equal(requests.length,0);
   const persisted=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8'));assert.equal(persisted.home.background,'forest');
   await until(()=>run('document.querySelectorAll(".home-shortcut").length===1'),'shortcut rendered');await capture('home-customized');
   await click('.home-shortcut');await until(()=>nacre.active()?.url===url('/shortcut'),'shortcut navigated');assert.equal(requests.some(r=>r.url==='/shortcut'),true);
  });
  await record('workspace CRUD and movement use real IPC while private workspace metadata stays transient',async()=>{
   const initial=nacre.active();await apiCall('workspace',{action:'create',name:'Research'});await until(()=>nacre.settings().workspaces.some(x=>x.name==='Research'),'space created');
   const space=nacre.settings().workspaces.find(x=>x.name==='Research');await apiCall('workspace',{action:'rename',id:space.id,name:'Reading'});
   await apiCall('workspace',{action:'move',id:space.id,tabId:initial.id});assert.equal(initial.workspaceId,space.id);
   await apiCall('workspace',{action:'select',id:'private'});assert.equal(nacre.active().private,true);assert.equal(nacre.active().workspaceId,'private');
   const persisted=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8'));assert.equal(persisted.workspaces.some(x=>x.id==='private'),false);assert.notEqual(persisted.activeWorkspace,'private');
   await apiCall('workspace',{action:'select',id:space.id});assert.equal(nacre.active().private,false);
   await apiCall('workspace',{action:'remove',id:space.id});assert.equal(nacre.settings().workspaces.some(x=>x.id===space.id),false);assert.equal(nacre.tabs.has(initial.id),true);
   await apiCall('workspace',{action:'create',name:'Saved workspace'});await apiCall('workspace',{action:'select',id:'personal'});
  });
  let left,right;
  await record('vertical tabs offset native page bounds and preserve tab identity',async()=>{
   left=await open(url('/left'));await apiCall('savePreferences',{verticalTabs:true});await until(()=>left.pageView.getBounds().x===232,'native sidebar offset');
   assert.equal(await run('document.querySelector("#tab-list").parentElement.id'),'workspace-sidebar');
   const other=nacre.snapshot().tabs.find(tab=>tab.id!==left.id&&tab.workspaceId===left.workspaceId);
   await run('document.querySelector("#tab-list .tab:not(.active)").focus()');chrome().sendInputEvent({type:'keyDown',keyCode:'Enter'});
   await until(()=>nacre.active()?.id===other.id,'vertical tab activation by keyboard');await activate(left);
   assert.equal(left.pageView.webContents.getURL(),url('/left'));await capture('vertical-tabs');
   await apiCall('savePreferences',{verticalTabs:false});await until(()=>left.pageView.getBounds().x===0,'horizontal native bounds');assert.equal(await run('document.querySelector("#tab-list").parentElement.classList.contains("tab-row")'),true);
   await apiCall('savePreferences',{verticalTabs:true});await until(()=>left.pageView.getBounds().x===232,'vertical restored');
  });
  await record('split view preserves independent navigation, focus identity, resizing and overlay exclusion',async()=>{
   right=await open(url('/right'));await activate(left);await apiCall('splitView',{action:'open',peerId:right.id});
   await until(()=>left.pageView.getBounds().width>0&&right.pageView.getBounds().width>0,'two visible native views');
   const a=left.pageView.getBounds(),b=right.pageView.getBounds();assert.ok(a.x+a.width<b.x);assert.equal(a.y,b.y);
   await apiCall('splitView',{action:'ratio',ratio:.65});assert.ok(left.pageView.getBounds().width>right.pageView.getBounds().width);
   right.pageView.webContents.focus();await until(()=>nacre.active().id===right.id,'native focus identifies right page');
   assert.equal(await run('document.querySelector("#address").value'),url('/right'));
   await nacre.navigateTab(right,url('/right-next'));assert.equal(left.pageView.webContents.getURL(),url('/left'));
   nacre.window().setSize(1160,820);await wait(120);assert.ok(right.pageView.getBounds().x+right.pageView.getBounds().width<=1160);
   await capture('split-view');await click('#commands-open');await until(()=>left.pageView.getBounds().width===0&&right.pageView.getBounds().width===0,'palette hides both views');
   chrome().sendInputEvent({type:'keyDown',keyCode:'Escape'});await until(()=>run('document.querySelector(".command-palette-backdrop").hidden'),'palette escape');
   await until(()=>right.pageView.getBounds().width>0,'restore split after palette');
   const privateTab=await open(url('/mixed-private','private.fixture.test'),true);await activate(left);assert.equal(await apiCall('splitView',{action:'open',peerId:privateTab.id}),false);
  });
  await record('command palette searches actual tabs and keyboard execution activates the selected result',async()=>{
   left.pageView.webContents.sendInputEvent({type:'keyDown',keyCode:'K',modifiers:['control']});await until(()=>run('document.querySelector(".command-palette-backdrop").hidden===false'),'native Ctrl+K palette');await run('const input=document.querySelector(".command-palette-input");input.value="right-next";input.dispatchEvent(new Event("input",{bubbles:true}))');
   await until(()=>run('document.querySelectorAll(".command-palette-option").length===1'),'filtered result');
   chrome().sendInputEvent({type:'keyDown',keyCode:'Enter'});await until(()=>nacre.active()?.id===right.id,'palette selected tab');
   assert.equal(await run('document.querySelector(".command-palette-input").value'),'');
  });
  await record('switching workspaces exits split view and closing a peer preserves the other page',async()=>{
   await activate(left);await apiCall('splitView',{action:'open',peerId:right.id});await apiCall('workspace',{action:'select',id:'work'});
   assert.equal(left.pageView.getBounds().width,0);assert.equal(right.pageView.getBounds().width,0);assert.deepEqual(nacre.snapshot().splitView.ids,[]);
   await activate(left);await apiCall('splitView',{action:'open',peerId:right.id});nacre.closeTab(right.id);assert.equal(nacre.tabs.has(left.id),true);assert.equal(nacre.tabs.has(right.id),false);assert.ok(left.pageView.getBounds().width>500);assert.deepEqual(nacre.snapshot().splitView.ids,[]);
  });
  await siteDraftChecks();
  await internalReuseChecks();
  await staleDocumentChecks();
  await record('site permission controls enforce temporary grants, navigation expiry, persistence and stale-origin refusal',async()=>{
   const target=await open(url('/permission'));await apiCall('openSiteSettings');
   await until(()=>nacre.active()?.url==='nacre://settings/sites','permissions tab');const panel=nacre.active(),page=panel.pageView.webContents;
   let info=await page.executeJavaScript('window.nacre.getSitePermissions()');assert.equal(info.current.tabId,target.id);assert.equal(info.current.permissions.find(x=>x.key==='notifications').mode,'deny');
   const payload={tabId:target.id,origin:new URL(target.url).origin,documentEpoch:target.siteControlsEpoch||0,permission:'notifications',mode:'allow',scope:'temporary'};
   assert.equal(await page.executeJavaScript('window.nacre.applySitePermission('+JSON.stringify(payload)+')'),true);
   assert.equal(await target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state)'),'granted');
   await target.pageView.webContents.executeJavaScript('document.cookie="site_header_cookie=1;Path=/;Secure;SameSite=None"');
   await page.executeJavaScript('document.querySelector("#site-cookie-scope").value="temporary";document.querySelector("#site-cookie-policy").value="block-all";document.querySelector("#site-cookie-apply").click()');
   await until(()=>target.cookiePolicyOverride?.policy==='block-all','site cookie control applied');
   await target.pageView.webContents.executeJavaScript('fetch("/cookie-scope-blocked",{credentials:"include"}).then(r=>r.text())');assert.equal(requests.find(x=>x.url==='/cookie-scope-blocked').cookie,'');
   await target.pageView.webContents.executeJavaScript('new Promise(resolve=>{const ws=new WebSocket(location.origin.replace("https:","wss:")+"/cookie-ws-blocked");ws.onopen=()=>{ws.close();resolve(true)};ws.onerror=()=>resolve(false)})');assert.equal(requests.find(x=>x.url==='/cookie-ws-blocked').cookie,'');
   await nacre.navigateTab(target,url('/cookie-after-navigation'));await until(()=>!target.pageView.webContents.isLoading(),'cookie navigation');
   await target.pageView.webContents.executeJavaScript('fetch("/cookie-scope-allowed",{credentials:"include"}).then(r=>r.text())');assert.match(requests.find(x=>x.url==='/cookie-scope-allowed').cookie,/site_header_cookie=1/);
   const cookiePayload={tabId:target.id,origin:new URL(target.url).origin,documentEpoch:target.siteControlsEpoch||0,policy:'block-all',scope:'persistent'};assert.equal(await page.executeJavaScript('window.nacre.applySiteCookies('+JSON.stringify(cookiePayload)+')'),true);
   assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8')).siteCookiePolicies['first.fixture.test'],'block-all');
   cookiePayload.policy='default';assert.equal(await page.executeJavaScript('window.nacre.applySiteCookies('+JSON.stringify(cookiePayload)+')'),true);
   assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8')).sitePermissions).includes('notifications'),false);
   await nacre.navigateTab(target,url('/permission-next'));await until(()=>!target.pageView.webContents.isLoading(),'permission navigation');
   assert.equal(await target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state)'),'denied');
   payload.scope='persistent';payload.documentEpoch=target.siteControlsEpoch||0;assert.equal(await page.executeJavaScript('window.nacre.applySitePermission('+JSON.stringify(payload)+')'),true);
   assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8')).sitePermissions['first.fixture.test'].notifications,'allow');
   payload.origin='https://different.fixture.test';payload.mode='deny';assert.equal(await page.executeJavaScript('window.nacre.applySitePermission('+JSON.stringify(payload)+')'),false);
   assert.equal(await target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state)'),'granted');
  });
  await privateStateChecks();
  await record('private permission changes never persist and normal pages cannot target an unrelated private tab',async()=>{
   const target=await open(url('/private-permission','private.fixture.test'),true);await apiCall('openSiteSettings');await until(()=>nacre.active()?.url==='nacre://settings/sites','private permissions');
   const panel=nacre.active(),wc=panel.pageView.webContents;const data=await wc.executeJavaScript('window.nacre.getSitePermissions()');assert.equal(data.private,true);assert.equal(data.current.tabId,target.id);
   const payload={tabId:target.id,origin:new URL(target.url).origin,documentEpoch:target.siteControlsEpoch||0,permission:'notifications',mode:'allow',scope:'persistent'};
   assert.equal(await wc.executeJavaScript('window.nacre.applySitePermission('+JSON.stringify(payload)+')'),true);
   assert.equal(await target.pageView.webContents.executeJavaScript('navigator.permissions.query({name:"notifications"}).then(x=>x.state)'),'granted');
   await target.pageView.webContents.executeJavaScript('document.cookie="private_header_cookie=1;Path=/;Secure;SameSite=None"');
   const cookiePayload={tabId:target.id,origin:new URL(target.url).origin,documentEpoch:target.siteControlsEpoch||0,policy:'block-all',scope:'persistent'};
   assert.equal(await wc.executeJavaScript('window.nacre.applySiteCookies('+JSON.stringify(cookiePayload)+')'),true);
   await target.pageView.webContents.executeJavaScript('fetch("/private-cookie-blocked",{credentials:"include"}).then(r=>r.text())');assert.equal(requests.find(x=>x.url==='/private-cookie-blocked').cookie,'');
   assert.match(await target.pageView.webContents.executeJavaScript('document.cookie'),/private_header_cookie=1/,'native JavaScript cookie limitation remains explicit');
   await apiCall('savePreferences',{theme:'light'});await wait(80);assert.equal(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8').includes('private.fixture.test'),false);
   const normalPanel=await open('nacre://settings/sites',false);assert.equal(await normalPanel.pageView.webContents.executeJavaScript('window.nacre.applySitePermission('+JSON.stringify({...payload,mode:'deny'})+')'),false);
   assert.equal(await normalPanel.pageView.webContents.executeJavaScript('window.nacre.applySiteCookies('+JSON.stringify(cookiePayload)+')'),false);
  });
  await record('dashboard renders real route, known limits and counters in all four active languages',async()=>{
   const panel=await open('nacre://protection/',false);for(const language of ['en','fr','de','es']){
    await apiCall('savePreferences',{language});await until(()=>panel.pageView.webContents.executeJavaScript('document.documentElement.lang==='+JSON.stringify(language)),'dashboard '+language);
    assert.equal(await panel.pageView.webContents.executeJavaScript('document.body.textContent.includes("dashboard.")'),false);
   }await activate(panel);await apiCall('savePreferences',{language:'en',theme:'dark'});await until(()=>panel.pageView.webContents.executeJavaScript('document.documentElement.dataset.theme==="dark"'),'dashboard dark theme');await capture('dashboard-dark',panel.pageView.webContents);
   await apiCall('savePreferences',{theme:'light'});await until(()=>panel.pageView.webContents.executeJavaScript('document.documentElement.dataset.theme==="light"'),'dashboard light theme');await capture('dashboard-light',panel.pageView.webContents);
   assert.equal(await panel.pageView.webContents.executeJavaScript('document.querySelector("#total").textContent'),'1');
   const privateTotals=Array.from(nacre.tabs.values()).filter(tab=>tab.private).map(tab=>[tab.id,tab.privateStats.total]);
   await panel.pageView.webContents.executeJavaScript('document.querySelector("#clear").click()');
   await until(()=>panel.pageView.webContents.executeJavaScript('document.querySelector("#total").textContent==="0"&&!document.querySelector("#clear").disabled'),'dashboard confirmed clear');
   assert.equal(nacre.snapshot().settings.adBlockStats.total,0);
   assert.deepEqual(Array.from(nacre.tabs.values()).filter(tab=>tab.private).map(tab=>[tab.id,tab.privateStats.total]),privateTotals);
  });
 }
 console.log(JSON.stringify({electron:process.versions.electron,chromium:process.versions.chrome,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),results,requests,consoleErrors:errors,screenshots},null,2));
 server.closeAllConnections();server.close();app.exit(results.some(x=>x.status==='FAIL')?1:0);
})().catch(error=>{console.error(error.stack||error);console.error(JSON.stringify({results,requests,consoleErrors:errors},null,2));server.closeAllConnections();server.close();app.exit(2);});
