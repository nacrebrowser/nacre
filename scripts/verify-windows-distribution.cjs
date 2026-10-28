'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
// Reads ZIP/CAB payloads only. Never executes the installer or changes a profile.
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const dir=path.resolve(root,process.argv[2]||'.cache/release-060/package-final');
const report=path.resolve(root,process.argv[3]||'.cache/release-060/distribution-payload.json');
if(!report.startsWith(path.join(root,'.cache')+path.sep))throw Error('Evidence must stay in workspace cache');
fs.mkdirSync(path.dirname(report),{recursive:true});
if(fs.existsSync(report))throw Error('Refuse evidence overwrite');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const names=require('./artifact-names.cjs').artifactNames(version),setup=path.join(dir,names.nsis),portable=path.join(dir,names.portable);
const result={status:'RUNNING',installation:'NOT_TESTED',results:[]};
function check(name,fn){fn();result.results.push({name,status:'PASS'});}
function zipHashes(file){
 const script=String.raw`Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[System.IO.Compression.ZipFile]::OpenRead($env:NACRE_VERIFY_ZIP); try { $hashes=@{}; foreach($name in @('Nacre.exe','resources/app.asar','resources/tor/tor.exe','resources/tor/geoip','resources/tor/geoip6','resources/filters/engine.bin')) { $entry=$zip.GetEntry($name); if($null -eq $entry){$entry=$zip.GetEntry($name.Replace("/","\"))}; if($null -eq $entry){throw ('Missing '+$name)}; $stream=$entry.Open(); $sha=[Security.Cryptography.SHA256]::Create(); try {$hashes[$name]=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally {$stream.Dispose();$sha.Dispose()} }; $hashes | ConvertTo-Json -Compress } finally {$zip.Dispose()}`;
 const run=cp.spawnSync('powershell.exe',['-NoProfile','-Command',script],{cwd:root,env:{...process.env,NACRE_VERIFY_ZIP:file},encoding:'utf8',windowsHide:true,timeout:120000});assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout.trim());
}
try{
 const sums=fs.readFileSync(path.join(dir,'SHA256SUMS-'+version+'.txt'),'utf8');
 check('Published setup and portable SHA-256 match actual files',()=>{for(const file of [setup,portable])assert.ok(sums.includes(digest(fs.readFileSync(file))+'  '+path.basename(file)));});
 check('Portable ZIP executable, ASAR, Tor and filters match tested unpacked candidate',()=>{for(const[file,hash]of Object.entries(zipHashes(portable)))assert.equal(hash,digest(fs.readFileSync(path.join(dir,'win-unpacked',file))),file);});
 const bytes=fs.readFileSync(setup),sign=Buffer.from('MSCF');let offset=-1;
 for(let cursor=bytes.indexOf(sign);cursor>=0;cursor=bytes.indexOf(sign,cursor+4))if(cursor+36<bytes.length&&bytes.readUInt32LE(cursor+4)===0&&bytes.readUInt32LE(cursor+8)>36&&cursor+bytes.readUInt32LE(cursor+8)<=bytes.length){assert.equal(offset,-1,'ambiguous CAB headers');offset=cursor;}
 assert.ok(offset>=0,'embedded CAB header');const size=bytes.readUInt32LE(offset+8),scratch=fs.mkdtempSync(path.join(path.dirname(report),'setup-payload-')),cab=path.join(scratch,'payload.cab'),dest=path.join(scratch,'extracted');fs.mkdirSync(dest);fs.writeFileSync(cab,bytes.subarray(offset,offset+size));
 const expanded=cp.spawnSync(path.join(process.env.WINDIR||'C:/Windows','System32','expand.exe'),[cab,'-F:*',dest],{encoding:'utf8',windowsHide:true,timeout:120000});assert.equal(expanded.status,0,expanded.stderr||expanded.stdout);
 check('Setup CAB contains exactly the expected installer script and application ZIP',()=>{assert.deepEqual(fs.readdirSync(dest).sort(),['install.ps1','nacre-app.zip']);assert.equal(fs.readFileSync(path.join(dest,'install.ps1'),'utf8'),fs.readFileSync(path.join(root,'scripts/install-nacre.ps1'),'utf8').replaceAll('0.4.0',version));});
 check('Setup application ZIP matches tested executable, ASAR, Tor and filters',()=>{for(const[file,hash]of Object.entries(zipHashes(path.join(dest,'nacre-app.zip'))))assert.equal(hash,digest(fs.readFileSync(path.join(dir,'win-unpacked',file))),file);});
 result.status='PASS';result.extractedEvidence=path.relative(root,scratch);
}catch(error){result.status='FAIL';result.error=error.stack;process.exitCode=1;}
fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
