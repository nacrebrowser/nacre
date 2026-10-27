'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeHome, migrateHome, applyShortcutAction, shortcutFromInput, nextZoom, pageBounds, canSplit } = require('../src/experience-core.cjs');
test('home preferences retain only bounded web shortcuts and local appearance choices', () => {
  const home = normalizeHome({ background: 'https://tracker.test/image', shortcuts: [
    { title: '<img src=x>', url: 'https://example.test/' }, {url:'javascript:alert(1)'}, {url:'file:///secret'},
    {url:'nacre://app/'}, {url:'https://user:secret@example.test/'}, {url:'https://example.test/'}
  ], privateUrl: 'https://secret.test/' });
  assert.deepEqual(home, { version:2, background:'default', showShortcuts:true, shortcuts:[{title:'<img src=x>',url:'https://example.test/'}] });
  assert.equal(normalizeHome({shortcuts:Array.from({length:100},(_,i)=>({url:`https://host${i}.test/`}))}).shortcuts.length,20);
});
test('older profiles keep the tiles they displayed, later ones never gain bookmarks', () => {
  const bookmarks = Array.from({length:10},(_,i)=>({title:'B'+i,url:`https://b${i}.test/`}));
  const migrated = migrateHome({ shortcuts:[{title:'Mine',url:'https://mine.test/'}] }, bookmarks);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.shortcuts.map(x=>x.title), ['Mine','B0','B1','B2','B3','B4','B5','B6','B7']);
  assert.deepEqual(migrateHome({ showBookmarks:false }, bookmarks).shortcuts, []);
  assert.deepEqual(migrateHome(migrated, [{url:'https://new.test/'}]).shortcuts, migrated.shortcuts);
});
test('shortcut actions add, rename, move and remove within bounds', () => {
  let list = applyShortcutAction([], { action:'add', title:'', url:'youtube.com' });
  assert.deepEqual(list, [{ title:'youtube.com', url:'https://youtube.com/' }]);
  list = applyShortcutAction(list, { action:'add', title:'Mail', url:'https://mail.example.test/inbox' });
  list = applyShortcutAction(list, { action:'add', title:'Maps', url:'maps.example.test' });
  assert.deepEqual(list.map(x=>x.title), ['youtube.com','Mail','Maps']);
  assert.deepEqual(applyShortcutAction(list, { action:'move', index:2, to:0 }).map(x=>x.title), ['Maps','youtube.com','Mail']);
  assert.deepEqual(applyShortcutAction(list, { action:'move', index:0, to:99 }).map(x=>x.title), ['Mail','Maps','youtube.com']);
  assert.deepEqual(applyShortcutAction(list, { action:'update', index:0, title:'YouTube', url:'https://www.youtube.com/' })[0], { title:'YouTube', url:'https://www.youtube.com/' });
  assert.deepEqual(applyShortcutAction(list, { action:'remove', index:1 }).map(x=>x.title), ['youtube.com','Maps']);
  for (const bad of [{action:'add',url:'javascript:alert(1)'},{action:'add',url:'file:///c:/x'},{action:'add',url:'not a url'},{action:'add',url:'intranet'},{action:'remove',index:7},{action:'move',index:0},{action:'update',index:0,url:'https://mail.example.test/inbox'},{action:'drop'}]) {
    assert.equal(applyShortcutAction(list, bad), null, JSON.stringify(bad));
  }
  const full = Array.from({length:20},(_,i)=>({url:`https://h${i}.test/`}));
  assert.equal(applyShortcutAction(full, { action:'add', url:'https://one-more.test/' }), null);
  assert.equal(shortcutFromInput('', 'https://user:pw@example.test/'), null);
});
test('zoom follows Chromium steps and stays between 50 and 300 percent', () => {
  assert.equal(nextZoom(100,'in'),110); assert.equal(nextZoom(110,'in'),125); assert.equal(nextZoom(100,'out'),90);
  assert.equal(nextZoom(120,'in'),125); assert.equal(nextZoom(120,'out'),110);
  assert.equal(nextZoom(300,'in'),300); assert.equal(nextZoom(50,'out'),50); assert.equal(nextZoom(175,'reset',100),100);
});
test('split geometry stays within the window and preserves a real divider', () => {
  for (const width of [450,920,1440]) for (const ratio of [-2,.5,9,NaN]) {
    const bounds = pageBounds({width,height:680,chromeHeight:135,sidebarWidth:240,split:true,ratio});
    for (const b of bounds) { assert.ok(b.x>=0&&b.y>=0&&b.width>0&&b.height>0); assert.ok(b.x+b.width<=width);assert.ok(b.y+b.height<=680); }
    if(bounds.length===2)assert.equal(bounds[0].x+bounds[0].width+6,bounds[1].x);
  }
});
test('split refuses mixed privacy, workspaces, internal and duplicate pages', () => {
  const a={id:1,url:'https://a.test/',private:false,workspaceId:'personal',internal:false};
  assert.equal(canSplit(a,{...a,id:2}),true);
  for(const change of [{private:true},{workspaceId:'work'},{url:''},{url:'nacre://settings/',internal:true},{id:1}])assert.equal(canSplit(a,{...a,id:2,...change}),false);
});
