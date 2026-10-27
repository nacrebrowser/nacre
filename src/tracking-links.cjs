'use strict';

const { stripTrackingParameters } = require('./privacy-core.cjs');

const MAX_URL_LENGTH = 16 * 1024;
const MAX_UNWRAP_PASSES = 5;

const GOOGLE_HOSTS = new Set([
  'google.com', 'www.google.com',
  'google.co.uk', 'www.google.co.uk',
  'google.ca', 'www.google.ca',
  'google.com.au', 'www.google.com.au',
  'google.fr', 'www.google.fr',
  'google.de', 'www.google.de',
  'google.es', 'www.google.es',
  'google.co.jp', 'www.google.co.jp'
]);
const FACEBOOK_HOSTS = new Set(['l.facebook.com', 'lm.facebook.com']);

const PROTECTED_QUERY_NAMES = new Set([
  'signature', 'sig', 'hmac', 'hash', 'policy', 'expires', 'key-pair-id',
  'awsaccesskeyid', 'googleaccessid', 'x-amz-signature', 'x-amz-credential',
  'x-amz-algorithm', 'x-amz-signedheaders', 'x-amz-security-token',
  'x-goog-signature', 'x-goog-credential', 'x-goog-algorithm',
  'x-goog-signedheaders', 'x-goog-security-token', 'x-ms-signature',
  'x-ms-credential', 'x-ms-algorithm', 'x-ms-signedheaders',
  'access_token', 'refresh_token', 'id_token', 'oauth_token', 'auth_token',
  'token', 'session', 'session_id', 'sessionid', 'client_secret', 'code',
  'state', 'nonce', 'payment_intent', 'payment_session', 'checkout_session',
  'checkout_session_id', 'order_id'
]);

const REDIRECT_QUERY_NAMES = new Set([
  'redirect', 'redirect_to', 'redirectto', 'redirect_url', 'redirecturl',
  'redirect_uri', 'return', 'return_to', 'returnto', 'return_url',
  'returnurl', 'next', 'continue', 'destination', 'target', 'url', 'u',
  'success_url', 'cancel_url'
]);

const PROTECTED_PATH_SEGMENTS = new Set([
  'login', 'log-in', 'log_in', 'logout', 'sign-in', 'sign_in', 'signin',
  'signout', 'auth', 'oauth', 'authorize', 'authorization', 'callback',
  'payment', 'payments', 'pay', 'checkout', 'billing', 'purchase',
  'transaction', 'transactions', 'order', 'orders', 'invoice', 'invoices',
  'redirect', 'redirects', 'redir', 'out', 'external', 'leave', 'link-out',
  'linkout', 'url', 'l.php'
]);

function unchanged(value, reason) {
  return {
    url: typeof value === 'string' ? value : '',
    changed: false,
    reasons: reason ? [reason] : []
  };
}

function parseHttpUrl(value) {
  if (typeof value !== 'string' || !value) return { error: 'invalid-input' };
  if (value.length > MAX_URL_LENGTH) return { error: 'url-too-long' };
  if (!/^https?:\/\//i.test(value)) return { error: 'unsupported-scheme' };

  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: 'invalid-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'unsupported-scheme' };
  if (url.username || url.password) return { error: 'credentials' };
  return { url };
}

function knownWrapper(url) {
  if (url.port) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (GOOGLE_HOSTS.has(host) && path === '/url') {
    const candidates = ['q', 'url'].filter((name) => url.searchParams.has(name));
    return candidates.length === 1 ? { name: 'google', parameter: candidates[0] } : null;
  }
  if (FACEBOOK_HOSTS.has(host) && path === '/l.php') {
    return url.searchParams.has('u') ? { name: 'facebook', parameter: 'u' } : null;
  }
  return null;
}

function decodedPathSegment(segment) {
  try { return decodeURIComponent(segment).toLowerCase(); }
  catch { return segment.toLowerCase(); }
}

function hasProtectedPath(url, ignoredPath = '') {
  if (ignoredPath && url.pathname.toLowerCase() === ignoredPath) return false;
  const segments = url.pathname.split('/').filter(Boolean).map(decodedPathSegment);
  return segments.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment));
}

function hasProtectedQuery(url, ignoredNames = new Set()) {
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (ignoredNames.has(lower)) continue;
    if (PROTECTED_QUERY_NAMES.has(lower) || REDIRECT_QUERY_NAMES.has(lower)) return true;
  }
  return false;
}

function isProtectedUrl(url, ignoredNames = new Set(), ignoredPath = '') {
  return hasProtectedPath(url, ignoredPath) || hasProtectedQuery(url, ignoredNames);
}

function cleanFinalUrl(value, original, reasons) {
  const parsed = parseHttpUrl(value);
  if (parsed.error) return unchanged(original, parsed.error);

  let stripped;
  try {
    stripped = new URL(stripTrackingParameters(parsed.url.href));
  } catch {
    return unchanged(original, 'invalid-url');
  }
  const removedTrackingParameters = stripped.search !== parsed.url.search;
  if (removedTrackingParameters) reasons.push('tracking-parameters-removed');
  const output = removedTrackingParameters ? stripped.href : value;
  return { url: output, changed: output !== original, reasons };
}

/**
 * Unwraps only supported, exact redirect URL formats, then removes known
 * tracking parameters from the destination. Potentially signed, authenticated,
 * payment, or generic redirect URLs are preserved without modification.
 */
function cleanTrackingLink(value, options = {}) {
  if (options && options.enabled === false) return unchanged(value, 'disabled');

  const initial = parseHttpUrl(value);
  if (initial.error) return unchanged(value, initial.error);

  const original = value;
  let current = value;
  const reasons = [];
  const visited = new Set();

  for (let pass = 0; pass < MAX_UNWRAP_PASSES; pass += 1) {
    if (visited.has(current)) return unchanged(original, 'wrapper-cycle');
    visited.add(current);

    const parsed = parseHttpUrl(current);
    if (parsed.error) return unchanged(original, parsed.error);
    const wrapper = knownWrapper(parsed.url);

    if (!wrapper) {
      if (isProtectedUrl(parsed.url)) return unchanged(original, 'protected-url');
      return cleanFinalUrl(current, original, reasons);
    }

    if (isProtectedUrl(parsed.url, new Set([wrapper.parameter]), parsed.url.pathname.toLowerCase())) {
      return unchanged(original, 'protected-url');
    }

    const targets = parsed.url.searchParams.getAll(wrapper.parameter);
    if (targets.length !== 1) return unchanged(original, 'invalid-wrapper-target');
    const target = targets[0];
    const targetResult = parseHttpUrl(target);
    if (targetResult.error) return unchanged(original, 'invalid-wrapper-target');
    const targetWrapper = knownWrapper(targetResult.url);
    const targetIgnoredNames = targetWrapper ? new Set([targetWrapper.parameter]) : new Set();
    const targetIgnoredPath = targetWrapper ? targetResult.url.pathname.toLowerCase() : '';
    if (isProtectedUrl(targetResult.url, targetIgnoredNames, targetIgnoredPath)) {
      return unchanged(original, 'protected-url');
    }

    reasons.push(`wrapper:${wrapper.name}`);
    current = target;
  }

  const final = parseHttpUrl(current);
  if (final.error) return unchanged(original, final.error);
  if (knownWrapper(final.url)) return unchanged(original, 'wrapper-depth-limit');
  if (isProtectedUrl(final.url)) return unchanged(original, 'protected-url');
  return cleanFinalUrl(current, original, reasons);
}

module.exports = { cleanTrackingLink, MAX_URL_LENGTH, MAX_UNWRAP_PASSES };
