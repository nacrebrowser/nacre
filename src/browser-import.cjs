'use strict';

// Finds bookmarks of other browsers installed for the current Windows user
// and reads them without contacting the network. Only bookmarks are read:
// passwords, cookies and history stay where they are. The renderer only ever
// receives opaque source ids; paths are resolved again here on import.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_BOOKMARK_FILE = 20_000_000;
const MAX_PLACES_FILE = 200_000_000;
const MAX_IMPORTED = 5000;

// Chromium-family browsers keep one directory per profile under "User Data".
const CHROMIUM_BROWSERS = Object.freeze([
  { key: 'chrome', name: 'Google Chrome', base: 'LOCALAPPDATA', dir: ['Google', 'Chrome', 'User Data'] },
  { key: 'edge', name: 'Microsoft Edge', base: 'LOCALAPPDATA', dir: ['Microsoft', 'Edge', 'User Data'] },
  { key: 'brave', name: 'Brave', base: 'LOCALAPPDATA', dir: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
  { key: 'vivaldi', name: 'Vivaldi', base: 'LOCALAPPDATA', dir: ['Vivaldi', 'User Data'] },
  { key: 'chromium', name: 'Chromium', base: 'LOCALAPPDATA', dir: ['Chromium', 'User Data'] }
]);
// Opera stores a single profile directly in its data directory.
const OPERA_BROWSERS = Object.freeze([
  { key: 'opera', name: 'Opera', base: 'APPDATA', dir: ['Opera Software', 'Opera Stable'] },
  { key: 'opera-gx', name: 'Opera GX', base: 'APPDATA', dir: ['Opera Software', 'Opera GX Stable'] }
]);

function regularFile(file, limit) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit;
  } catch { return false; }
}

function readJson(file, limit) {
  if (!regularFile(file, limit)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

function cleanLabel(value, fallback) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '';
  return text || fallback;
}

function chromiumProfileNames(userData) {
  const state = readJson(path.join(userData, 'Local State'), 5_000_000);
  const cache = state && state.profile && state.profile.info_cache;
  return cache && typeof cache === 'object' ? cache : {};
}

function listDirectories(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch { return []; }
}

function findChromiumProfiles(env) {
  const sources = [];
  for (const browser of CHROMIUM_BROWSERS) {
    if (!env[browser.base]) continue;
    const userData = path.join(env[browser.base], ...browser.dir);
    const names = chromiumProfileNames(userData);
    const profiles = listDirectories(userData).filter((name) => name === 'Default' || /^Profile \d{1,4}$/.test(name));
    for (const profile of profiles) {
      const file = path.join(userData, profile, 'Bookmarks');
      if (!regularFile(file, MAX_BOOKMARK_FILE)) continue;
      const info = names[profile] && typeof names[profile] === 'object' ? names[profile] : {};
      sources.push({ id: `${browser.key}:${profile}`, browser: browser.name, profile: cleanLabel(info.name, profile), kind: 'chromium', file });
    }
  }
  for (const browser of OPERA_BROWSERS) {
    if (!env[browser.base]) continue;
    const file = path.join(env[browser.base], ...browser.dir, 'Bookmarks');
    if (regularFile(file, MAX_BOOKMARK_FILE)) sources.push({ id: `${browser.key}:default`, browser: browser.name, profile: '', kind: 'chromium', file });
  }
  return sources;
}

// profiles.ini lists Firefox profiles with their display names.
function firefoxProfileNames(root) {
  const names = new Map();
  let text = '';
  try { if (regularFile(path.join(root, 'profiles.ini'), 1_000_000)) text = fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8'); } catch {}
  let current = {};
  const flush = () => { if (current.path && current.name) names.set(path.basename(current.path.replace(/\//g, path.sep)), current.name); current = {}; };
  for (const line of text.split(/\r?\n/)) {
    if (/^\[.*\]$/.test(line.trim())) { flush(); continue; }
    const match = /^(Name|Path)=(.*)$/.exec(line.trim());
    if (match) current[match[1].toLowerCase()] = match[2];
  }
  flush();
  return names;
}

function findFirefoxProfiles(env) {
  if (!env.APPDATA) return [];
  const root = path.join(env.APPDATA, 'Mozilla', 'Firefox');
  const names = firefoxProfileNames(root);
  const sources = [];
  for (const profile of listDirectories(path.join(root, 'Profiles'))) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(profile)) continue;
    const file = path.join(root, 'Profiles', profile, 'places.sqlite');
    if (!regularFile(file, MAX_PLACES_FILE)) continue;
    sources.push({ id: `firefox:${profile}`, browser: 'Mozilla Firefox', profile: cleanLabel(names.get(profile), profile), kind: 'firefox', file });
  }
  return sources;
}

function findBrowserSources(env = process.env) {
  return [...findChromiumProfiles(env), ...findFirefoxProfiles(env)];
}

// Public description for the interface: no file paths.
function describeSources(sources) {
  return sources.map(({ id, browser, profile, kind }) => ({ id, browser, profile, kind }));
}

function pushBookmark(result, safeURL, title, url, folder) {
  if (result.length >= MAX_IMPORTED || typeof url !== 'string') return;
  const safe = safeURL(url);
  if (!safe) return;
  const label = typeof title === 'string' ? title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
  result.push({ title: label || safe, url: safe, folder: typeof folder === 'string' ? folder.slice(0, 80) : '' });
}

function parseChromiumBookmarks(data, safeURL) {
  const result = [];
  const roots = data && data.roots && typeof data.roots === 'object' ? data.roots : {};
  // Roots (bar, other, mobile) are not folders the user created; their
  // children land at the top level or keep the name of their own folder.
  const walk = (node, folder, depth) => {
    if (!node || typeof node !== 'object' || depth > 40 || result.length >= MAX_IMPORTED) return;
    if (node.type === 'url') { pushBookmark(result, safeURL, node.name, node.url, folder); return; }
    if (!Array.isArray(node.children)) return;
    const name = depth === 0 ? folder : cleanLabel(node.name, folder);
    for (const child of node.children) walk(child, name, depth + 1);
  };
  for (const key of ['bookmark_bar', 'other', 'synced']) walk(roots[key], '', 0);
  return result;
}

function readChromiumBookmarks(file, safeURL) {
  const data = readJson(file, MAX_BOOKMARK_FILE);
  if (!data) throw new Error('Impossible de lire les favoris de ce navigateur.');
  return parseChromiumBookmarks(data, safeURL);
}

// Firefox keeps its database open while it runs; work on a private copy.
function readFirefoxBookmarks(file, safeURL) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { throw new Error('Import Firefox indisponible dans cette version.'); }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-import-'));
  try {
    const copy = path.join(directory, 'places.sqlite');
    fs.copyFileSync(file, copy);
    if (regularFile(file + '-wal', MAX_PLACES_FILE)) fs.copyFileSync(file + '-wal', copy + '-wal');
    const db = new DatabaseSync(copy, { readOnly: false });
    try {
      const rows = db.prepare(`SELECT b.title AS title, p.url AS url, parent.title AS folder, parent.parent AS grand
        FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk LEFT JOIN moz_bookmarks parent ON parent.id = b.parent
        WHERE b.type = 1 AND IFNULL(parent.parent, 0) <> 4 ORDER BY b.parent, b.position LIMIT ${MAX_IMPORTED * 2}`).all();
      const result = [];
      // Folders directly under the root (toolbar, menu, unfiled) are roots;
      // children of the tags root (4) are tag entries, not bookmarks.
      for (const row of rows) pushBookmark(result, safeURL, row.title, row.url, row.grand > 1 ? cleanLabel(row.folder, '') : '');
      return result;
    } finally { db.close(); }
  } finally {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  }
}

// Site icons the other browser already stored on this computer. Chromium keeps
// them in "Favicons" next to "Bookmarks", Firefox in favicons.sqlite next to
// places.sqlite. Nothing is fetched: only icons of the wanted hosts are kept.
const MAX_ICON_BYTES = 262_144;
const MAX_ICON_ROWS = 60000;
const normalHost = (value) => String(value || '').toLowerCase().replace(/^www\./, '');
function hostOfUrl(value) { try { return normalHost(new URL(value).hostname); } catch { return ''; } }

function readIconDatabase(file, run) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return new Map(); }
  if (!regularFile(file, MAX_PLACES_FILE)) return new Map();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-icons-'));
  try {
    const copy = path.join(directory, path.basename(file));
    fs.copyFileSync(file, copy);
    if (regularFile(file + '-wal', MAX_PLACES_FILE)) fs.copyFileSync(file + '-wal', copy + '-wal');
    const db = new DatabaseSync(copy, { readOnly: false });
    try { return run(db); } finally { db.close(); }
  } catch { return new Map(); }
  finally { try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} }
}

// Keeps, for each wanted host, the icon closest to 32 px.
function collectIcons(rows, wantedHosts) {
  const wanted = new Map();
  for (const host of wantedHosts) wanted.set(normalHost(host), host);
  const best = new Map();
  for (const row of rows) {
    const host = wanted.get(hostOfUrl(row.page_url));
    const bytes = row.image_data;
    if (!host || !bytes || !bytes.length || bytes.length > MAX_ICON_BYTES) continue;
    const distance = Math.abs((Number(row.width) || 0) - 32);
    if (!best.has(host) || distance < best.get(host).distance) best.set(host, { distance, bytes: Buffer.from(bytes) });
  }
  return new Map([...best].map(([host, entry]) => [host, entry.bytes]));
}

function readSourceIcons(source, wantedHosts) {
  if (!wantedHosts || !wantedHosts.length) return new Map();
  if (source.kind === 'firefox') {
    return readIconDatabase(path.join(path.dirname(source.file), 'favicons.sqlite'), (db) => collectIcons(
      db.prepare(`SELECT p.page_url AS page_url, i.data AS image_data, i.width AS width FROM moz_pages_w_icons p
        JOIN moz_icons_to_pages m ON m.page_id = p.id JOIN moz_icons i ON i.id = m.icon_id
        WHERE i.data IS NOT NULL LIMIT ${MAX_ICON_ROWS}`).all(), wantedHosts));
  }
  return readIconDatabase(path.join(path.dirname(source.file), 'Favicons'), (db) => collectIcons(
    db.prepare(`SELECT m.page_url AS page_url, b.image_data AS image_data, b.width AS width FROM icon_mapping m
      JOIN favicon_bitmaps b ON b.icon_id = m.icon_id LIMIT ${MAX_ICON_ROWS}`).all(), wantedHosts));
}

function readSourceBookmarks(source, safeURL) {
  return source.kind === 'firefox' ? readFirefoxBookmarks(source.file, safeURL) : readChromiumBookmarks(source.file, safeURL);
}

// Adds imported bookmarks after the existing ones, skipping known addresses.
function mergeBookmarks(existing, imported, limit = 500) {
  const unique = new Map(existing.map((item) => [item.url, item]));
  let added = 0;
  for (const item of imported) {
    if (unique.size >= limit) break;
    if (unique.has(item.url)) continue;
    unique.set(item.url, item);
    added++;
  }
  return { bookmarks: Array.from(unique.values()), added, skipped: imported.length - added };
}

module.exports = {
  findBrowserSources,
  describeSources,
  parseChromiumBookmarks,
  readSourceBookmarks,
  readSourceIcons,
  collectIcons,
  mergeBookmarks
};
