'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ElectronBlocker, Request } = require('@ghostery/adblocker-electron');
const {
  DEFAULT_LISTS, FILTER_FETCH_TIMEOUT_MS, safeFilterListUrl, validateFilterListText, validateCustomFilters,
  shouldUpdateViaTor, shouldBlockStrictThirdParty, verifyAdvertisedDigest, updateBlockerFromSources, readFilterResponseText, persistFilterSnapshot, recordBlockedRequest, normalizeListStates, updateDue, isYouTubeHost, reloadYouTubeTabs
} = require('../src/adblock-core.cjs');
const { buildProceduralCosmeticScript } = require('../src/adblock-procedural.cjs');
const { ALLOWED_SCRIPTLET_ENTRIES, buildScriptletBundle, isAllowedGhosteryScriptlet } = require('../src/adblock-injector.cjs');
const { createFilterMetadata } = require('../src/filter-metadata.cjs');

test('Tor filter downloads allow slow circuits but remain bounded', () => {
  assert.equal(FILTER_FETCH_TIMEOUT_MS, 180_000);
});

test('updated filter snapshots record the running Nacre version', () => {
  assert.equal(createFilterMetadata(Buffer.from('snapshot'), '2026-10-12T00:00:00.000Z', { appVersion: '0.4.6' }).appVersion, '0.4.6');
});

test('only compiled Ghostery scriptlets from the explicit allowlist enter the bundle', () => {
  const prefix = "if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; };";
  const suffix = "].filter((a,i) => a !== '{{'+(i+1)+'}}').map((a) => decodeURIComponent(a)))";
  const trusted = (entry, n) => `${prefix}function ${entry}(){return ${n};};[${n}${suffix}`;
  const bundle = buildScriptletBundle({ scripts: [
    trusted('jsonPrune', 1),
    trusted('setConstant', 2),
    'globalThis.__nacrePwned = true;',
    trusted('unknownScriptlet', 4)
  ], proceduralScript: 'globalThis.__nacreSequence.push(3)' });
  assert.equal(bundle.scripts, 3, 'two approved scriptlets and Nacre procedural selectors are included');
  assert.equal(bundle.rejected, 2, 'arbitrary and unrecognized script sources are rejected');
  assert.ok(bundle.source.indexOf(trusted('jsonPrune', 1)) < bundle.source.indexOf(trusted('setConstant', 2)), 'approved scriptlets retain their order');
  assert.ok(bundle.source.indexOf('globalThis.__nacreSequence.push(3)') > bundle.source.indexOf(trusted('setConstant', 2)), 'Nacre procedural selectors are appended after scriptlets');
  assert.deepEqual(ALLOWED_SCRIPTLET_ENTRIES.includes('jsonPrune'), true);
  assert.equal(isAllowedGhosteryScriptlet('globalThis.__nacrePwned = true;'), false);
});

test('sandboxed adblock preload does not require a local CommonJS module', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'adblock-preload.cjs'), 'utf8');
  assert.doesNotMatch(preload, /require\(['"](?:\.\/|\.\.\/)/);
  assert.match(preload, /payload\.scriptletBundle/);
  assert.match(preload, /webFrame\.executeJavaScript\(payload\.scriptletBundle\)/);
  assert.doesNotMatch(preload, /\beval\s*\(|new\s+Function/);
  assert.doesNotMatch(preload, /contextBridge\.executeInMainWorld/);
});

test('Ghostery matches network rules, important precedence, domain exception and badfilter', () => {
  const engine = ElectronBlocker.parse([
    '||ads.example^$script,third-party',
    '@@||ads.example^$script,domain=allowed.example',
    '||important.example^$important',
    '@@||important.example^',
    '||disabled.example^',
    '||disabled.example^$badfilter',
    '||domainonly.example^$script,domain=allowed.example'
  ].join('\n'), { loadNetworkFilters: true, loadCosmeticFilters: true });
  const match = (url, sourceUrl, type = 'script') => engine.match(Request.fromRawDetails({ url, sourceUrl, type, method: 'GET' })).match;
  assert.equal(match('https://ads.example/ad.js', 'https://news.example/'), true, 'third-party script is blocked');
  assert.equal(match('https://ads.example/ad.js', 'https://allowed.example/'), false, 'domain exception is honored');
  assert.equal(match('https://important.example/pixel', 'https://news.example/', 'image'), true, '$important overrides a generic exception');
  assert.equal(match('https://disabled.example/ad.js', 'https://news.example/'), false, '$badfilter disables the matching rule');
  assert.equal(match('https://domainonly.example/ad.js', 'https://allowed.example/'), true, '$domain restricts a rule to configured host');
  assert.equal(match('https://domainonly.example/ad.js', 'https://news.example/'), false, '$domain excludes other hosts');
  assert.equal(shouldBlockStrictThirdParty('strict', true, 'script'), true);
  assert.equal(shouldBlockStrictThirdParty('strict', true, 'subFrame'), true);
  assert.equal(shouldBlockStrictThirdParty('comfort', true, 'script'), false);
  assert.equal(shouldBlockStrictThirdParty('strict', false, 'script'), false);
  assert.equal(shouldBlockStrictThirdParty('strict', true, 'script', true), false, 'filter exceptions remain honored in strict mode');
});

test('large filter refreshes update the Ghostery engine by source and keep cross-list badfilter exceptions', () => {
  const engine = ElectronBlocker.parse('', { loadNetworkFilters: true, loadCosmeticFilters: true });
  updateBlockerFromSources(engine, [
    '||chunked.example^$script',
    '||chunked.example^$script,badfilter'
  ]);
  assert.equal(engine.match(Request.fromRawDetails({ url: 'https://chunked.example/ad.js', sourceUrl: 'https://news.example/', type: 'script', method: 'GET' })).match, false);
});

test('$removeparam rewrites a URL while preserving unrelated query values', () => {
  const engine = ElectronBlocker.parse('||params.example^$removeparam=utm_source\n', { loadNetworkFilters: true });
  const result = engine.match(Request.fromRawDetails({ url: 'https://params.example/article?utm_source=mail&story=42', sourceUrl: 'https://params.example/', type: 'main_frame', method: 'GET' }));
  assert.equal(result.rewrite.url, 'https://params.example/article?story=42');
});

test('Ghostery supports redirect resources and ships YouTube scriptlets in the offline snapshot', () => {
  const snapshot = path.join(__dirname, '..', 'vendor', 'filters', 'engine.bin');
  assert.ok(fs.existsSync(snapshot), 'the generated build has a bundled filter snapshot');
  const engine = ElectronBlocker.deserialize(fs.readFileSync(snapshot));
  engine.updateFromDiff({ added: ['||redirect.example^$script,redirect=noopjs'] });
  const redirected = engine.match(Request.fromRawDetails({ url: 'https://redirect.example/ad.js', sourceUrl: 'https://video.example/', type: 'script', method: 'GET' }));
  assert.ok(redirected.redirect && redirected.redirect.dataUrl.startsWith('data:'), 'neutral resource redirect is produced');
  const youtube = engine.getCosmeticsFilters({ url: 'https://www.youtube.com/watch?v=sample', hostname: 'www.youtube.com', domain: 'youtube.com', getBaseRules: true, getInjectionRules: true, getExtendedRules: true, getRulesFromHostname: true });
  assert.ok(youtube.scripts.length > 0, 'scriptlets exist in the bundled YouTube rule set');
  assert.ok(youtube.scripts.some((script) => /jsonPrune/.test(script)), 'json-prune resource is available');
  assert.ok(youtube.scripts.some((script) => /setConstant/.test(script)), 'set-constant resource is available');
  const bundle = buildScriptletBundle(youtube);
  assert.equal(bundle.scripts, youtube.scripts.length, 'all YouTube scriptlets fit the bounded injection bundle');
  assert.equal(bundle.rejected, 0, 'bundled YouTube list uses only explicitly approved Ghostery resources');
  assert.doesNotThrow(() => new Function(bundle.source), 'the complete YouTube scriptlet bundle parses as one document-start evaluation');
});

test('a malicious list cannot inject arbitrary JavaScript or an unknown scriptlet', () => {
  const engine = ElectronBlocker.parse('', { loadNetworkFilters: true, loadCosmeticFilters: true, loadExtendedSelectors: true });
  updateBlockerFromSources(engine, ['evil.example##+js(eval,globalThis.PWNED=true)\nevil.example##+js(unknown-scriptlet,fetch)']);
  const result = engine.getCosmeticsFilters({ url: 'https://evil.example/', hostname: 'evil.example', domain: 'evil.example', getBaseRules: true, getInjectionRules: true, getExtendedRules: true, getRulesFromHostname: true });
  const bundle = buildScriptletBundle(result);
  assert.equal(bundle.source, '');
  assert.equal(bundle.scripts, 0);
  assert.throws(() => validateFilterListText('! malicious\n<script>fetch("https://attacker.invalid")</script>'), /format/);

  const snapshot = path.join(__dirname, '..', 'vendor', 'filters', 'engine.bin');
  const knownScriptletEngine = ElectronBlocker.deserialize(fs.readFileSync(snapshot));
  updateBlockerFromSources(knownScriptletEngine, ['evil.example##+js(set-constant,foo,;globalThis.PWNED=1;fetch(https://attacker.invalid))']);
  const knownResource = knownScriptletEngine.getCosmeticsFilters({ url: 'https://evil.example/', hostname: 'evil.example', domain: 'evil.example', getBaseRules: true, getInjectionRules: true, getExtendedRules: true, getRulesFromHostname: true });
  const safeBundle = buildScriptletBundle(knownResource);
  assert.doesNotMatch(safeBundle.source, /;globalThis\.PWNED=1;fetch\(/, 'hostile arguments are not emitted as executable statements');
});

test('procedural :has-text and :has are parsed as extended cosmetic selectors', () => {
  const engine = ElectronBlocker.parse('example.test##div:has-text(Sponsored)\nexample.test##section:has(> .advert)\n', { loadNetworkFilters: true, loadCosmeticFilters: true, loadExtendedSelectors: true });
  const result = engine.getCosmeticsFilters({ url: 'https://example.test/', hostname: 'example.test', domain: 'example.test', getBaseRules: true, getInjectionRules: true, getExtendedRules: true, getRulesFromHostname: true });
  assert.equal(result.extended.length, 1, ':has-text is returned as an extended rule');
  assert.ok(result.extended[0].ast);
  assert.match(result.styles, /section:has\(> \.advert\)/, ':has uses Chromium CSS selectors');
  const procedural = buildProceduralCosmeticScript(result.extended);
  assert.ok(procedural);
  assert.doesNotThrow(() => new Function(procedural), 'generated procedural helper is syntactically valid');
});

test('list sources reject non-HTTPS URLs and corrupt/non-filter responses', () => {
  assert.equal(safeFilterListUrl('http://example.org/list.txt'), null);
  assert.equal(safeFilterListUrl('https://example.org/list.txt'), 'https://example.org/list.txt');
  assert.equal(safeFilterListUrl('https://127.0.0.1/list.txt'), null);
  assert.equal(safeFilterListUrl('https://[::1]/list.txt'), null);
  assert.throws(() => validateFilterListText('<html>403 denied</html>'));
  assert.throws(() => validateFilterListText('! valid title\n||only-one.example^\n'));
  assert.throws(() => validateFilterListText(Array.from({ length: 300_001 }, (_, i) => `||host${i}.example^`).join('\n'), { minRules: 1 }), /trop de règles/);
  assert.throws(() => validateFilterListText('x'.repeat(64 * 1024 + 1) + '\n||one.example^\n||two.example^\n||three.example^\n||four.example^\n||five.example^'));
  const validated = validateFilterListText('! title\n||one.example^\n||two.example^\n||three.example^\n||four.example^\n||five.example^\n');
  assert.equal(validated.rules, 5);
});

test('bounded response reader rejects oversized bodies before parsing', async () => {
  assert.equal(await readFilterResponseText(new Response('||one.example^\n'), 128), '||one.example^\n');
  await assert.rejects(readFilterResponseText(new Response('x'.repeat(200)), 32), /taille maximale/);
});

test('filter reader refuses missing streams without calling an unbounded fallback', async () => {
  for (const body of [null, undefined, {}]) {
    await assert.rejects(readFilterResponseText({ body, text() { assert.fail('Unbounded text fallback'); } }), /no readable byte stream/);
  }
  await assert.rejects(readFilterResponseText(null), /no readable byte stream/);
  for (const limit of [NaN, Infinity, -1, 1.5]) await assert.rejects(readFilterResponseText(new Response('x'), limit), RangeError);
});

test('filter reader cancels on byte overflow and releases the reader lock', async () => {
  let cancelled = false, released = false, reads = 0;
  const response = { body: { getReader: () => ({
    async read() { reads++; return { done: false, value: new Uint8Array(6) }; },
    async cancel() { cancelled = true; },
    releaseLock() { released = true; }
  }) } };
  await assert.rejects(readFilterResponseText(response, 10), /taille maximale/);
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test('advertised SHA-256 is verified and bad digest rejects the update', () => {
  const text = '||ads.example^\n';
  const digest = Buffer.from(require('node:crypto').createHash('sha256').update(text).digest()).toString('base64');
  assert.equal(verifyAdvertisedDigest(text, new Headers({ Digest: 'sha-256=' + digest })).verified, true);
  assert.throws(() => verifyAdvertisedDigest(text, new Headers({ Digest: 'sha-256=' + Buffer.alloc(32).toString('base64') })), /SHA-256/);
});

test('Tor-down update is closed and leaves the current filter engine untouched', async () => {
  const engine = ElectronBlocker.parse('||stable.example^\n', { loadNetworkFilters: true });
  const bytesBefore = Buffer.from(engine.serialize());
  assert.equal(shouldUpdateViaTor(true, false), false);
  assert.equal(shouldUpdateViaTor(true, true, false), false);
  assert.equal(shouldUpdateViaTor(true, true, true), true);
  const update = async () => {
    if (!shouldUpdateViaTor(true, false)) throw new Error('Tor indisponible; mise à jour refusée.');
    return engine;
  };
  await assert.rejects(update(), /Tor indisponible/);
  assert.deepEqual(Buffer.from(engine.serialize()), bytesBefore);
  assert.ok(DEFAULT_LISTS.filter((list) => list.enabled).length >= 9);
});

test('failed snapshot swap keeps the previous active filter snapshot', () => {
  const directory = path.win32.join('C:\\nacre-test', 'filters');
  const files = new Map();
  let failPointerSwap = false;
  const fakeFs = {
    mkdirSync() {},
    writeFileSync(file, contents) { files.set(file, Buffer.isBuffer(contents) ? Buffer.from(contents) : String(contents)); },
    renameSync(source, destination) {
      if (failPointerSwap && destination === path.win32.join(directory, 'active.json')) throw new Error('simulated final pointer failure');
      files.set(destination, files.get(source));
      files.delete(source);
    }
  };
  const first = persistFilterSnapshot(directory, Buffer.from('old engine'), { version: 1 }, { texts: { easylist: 'old' } }, fakeFs);
  const previousPointer = files.get(path.win32.join(directory, 'active.json'));
  failPointerSwap = true;
  assert.throws(() => persistFilterSnapshot(directory, Buffer.from('new engine'), { version: 2 }, { texts: { easylist: 'new' } }, fakeFs), /pointer failure/);
  assert.equal(files.get(path.win32.join(directory, 'active.json')), previousPointer);
  const pointer = JSON.parse(previousPointer);
  assert.equal(pointer.sha256, first.sha256);
  assert.equal(files.get(path.win32.join(directory, pointer.engineFile)).toString(), 'old engine');
});

test('custom rules are bounded, dashboard counters stay in memory, and weekly cadence is opt-in', () => {
  assert.equal(validateCustomFilters('! title\n||ads.example^\n'), '||ads.example^');
  assert.equal(validateCustomFilters('||one.example^\n' + '||two.example^\n'.repeat(5000)), null, 'custom rules over the count limit are rejected');
  assert.equal(validateCustomFilters('x'.repeat(600 * 1024)), null);
  const counts = {};
  recordBlockedRequest(counts, 'news.example', 'script', 100);
  recordBlockedRequest(counts, 'news.example', 'image', 101);
  assert.deepEqual(counts.bySite['news.example'], { total: 2, byType: { script: 1, image: 1 } });
  assert.equal(updateDue('', 1), true);
  assert.equal(updateDue(new Date(10_000).toISOString(), 10_001), false);
  const states = normalizeListStates({ easylist: { enabled: false } });
  assert.equal(states.easylist.enabled, false);
  assert.equal(states['easylist-fr'].enabled, true);
});

test('YouTube tabs are recognized for filter refresh without matching lookalike domains', () => {
  assert.equal(isYouTubeHost('www.youtube.com'), true);
  assert.equal(isYouTubeHost('music.youtube.com'), true);
  assert.equal(isYouTubeHost('youtube-nocookie.com'), true);
  assert.equal(isYouTubeHost('youtube.com.evil.example'), false);
  assert.equal(isYouTubeHost('notyoutube.com'), false);
  assert.equal(isYouTubeHost('youtube.example'), false);
});

test('manual list refresh reloads only first-party YouTube tabs', () => {
  const calls = [];
  const makeTab = (url, options = {}) => ({
    url,
    internal: Boolean(options.internal),
    pageView: { webContents: {
      isDestroyed: () => Boolean(options.destroyed),
      reload: () => calls.push(url)
    } }
  });
  const reloaded = reloadYouTubeTabs([
    makeTab('https://www.youtube.com/watch?v=one'),
    makeTab('https://music.youtube.com/'),
    makeTab('https://news.example/'),
    makeTab('https://youtube.com.evil.example/'),
    makeTab('https://youtube.com/watch?v=internal', { internal: true }),
    makeTab('https://youtube.com/watch?v=destroyed', { destroyed: true })
  ]);
  assert.equal(reloaded, 2);
  assert.deepEqual(calls, ['https://www.youtube.com/watch?v=one', 'https://music.youtube.com/']);
});
