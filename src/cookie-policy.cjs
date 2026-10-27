'use strict';

const { getDomain } = require('tldts-experimental');
const { isIP } = require('node:net');

function cookieRemovalUrl(cookie) {
  let host = String(cookie.domain || '').replace(/^\./, '');
  const ipv6 = isIP(host.replace(/^\[|\]$/g, '')) === 6;
  if (isIP(host) === 6) host = '[' + host + ']';
  const url = new URL((cookie.secure ? 'https://' : 'http://') + host);
  // A cookie domain must be a host, never credentials, a port or a path.
  if (!host || (!ipv6 && url.host.toLowerCase() !== host.toLowerCase()) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid cookie domain.');
  url.pathname = cookie.path || '/';
  return url.href;
}

function hostFromUrl(value) {
  try { return new URL(String(value || '')).hostname.toLowerCase().replace(/\.$/, ''); }
  catch { return ''; }
}

function siteForHost(host) {
  const normalized = String(host || '').toLowerCase().replace(/\.$/, '');
  return getDomain(normalized, { allowPrivateDomains: true }) || normalized;
}

function cookieSite(value) {
  try {
    const url = new URL(String(value || ''));
    const scheme = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
    if (!['http:', 'https:'].includes(scheme) || !url.hostname) return '';
    return scheme + '//' + siteForHost(url.hostname);
  } catch { return ''; }
}

function cookieContextForRequest(details, tabUrl = '') {
  const context = {
    requestUrl: details.url,
    resourceType: details.resourceType,
    tabUrl,
    topFrameOrigin: '',
    ancestorOrigins: []
  };
  try {
    let frame = details.frame;
    if (!frame) return context;
    context.topFrameOrigin = frame.top.origin;
    // The requested document replaces this frame's old document. Its parent
    // ancestry still applies; the old document's origin must not decide whether
    // a same-site frame navigation can receive cookies.
    if (details.resourceType === 'subFrame') frame = frame.parent;
    const visited = new Set();
    while (frame) {
      if (visited.has(frame)) throw new Error('Cyclic frame ancestry');
      visited.add(frame);
      context.ancestorOrigins.push(frame.origin);
      frame = frame.parent;
    }
  } catch {
    // Detached/destroyed/opaque frame state cannot prove first-party status.
    context.ancestorOrigins = ['null'];
  }
  return context;
}

function shouldBlockRequestCookies(policy, context = {}) {
  if (policy === 'block-all') return true;
  if (policy !== 'block-third-party') return false;
  if (context.resourceType === 'mainFrame') return false;

  const requestSite = cookieSite(context.requestUrl);
  // A detached worker's initiator is the worker's own origin. It says nothing
  // about the top-level site which registered or invoked it. Do not use that
  // origin as evidence of first-party status: strip both outgoing and incoming
  // cookies when the trusted top-level context is unavailable.
  const contextSite = cookieSite(context.topFrameOrigin || context.tabUrl);
  if (!requestSite || !contextSite) return true;
  if ((context.ancestorOrigins || []).some(origin => cookieSite(origin) !== contextSite)) return true;
  return requestSite !== contextSite;
}

module.exports = {
  cookieRemovalUrl,
  hostFromUrl,
  siteForHost,
  cookieSite,
  cookieContextForRequest,
  shouldBlockRequestCookies
};
