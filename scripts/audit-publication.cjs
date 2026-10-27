'use strict';
// Report locations only: never copy suspected private values into the report.
const fs=require('fs'),cp=require('child_process');
const git=args=>cp.execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024});
const files=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))];
const findings=[];let scanned=0;
for(const file of files){if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;const b=fs.readFileSync(file);if(b.includes(0)||b.length>10*1024*1024)continue;scanned++;
 const lines=b.toString('utf8').split(/\r?\n/);lines.forEach((line,i)=>{
  const rules={personalPath:/[A-Z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)(?!Developer|Public|Default|<)[^\s"<>]+/i,privateKey:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,token:/\b(?:github_pat_[a-zA-Z0-9_]{30,}|ghp_[a-zA-Z0-9]{30,}|AKIA[A-Z0-9]{16})\b/};
  for(const [kind,pattern]of Object.entries(rules))if(pattern.test(line))findings.push({file,line:i+1,kind,reviewedExample:kind==='personalPath'&&((file==='docs/security/HARDENING_0.8.2.md'&&line.includes('Users\\...'))||(file==='scripts/red-team/fixtures/pure-attacks.test.cjs'&&line.includes('Users\\\\x\\\\'))||(file==='test/profile-location.test.cjs'&&line.includes('Users\\\\Test\\\\'))||(file==='test/tor-diagnostics.test.cjs'&&line.includes('Users\\\\ExampleUser\\\\')))});
 });
}
const identities=new Set(git(['log','--all','--format=%an <%ae>']).trim().split('\n'));
const report={scanned,findings,gitIdentityCount:identities.size,historyRewritten:false,scope:'Tracked and nonignored working files, text <=10 MiB. Binary metadata and Git historical contents require separate review. Matches are candidates, not proof; fixture patterns may match.'};
fs.mkdirSync('.cache/publication',{recursive:true});fs.writeFileSync('.cache/publication/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
process.exitCode=findings.some(item=>!item.reviewedExample)?1:0;
