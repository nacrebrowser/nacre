'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanTrackingLink, MAX_URL_LENGTH, MAX_UNWRAP_PASSES } = require('../src/tracking-links.cjs');

function wrapped(host, path, parameter, target) {
  const url = new URL(`https://${host}${path}`);
  url.searchParams.set(parameter, target);
  return url.href;
}

test('unwraps exact Google and Facebook wrappers recursively and cleans the destination', () => {
  const destination = 'https://news.example/story?utm_source=mail&page=2#part';
  const facebook = wrapped('l.facebook.com', '/l.php', 'u', destination);
  const google = wrapped('www.google.com', '/url', 'q', facebook);

  assert.deepEqual(cleanTrackingLink(google), {
    url: 'https://news.example/story?page=2#part',
    changed: true,
    reasons: ['wrapper:google', 'wrapper:facebook', 'tracking-parameters-removed']
  });
});

test('supports Google url targets and Facebook lm wrappers', () => {
  const google = wrapped('google.co.uk', '/url', 'url', 'https://news.example/a?fbclid=click');
  const facebook = wrapped('lm.facebook.com', '/l.php', 'u', 'http://news.example/b?ref=sidebar');

  assert.equal(cleanTrackingLink(google).url, 'https://news.example/a');
  assert.equal(cleanTrackingLink(facebook).url, 'http://news.example/b?ref=sidebar');
});

test('keeps functional query parameters on an ordinary destination', () => {
  const input = 'https://shop.example/search?q=red+shoes&page=2&sort=price';
  assert.deepEqual(cleanTrackingLink(input), { url: input, changed: false, reasons: [] });
});

test('does not unwrap generic redirect, login, payment, or signed URLs', () => {
  const genericRedirect = 'https://portal.example/redirect?url=https%3A%2F%2Fnews.example%2F%3Futm_source%3Dmail';
  const login = 'https://accounts.example/login?utm_source=mail&next=%2Fhome';
  const payment = 'https://shop.example/checkout?utm_medium=email';
  const signed = 'https://storage.example/file?X-Amz-Signature=abc&utm_source=mail';
  const session = 'https://shop.example/cart?session_id=secret&utm_source=mail';
  const wrappedSigned = wrapped('www.google.com', '/url', 'q', signed);

  for (const input of [genericRedirect, login, payment, signed, session, wrappedSigned]) {
    assert.deepEqual(cleanTrackingLink(input), { url: input, changed: false, reasons: ['protected-url'] });
  }
});

test('does not unwrap lookalike hosts, unsupported paths, invalid targets, or duplicate targets', () => {
  const lookalikeHost = wrapped('www.google.com.evil.example', '/url', 'q', 'https://news.example/');
  const wrongPath = wrapped('www.google.com', '/redirect', 'q', 'https://news.example/');
  const invalidTarget = wrapped('www.google.com', '/url', 'q', 'javascript:alert(1)');
  const duplicateTarget = 'https://www.google.com/url?q=https%3A%2F%2Fnews.example%2F&url=https%3A%2F%2Fother.example%2F';

  for (const input of [lookalikeHost, wrongPath, invalidTarget, duplicateTarget]) {
    const result = cleanTrackingLink(input);
    assert.equal(result.url, input);
    assert.equal(result.changed, false);
  }
});

test('disabled mode preserves the input exactly', () => {
  const input = 'https://www.google.com/url?q=https%3A%2F%2Fnews.example%2F%3Ffbclid%3Dclick';
  assert.deepEqual(cleanTrackingLink(input, { enabled: false }), {
    url: input,
    changed: false,
    reasons: ['disabled']
  });
});

test('rejects non-web, credentialed, invalid, and oversized inputs without mutation', () => {
  const cases = [
    ['javascript:alert(1)', 'unsupported-scheme'],
    ['https://user:password@example.test/article?fbclid=click', 'credentials'],
    ['https://', 'invalid-url'],
    [`https://example.test/${'a'.repeat(MAX_URL_LENGTH)}`, 'url-too-long']
  ];

  for (const [input, reason] of cases) {
    assert.deepEqual(cleanTrackingLink(input), { url: input, changed: false, reasons: [reason] });
  }
});

test('nested wrapper depth is bounded and never returns a partly cleaned chain', () => {
  let input = 'https://destination.example/article?utm_source=mail';
  for (let index = 0; index <= MAX_UNWRAP_PASSES; index += 1) {
    input = wrapped('www.google.com', '/url', 'q', input);
  }

  assert.deepEqual(cleanTrackingLink(input), {
    url: input,
    changed: false,
    reasons: ['wrapper-depth-limit']
  });
});
