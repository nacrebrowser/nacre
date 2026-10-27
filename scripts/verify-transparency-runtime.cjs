'use strict';
// Actual Electron interception and internal UI, disposable profile, no visible
// windows or host clipboard changes. Requests stay on a local fixture server.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.env.NACRE_TRANSPARENCY_ROOT||path.resolve(__dirname,'..'),out=path.join(root,'.cache/transparency-runtime');fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const profile=fs.mkdtempSync(path.join(out,'profile-')),entry=path.join(profile,'verify.cjs');fs.copyFileSync(__filename,entry);
 const env={...process.env,NACRE_TRANSPARENCY_ROOT:root,NACRE_TRANSPARENCY_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(require('electron'),[entry],{env,windowsHide:true,encoding:'utf8',timeout:120000});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
}
const assert=require('node:assert/strict'),http=require('node:http'),Module=require('node:module');
const {app,BrowserWindow,safeStorage,clipboard}=require('electron'),profile=process.env.NACRE_TRANSPARENCY_PROFILE;
app.setPath('userData',profile);app.setPath('appData',profile);app.setPath('sessionData',path.join(profile,'session'));BrowserWindow.prototype.show=function(){};
const copied=[];clipboard.writeText=value=>copied.push(value);
app.whenReady().then(()=>require(path.join(root,'src/profile-integrity.cjs')).createProfileIntegrity(profile,safeStorage).write(path.join(profile,'settings.json'),'settings',{directMode:true,torCountry:'',httpsOnly:false,clearOnQuit:true,adBlockEnabled:false,antiFingerprint:false,cookiePolicy:'block-all',language:'en'}));
const filename=path.join(root,'src/main.cjs'),main=new Module(filename,module);main.filename=filename;main.paths=Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports={tabs,createTab,closeTab,activateTab,sendState,chrome:()=>chromeView,activity:protectionActivity,internalSnapshot,setFixtureEngine:engine=>{blocker=engine;settings.adBlockEnabled=true;settings.adBlockMode="comfort";settings.adBlockExceptions=[];}};',filename);
const nacre=main.exports,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<240;i++){if(await fn())return;await wait(30);}throw Error('Timeout '+label);}
const hits=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');hits.push(url.pathname);
 res.setHeader('content-type','text/html');
 if(url.pathname==='/pixel'||url.pathname==='/private-pixel'){
  const name=url.pathname==='/private-pixel'?'private_one':'_ga';res.setHeader('Set-Cookie',name+'=SECRET_COOKIE_VALUE; Path=/; Max-Age=3600');res.end('<!doctype html><title>Cookie fixture</title>');return;
 }
 if(url.pathname==='/private-one'){res.end('<!doctype html><title>Private one</title><iframe src="/private-pixel"></iframe>');return;}
 if(url.pathname==='/private-two'){res.setHeader('Set-Cookie','_fbp=PRIVATE_TWO_SECRET; Path=/');res.end('<!doctype html><title>Private two</title>');return;}
 if(url.pathname==='/fixture')res.end('<!doctype html><title>Transparency fixture</title><iframe src="/pixel"></iframe><img src="/blocked?token=REQ_SECRET"><img src="/redirect"><script>fetch("/except?token=REQ_SECRET");fetch("/rewrite?token=REQ_SECRET");</script>');
 else res.end('<!doctype html><title>Allowed fixture</title>');
});
async function run(){
 await app.whenReady();await until(()=>nacre.tabs.size>0,'startup');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 nacre.setFixtureEngine({match(request){
  const url=new URL(request.url),filter=id=>({getId:()=>id});
  if(url.pathname==='/blocked')return {match:true,filter:filter(41)};
  if(url.pathname==='/redirect')return {match:true,filter:filter(42),redirect:{dataUrl:'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}};
  if(url.pathname==='/rewrite')return {match:false,filter:filter(43),rewrite:{url:origin+'/rewritten'}};
  if(url.pathname==='/except')return {match:false,exception:filter(44)};
  return {match:false};
 }});
 const sourceId=await nacre.createTab(origin+'/fixture?NAV_SECRET');
 await until(()=>['request-blocked','request-allowed','request-redirected','request-rewritten','cookie-set-blocked'].every(action=>nacre.activity.snapshot().entries.some(e=>e.action===action)),'actual decisions');
 await until(()=>hits.includes('/except')&&hits.includes('/rewritten'),'allowed and rewritten server requests');
 assert.equal(hits.includes('/blocked'),false);assert.equal(hits.includes('/redirect'),false);
 const observed=nacre.activity.snapshot();assert.doesNotMatch(JSON.stringify(observed),/SECRET/);
 assert.equal(observed.entries.find(e=>e.action==='request-blocked').ruleId,'f-00000029');assert.equal(observed.entries.find(e=>e.action==='request-allowed').reason,'filter-exception');
 const id=await nacre.createTab('nacre://protection/',false,{contextTabId:sourceId}),wc=nacre.tabs.get(id).pageView.webContents,chrome=nacre.chrome().webContents;
 await until(()=>!wc.isLoading()&&wc.executeJavaScript('document.querySelectorAll(".activity-row").length>=5'),'dashboard');
 await wc.executeJavaScript('document.querySelector("#activity-decision").value="allowed";document.querySelector("#activity-decision").dispatchEvent(new Event("change"));');
 assert.deepEqual(await wc.executeJavaScript('[...document.querySelectorAll(".activity-row")].map(e=>e.dataset.decision)'),['allowed']);
 await wc.executeJavaScript('document.querySelector("#activity-decision").value="all";document.querySelector("#activity-decision").dispatchEvent(new Event("change"));document.querySelector("#activity-search").value="f-00000029";document.querySelector("#activity-search").dispatchEvent(new Event("input"));document.querySelector(".activity-details").open=true;');
 assert.equal(await wc.executeJavaScript('document.querySelectorAll(".activity-row").length'),1);
 assert.match(await wc.executeJavaScript('document.querySelector(".activity-detail-body").textContent'),/Matched a loaded filter/);
 nacre.sendState();await wait(100);assert.equal(await wc.executeJavaScript('document.querySelector(".activity-details").open'),true);
 const disclosure=await wc.executeJavaScript('({note:document.querySelector("#transparency-report-note").textContent,describedBy:document.querySelector("#copy-transparency-report").getAttribute("aria-describedby"),visible:document.querySelectorAll(".activity-row").length})');
 assert.match(disclosure.note,/all retained entries/);assert.match(disclosure.note,/filters or pagination/);assert.equal(disclosure.describedBy,'transparency-report-note');assert.equal(disclosure.visible,1);
 await wc.executeJavaScript('document.querySelector("#copy-transparency-report").click()');
 await until(()=>copied.length>0,'copy report');let report=JSON.parse(copied.at(-1));assert.equal(report.scope,'normal');assert.doesNotMatch(JSON.stringify(report),/SECRET/);assert.ok(report.entries.some(e=>e.basis==='signature'&&e.company==='Google'));assert.equal(report.entries.length,observed.entries.length);assert.ok(report.entries.length>disclosure.visible);
 await wc.executeJavaScript('document.querySelector("#activity-search").value="";document.querySelector("#activity-search").dispatchEvent(new Event("input"))');
 const locales=[];
 for(const language of ['en','fr','ja','ar']){
  await chrome.executeJavaScript('window.nacre.savePreferences('+JSON.stringify({language})+')');
  const expected=require(path.join(root,'src/i18n.cjs')).t('transparency.title',language);
  await until(()=>wc.executeJavaScript('document.documentElement.lang==='+JSON.stringify(language)+'&&document.querySelector("#activity-title").textContent==='+JSON.stringify(expected)),'locale '+language);locales.push(language);
 }
 assert.equal(await wc.executeJavaScript('document.documentElement.dir'),'rtl');
 assert.equal(await wc.executeJavaScript('(()=>{const root=document.createElement("div");window.NacreProtectionActivity.render(root,{available:true,scope:"normal",entries:[{host:"<script>bad</script>",company:"<img src=x>",cookieName:"<svg>",count:1,action:"cookie-set-blocked",basis:"domain",sourceUrl:"javascript:alert(1)",ruleId:"<img src=x>"}]},key=>key);return root.querySelectorAll("img,svg,script,a").length})()'),0);
 const privateOne=await nacre.createTab(origin+'/private-one',true);await until(()=>nacre.tabs.get(privateOne).privateActivity.snapshot().entries.some(e=>e.cookieName==='private_one'),'private one');
 const privateDashboard=await nacre.createTab('nacre://protection/',true,{contextTabId:privateOne}),privateWc=nacre.tabs.get(privateDashboard).pageView.webContents;await until(()=>!privateWc.isLoading(),'private dashboard');
 const privateTwo=await nacre.createTab(origin+'/private-two',true);await until(()=>nacre.tabs.get(privateTwo).privateActivity.snapshot().entries.some(e=>e.cookieName==='_fbp'),'private two');
 nacre.activateTab(id);await privateWc.executeJavaScript('window.nacre.copyTransparencyReport()');report=JSON.parse(copied.at(-1));assert.equal(report.scope,'private');assert.ok(report.entries.every(e=>e.tabId===privateOne));assert.doesNotMatch(JSON.stringify(report),/PRIVATE_TWO|_fbp|NAV_SECRET/);
 await wc.executeJavaScript('window.nacre.copyTransparencyReport()');report=JSON.parse(copied.at(-1));assert.equal(report.scope,'normal');assert.ok(report.entries.every(e=>e.tabId!==privateOne&&e.tabId!==privateTwo));
 await nacre.closeTab(privateOne);await privateWc.executeJavaScript('window.nacre.copyTransparencyReport()');assert.equal(JSON.parse(copied.at(-1)).entries.length,0);
 await nacre.closeTab(privateTwo);await nacre.closeTab(privateDashboard);
 // Controlled additional groups exercise pagination/retention; not real sites.
 for(let i=0;i<65;i++)nacre.activity.record({host:'fixture'+i+'.test',site:'fixture.test',tabId:sourceId,action:'request-blocked',reason:'filter-rule',ruleId:'f-00000029'});
 nacre.sendState();await until(()=>wc.executeJavaScript('document.querySelectorAll(".activity-row").length===50'),'initial pagination');
 await wc.executeJavaScript('document.querySelector("#activity-more").click()');assert.ok(await wc.executeJavaScript('document.querySelectorAll(".activity-row").length>50'));
 // Render the real observed fixture data offscreen; no invented site events.
 for(const language of ['en','ar']){
  const preview=new BrowserWindow({show:false,width:1250,height:1150,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true}});await preview.loadURL('nacre://protection/');
  const messages=require(path.join(root,'src/i18n.cjs')).getMessages(language),state={settings:{language,protectionActivity:observed,adBlockStats:{total:1,byType:{image:1},bySite:{}},proxy:{mode:'direct'},cookiePolicy:'block-all',adBlockEnabled:true,blockerReady:true}};
  await preview.webContents.executeJavaScript('messages='+JSON.stringify(messages)+';locale='+JSON.stringify(language)+';requestedLocale=locale;document.documentElement.lang=locale;document.documentElement.dir=locale==="ar"?"rtl":"ltr";document.querySelectorAll("[data-i18n]").forEach(el=>{if(messages[el.dataset.i18n])el.textContent=messages[el.dataset.i18n]});applyState('+JSON.stringify(state)+');document.querySelector(".activity-panel").scrollIntoView();document.querySelectorAll(".activity-details").forEach(e=>e.open=true)');await preview.webContents.executeJavaScript("document.querySelectorAll(\"[data-i18n-attr]\").forEach(e=>{for(const x of e.dataset.i18nAttr.split(\";\")){const[a,k]=x.split(\":\",2);if([\"title\",\"aria-label\",\"placeholder\"].includes(a)&&messages[k])e.setAttribute(a,messages[k])}})");await wait(120);fs.writeFileSync(path.join(out,'dashboard-'+language+'.png'),(await preview.webContents.capturePage()).toPNG());preview.destroy();
 }
 await wc.executeJavaScript('document.querySelector("#clear").click()');await until(()=>nacre.activity.snapshot().total===0,'clear');
 const result={status:'PASS',electron:process.versions.electron,locales,checks:['actual blocked/allowed/redirected/rewritten requests','server confirms block and rewrite','cookie names without values','rule identifier and reason','decision/search filters','open details preserved','sanitized report','explicit all-retained export disclosure despite active filters','unknown markup and source URL rejected','private context bound after activation changes','closed private context empty','normal/private reports isolated','pagination and clear','offscreen English/Arabic layouts'],screenshots:['dashboard-en.png','dashboard-ar.png']};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('TRANSPARENCY_RUNTIME_RESULT '+JSON.stringify(result));
}
run().then(()=>{server.close();app.exit(0)},error=>{console.error(error.stack);fs.writeFileSync(path.join(out,'failure.txt'),error.stack);server.close();app.exit(1)});
