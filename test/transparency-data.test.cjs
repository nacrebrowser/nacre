'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createProtectionActivity,filterIdentifier,createTransparencyReport,MAX_ENTRIES}=require('../src/protection-activity.cjs');

test('transparency records distinct decisions, reasons, rule IDs and bounded retained summaries',()=>{
 const journal=createProtectionActivity();
 const base={host:'ad.doubleclick.net',site:'shop.test',tabId:1,resourceType:'image',thirdParty:true};
 journal.record({...base,action:'request-blocked',reason:'filter-rule',ruleId:'f-0000002a'},100);
 journal.record({...base,action:'request-blocked',reason:'filter-rule',ruleId:'f-0000002a'},200);
 journal.record({...base,action:'request-blocked',reason:'strict-mode',ruleId:'f-0000002a'},210);
 journal.record({...base,action:'request-allowed',reason:'site-exception'},220);
 journal.record({...base,action:'request-redirected',reason:'filter-rule',ruleId:'f-0000002a'},230);
 const data=journal.snapshot();
 assert.deepEqual(data.summary,{blocked:3,allowed:1,modified:1});
 assert.equal(data.entries.length,4);
 const matched=data.entries.find(e=>e.action==='request-blocked'&&e.reason==='filter-rule');
 assert.equal(matched.firstSeen,100);assert.equal(matched.lastSeen,200);assert.equal(matched.count,2);
 assert.equal(matched.ruleId,'f-0000002a');assert.match(matched.sourceUrl,/^https:\/\/policies.google.com\//);
 assert.equal(data.entries.find(e=>e.reason==='strict-mode').ruleId,'');
 for(let i=0;i<MAX_ENTRIES;i++)journal.record({...base,host:'host'+i+'.test',action:'request-allowed',reason:'no-matching-rule'},300+i);
 assert.equal(journal.snapshot().entries.length,MAX_ENTRIES);assert.ok(journal.snapshot().droppedGroups>0);
 assert.equal(journal.snapshot().total,205);
 journal.clear();assert.equal(journal.snapshot().droppedGroups,0);assert.deepEqual(journal.snapshot().summary,{blocked:0,allowed:0,modified:0});
});

test('only numeric Ghostery IDs enter transparency; raw filter text is never evaluated',()=>{
 assert.equal(filterIdentifier({getId:()=>42,getRawLine:()=>{throw Error('raw filter leaked');}}),'f-0000002a');
 for(const id of [-1,2**40,NaN,'https://secret.test/?token=SECRET',{}])assert.equal(filterIdentifier({getId:()=>id}),'');
 assert.equal(filterIdentifier({getId:()=>{throw Error('boom')}}),'');
 const journal=createProtectionActivity();
 journal.record({host:'x.test',action:'request-blocked',resourceType:'<script>',reason:'__proto__',ruleId:'https://secret.test/?token=SECRET',sourceUrl:'https://evil.test',sourceReviewedAt:'bad',requestHeaders:{Authorization:'SECRET'}});
 const row=journal.snapshot().entries[0];assert.equal(row.reason,'unknown');assert.equal(row.resourceType,'other');assert.equal(row.ruleId,'');assert.equal(row.sourceUrl,'');assert.equal(row.thirdParty,null);
 assert.doesNotMatch(JSON.stringify(row),/SECRET|evil\.test|<script>/);
 assert.equal(journal.record({host:'x'.repeat(100000),action:'request-blocked'}),false);
});

test('report reconstructs sanitized metadata and retains counts without values, paths or cross-scope data',()=>{
 const normal=createProtectionActivity(),privateJournal=createProtectionActivity({scope:'private'});
 const base={host:'shop.test',site:'shop.test',cookieName:'_ga',action:'cookie-set-blocked',tabId:4,value:'SECRET_VALUE',url:'https://shop.test/SECRET_PATH?token=SECRET_QUERY'};
 normal.record(base,100);normal.record(base,200);
 privateJournal.record({...base,private:true,host:'private.test'},300);
 const report=JSON.parse(createTransparencyReport(normal.snapshot()));
 assert.equal(report.scope,'normal');assert.equal(report.total,2);assert.equal(report.entries[0].count,2);assert.equal(report.entries[0].firstSeen,100);assert.equal(report.entries[0].lastSeen,200);
 assert.equal(report.entries[0].basis,'signature');assert.deepEqual(report.summary,{blocked:2,allowed:0,modified:0});
 assert.doesNotMatch(JSON.stringify(report),/SECRET|private\.test|\?token|Authorization/);
 assert.equal(JSON.parse(createTransparencyReport(privateJournal.snapshot())).scope,'private');
 const forged=normal.snapshot();Object.assign(forged.entries[0],{company:'EVIL',sourceUrl:'https://evil.test/?secret=SECRET',sourceReviewedAt:'untrusted',decision:'allowed',value:'SECRET'});
 const clean=JSON.parse(createTransparencyReport(forged)).entries[0];assert.equal(clean.company,'Google');assert.equal(clean.decision,'blocked');assert.match(clean.sourceUrl,/policies.google.com/);assert.doesNotMatch(JSON.stringify(clean),/EVIL|SECRET|untrusted/);
});
