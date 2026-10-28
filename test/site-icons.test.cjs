'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { parseBookmarkHtml } = require('../src/hardening-core.cjs');
const { iconCandidatesFromHtml, fetchSiteIcon, createSiteIconStore, MAX_ICONS } = require('../src/site-icons.cjs');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('declared icons are ranked and limited to decodable https images', () => {
  const html = `<head>
    <link rel="mask-icon" href="/mask.svg">
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="apple-touch-icon" href="/touch.png" sizes="180x180">
    <link rel="icon" href="/big.png" sizes="256x256">
    <link rel='shortcut icon' href='https://cdn.example.test/fav.ico'>
    <link rel="icon" href="/32.png" sizes="32x32">
    <link rel="icon" href="http://example.test/plain.png">
    <link rel="icon" href="javascript:alert(1)">
  </head>`;
  assert.deepEqual(iconCandidatesFromHtml(html, 'https://example.test/home'), [
    'https://example.test/32.png', 'https://cdn.example.test/fav.ico', 'https://example.test/big.png', 'https://example.test/touch.png'
  ]);
  assert.deepEqual(iconCandidatesFromHtml('<p>no icons</p>', 'https://example.test/'), []);
});

test('the icon fetch uses https only, omits credentials and falls back to favicon.ico', async () => {
  const requests = [];
  // Like Electron's session.fetch, responses do not report their final url.
  const respond = (url, type, ok = true) => ({ ok, url: '', headers: new Map([['content-type', type]]), body: { cancel() {} } });
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    if (url === 'https://example.test/') return respond(url, 'text/html');
    if (url.endsWith('/missing.png')) return respond(url, 'text/html', false);
    return respond(url, 'image/x-icon');
  };
  // A 16x16 ICO header, so the dimension check in favicon.cjs accepts it.
  const ico = Buffer.alloc(6 + 16 + 40);
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt32LE(22, 6 + 12); ico.writeInt32LE(16, 22 + 4); ico.writeInt32LE(32, 22 + 8);
  let reads = 0;
  const readBoundedBody = async () => (reads++ === 0 ? Buffer.from('<link rel="icon" href="/missing.png">') : ico);
  const nativeImage = { createFromBuffer: () => ({ isEmpty: () => false, resize: () => ({ toDataURL: () => PNG }) }) };
  const icon = await fetchSiteIcon({ fetcher, pageUrl: 'http://example.test/path?q=1', nativeImage, readBoundedBody });
  assert.equal(icon, PNG);
  assert.deepEqual(requests.map((r) => r.url), ['https://example.test/', 'https://example.test/missing.png', 'https://example.test/favicon.ico']);
  for (const { init } of requests) { assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer'); }
  assert.equal(await fetchSiteIcon({ fetcher, pageUrl: 'ftp://example.test/', nativeImage, readBoundedBody }), '');
});

test('the icon store keeps only safe icons of wanted hosts and retries later', () => {
  let saved = null, clock = 0;
  const store = createSiteIconStore({ read: () => ({ icons: { 'a.test': PNG, 'bad host': PNG, 'b.test': 'data:text/html,x' } }), write: (data) => { saved = data; }, now: () => clock });
  assert.equal(store.get('a.test'), PNG);
  assert.equal(store.has('b.test'), false);
  assert.equal(store.set('c.test', 'https://tracker.test/icon.png'), false);
  assert.equal(store.set('c.test', PNG), true);
  assert.deepEqual(Object.keys(saved.icons), ['a.test', 'c.test']);
  store.retain(['c.test']);
  assert.deepEqual(Object.keys(saved.icons), ['c.test']);
  assert.deepEqual(store.due(['c.test', 'd.test']), ['d.test']);
  store.attempted('d.test');
  assert.deepEqual(store.due(['d.test']), []);
  clock += 31 * 60 * 1000;
  assert.deepEqual(store.due(['d.test']), ['d.test']);
  for (let i = 0; i < MAX_ICONS + 5; i++) store.set(`h${i}.test`, PNG);
  assert.equal(Object.keys(saved.icons).length, MAX_ICONS);
});

test('icons embedded in an exported bookmarks file are read, bounded and restricted to images', () => {
  const big = 'A'.repeat(30000);
  const html = `<DL><p>
    <DT><A HREF="https://mail.example.test/" ADD_DATE="1" ICON="data:image/png;base64,${big}">Mail</A>
    <DT><A HREF="https://plain.example.test/">Plain</A>
    <DT><A HREF="https://script.example.test/" ICON="data:text/html;base64,PHNjcmlwdD4=">Script</A>
    <DT><A HREF="https://remote.example.test/" ICON="https://tracker.test/icon.png">Remote</A></DL>`;
  const items = parseBookmarkHtml(html, (value) => new URL(value).href);
  assert.deepEqual(items.map((item) => item.title), ['Mail', 'Plain', 'Script', 'Remote']);
  assert.equal(items[0].icon, 'data:image/png;base64,' + big);
  for (const item of items.slice(1)) assert.equal(item.icon, undefined, item.title);
  const huge = `<A HREF="https://huge.example.test/" ICON="data:image/png;base64,${'A'.repeat(80000)}">Huge</A>`;
  assert.equal(parseBookmarkHtml(huge, (value) => value).length, 0);
});

test('the temporary icon Tor stays separate from browsing and stops on its own', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main.cjs'), 'utf8');
  const body = main.match(/function fetchIconsInBackground\([\s\S]*?\n}\n/)?.[0] || '';
  assert.ok(body, 'fetchIconsInBackground exists');
  // Opt-out, existing Tor reused, never around a manual proxy or a Tor being set up.
  assert.match(body, /!settings\.iconTorBackground\) return;/);
  assert.match(body, /if \(torIsConnected\(\)\) \{ refreshSiteIcons\(\); return; \}/);
  assert.match(body, /torConnectingCountry \|\| settings\.torCountry \|\| settings\.proxy\.enabled\) return;/);
  assert.match(body, /!afterImport && Date\.now\(\) - iconTorLastRun < ICON_TOR_INTERVAL_MS/);
  // Its own Tor process and in-memory session; never assigned to torRuntime.
  assert.match(body, /startTor\(TOR_EXIT_AUTO, \{ background: true/);
  assert.match(body, /session\.fromPartition\('nacre-site-icons-temporary', \{ cache: false \}\)/);
  assert.doesNotMatch(body, /torRuntime =/);
  assert.match(body, /setTimeout\(\(\) => \{ stopIconTor\(job\)/);
  assert.match(body, /finally \{[\s\S]*await closeTorRuntime\(job\.runtime\);/);
  assert.match(main, /const ICON_TOR_MAX_MS = 4 \* 60 \* 1000;/);
  // A user connection to Tor, panic and quit stop it first.
  assert.match(main, /async function connectTorImpl\(country\) \{[\s\S]{0,600}try \{ return await connectTorRoute\(country\); \}/);
  assert.match(main, /async function connectTorRoute\(country\) \{\n  await stopIconTor\(\);/);
  assert.match(main, /async function panicCleanup\(\) \{[\s\S]{0,200}await stopIconTor\(\);/);
  assert.match(main, /fetchIconsInBackground\(\{ afterImport: true \}\);[\s\S]{0,40}return \{ found:/);
});
