'use strict';

const INTERNAL_HOSTS = new Set(['auth', 'app', 'settings', 'tests-fuite', 'downloads', 'source', 'error', 'leak-tests', 'bookmarks', 'shortcuts', 'offline', 'protection', 'reader', 'share', 'phishing']);

function isTrustedNacreMainFrame(event) {
  const frame = event && event.senderFrame;
  if (!frame || frame.isDestroyed() || frame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(frame.url);
    return url.protocol === 'nacre:' && INTERNAL_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function rawInternalUrlParts(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const match = /^nacre:\/\/([^/?#]*)([^?#]*)(?:[?#][\s\S]*)?$/i.exec(value);
  if (!match) return null;
  return { authority: match[1], pathname: match[2] || '/' };
}

function isAllowedNavigationTarget(value, { isChromeView = false, internalTab = false } = {}) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'http:' || url.protocol === 'https:') return !isChromeView;
    if (url.protocol !== 'nacre:') return false;
    const raw = rawInternalUrlParts(value);
    if (!raw || raw.authority !== url.hostname || !INTERNAL_HOSTS.has(url.hostname) || url.port
      || !isCanonicalInternalPath(raw.pathname) || url.pathname !== raw.pathname) return false;
    return isChromeView ? url.hostname === 'app' : internalTab;
  } catch { return false; }
}

function isCanonicalInternalPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('%')) return false;
  return pathname.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function isAllowedNacreRequest(urlValue, method) {
  try {
    const raw = rawInternalUrlParts(String(urlValue));
    const url = new URL(String(urlValue));
    if (!raw || raw.authority !== url.hostname || url.protocol !== 'nacre:' || !INTERNAL_HOSTS.has(url.hostname)
      || url.username || url.password || url.port || !['GET', 'HEAD'].includes(method)
      || !isCanonicalInternalPath(raw.pathname) || url.pathname !== raw.pathname) return false;
    return true;
  } catch { return false; }
}

module.exports = { INTERNAL_HOSTS, isTrustedNacreMainFrame, isAllowedNavigationTarget, isAllowedNacreRequest, isCanonicalInternalPath };
