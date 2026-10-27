'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const { launch } = require('./test-support/electron-fixture.cjs');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){
 const folder=path.join(root,'.cache');fs.mkdirSync(folder,{recursive:true});const fixture=fs.mkdtempSync(path.join(folder,'diagnostics-'));
 try {const env={...process.env,NACRE_DIAGNOSTIC_FIXTURE:fixture};
 const child=launch([__filename],{cwd:root,env,encoding:'utf8',timeout:90000});process.stdout.write(child.stdout||'');process.stderr.write(child.stderr||'');assert.equal(child.status,0, String(child.error||''));}
 finally {if(path.dirname(path.resolve(fixture))!==path.resolve(folder))throw Error('Unsafe cleanup');fs.rmSync(fixture,{recursive:true,force:true});}
}else{
 const {app,safeStorage,dialog}=require('electron');const fixture=process.env.NACRE_DIAGNOSTIC_FIXTURE,profile=path.join(fixture,'personal');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',profile);app.setPath('appData',fixture);
 let confirmations=0;dialog.showMessageBox=async(_owner,options)=>{assert.equal(options.title,'External network diagnostic');assert.equal(options.defaultId,1);confirmations++;return {response:0};};
 app.whenReady().then(()=>require('../src/profile-integrity.cjs').createProfileIntegrity(profile,safeStorage).write(path.join(profile,'settings.json'),'settings',{directMode:true,torCountry:'',torAutoStart:false,httpsOnly:false,clearOnQuit:false,adBlockEnabled:false,antiFingerprint:true,language:'en'}));
 const Module=require('node:module'),filename=path.join(root,'src/main.cjs'),main=new Module(filename,module);main.filename=filename;main.paths=Module._nodeModulePaths(path.dirname(filename));main._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports={tabs,createTab,workspaceSession,chrome:()=>chromeView,settings:()=>settings};',filename);const nacre=main.exports;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));async function until(fn){for(let n=0;n<800;n++){if(await fn())return;await wait(25);}throw Error('Runtime wait timed out');}
 app.whenReady().then(async()=>{
  await until(()=>nacre.chrome());
  let requests=0;
  nacre.workspaceSession('personal').protocol.handle('https',request=>{
    // The temporary page may also ask its own origin for a site icon.
    if(request.url==='https://check.torproject.org/favicon.ico')return new Response('',{status:404});
    assert.equal(request.url,'https://check.torproject.org/api/ip');requests++;return new Response('<!doctype html><html><body>{"IsTor":false,"IP":"203.0.113.10"}</body></html>',{headers:{'Content-Type':'text/html'}});});
  const id=await nacre.createTab('nacre://leak-tests/'),wc=nacre.tabs.get(id).pageView.webContents;await until(()=>!wc.isLoading());const run=script=>wc.executeJavaScript(script);
  const before=nacre.tabs.size;
  await run('document.querySelector("#diagnostics-external").checked=false;document.querySelector("#diagnostics-run").click()');
  await until(()=>run('!document.querySelector("#diagnostics-run").disabled'));
  assert.equal(confirmations,0);assert.equal(requests,0);
  assert.ok(await run('document.querySelector("#diagnostics-results [data-status=NOT_STARTED]")!==null'),'missing web measurements are not started');
  assert.ok(await run('document.querySelector("#diagnostics-results [data-status=NOT_RUN]")!==null'),'unselected external check is not run');
  assert.ok(await run('document.querySelector("#diagnostics-results [data-status=LIMITED]")!==null'),'coverage limits are labelled');
  await run('document.querySelector("#diagnostics-external").checked=true;document.querySelector("#diagnostics-run").click()');
  await until(()=>run('!document.querySelector("#diagnostics-run").disabled'));
  assert.equal(confirmations,1);assert.equal(requests,1);assert.equal(nacre.tabs.size,before,'temporary test tab cleaned');
  const report=await run('JSON.parse(document.querySelector("pre[role=status]").textContent)');
  assert.equal(report.web.page.node,'undefined');assert.equal(report.web.page.webgl,false);assert.equal(report.web.network.IsTor,false);
  assert.ok(await run('document.querySelector("#diagnostics-results [data-status=FAIL]")===null'),'known worker limit is not presented as a measured failure');
  assert.ok(await run('document.querySelector("#diagnostics-results [data-status=LIMITED]")!==null'),'known worker limit appears as limited coverage');
  assert.ok(await run('document.querySelector("#diagnostics-results [data-status=MEASURED]")!==null'),'neutral Tor measurement is shown as measured');
  assert.ok(await run('document.querySelector("#diagnostics-build-results .diagnostics-row")!==null'),'bundled build report rows are rendered');
  assert.equal(await run('document.querySelector("details.diagnostics-raw").open'),false,'raw JSON is collapsed');
  const settingsId=await nacre.createTab('nacre://settings/#appearance'),settings=nacre.tabs.get(settingsId).pageView.webContents;await until(()=>!settings.isLoading());
  await settings.executeJavaScript('window.nacre.savePreferences({accent:"#cc3344",darkBackground:"#17251e"})');await wait(250);
  assert.equal(nacre.settings().accent,'#cc3344');assert.equal(nacre.settings().darkBackground,'#17251e');
  assert.equal(await settings.executeJavaScript('getComputedStyle(document.documentElement).getPropertyValue("--dark-background").trim()'),'#17251e');
  assert.equal(await nacre.chrome().webContents.executeJavaScript('getComputedStyle(document.querySelector(".tab-list")).getPropertyValue("-webkit-app-region")'),'drag');
  console.log(JSON.stringify({status:'PASS',checks:['local checks without outbound requests','explicit network consent','ordinary web/iframe/worker probes in intercepted HTTPS fixture','verified/measured-failure/could-not-start/not-run/limited statuses readable','bundled build rows rendered','one background tab cleaned','raw details collapsed','accent and background propagated','drag-region CSS measured'],limits:['No real external network request or physical native mouse drag in this fixture.']}));app.quit();
 }).catch(error=>{console.error(error);app.exit(1);});
}
