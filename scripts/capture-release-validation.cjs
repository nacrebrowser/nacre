'use strict';
// Development command only. Installed pages can read its report, never invoke it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {deriveCheckStatus,deriveTestSuiteStatus}=require('../src/release-validation.cjs');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'.cache','release-'+require('../package.json').nacreVersion.replaceAll('.',''));fs.mkdirSync(folder,{recursive:true});
const {computeSourceDigest}=require('../src/release-validation.cjs');
const startedAt=new Date().toISOString(),source=computeSourceDigest(path.join(root,'src'));

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

function capture(id,args){
 const start=new Date().toISOString(),result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:32*1024*1024,windowsHide:true});
 const output=(result.stdout||'')+(result.stderr||'')+(result.error?'\n'+String(result.error):'');fs.writeFileSync(path.join(folder,id+'.log'),output);
 const timedOut=Boolean(result.error&&(result.error.code==='ETIMEDOUT'||result.signal));
 const environmentFailure=/^FIXTURE_ENVIRONMENT_ERROR\b/m.test(output);
 const record={command:'node '+args.join(' '),startedAt:start,finishedAt:new Date().toISOString(),exitCode:Number.isInteger(result.status)?result.status:null,signal:result.signal||null,timedOut,environmentFailure,outputSha256:crypto.createHash('sha256').update(output).digest('hex')};
 const status=deriveCheckStatus(record);
 console.log(id+': exit '+record.exitCode+' ('+status+')');
 return {record,output,status,limitations:limitationsFromOutput(output,id)};
}

const test=capture('node-suite',['--test','--test-reporter=tap']);
const counts={};
for(const name of ['tests','pass','fail','cancelled','skipped','todo']){
 const values=[...test.output.matchAll(new RegExp('^# '+name+' (\\d+)','gm'))];
 counts[name]=values.length?Number(values.at(-1)[1]):0;
}
if(![...test.output.matchAll(/^# tests (\d+)/gm)].length&&test.record.exitCode!==0)test.record.environmentFailure=true;
const testSuite={...test.record,total:counts.tests,passed:counts.pass,failed:counts.fail,cancelled:counts.cancelled,skipped:counts.skipped,todo:counts.todo};
const testSuiteLimitations=limitationsFromOutput(test.output,'test-suite');
const checks=[],limitations=[...testSuiteLimitations];
for(const[id,script]of [['installer-native','verify-installer-native.cjs'],['diagnostics-runtime','verify-diagnostics-runtime.cjs'],['privacy-profiles-runtime','verify-privacy-center-runtime.cjs'],['audit-runtime','verify-audit-remediation-runtime.cjs'],['canvas-runtime','verify-canvas-exports-runtime.cjs'],['fingerprint-runtime','verify-fingerprint-runtime.cjs'],['hardening-runtime','verify-hardening-runtime.cjs'],['tor-control-runtime','verify-tor-control-runtime.cjs'],['workspace-isolation-runtime','verify-workspace-isolation-runtime.cjs'],['continuation-runtime','verify-continuation-runtime.cjs']]){
 const result=capture(id,['scripts/'+script]);checks.push({id,...result.record});limitations.push(...result.limitations);
}
if(JSON.stringify(computeSourceDigest(path.join(root,'src')))!==JSON.stringify(source))throw Error('Sources changed during validation');
const evidence={format:'nacre-release-validation-evidence',schemaVersion:2,releaseVersion:require('../package.json').version,startedAt,finishedAt:new Date().toISOString(),source,testSuite,checks,limitations};
const file=path.join(folder,'evidence.json');fs.writeFileSync(file,JSON.stringify(evidence,null,2)+'\n');
const manifest=require('./build-release-validation-manifest.cjs').buildManifestFromEvidence(evidence,{repoRoot:root,evidenceSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
fs.writeFileSync(path.join(root,'src/release-validation.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:manifest.status,tests:{...testSuite,status:deriveTestSuiteStatus(testSuite)},checks:checks.map(check=>({id:check.id,status:deriveCheckStatus(check),exitCode:check.exitCode})),limitations:limitations.length},null,2));
