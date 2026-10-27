'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'.cache','release-'+require('../package.json').nacreVersion.replaceAll('.','')),file=path.join(folder,'evidence.json');
const evidence=JSON.parse(fs.readFileSync(file,'utf8'));
const {deriveCheckStatus}=require('../src/release-validation.cjs');

function limitationsFromOutput(output, checkId) {
 const statements=[];
 for(const line of output.split(/\r?\n/)){
  const match=/^LIMITATION\s+(.+)$/.exec(line.trim());
  if(match)statements.push(match[1]);
 }
 for(const line of output.split(/\r?\n/)){
  const text=line.trim();if(!text.startsWith('{'))continue;
  try{const value=JSON.parse(text);
   if(Array.isArray(value.limits))for(const statement of value.limits)if(typeof statement==='string')statements.push(statement);
   if(typeof value.scope==='string'&&value.scope)statements.push(value.scope);
  }catch{}
 }
 const seen=new Set();
 return statements
  .map(statement=>String(statement).replace(/\s+/g,' ').trim().slice(0,1000))
  .filter(statement=>statement&&!seen.has(statement)&&seen.add(statement))
  .map(statement=>({checkId,statement}));
}

for(const[id,args]of [['packaged-sources',['scripts/verify-release-sources.cjs','dist/win-unpacked']],['packaged-smoke',['scripts/verify-design-package.cjs']]]){
 const startedAt=new Date().toISOString(),run=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,windowsHide:true});
 const output=(run.stdout||'')+(run.stderr||'')+(run.error?'\n'+String(run.error):'');fs.writeFileSync(path.join(folder,id+'.log'),output);
 const record={id,command:'node '+args.join(' '),startedAt,finishedAt:new Date().toISOString(),exitCode:Number.isInteger(run.status)?run.status:null,signal:run.signal||null,timedOut:Boolean(run.error&&(run.error.code==='ETIMEDOUT'||run.signal)),environmentFailure:/^FIXTURE_ENVIRONMENT_ERROR\b/m.test(output),outputSha256:crypto.createHash('sha256').update(output).digest('hex')};
 evidence.checks=evidence.checks.filter(check=>check.id!==id);evidence.checks.push(record);
 evidence.limitations=(Array.isArray(evidence.limitations)?evidence.limitations:[]).filter(limitation=>limitation.checkId!==id).concat(limitationsFromOutput(output,id));
 console.log(id+': exit '+record.exitCode+' ('+deriveCheckStatus(record)+')');
}
evidence.finishedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(evidence,null,2)+'\n');
const manifest=require('./build-release-validation-manifest.cjs').buildManifestFromEvidence(evidence,{repoRoot:root,evidenceSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
fs.writeFileSync(path.join(root,'src/release-validation.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Recorded real package checks; overall '+manifest.status);
