'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pages = fs.readdirSync(path.join(root,'src')).filter(name=>name.endsWith('.html')).map((name) => ({
  name,
  html: fs.readFileSync(path.join(root, 'src', name), 'utf8')
}));
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const errorJs = fs.readFileSync(path.join(root, 'src', 'error.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
const settingsJs = fs.readFileSync(path.join(root, 'src', 'settings.js'), 'utf8');
const english = require('../src/locales/en.json');
const i18n = require('../src/i18n.cjs');

function visibleTextNodes(html) {
  const tokens = html.match(/<[^>]*>|[^<]+/g) || [];
  const stack = [];
  const nodes = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const token of tokens) {
    if (token.startsWith('</')) {
      const tag = token.match(/^<\/([\w-]+)/)?.[1];
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag === tag) { stack.length = index; break; }
      }
      continue;
    }
    if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag || tag.startsWith('!')) continue;
      const attrs = Object.fromEntries([...token.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
      if (!voidTags.has(tag)) stack.push({ tag, attrs });
      continue;
    }
    const text = token.trim();
    if (!text || stack.some(({ tag, attrs }) => ['script','style','kbd','code'].includes(tag) || attrs['aria-hidden'] === 'true')) continue;
    if (/^(?:Nacre|NACRE|[\d\s.,%+−\-/:·×◈⌕↑↓←→↗!]+)$/.test(text)) continue;
    if (/^(?:[A-Z]{2}|[0-9]+(?:[.,][0-9]+)?|[↑↓×⌕◈!])$/.test(text)) continue;
    const element = stack.at(-1);
    if (element && element.attrs['data-i18n-child'] !== undefined) continue;
    if (element) nodes.push({ text, key: element.attrs['data-i18n'] || '' });
  }
  return nodes;
}

test('every visible static page text node has a non-empty English catalogue entry', () => {
  for (const page of pages) {
    const unkeyed = visibleTextNodes(page.html).filter(({ key }) => !key);
    assert.deepEqual(unkeyed, [], `${page.name} has unkeyed visible text: ${unkeyed.map(({ text }) => text).join(' | ')}`);
    const keys = [...page.html.matchAll(/\bdata-i18n="([^"]+)"/g)].map((match) => match[1]);
    for (const key of keys) assert.equal(typeof english[key], 'string', `${page.name} missing ${key}`);
    for (const [, mappings] of page.html.matchAll(/\bdata-i18n-attr="([^"]+)"/g)) {
      for (const mapping of mappings.split(';')) {
        const [, key] = mapping.split(':', 2);
        assert.equal(typeof english[key], 'string', `${page.name} missing attribute key ${key}`);
      }
    }
  }
  assert.equal(english._status, 'pending-review');
});

test('pages have no variable innerHTML assignments, inline scripts, or inline styles', () => {
  for (const page of pages) {
    assert.doesNotMatch(page.html, /\b(?:[\w$.]+\.)?innerHTML\s*=/i, `${page.name} assigns innerHTML`);
    assert.doesNotMatch(page.html, /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i, `${page.name} has an inline script`);
    assert.doesNotMatch(page.html, /<style\b/i, `${page.name} has an inline style element`);
    assert.doesNotMatch(page.html, /\sstyle\s*=/i, `${page.name} has an inline style attribute`);
  }
});

test('every English key uses the dotted catalogue key style', () => {
  for (const key of Object.keys(english)) {
    if (key === '_status') continue;
    assert.match(key, /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/, `Invalid English key: ${key}`);
    assert.equal(typeof english[key], 'string');
    assert.ok(english[key].trim(), `Empty English value: ${key}`);
  }
});

test('page catalogue lookup uses read-only IPC and inserts hostile markup only as text', async () => {
  const h = require('../scripts/test-support/preload-locale-harness.cjs').localeHarness();
  await h.ready();
  assert.deepEqual(h.calls.map(item => item.channel), ['nacre:get-language','nacre:get-messages','nacre:get-messages','nacre:get-messages']);
  assert.deepEqual(h.calls.filter(item=>item.channel==='nacre:get-messages').map(item=>item.language),['fr','en','fr']);
  assert.equal(h.calls[1].language, 'fr');
  assert.equal(h.text.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(h.attribute.attrs.title, h.text.textContent);
  assert.equal(h.attribute.attrs.onclick, undefined);
  assert.equal(h.document.documentElement.lang, 'fr');
  assert.equal(h.api.nacre.getLocaleText('fixture.text'), h.text.textContent);
});

test('dynamic renderer and error-page states resolve English catalogue keys', () => {
  assert.match(renderer, /const t = \(key\) => typeof messages\[key\] === 'string'/);
  assert.match(renderer, /api\.getMessages\(language\)/);
  assert.match(renderer, /toast\.textContent\s*=\s*item\.key\s*\?\s*t\(item\.key\)/);
  const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
  assert.doesNotMatch(main, /messageKeyForToast/, 'toasts send keys; no reverse lookup from French text');
  for (const [, key] of main.matchAll(/notify\('([a-zA-Z]+\.[a-zA-Z]+)'/g)) assert.equal(typeof english[key], 'string', key);
  assert.match(renderer, /function renderVPN\(\)/);
  assert.match(renderer, /t\('tor\.[A-Za-z0-9.]+'\)/);
  const errorJs = fs.readFileSync(path.join(root, 'src', 'error.js'), 'utf8');
  assert.match(errorJs, /api\.getLocaleText\(key\)/);
  assert.match(errorJs, /nacre:locale-ready/);
  assert.match(errorJs, /textContent\s*=/);
  assert.doesNotMatch(errorJs, /innerHTML/);
  assert.match(settingsJs, /language-restart-notice/);
  assert.ok(i18n.t('tor.menuStateDefault', 'en'));
});
