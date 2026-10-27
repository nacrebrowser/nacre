'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readStartupChoice,applyStartupChoice,applyStartupRoute}=require('../src/startup-choice.cjs');
const id='12345678-1234-1234-1234-123456789abc';
test('installer choices retain blockers and persist distinct launch routes',()=>{
 const old={torPreferredCountry:'GB',language:'fr',proxy:{enabled:true},adBlockEnabled:false,cookiePolicy:'allow'};
 for(const mode of ['tor','standard']){
  const result=applyStartupChoice(old,{id,mode});assert.equal(result.language,'fr');assert.equal(result.proxy.enabled,false);
  assert.equal(result.adBlockEnabled,true);assert.equal(result.blockTrackers,true);assert.equal(result.cookiePolicy,'block-third-party');
  assert.equal(result.directMode,mode==='standard');assert.equal(result.torAutoStart,mode==='tor');
  assert.equal(result.torCountry,mode==='tor'?'GB':'');
 }
 const standard=applyStartupChoice(old,{id,mode:'standard'});
 const manual={...standard,torCountry:'US',directMode:false};
 assert.equal(applyStartupRoute(manual).torCountry,'');assert.equal(applyStartupRoute(manual).directMode,true);
 assert.equal(applyStartupChoice(manual,{id,mode:'standard'}),manual,'same setup is never reapplied');
 const tor={...applyStartupChoice(old,{id,mode:'tor'}),torCountry:'',directMode:true};
 assert.equal(applyStartupRoute(tor).torCountry,'GB');assert.equal(applyStartupRoute(tor).directMode,false);
});
test('installer marker accepts bounded exact schema and rejects unknown modes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nacre-choice-')),file=path.join(dir,'choice.json');
 try{
  for(const value of [{version:1,id,mode:'standard'},{version:1,id,mode:'tor'}]){
   fs.writeFileSync(file,'\uFEFF'+JSON.stringify(value));assert.deepEqual(readStartupChoice(file),value);
  }
  for(const value of [{version:1,id,mode:'direct'},{version:1,id:'invalid',mode:'tor'},{version:1,id,mode:'tor',url:'https://evil.test'}]){
   fs.writeFileSync(file,JSON.stringify(value));assert.equal(readStartupChoice(file),null);
  }
  fs.writeFileSync(file,' '.repeat(1025));assert.equal(readStartupChoice(file),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('la langue du systeme remplace seulement la langue par defaut',()=>{
 const base={torPreferredCountry:'AUTO',proxy:{}};
 assert.equal(applyStartupChoice({...base,language:'en'},{id,mode:'tor'},'fr').language,'fr');
 assert.equal(applyStartupChoice({...base,language:'de'},{id,mode:'tor'},'fr').language,'de');
 assert.equal(applyStartupChoice({...base,language:'en'},{id,mode:'tor'}).language,'en');
 assert.equal(applyStartupChoice({...base,language:'en'},{id,mode:'tor'}).torCountry,'AUTO');
});
