'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { loadMainHeadless }=require('../scripts/red-team/harness/electron-stub.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const event=h=>({sender:h.chrome,senderFrame:h.chrome.mainFrame});
const state=h=>h.sends.filter(send=>send.channel==='nacre:state').at(-1).args[0];

test('real cookie-change listener purges IPv6 cookies using valid URLs', async () => {
  const h = await loadMainHeadless();
  h.ipcHandlers.get('nacre:navigate').fn(event(h), 'https://shop.test/');
  const cookies = h.views.at(-1).webContents.session.cookies;
  const removed = [];
  cookies.remove = async (url, name) => removed.push({ url, name });
  for (const domain of ['::1', '[::1]']) {
    cookies.emit('changed', {}, { domain, name: 'tracker', secure: true, path: '/track' }, 'explicit', false);
  }
  await tick();
  assert.deepEqual(removed, [{ url: 'https://[::1]/track', name: 'tracker' }, { url: 'https://[::1]/track', name: 'tracker' }]);
});

test('stripped cookies are attributed, private journals stay isolated and counters can be cleared', async()=>{
  const h=await loadMainHeadless();
  h.ipcHandlers.get('nacre:navigate').fn(event(h),'https://shop.test/');
  const normalId=state(h).activeId;
  const contents=h.views.at(-1).webContents;
  contents.mainFrame.url='https://shop.test/';
  let result;
  contents.session.webRequest.headersReceived({url:'https://ad.doubleclick.net/ad',webContentsId:contents.id,resourceType:'image',responseHeaders:{'Set-Cookie':['IDE=SECRET_VALUE; Domain=.evil.test; Secure','session=AUTH_SECRET; Path=/']}},r=>{result=r;});
  assert.equal(Object.hasOwn(result.responseHeaders,'Set-Cookie'),false);
  let activity=state(h).settings.protectionActivity;
  assert.equal(activity.total,2);
  assert.equal(state(h).active.cookieBlocked,2);
  assert.ok(activity.entries.every(entry=>entry.company==='Google'&&entry.host==='ad.doubleclick.net'&&entry.site==='shop.test'));
  assert.equal(JSON.stringify(activity).includes('SECRET'),false);
  contents.session.webRequest.beforeSendHeaders({url:'https://google-analytics.com/collect',webContentsId:contents.id,resourceType:'xhr',requestHeaders:{Cookie:'_ga=SECRET_VALUE'}},r=>{result=r;});
  assert.equal(Object.hasOwn(result.requestHeaders,'Cookie'),false);
  assert.equal(state(h).settings.protectionActivity.total,3);
  h.ipcHandlers.get('nacre:new-private-tab').fn(event(h));await tick();
  h.ipcHandlers.get('nacre:navigate').fn(event(h),'https://private.test/');
  const privateContents=h.views.at(-1).webContents;
  privateContents.session.webRequest.headersReceived({url:'https://facebook.com/pixel',webContentsId:privateContents.id,resourceType:'image',responseHeaders:{'Set-Cookie':['_fbp=PRIVATE_VALUE']}},()=>{});
  assert.equal(state(h).settings.protectionActivity.total,1);
  assert.equal(state(h).settings.protectionActivity.scope,'private');
  assert.equal(state(h).settings.protectionActivity.entries[0].company,'Meta');
  assert.equal(JSON.stringify(state(h).settings.protectionActivity).includes('shop.test'),false);
  h.ipcHandlers.get('nacre:activate-tab').fn(event(h),normalId);
  assert.equal(state(h).settings.protectionActivity.total,3);
  assert.equal(state(h).settings.protectionActivity.scope,'normal');
  assert.equal(JSON.stringify(state(h).settings.protectionActivity).includes('private.test'),false);
  h.ipcHandlers.get('nacre:clear-protection-stats').fn(event(h));
  assert.equal(state(h).settings.protectionActivity.total,0);
  assert.equal(state(h).active.cookieBlocked,0);
});
