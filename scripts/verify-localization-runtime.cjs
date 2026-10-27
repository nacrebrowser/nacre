'use strict';
// Real Electron, isolated profile and hidden windows. Does not install Nacre.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.env.NACRE_LOCALE_ROOT||path.resolve(__dirname,'..'),out=path.join(root,'.cache/localization-runtime');fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const profile=fs.mkdtempSync(path.join(out,'profile-')),entry=path.join(profile,'verify.cjs');fs.copyFileSync(__filename,entry);
 const env={...process.env,NACRE_LOCALE_ROOT:root,NACRE_LOCALE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(require('electron'),[entry],{env,windowsHide:true,encoding:'utf8',timeout:240000});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
}
const {app,BrowserWindow,safeStorage,Menu,ipcMain}=require('electron'),Module=require('node:module'),assert=require('node:assert/strict');
const profile=process.env.NACRE_LOCALE_PROFILE;app.setPath('userData',profile);app.setPath('appData',profile);app.setPath('sessionData',path.join(profile,'session'));
BrowserWindow.prototype.show=function(){};
app.whenReady().then(()=>require(path.join(root,'src/profile-integrity.cjs')).createProfileIntegrity(profile,safeStorage).write(path.join(profile,'settings.json'),'settings',{directMode:true,torCountry:'',torAutoStart:false,language:'en'}));
const file=path.join(root,'src/main.cjs'),main=new Module(file,module);main.filename=file;main.paths=Module._nodeModulePaths(path.dirname(file));
main._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports={tabs,createTab,closeTab,chrome:()=>chromeView,active:()=>activeTab(),setLanguage:language=>{settings.language=language;buildMenu();applyLayout();sendState()}};',file);
const nacre=main.exports,{SUPPORTED_LANGUAGES,getMessages}=require(path.join(root,'src/i18n.cjs'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<250;i++){if(await fn())return;await wait(20);}throw Error('Timeout '+label);}
const pages=['nacre://settings/','nacre://settings/sites','nacre://leak-tests/','nacre://tests-fuite/','nacre://downloads/','nacre://bookmarks/','nacre://shortcuts/','nacre://offline/','nacre://source/','nacre://protection/','nacre://error/'];
async function run(){
 await app.whenReady();await until(()=>nacre.tabs.size>0,'startup');
 const fixtures=[];
 for(const url of pages){const id=await nacre.createTab(url),wc=nacre.tabs.get(id).pageView.webContents;await until(()=>!wc.isLoading()&&wc.executeJavaScript('document.documentElement.lang==="en"'),'load '+url);fixtures.push({url,wc});}
 const chrome=nacre.chrome().webContents;
 const results=[],dynamic=new Set(['tor-status','tor-toggle','title','message','note','retry','code','profile-location','download-directory','versions','source-status']);
 for(const language of SUPPORTED_LANGUAGES){
  nacre.setLanguage(language);
  const messages=getMessages(language),direction=['ar','he','fa','ur'].includes(language)?'rtl':'ltr';
  await until(async()=>{for(const {wc}of fixtures)if(!await wc.executeJavaScript('document.documentElement.lang==='+JSON.stringify(language)+'&&document.documentElement.dir==='+JSON.stringify(direction)))return false;return await chrome.executeJavaScript('document.documentElement.lang==='+JSON.stringify(language));},'locale '+language);
  await wait(35);
  for(const {url,wc}of fixtures){
   const seen=await wc.executeJavaScript(`({title:document.title,lang:document.documentElement.lang,dir:document.documentElement.dir,labels:[...document.querySelectorAll('[data-i18n]')].filter(e=>!${JSON.stringify([...dynamic])}.includes(e.id)).map(e=>({key:e.dataset.i18n,text:e.textContent})),options:document.querySelector('#language')?.options.length})`);
   for(const item of seen.labels)assert.equal(item.text,messages[item.key],language+' '+url+' '+item.key);
   if(url==='nacre://settings/')assert.equal(seen.options,SUPPORTED_LANGUAGES.length);
  }
  const infoTab=nacre.active(),originalUrl=infoTab.url;infoTab.url="https://example.invalid/";
  let info;try{info=await chrome.executeJavaScript("window.nacre.getSiteInfo()");}finally{infoTab.url=originalUrl;}
  assert.equal(info.transport,messages["diagnostic.maincjs.text9802cb29e6"],language+" site information");
  assert.ok(info.permissions.includes(messages["siteControls.permission.media"]+": "),language+" site permission label");
  assert.equal(await chrome.executeJavaScript("window.nacre.localizeText(\"alpha of beta\")"),"alpha of beta",language+" unknown error");
  const bridgeFailure=await chrome.executeJavaScript('window.nacre.localizeText("Pont Snowflake sélectionné · délai dépassé. Cette cause reste indicative.")');
  assert.equal(bridgeFailure,messages['diagnostic.torBridgeFailure'].replace('{bridge}','Snowflake '+messages['diagnostic.tordiagnosticscjs.text3f8c0e1af6']).replace('{cause}',messages['diagnostic.tordiagnosticscjs.text8c69efbb42']),language+' bridge failure');
  assert.equal(await chrome.executeJavaScript('window.nacre.localizeText("GitHub a répondu avec le statut HTTP 503.")'),messages['diagnostic.githubStatus'].replace('{status}','503'),language+' update failure');
  const metricsText=await fixtures[0].wc.executeJavaScript("document.querySelector(\"#filter-status\").textContent");
  assert.ok(metricsText.includes(messages["settings.profileLocationLoading"]),language+" filter metrics");
  assert.equal(Menu.getApplicationMenu().items[0].label,messages['menu.file'],language+' native menu');
  const {promptHttpAuth}=require(path.join(root,'src/http-auth.cjs'));
  const before=new Set(BrowserWindow.getAllWindows());
  const auth=promptHttpAuth({BrowserWindow,ipcMain,contents:chrome,url:'https://example.invalid/',realm:'<img src=x onerror=alert(1)>',language});
  const prompt=BrowserWindow.getAllWindows().find(window=>!before.has(window));assert.ok(prompt);
  await until(()=>!prompt.webContents.isLoading()&&prompt.webContents.executeJavaScript('document.documentElement.lang==='+JSON.stringify(language)),'auth '+language);
  const authSeen=await prompt.webContents.executeJavaScript('({heading:document.querySelector("h1").textContent,images:document.querySelectorAll("img").length,realm:document.querySelector("#realm").textContent,dir:document.documentElement.dir})');
  assert.equal(authSeen.heading,messages['ui.httpauthhtml.text22fa074241']);assert.equal(authSeen.images,0);assert.equal(authSeen.dir,direction);
  prompt.destroy();assert.equal(await auth,null);
  results.push({language,pages:fixtures.length+1,menu:'PASS',auth:'PASS',direction});
  if(results.length%10===0)console.log('LOCALE_PROGRESS '+results.length+'/'+SUPPORTED_LANGUAGES.length);
 }
 // Render representative layouts offscreen with the real packaged CSS.
 for(const [language,url,name]of [['ar','nacre://settings/','settings-ar'],['ja','nacre://leak-tests/','leak-tests-ja'],['en','nacre://leak-tests/','leak-tests-en']]){
  const preview=new BrowserWindow({show:false,width:1250,height:1000,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true}});await preview.loadURL(url);
  await preview.webContents.executeJavaScript('document.documentElement.lang='+JSON.stringify(language)+';document.documentElement.dir='+JSON.stringify(language==='ar'?'rtl':'ltr')+';const map='+JSON.stringify(getMessages(language))+';document.querySelectorAll("[data-i18n]").forEach(e=>{if(map[e.dataset.i18n])e.textContent=map[e.dataset.i18n]});document.querySelectorAll("[data-i18n-attr]").forEach(e=>{for(const mapping of e.dataset.i18nAttr.split(";")){const[a,k]=mapping.split(":",2);if(["title","aria-label","placeholder"].includes(a)&&map[k])e.setAttribute(a,map[k])}})');
  await preview.webContents.executeJavaScript("if(document.querySelector(\"#language\"))document.querySelector(\"#language\").value="+JSON.stringify(language));await wait(100);fs.writeFileSync(path.join(out,name+'.png'),(await preview.webContents.capturePage()).toPNG());preview.destroy();
 }
 const result={status:'PASS',languages:results.length,pageChecks:results.length*(fixtures.length+1),nativeMenus:results.length,siteInfoPopups:results.length,authDialogs:results.length,results};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('LOCALIZATION_RUNTIME_RESULT '+JSON.stringify({...result,results:undefined}));
}
run().then(()=>app.exit(0),error=>{console.error(error.stack);fs.writeFileSync(path.join(out,'failure.txt'),error.stack);app.exit(1)});
