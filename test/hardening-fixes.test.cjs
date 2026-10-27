'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { readBoundedBody, validZapperSelector, normalizeSitePermissions, parseBookmarkHtml } = require('../src/hardening-core.cjs');
const { createProfileIntegrity } = require('../src/profile-integrity.cjs');
const { safeCookieProof } = require('../src/tor-control.cjs');
const { verifyPinnedTorFiles, sha256File } = require('../src/tor-integrity.cjs');
const { isRiskyOpenDownload, isSafeAutoOpenDownload } = require('../src/data-policy.cjs');
const scratch = path.resolve(__dirname, '../.cache/hardening-unit');
fs.mkdirSync(scratch, { recursive: true });

test('streaming image copy rejects a lying/missing Content-Length and cancels the reader', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedBody(new Response(stream), 10), /byte limit/);
  assert.equal(cancelled, true);
  assert.equal((await readBoundedBody(new Response('1234567890'), 10)).toString(), '1234567890');
});

test('zapper grammar rejects filter/CSS injection but accepts generated selectors', () => {
  for (const selector of ['#advert', 'div.banner > section:nth-of-type(2)', 'body > div#content.foo.bar']) assert.equal(validZapperSelector(selector), true, selector);
  for (const selector of ['*', 'div,body', 'div{color:red}', 'div\nbody', 'div:has(script)', 'div[onclick]', 'div##x', '#', ' > div', '#__x\\a', 'div > '.repeat(8) + 'p']) assert.equal(validZapperSelector(selector), false, selector);
});

test('bookmark tokenizer decodes titles before stripping encoded tags and bounds malformed input', () => {
  const imported = parseBookmarkHtml('<a href="https://example.test/?a=1&amp;b=2">&lt;img src=x onerror=x&gt;Hello &#x1f30d;</a>', value => new URL(value).href);
  assert.equal(imported[0].title, 'Hello 🌍');
  assert.equal(imported[0].url, 'https://example.test/?a=1&b=2');
  assert.equal(parseBookmarkHtml('<a href="'.repeat(100000), value => value).length, 0);
});

test('permission maps discard invalid hosts and never inherit prototype keys', () => {
  const policies = normalizeSitePermissions(JSON.parse('{"__proto__":{"media":"allow"},"example.org":{"media":"ask"},"https://evil.test/":{"media":"allow"}}'));
  assert.equal(Object.getPrototypeOf(policies), null);
  assert.equal(Object.getPrototypeOf(policies['example.org']), null);
  assert.equal(Object.hasOwn(policies, '__proto__'), false);
  assert.equal(Object.keys(policies).length, 1);
});

test('download policy catches trailing dots/spaces and ADS and only auto-opens allowlisted formats', () => {
  for (const name of ['evil.exe.', 'evil.exe ', 'image.png:evil.exe', 'readme.txt:payload', 'C:\\Downloads\\evil.exe. ']) {
    assert.equal(isRiskyOpenDownload(name), true, name);
    assert.equal(isSafeAutoOpenDownload(name), false, name);
  }
  assert.equal(isSafeAutoOpenDownload('C:\\Downloads\\image.PNG'), true);
  for (const name of ['archive.zip', 'report.pdf', 'image.svg', 'file.unknown', 'image.png.']) assert.equal(isSafeAutoOpenDownload(name), false);
});

test('profile HMAC rejects settings tampering, cross-purpose substitution and unsigned JSON', () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'profile-'));
  const storage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() };
  const integrity = createProfileIntegrity(dir, storage);
  const sealed = integrity.seal('settings', { directMode: false });
  assert.deepEqual(integrity.open('settings', sealed), { directMode: false });
  assert.throws(() => integrity.open('settings', sealed.replace('false', 'true')), /mismatch/);
  assert.throws(() => integrity.open('filter-manifest', sealed), /mismatch/);
  assert.throws(() => integrity.open('settings', '{"directMode":true}'), /Unsigned/);
  const target = path.join(dir, 'settings.json');
  integrity.write(target, 'settings', { cookiePolicy: 'block-all' });
  assert.equal(integrity.open('settings', fs.readFileSync(target, 'utf8')).cookiePolicy, 'block-all');
  fs.writeFileSync(path.join(dir, 'integrity-key.bin'), '00');
  const corrupted = createProfileIntegrity(dir, storage);
  assert.throws(() => corrupted.seal('settings', {}), /Invalid profile integrity key/);
  assert.throws(() => corrupted.seal('settings', {}), /Invalid profile integrity key/, 'an invalid key is never cached');
});

test('SAFECOOKIE verifies the server before returning a different controller proof', () => {
  const cookie = Buffer.alloc(32, 1), client = Buffer.alloc(32, 2), server = Buffer.alloc(32, 3);
  const material = Buffer.concat([cookie, client, server]);
  const hash = direction => crypto.createHmac('sha256', `Tor safe cookie authentication ${direction} hash`).update(material).digest('hex');
  const challenge = `250 AUTHCHALLENGE SERVERHASH=${hash('server-to-controller')} SERVERNONCE=${server.toString('hex')}`;
  assert.equal(safeCookieProof(cookie, client, challenge), hash('controller-to-server'));
  assert.throws(() => safeCookieProof(cookie, client, challenge.replace(/SERVERHASH=./, 'SERVERHASH=0')), /authentication failed/);
  assert.throws(() => safeCookieProof(cookie, client, '250 AUTHCHALLENGE SERVERHASH=abc'), /Invalid/);
});

test('Tor allowlist rejects DLL additions and symlinks even when all pinned hashes match', () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'tor-'));
  fs.writeFileSync(path.join(dir, 'tor.exe'), 'fixture');
  const pins = { 'tor.exe': sha256File(path.join(dir, 'tor.exe')) };
  assert.equal(verifyPinnedTorFiles(dir, pins).valid, true);
  fs.writeFileSync(path.join(dir, 'version.dll'), 'attacker');
  assert.equal(verifyPinnedTorFiles(dir, pins).valid, false);
});

test('WebGL coercion happens once, including hostile objects whose toString changes', () => {
  let result;
  const context = vm.createContext({ require: () => ({ contextBridge: { executeInMainWorld({ func }) { result = func; } } }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/webgl-guard-preload.cjs'), 'utf8'), context);
  vm.runInContext('globalThis.HTMLCanvasElement = class { getContext(type) { return type; } };', context);
  result();
  assert.equal(vm.runInContext("new HTMLCanvasElement().getContext({ toString() { return 'webgl'; } })", context), null);
  assert.equal(vm.runInContext("new HTMLCanvasElement().getContext({ n:0, toString() { return ++this.n === 1 ? '2d' : 'webgl'; } })", context), '2d');
});

test('cookie preload freezes JS cookies and the native CookieStore prototype in blocked frames', async () => {
  const context = vm.createContext({ DOMException });
  vm.runInContext('globalThis.Document = class {}; globalThis.document = new Document(); globalThis.cookieStore = new class { get() { return Promise.resolve(1); } set() {} getAll() {} delete() {} }; globalThis.savedStore = cookieStore;', context);
  context.require = () => ({ ipcRenderer: { sendSync: () => true }, contextBridge: { executeInMainWorld({ func }) { vm.runInContext('(' + func.toString() + ')()', context); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/cookie-guard-preload.cjs'), 'utf8'), context);
  assert.equal(vm.runInContext("document.cookie = 'x=y'; document.cookie", context), '');
  await assert.rejects(vm.runInContext("Object.getPrototypeOf(savedStore).set.call(savedStore, 'x', 'y')", context), /Cookies blocked/);
  assert.equal(vm.runInContext('cookieStore', context), undefined);
  assert.equal(vm.runInContext("Object.getOwnPropertyDescriptor(Document.prototype, 'cookie').configurable", context), false);
});

test('profile writes retry a rename briefly blocked by Windows and still fail on other errors', (t) => {
  const dir = fs.mkdtempSync(path.join(scratch, 'profile-'));
  const storage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() };
  const integrity = createProfileIntegrity(dir, storage);
  const target = path.join(dir, 'settings.json');
  const rename = fs.renameSync;
  let failures = 2;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (failures-- > 0) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return rename(from, to);
  });
  integrity.write(target, 'settings', { theme: 'dark' });
  assert.equal(integrity.open('settings', fs.readFileSync(target, 'utf8')).theme, 'dark');
  fs.renameSync.mock.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
  assert.throws(() => integrity.write(target, 'settings', {}), /missing/);
});

test('a profile key the OS can no longer decrypt is set aside and replaced instead of blocking every save', () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'profile-'));
  const working = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() };
  const target = path.join(dir, 'settings.json');
  createProfileIntegrity(dir, working).write(target, 'settings', { theme: 'dark' });
  const lostOsKey = { ...working, decryptString: () => { throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.'); } };
  const restarted = createProfileIntegrity(dir, lostOsKey);
  assert.throws(() => restarted.open('settings', fs.readFileSync(target, 'utf8')), /mismatch/);
  restarted.write(target, 'settings', { theme: 'light' });
  assert.equal(restarted.open('settings', fs.readFileSync(target, 'utf8')).theme, 'light');
  assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('integrity-key.bin.unreadable-')).length, 1);
});
