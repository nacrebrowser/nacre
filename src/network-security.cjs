'use strict';

const CLOSED_PROXY_HOST = '127.0.0.1';
const CLOSED_PROXY_PORT = 1;

function closedProxyConfig() {
  return {
    mode: 'fixed_servers',
    proxyRules: `http=${CLOSED_PROXY_HOST}:${CLOSED_PROXY_PORT};https=${CLOSED_PROXY_HOST}:${CLOSED_PROXY_PORT};socks=${CLOSED_PROXY_HOST}:${CLOSED_PROXY_PORT}`,
    proxyBypassRules: '<-loopback>'
  };
}

function chromiumPrivacySwitches() {
  return Object.freeze([
    ['disable-background-networking'],
    ['disable-component-update'],
    ['disable-sync'],
    ['disable-default-apps'],
    ['no-pings'],
    ['disable-breakpad'],
    ['disable-domain-reliability'],
    ['disable-quic'],
    ['disable-preconnect'],
    ['disable-prerender-local-predictor'],
    ['dns-prefetch-disable'],
    ['disable-features', 'OptimizationHints,MediaRouter,SafeBrowsingEnhancedProtection,SafeBrowsingRealtimeLookup,SafeBrowsingOnDeviceModel']
  ]);
}

function shouldAllowHttpRequest(url, httpsOnly, acceptedHttpUrl, acceptedDocumentUrl, isMainFrame = false) {
  if (!httpsOnly) return true;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'ws:') return true;
  if (!acceptedHttpUrl || !acceptedDocumentUrl || acceptedHttpUrl !== acceptedDocumentUrl) return false;
  return !isMainFrame || url === acceptedDocumentUrl;
}

function isHttpUrl(url) {
  try { return new URL(url).protocol === 'http:'; } catch { return false; }
}

module.exports = {
  CLOSED_PROXY_HOST,
  CLOSED_PROXY_PORT,
  closedProxyConfig,
  chromiumPrivacySwitches,
  shouldAllowHttpRequest,
  isHttpUrl
};
