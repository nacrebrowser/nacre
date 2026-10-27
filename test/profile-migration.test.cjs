'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {loadMainHeadless}=require('../scripts/red-team/harness/electron-stub.cjs');
const {createProfileIntegrity}=require('../src/profile-integrity.cjs');

test('an explicitly accepted legacy profile is backed up, signed and preserves bookmarks',async()=>{
 const legacy={language:'fr',directMode:true,torCountry:'',bookmarks:[{title:'Saved bookmark',url:'https://example.test/',folder:''}]};
 const h=await loadMainHeadless({legacySettings:legacy,importLegacy:true});
 const file=path.join(h.state.userData,'settings.json');
 const saved=createProfileIntegrity(h.state.userData,h.electron.safeStorage).open('settings',fs.readFileSync(file,'utf8'));
 assert.equal(saved.language,'fr');assert.equal(saved.bookmarks[0].title,'Saved bookmark');
 assert.ok(fs.readdirSync(h.state.userData).some(name=>name.startsWith('settings.json.before-integrity-')));
 const prompt=h.state.migrationDialogs.find(d=>d.type==='question');assert.equal(prompt.defaultId,1);assert.equal(prompt.cancelId,1);
 assert.equal(prompt.title,'Nacre profile upgrade');
});

test('declining legacy import saves clean signed defaults without integrity warning',async()=>{
 const h=await loadMainHeadless({legacySettings:{language:'fr',directMode:true,torCountry:'',bookmarks:[{title:'Old',url:'https://example.test'}]},importLegacy:false});
 const saved=createProfileIntegrity(h.state.userData,h.electron.safeStorage).open('settings',fs.readFileSync(path.join(h.state.userData,'settings.json'),'utf8'));
 assert.equal(saved.language,'en');assert.deepEqual(saved.bookmarks,[]);
 assert.equal(h.state.migrationDialogs.filter(d=>d.type==='warning').length,0);
 assert.ok(fs.readdirSync(h.state.userData).some(name=>name.startsWith('settings.json.before-integrity-')));
});

test('an unsigned profile beside an existing key is never offered legacy import',async()=>{
 const h=await loadMainHeadless({legacySettings:{language:'en',directMode:true,torCountry:''},importLegacy:true,existingIntegrityKey:true});
 assert.equal(h.state.migrationDialogs.some(d=>d.type==='question'),false);
 assert.ok(fs.readdirSync(h.state.userData).some(name=>name.startsWith('settings.json.rejected-')));
});

test('Standard installer selection applies before startup networking even after profile rejection',async()=>{
 const h=await loadMainHeadless({legacySettings:{language:'fr',torCountry:'GB'},existingIntegrityKey:true,startupChoice:{version:1,id:'12345678-1234-1234-1234-123456789abc',mode:'standard'}});
 const saved=createProfileIntegrity(h.state.userData,h.electron.safeStorage).open('settings',fs.readFileSync(path.join(h.state.userData,'settings.json'),'utf8'));
 assert.equal(saved.language,'en');assert.equal(saved.directMode,true);assert.equal(saved.torCountry,'');assert.equal(saved.torAutoStart,false);
 assert.equal(saved.adBlockEnabled,true);assert.equal(saved.cookiePolicy,'block-third-party');
 assert.equal(h.state.migrationDialogs.filter(d=>d.type==='warning').length,1);
 assert.equal(h.state.migrationDialogs.find(d=>d.type==='warning').title,'Profile integrity');
});
