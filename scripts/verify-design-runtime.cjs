'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=process.env.NACRE_DESIGN_ROOT||path.resolve(__dirname,'..'),out=path.join(root,'.cache/design-090/qa');
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const temporaryRoot=path.resolve(os.tmpdir()),profile=fs.mkdtempSync(path.join(temporaryRoot,'na-design-'));
 const env={...process.env,NACRE_DESIGN_ROOT:root,NACRE_DESIGN_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 try{const child=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});process.stdout.write(child.stdout||'');process.stderr.write(child.stderr||'');if(child.error)console.error(child.error);process.exitCode=child.status??1;}
 finally{if(path.dirname(path.resolve(profile))!==temporaryRoot||!path.basename(profile).startsWith('na-design-'))throw Error('Unsafe cleanup');fs.rmSync(profile,{recursive:true,force:true});}
}else{
 const {app,BrowserWindow,safeStorage}=require('electron'),assert=require('node:assert/strict'),Module=require('node:module');
 const profile=process.env.NACRE_DESIGN_PROFILE,errors=[],checks=[];
 app.setPath('userData',profile);app.setPath('appData',profile);app.setPath('sessionData',path.join(profile,'session'));
 app.on('web-contents-created',(_event,wc)=>{wc.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});});
 app.whenReady().then(()=>require(path.join(root,'src/profile-integrity.cjs')).createProfileIntegrity(profile,safeStorage).write(path.join(profile,'settings.json'),'settings',{
  directMode:true,torCountry:'',torAutoStart:false,httpsOnly:false,clearOnQuit:false,adBlockEnabled:false,antiFingerprint:false,language:'en',theme:'light',suspendInactiveTabs:false
 }));
 const filename=path.join(root,'src/main.cjs'),main=new Module(filename,module);main.filename=filename;main.paths=Module._nodeModulePaths(path.dirname(filename));
 main._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports={tabs,createTab,closeTab,activateTab,sendState,chrome:()=>chromeView,window:()=>win,settings:()=>settings,active:()=>activeTab(),overlay:()=>expandedOverlay};',filename);
 const nacre=main.exports,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function until(check,label){for(let n=0;n<300;n++){if(await check())return;await wait(25);}throw Error('Timeout '+label);}
 const chrome=()=>nacre.chrome().webContents,run=source=>chrome().executeJavaScript(source);
 const api=(name,arg)=>run('window.nacre.'+name+'('+JSON.stringify(arg)+')');
 async function capture(name,wc=chrome()){
  nacre.window().focus();wc.focus();
  if(name==='browser-menu-light'){
   // Native CopyFromSurface can return the preceding chrome frame on Windows.
   // Capture this transient overlay from the live renderer instead.
   try{wc.debugger.attach('1.3');const shot=await wc.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));return;}
   finally{if(wc.debugger.isAttached())wc.debugger.detach();}
  }
  let lastError;
  for(let attempt=0;attempt<5;attempt++){
   await wait(300);
   try{fs.writeFileSync(path.join(out,name+'.png'),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());return;}
   catch(error){lastError=error;}
  }
  // Test-only DevTools screenshot fallback for Windows views which have no
  // native CopyFromSurface handle. It captures the same live page and does
  // not inject code or change the production debugger configuration.
  try{
   wc.debugger.attach('1.3');
   const shot=await wc.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:false});
   fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));
   checks.push('DevTools view screenshot fallback: '+name);return;
  }catch(error){lastError=error;}finally{if(wc.debugger.isAttached())wc.debugger.detach();}
  throw new Error('Capture '+name+' failed: '+lastError+' '+JSON.stringify({overlay:nacre.overlay(),active:nacre.active()?.id,tabs:[...nacre.tabs.values()].map(tab=>({id:tab.id,url:tab.url,bounds:tab.pageView?.getBounds()}))}));
 }
 async function settingsPage(){const id=await nacre.createTab('nacre://settings/');const tab=nacre.tabs.get(id);await until(()=>!tab.pageView.webContents.isLoading(),'settings load');nacre.window().setSize(1279,820);await wait(100);nacre.window().setSize(1280,820);return tab.pageView.webContents;}
 async function theme(value){await api('savePreferences',{theme:value});await until(()=>run('document.documentElement.dataset.theme==='+JSON.stringify(value)),'theme '+value);}
 const categories=['start','appearance','search','privacy','adblock','phishing','network','downloads','profile','about'];
 const timeout=setTimeout(()=>{console.error('Design fixture timeout');app.exit(9);},165000);timeout.unref();
 app.whenReady().then(async()=>{
  await until(()=>nacre.chrome()&&nacre.tabs.size,'startup');nacre.window().setSize(1280,820);nacre.window().show();nacre.window().focus();chrome().focus();
  await until(()=>run('!!document.querySelector(".tab")'),'tab');
  if(process.env.NACRE_DIAGNOSTICS_ONLY==='1'){
   const id=await nacre.createTab('nacre://leak-tests/#run');const wc=nacre.tabs.get(id).pageView.webContents;
   await until(async()=>{try{return await wc.executeJavaScript('document.querySelector("pre[role=status]")?.textContent.includes("DEVELOPMENT_ONLY")');}catch{return false;}},'diagnostic completion');
   const report=await wc.executeJavaScript('JSON.parse(document.querySelector("pre[role=status]").textContent)');
   assert.equal(report.checks.page.status,'MEASURED');assert.equal(report.checks.page.result.javascript,true);assert.equal(report.checks.page.result.webgl,false);assert.equal(report.checks.page.result.process,'undefined');
   fs.writeFileSync(path.join(out,'diagnostics.json'),JSON.stringify(report,null,2));console.log('DIAGNOSTICS PASS');app.exit(0);return;
  }
  await capture('home-light');
  assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
  checks.push('new tab and native-sized toolbar render without horizontal overflow');
  await run('document.querySelector("#browser-menu-button").focus();document.querySelector("#browser-menu-button").click()');
  await until(()=>run('!document.querySelector("#browser-menu").hidden'),'browser menu');
  assert.ok(await run('document.querySelector("#browser-menu").getBoundingClientRect().bottom<=innerHeight'),'menu fits window');
  await capture('browser-menu-light');
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
  assert.ok(await run('document.querySelector("#browser-menu").contains(document.activeElement)'));
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await until(()=>run('document.querySelector("#browser-menu").hidden'),'menu Escape');
  assert.equal(await run('document.activeElement.id'),'browser-menu-button');
  checks.push('main menu opens, fits viewport, supports keyboard navigation and restores focus');
  const server=require('node:http').createServer((_req,res)=>res.end('<title>Design fixture</title><h1>Local browser page</h1>'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const webId=await nacre.createTab('http://127.0.0.1:'+server.address().port+'/');
  await until(()=>!nacre.tabs.get(webId).pageView.webContents.isLoading(),'local web page');
  await run('document.querySelector("#browser-menu-button").focus();document.querySelector("#browser-menu-button").click()');
  await until(()=>nacre.tabs.get(webId).pageView.getBounds().width===0,'native menu overlay');
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await until(()=>nacre.tabs.get(webId).pageView.getBounds().width>800,'native page restoration');
  nacre.closeTab(webId,{discard:true});server.close();
  checks.push('main menu native view expands over a web page and restores the toolbar bounds');
  const settings=await settingsPage();
  const actual=await settings.executeJavaScript('[...document.querySelectorAll(".group")].map(node=>node.id)');
  for(const id of categories)assert.ok(actual.includes(id),'Missing category '+id);
  for(const id of categories){
   await settings.executeJavaScript('document.querySelector('+JSON.stringify('aside a[href="#'+id+'"]')+').click()');
   await until(()=>settings.executeJavaScript('!document.querySelector('+JSON.stringify('#'+id)+').hidden'),'category '+id);
   assert.equal(await settings.executeJavaScript('document.querySelectorAll(".group:not([hidden])").length'),1,id+' one section');
  }
  checks.push('all ten settings categories selectable with one visible section');
  await settings.executeJavaScript('location.hash="privacy"');await until(()=>settings.executeJavaScript('!document.querySelector("#privacy").hidden'),'deep link');
  await capture('settings-privacy-light',settings);
  await settings.executeJavaScript('location.hash="appearance"');await until(()=>settings.executeJavaScript('!document.querySelector("#appearance").hidden'),'appearance');
  await settings.executeJavaScript('history.back()');await until(()=>settings.executeJavaScript('!document.querySelector("#privacy").hidden'),'history back');
  await settings.executeJavaScript('history.forward()');await until(()=>settings.executeJavaScript('!document.querySelector("#appearance").hidden'),'history forward');
  checks.push('settings hash navigation and back/forward');
  await settings.executeJavaScript('{const q=document.querySelector("#find-setting");q.value="cookies";q.dispatchEvent(new Event("input"));}');
  assert.ok(await settings.executeJavaScript('document.querySelectorAll(".group:not([hidden])").length>0'));
  await capture('settings-search-light',settings);
  await settings.executeJavaScript('{const q=document.querySelector("#find-setting");q.value="zzzyxq-no-match-4319";q.dispatchEvent(new Event("input"));}');
  assert.equal(await settings.executeJavaScript('document.querySelectorAll(".group:not([hidden])").length'),0);
  assert.equal(await settings.executeJavaScript('document.querySelector("#settings-empty").hidden'),false);
  await settings.executeJavaScript('{const q=document.querySelector("#find-setting");q.value="";q.dispatchEvent(new Event("input"));}');
  assert.equal(await settings.executeJavaScript('document.querySelectorAll(".group:not([hidden])").length'),1);
  checks.push('cross-category settings search, no-results and clear');
  const {SUPPORTED_LANGUAGES}=require(path.join(root,'src/i18n.cjs'));
  for(const language of SUPPORTED_LANGUAGES){
   await api('savePreferences',{language});
   await until(()=>settings.executeJavaScript('document.documentElement.lang==='+JSON.stringify(language)),'settings language '+language);
   assert.equal(await settings.executeJavaScript('document.querySelectorAll('+JSON.stringify('aside a[href^="#"]')+').length'),10,language);
   assert.equal(await settings.executeJavaScript('document.documentElement.dir'),['ar','fa','he','ur'].includes(language)?'rtl':'ltr');
  }
  checks.push('settings navigation present and localized in all ' + SUPPORTED_LANGUAGES.length + ' catalogues with RTL');
  await api('savePreferences',{language:'fr'});await theme('dark');await settings.executeJavaScript('location.hash="adblock"');
  await until(()=>settings.executeJavaScript('!document.querySelector("#adblock").hidden'),'adblock');await capture('settings-adblock-dark-fr',settings);
  await api('savePreferences',{language:'ar',fontSize:24});nacre.window().setSize(980,760);
  await until(()=>settings.executeJavaScript('document.documentElement.lang==="ar"'),'Arabic');
  assert.equal(await settings.executeJavaScript('document.documentElement.scrollWidth>innerWidth'),false,'RTL settings overflow');
  await capture('settings-rtl-large',settings);
  await api('savePreferences',{language:'en',fontSize:16});await theme('dark');
  await until(()=>run('document.documentElement.lang==="en"'),'English chrome restored');
  const homeId=await nacre.createTab('');
  await until(()=>run('state.activeId==='+homeId+'&&!document.querySelector("#home").hidden'),'new tab home');await capture('home-dark');
  const privateId=await nacre.createTab('',true);
  await until(()=>run('state.activeId==='+privateId+'&&!document.querySelector("#home").hidden'),'private home');await capture('private-dark');
  assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false,'compact chrome overflow');
  checks.push('light/dark, private mode, RTL and 980px large-text layout');
  assert.deepEqual(errors,[]);const report={status:'PASS',version:require(path.join(root,'package.json')).version,checks,rendererErrors:errors,screenshots:out};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
 }).catch(error=>{console.error(error.stack||error);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'FAIL',error:error.stack||String(error),checks,errors},null,2));if(!process.env.NACRE_DESIGN_KEEP_OPEN)app.exit(1);});
}
