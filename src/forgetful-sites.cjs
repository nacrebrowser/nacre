'use strict';

// Volatile origin ownership, never full URLs or persisted browsing history.
// Retain every opted-in origin until its last owning tab closes, including
// tabs which have since navigated away or entered Reader/Share.
function createForgetfulSites() {
  const sessions = new Map();
  function remember(tab, value, enabledHosts) {
    if (!tab || tab.private || !tab.browserSession) return;
    let url;
    try { url = new URL(value); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || !enabledHosts.includes(url.hostname)) return;
    let origins = sessions.get(tab.browserSession);
    if (!origins) sessions.set(tab.browserSession, origins = new Map());
    let entry = origins.get(url.origin);
    if (!entry) origins.set(url.origin, entry = { host: url.hostname, owners: new Set() });
    entry.owners.add(tab.id);
  }
  function release(tab) {
    const origins = sessions.get(tab.browserSession);
    if (!origins) return [];
    for (const entry of origins.values()) entry.owners.delete(tab.id);
    return ready(tab.browserSession);
  }
  function ready(ses) {
    const origins = sessions.get(ses);
    if (!origins) return [];
    const occupied = new Set([...origins.values()].filter(entry => entry.owners.size).map(entry => entry.host));
    return [...origins].filter(([, entry]) => !occupied.has(entry.host)).map(([origin]) => origin);
  }
  function complete(ses, origin) {
    const origins = sessions.get(ses);
    if (!origins?.get(origin)?.owners.size) origins?.delete(origin);
    if (!origins?.size) sessions.delete(ses);
  }
  function disable(host) {
    for (const [ses, origins] of sessions) {
      for (const [origin, entry] of origins) if (entry.host === host) origins.delete(origin);
      if (!origins.size) sessions.delete(ses);
    }
  }
  function snapshot() { return new Map([...sessions].map(([ses, origins]) => [ses, [...origins.keys()]])); }
  function syncEnabled(hosts) {
    const obsolete = new Set();
    for (const origins of sessions.values()) for (const entry of origins.values()) if (!hosts.includes(entry.host)) obsolete.add(entry.host);
    for (const host of obsolete) disable(host);
  }
  return { remember, release, ready, complete, disable, syncEnabled, snapshot };
}

module.exports = { createForgetfulSites };
