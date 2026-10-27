'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeSiteCookiePolicies,siteCookiePolicy,detachedCookiePolicy}=require('../src/site-cookie-controls.cjs');
test('site cookie controls use own validated host policies with temporary precedence',()=>{
 const policies=normalizeSiteCookiePolicies(JSON.parse('{"first.test":"block-all","__proto__":"allow","other.test":"broken"}'));
 assert.deepEqual(Object.keys(policies),['first.test']);
 assert.equal(normalizeSiteCookiePolicies({'[::1]':'block-all'})['[::1]'],'block-all');
 assert.deepEqual(Object.keys(normalizeSiteCookiePolicies({'[zz]':'allow'})),[]);
 assert.equal(siteCookiePolicy('allow','first.test',policies),'block-all');
 assert.equal(siteCookiePolicy('block-all','first.test',policies,{host:'first.test',policy:'allow'}),'allow');
 assert.equal(siteCookiePolicy('block-all','different.test',Object.create({'different.test':'allow'})),'block-all');
});
test('detached requests cannot evade a stricter site policy or inherit an allow exception',()=>{
 assert.equal(detachedCookiePolicy('allow',{'first.test':'block-all'}),'block-all');
 assert.equal(detachedCookiePolicy('allow',{},['block-third-party']),'block-third-party');
 assert.equal(detachedCookiePolicy('block-third-party',{'first.test':'allow'}),'block-third-party');
 assert.equal(detachedCookiePolicy('allow',{'first.test':'allow'}),'allow');
});
