'use strict';

const BACKGROUNDS = Object.freeze(['default', 'paper', 'slate', 'forest']);
const MAX_SHORTCUTS = 20;
// Same steps as Chromium's zoom bubble, limited to the 50-300 % range Nacre stores.
const ZOOM_STEPS = Object.freeze([50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300]);
function webShortcut(value) {
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || value.url.length > 2048) return null;
  try {
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\u0000-\u001f\u007f]/.test(value.url)) return null;
    const title = typeof value.title === 'string' ? value.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 48) : '';
    return { title: title || url.hostname.replace(/^www\./, ''), url: url.href };
  } catch { return null; }
}
function boundedShortcuts(list) {
  const seen = new Set();
  const shortcuts = [];
  for (const candidate of Array.isArray(list) ? list.slice(0, MAX_SHORTCUTS * 2) : []) {
    const item = webShortcut(candidate);
    if (item && !seen.has(item.url)) { seen.add(item.url); shortcuts.push(item); }
    if (shortcuts.length === MAX_SHORTCUTS) break;
  }
  return shortcuts;
}
// Version 2 (Nacre 0.9.6): the home page shows only the shortcuts the user
// placed there. Earlier versions also listed the eight latest bookmarks, so a
// starred or imported page could appear on the home page unexpectedly.
function normalizeHome(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    version: 2,
    background: BACKGROUNDS.includes(value.background) ? value.background : 'default',
    showShortcuts: value.showShortcuts !== false,
    shortcuts: boundedShortcuts(value.shortcuts)
  };
}
// Keeps what an older profile displayed: its own shortcuts, then the bookmarks
// that used to fill the home page. Every tile can now be removed or moved.
function migrateHome(raw, bookmarks) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (value.version === 2) return normalizeHome(value);
  const fromBookmarks = value.showBookmarks === false || !Array.isArray(bookmarks) ? [] : bookmarks.slice(0, 8);
  return normalizeHome({ ...value, shortcuts: [...(Array.isArray(value.shortcuts) ? value.shortcuts : []), ...fromBookmarks] });
}
// Typed addresses may omit the scheme ("youtube.com"); https is assumed.
function shortcutFromInput(title, address) {
  const text = String(address || '').trim();
  if (!text || /\s/.test(text)) return null;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text;
  try { if (!new URL(url).hostname.includes('.') && new URL(url).hostname !== 'localhost') return null; } catch { return null; }
  return webShortcut({ title, url });
}
// add / update / remove / move on the ordered shortcut list. Returns the new
// list, or null when the request is invalid or the list is full.
function applyShortcutAction(list, request) {
  const shortcuts = boundedShortcuts(list);
  const data = request && typeof request === 'object' ? request : {};
  const index = Number.isInteger(data.index) && data.index >= 0 && data.index < shortcuts.length ? data.index : -1;
  if (data.action === 'add') {
    const item = shortcutFromInput(data.title, data.url);
    if (!item || shortcuts.length >= MAX_SHORTCUTS) return null;
    if (shortcuts.some((existing) => existing.url === item.url)) return shortcuts;
    return [...shortcuts, item];
  }
  if (index < 0) return null;
  if (data.action === 'update') {
    const item = shortcutFromInput(data.title, data.url);
    if (!item || shortcuts.some((existing, position) => position !== index && existing.url === item.url)) return null;
    return shortcuts.map((existing, position) => position === index ? item : existing);
  }
  if (data.action === 'remove') return shortcuts.filter((_item, position) => position !== index);
  if (data.action === 'move') {
    const target = Number.isInteger(data.to) ? Math.min(Math.max(0, data.to), shortcuts.length - 1) : -1;
    if (target < 0) return null;
    const next = shortcuts.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    return next;
  }
  return null;
}
function nextZoom(current, action, fallback = 100) {
  if (action === 'reset') return fallback;
  const value = Number(current) || fallback;
  if (action === 'in') return ZOOM_STEPS.find((step) => step > value) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
  if (action === 'out') return [...ZOOM_STEPS].reverse().find((step) => step < value) || ZOOM_STEPS[0];
  return value;
}
function pageBounds({ width, height, chromeHeight, sidebarWidth = 0, split = false, ratio = .5 }) {
  const w = Math.max(0, Math.floor(Number(width) || 0)), h = Math.max(0, Math.floor(Number(height) || 0));
  const x = Math.min(Math.max(0, Math.floor(sidebarWidth)), Math.max(0, w - 320));
  const y = Math.min(Math.max(80, Math.ceil(chromeHeight || 80)), Math.max(0, h - 120));
  const available = w - x, pageHeight = Math.max(0, h - y);
  if (!split || available < 480) return [{ x, y, width: available, height: pageHeight }];
  const fraction = Number.isFinite(ratio) ? Math.min(.75, Math.max(.25, ratio)) : .5;
  const left = Math.floor((available - 6) * fraction);
  return [{ x, y, width: left, height: pageHeight }, { x: x + left + 6, y, width: available - left - 6, height: pageHeight }];
}
function canSplit(first, second) {
  if (!first || !second || first.id === second.id || first.private !== second.private || first.workspaceId !== second.workspaceId) return false;
  return [first, second].every(tab => !tab.internal && typeof tab.url === 'string' && /^https?:\/\//.test(tab.url));
}
module.exports = { BACKGROUNDS, MAX_SHORTCUTS, ZOOM_STEPS, webShortcut, normalizeHome, migrateHome, shortcutFromInput, applyShortcutAction, nextZoom, pageBounds, canSplit };
