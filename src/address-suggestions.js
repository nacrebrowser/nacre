(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NacreAddressSuggestions = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_SUGGESTIONS = 6;

  function hostOf(value) {
    try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  // Returns stable bookmark suggestions for the text typed in the address bar.
  // Only saved bookmarks are searched; Nacre has no browsing history to query.
  function filterBookmarks(bookmarks, query, limit = MAX_SUGGESTIONS) {
    const items = Array.isArray(bookmarks) ? bookmarks : [];
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return [];
    const scored = [];
    for (const item of items) {
      if (!item || typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) continue;
      const title = typeof item.title === 'string' ? item.title : '';
      const url = item.url;
      const host = hostOf(url);
      const titleMatch = title.toLocaleLowerCase().indexOf(needle);
      const hostMatch = host.toLocaleLowerCase().indexOf(needle);
      const urlMatch = url.toLocaleLowerCase().indexOf(needle);
      if (titleMatch === -1 && hostMatch === -1 && urlMatch === -1) continue;
      const score = hostMatch === 0 ? 0 : titleMatch === 0 ? 1 : hostMatch > 0 ? 2 : titleMatch > 0 ? 3 : 4;
      scored.push({ item, score });
    }
    scored.sort((left, right) => left.score - right.score || left.item.url.localeCompare(right.item.url));
    const seen = new Set();
    const result = [];
    for (const { item } of scored) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      result.push(item);
      if (result.length >= Math.max(1, Math.min(MAX_SUGGESTIONS, Number(limit) || MAX_SUGGESTIONS))) break;
    }
    return result;
  }

  return Object.freeze({ MAX_SUGGESTIONS, filterBookmarks, hostOf });
}));
