'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { attribution, cookieNamesFromHeader, createProtectionActivity, MAX_ENTRIES } = require('../src/protection-activity.cjs');

test('attribution uses exact registrable domains and identifies names only as possible technology', () => {
  assert.deepEqual(attribution('ad.doubleclick.net', 'IDE'), { company:'Google', service:'DoubleClick', basis:'domain', purpose:'unknown' });
  assert.equal(attribution('www.google.com.evil.test', 'session').company, '');
  assert.equal(attribution('notgoogle.com', 'session').company, '');
  assert.equal(attribution('google.com.evil.test', '_ga').basis, 'signature');
  assert.equal(attribution('shop.test', '_ga_ABC123').service, 'Google Analytics');
  assert.equal(attribution('shop.test', '_fbp').company, 'Meta');
  assert.equal(attribution('shop.test', '_clck').company, 'Microsoft');
  assert.equal(attribution('shop.test', 'li_fat_id').company, 'LinkedIn');
  assert.equal(attribution('facebook.com', '_ga').company, 'Meta', 'observed domain wins over conflicting name');
});

test('headers yield bounded cookie names only, never cookie values or attributes', () => {
  assert.deepEqual(cookieNamesFromHeader('_ga=secret; session=othersecret'), ['_ga','session']);
  assert.deepEqual(cookieNamesFromHeader(['IDE=secret; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure','test_cookie=value; SameSite=None'], true), ['IDE','test_cookie']);
  assert.deepEqual(cookieNamesFromHeader('malformed; <script>=secret; __proto__=value'), ['__proto__']);
  assert.equal(cookieNamesFromHeader(Array.from({length:500}, (_,i) => 'cookie'+i+'=secret'), true).length, 40);
  assert.deepEqual(cookieNamesFromHeader('x'.repeat(81)+'=secret'), []);
});

test('journal deduplicates interventions, evicts older entries and never stores extra input fields', () => {
  const journal = createProtectionActivity();
  const event = { host:'stats.google-analytics.com', site:'shop.test', cookieName:'_ga', action:'cookie-set-blocked', tabId:1, value:'SECRET', url:'https://shop.test/private?token=SECRET' };
  journal.record(event,100); journal.record(event,200);
  assert.equal(journal.snapshot().entries[0].count,2);
  assert.equal(journal.snapshot().entries[0].lastSeen,200);
  assert.equal(JSON.stringify(journal.snapshot()).includes('SECRET'),false);
  const copy=journal.snapshot();copy.entries[0].count=999;
  assert.equal(journal.snapshot().entries[0].count,2);
  for(let i=0;i<MAX_ENTRIES+1;i++)journal.record({...event,cookieName:'cookie'+i},300+i);
  assert.equal(journal.snapshot().entries.length,MAX_ENTRIES);
  assert.equal(journal.snapshot().entries.some(entry=>entry.cookieName==='_ga'),false);
  journal.clear();assert.equal(journal.snapshot().total,0);assert.deepEqual(journal.snapshot().entries,[]);
});

test('private/invalid events never enter the journal and requests do not invent cookie names', () => {
  const journal=createProtectionActivity();
  for(const event of [
    {host:'google.com',action:'request-blocked',private:true},
    {host:'evil.test/path',action:'request-blocked'},
    {host:'site.test',cookieName:'<script>',action:'cookie-set-blocked'},
    {host:'site.test',cookieName:'name',action:'allowed'}
  ])assert.equal(journal.record(event),false);
  journal.record({host:'doubleclick.net',site:'shop.test',action:'request-blocked'});
  assert.equal(journal.snapshot().total,1);
  assert.equal(journal.snapshot().entries[0].cookieName,'');
  assert.equal(journal.snapshot().entries[0].purpose,'unknown');
});

test('a private journal accepts only its own private events and clears independently',()=>{
  const normal=createProtectionActivity(),privateJournal=createProtectionActivity({scope:'private'});
  const entry={host:'facebook.com',cookieName:'_fbp',action:'cookie-set-blocked',private:true};
  assert.equal(normal.record(entry),false);
  assert.equal(privateJournal.record(entry),true);
  assert.equal(privateJournal.record({...entry,private:false}),false);
  assert.equal(privateJournal.snapshot().scope,'private');
  assert.equal(normal.snapshot().total,0);
  privateJournal.clear();assert.equal(privateJournal.snapshot().total,0);
});
