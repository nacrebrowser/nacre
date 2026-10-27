'use strict';

const QUAD9_DOH = 'https://dns.quad9.net/dns-query';

// Chromium host resolver options for the current network route.
// - Tor or a proxy: secure DNS is off so DNS cannot open a parallel direct
//   DoH connection. SOCKS5 receives hostnames and resolves them remotely.
// - strict: Quad9 over HTTPS only. Nothing resolves if Quad9 is blocked.
// - automatic (default): Quad9 over HTTPS, with Chromium falling back to the
//   system resolver when Quad9 cannot be reached.
function hostResolverOptions(proxyActive, mode) {
  if (proxyActive) return { secureDnsMode: 'off' };
  return {
    secureDnsMode: mode === 'strict' ? 'secure' : 'automatic',
    secureDnsServers: [QUAD9_DOH]
  };
}

// Network errors that strict DNS can cause when Quad9 is unreachable.
function isStrictDnsFailure(errorCode, mode, proxyActive) {
  if (proxyActive || mode !== 'strict') return false;
  return ['ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED', 'ERR_DNS_TIMED_OUT', 'ERR_DNS_MALFORMED_RESPONSE', 'ERR_DNS_SERVER_FAILED']
    .includes(String(errorCode || '').replace(/^net::/, ''));
}

module.exports = { QUAD9_DOH, hostResolverOptions, isStrictDnsFailure };
