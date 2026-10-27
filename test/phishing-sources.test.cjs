'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { SOURCES, createMergedSnapshot, downloadSnapshot } = require('../scripts/phishing-sources.cjs');
const { fetchApprovedFeed, downloadPhishingFeed, MAX_FEED_BYTES } = require('../scripts/download-phishing-feed.cjs');
const inputs = () => SOURCES.map((source, index) => ({ id: source.id, text: source.format === 'json' ? JSON.stringify(['common.example', 'third.example']) : (index ? 'common.example\nsecond.example\nsites.google.com\ngithub.io\n' : 'https://common.example/path?token=discarded\nfirst.example\n'), sourceLastModified: '2026-10-02T00:00:00Z' }));

test('three feeds merge unique hosts with honest provenance and unsafe roots excluded', () => {
  const result = createMergedSnapshot(inputs(), { updatedAt: '2026-10-26T00:00:00Z' });
  assert.deepEqual(result.domains, ['common.example', 'first.example', 'second.example', 'third.example']);
  assert.equal(result.entryCount, 4); assert.equal(result.sources.length, 3);
  assert.equal(result.sources[1].excludedUnsafeRoots, 2);
  assert.equal(result.sources[1].sourceLastModified, '2026-10-02T00:00:00.000Z');
  assert.match(result.sources[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.sources[1].license, 'MIT');
  assert.equal(JSON.stringify(result).includes('token=discarded'), false);
});

test('missing, empty, malformed and oversized sources reject the entire build', () => {
  assert.throws(() => createMergedSnapshot(inputs().slice(1)), /required/);
  const empty = inputs(); empty[1].text = '# only a comment';
  assert.throws(() => createMergedSnapshot(empty), /No usable domains/);
  const json = inputs(); json[2].text = JSON.stringify(['good.example\nevil.example']);
  assert.throws(() => createMergedSnapshot(json), /Invalid JSON/);
  json[2].text = '{}'; assert.throws(() => createMergedSnapshot(json), /Invalid JSON/);
  const large = inputs(); large[0].text = 'x'.repeat(MAX_FEED_BYTES + 1);
  assert.throws(() => createMergedSnapshot(large), /byte limit/);
});

test('HTTPS feed fetch refuses unapproved origins and cross-origin redirects before following them', async () => {
  let calls = 0;
  const crossOrigin = async () => { calls++; return new Response('', { status: 302, headers: { location: 'https://attacker.example/feed' } }); };
  await assert.rejects(fetchApprovedFeed(SOURCES[0].url, crossOrigin), /outside/); assert.equal(calls, 1);
  for (const url of ['http://phishunt.io/feed.txt', 'https://127.0.0.1/feed', 'https://phishunt.io.attacker.example/feed', 'https://name:secret@phishunt.io/feed.txt']) await assert.rejects(fetchApprovedFeed(url, crossOrigin), /Unapproved/);
  assert.equal(calls, 1);
  await assert.rejects(fetchApprovedFeed(SOURCES[0].url, async () => new Response('', { headers: { 'content-length': String(MAX_FEED_BYTES + 1) } })), /size limit/);
  await assert.rejects(fetchApprovedFeed(SOURCES[0].url, async () => new Response(new Uint8Array([0xff]))), /encoded|encoding|UTF-8/i);
});

test('GitHub feeds are downloaded at verified revisions with their upstream timestamps', async () => {
  const requests = [], revision = 'a'.repeat(40);
  const result = await downloadSnapshot(async (url, options) => {
    requests.push(url); assert.equal(options.redirect, 'manual'); assert.ok(options.signal);
    if (url.startsWith('https://api.github.com/')) {
      assert.match(options.headers.accept, /github\+json/);
      return new Response(JSON.stringify([{ sha: revision, commit: { committer: { date: '2026-10-02T12:00:00Z' } } }]));
    }
    if (url.includes('/phishing-domains-ACTIVE.txt')) return new Response('second.example\n');
    if (url.includes('/active_domains.json')) return new Response('["third.example"]');
    return new Response('first.example\n', { headers: { 'last-modified': 'Mon, 26 Oct 2026 10:00:00 GMT' } });
  });
  assert.equal(requests.length, 5); assert.equal(result.entryCount, 3);
  assert.ok(requests.filter(url => url.startsWith('https://raw.')).every(url => url.includes('/' + revision + '/')));
  assert.equal(result.sources[1].revision, revision);
  assert.equal(result.sources[1].sourceLastModified, '2026-10-02T12:00:00.000Z');
});

test('a failed source preserves the existing snapshot and leaves no partial file', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-feed-test-'));
  const targetPath = path.join(directory, 'snapshot.json'); fs.writeFileSync(targetPath, 'previous snapshot');
  try {
    await assert.rejects(downloadPhishingFeed({ targetPath, fetchImpl: async url => url === SOURCES[0].url ? new Response('first.example\n') : new Response('', { status: 503 }) }), /503/);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'previous snapshot');
    assert.deepEqual(fs.readdirSync(directory), ['snapshot.json']);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true });
  }
});
