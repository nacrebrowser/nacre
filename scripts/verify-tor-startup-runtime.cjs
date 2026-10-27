'use strict';
// Runs the real startup/connect/session path in a disposable Electron profile.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.env.NACRE_TOR_TEST_ROOT||path.resolve(__dirname,'..');
if(!process.versions.electron){
 const folder=path.join(root,'.cache/tor-startup');fs.mkdirSync(folder,{recursive:true});
 const profile=fs.mkdtempSync(path.join(folder,'profile-')),entry=path.join(profile,'verify.cjs');fs.copyFileSync(__filename,entry);
 const env={...process.env,NACRE_TOR_TEST_ROOT:root,NACRE_TOR_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(require('electron'),[entry],{env,windowsHide:true,encoding:'utf8',timeout:175000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
}
const {app,BrowserWindow,safeStorage}=require('electron'),Module=require('node:module'),assert=require('node:assert/strict');
const profile=process.env.NACRE_TOR_TEST_PROFILE;
app.setPath('userData',profile);app.setPath('appData',profile);app.setPath('sessionData',path.join(profile,'session'));
BrowserWindow.prototype.show=function(){};
app.whenReady().then(()=>require(path.join(root,'src/profile-integrity.cjs')).createProfileIntegrity(profile,safeStorage).write(path.join(profile,'settings.json'),'settings',{directMode:true,torAutoStart:false,torCountry:'',language:'en'}));
const filename=path.join(root,'src/main.cjs'),main=new Module(filename,module);main.filename=filename;main.paths=Module._nodeModulePaths(path.dirname(filename));
main._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports={tabs,connectTor,closeTorRuntime,state:()=>({torRuntime,regularSession,torBootstrapPercent,torStartupError,lastTorLog})};',filename);
const nacre=main.exports,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
 await app.whenReady();for(let i=0;i<200&&!nacre.tabs.size;i++)await wait(50);
 const start=Date.now();
 try{
  await nacre.connectTor('GB');const state=nacre.state();assert.equal(state.torRuntime?.ready,true);assert.equal(state.torBootstrapPercent,100);
  const response=await state.regularSession.fetch('https://check.torproject.org/api/ip',{signal:AbortSignal.timeout(30000)});
  const result=await response.json();assert.equal(result.IsTor,true);
  console.log('TOR_STARTUP_RESULT '+JSON.stringify({status:'PASS',seconds:Math.round((Date.now()-start)/1000),bootstrap:state.torBootstrapPercent,torCheck:result.IsTor}));
 }catch(error){console.log('TOR_STARTUP_RESULT '+JSON.stringify({status:'FAIL',seconds:Math.round((Date.now()-start)/1000),bootstrap:nacre.state().torBootstrapPercent,error:error.message,log:nacre.state().lastTorLog}));throw error;}
 finally{await nacre.closeTorRuntime(nacre.state().torRuntime);}
}
run().then(()=>app.exit(0),error=>{console.error(error.message);app.exit(1)});
