'use strict';
// Read-only checks against the unpacked executable and the packaged ASAR.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=path.resolve(root,process.argv[2]||'release/Nacre-0.6.1/win-unpacked');
const asar=require(require.resolve('@electron/asar',{paths:[require.resolve('electron-builder')]}));
const {verifyPinnedTorFiles,torPinsFor}=require('../src/tor-integrity.cjs');
// linux-unpacked holds 'nacre'; win-unpacked holds 'Nacre.exe'.
const platform=fs.existsSync(path.join(dir,'nacre'))?'linux':'win32',executable=path.join(dir,platform==='linux'?'nacre':'Nacre.exe');
const {loadFuseApi,verifyFuseWire}=require('./electron-fuse-policy.cjs');
const archive=path.join(dir,'resources/app.asar');
async function run(){
 let files=0;
 function walk(relative){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const file=relative+'/'+entry.name;if(entry.isDirectory())walk(file);else{assert.deepEqual(asar.extractFile(archive,path.normalize(file)),fs.readFileSync(path.join(root,file)),file);files++;}}}
 walk('src');
 assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,require('../package.json').version);
 assert.equal(verifyPinnedTorFiles(path.join(dir,'resources/tor'),torPinsFor(platform)).valid,true);
 assert.equal(verifyFuseWire(await loadFuseApi().getCurrentFuseWire(executable)),true);
 // A release must carry the update keys of this repository (compared byte for byte above) and at least one.
 assert.ok(require('../src/update-keys.cjs').some(key=>key.role==='manifest'),'no update signing key built in');
 for(const name of ['engine.bin','metadata.json'])assert.deepEqual(fs.readFileSync(path.join(dir,'resources/filters',name)),fs.readFileSync(path.join(root,'vendor/filters',name)));
 console.log('RELEASE_SOURCES_RESULT '+JSON.stringify({status:'PASS',version:require('../package.json').version,sourceFiles:files,fuses:'PASS',tor:'PASS',filters:'PASS'}));
}
run().catch(error=>{console.error(error.message);process.exitCode=1});
