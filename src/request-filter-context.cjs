'use strict';
const { cookieContextForRequest, siteForHost } = require('./cookie-policy.cjs');

function webURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}

function filterContext(details, tabUrl = '') {
  const ancestry = cookieContextForRequest(details, tabUrl);
  const topUrl = webURL(ancestry.topFrameOrigin) || webURL(tabUrl);
  let sourceUrl = '';
  try { sourceUrl = webURL(details.frame?.url); } catch {}
  sourceUrl ||= webURL(details.initiatorOrigin) || webURL(details.initiator) || webURL(tabUrl);
  let requestHost = '', topHost = '';
  try { requestHost = new URL(details.url).hostname.toLowerCase(); } catch {}
  if (topUrl) topHost = new URL(topUrl).hostname.toLowerCase();
  return { sourceUrl, topUrl, requestHost, topHost,
    thirdParty: topHost && requestHost ? siteForHost(topHost) !== siteForHost(requestHost) : null };
}

// Electron retains one listener per event. An accidental later registration
// must fail loudly instead of silently removing the browser's policy chain.
const registered = new WeakSet();
function registerRequestFilter(webRequest, filter, listener) {
  if (registered.has(webRequest)) throw Error('Nacre request filter is already registered');
  const register = webRequest.onBeforeRequest.bind(webRequest);
  Object.defineProperty(webRequest, 'onBeforeRequest', {
    configurable: false, writable: false,
    value() { throw Error('Nacre owns onBeforeRequest; extend the shared request policy instead'); }
  });
  register(filter, listener);
  registered.add(webRequest);
}

module.exports = { filterContext, registerRequestFilter };
