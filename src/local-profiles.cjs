'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_VERSION = 1;
const DEFAULT_PROFILE_ID = 'personal';
const DEFAULT_PROFILE_NAME = 'Personal';
const PROFILE_ID_RE = /^[a-f0-9]{24}$/;
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/;
const APP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeProfileName(value) {
  if (typeof value !== 'string') throw new TypeError('Profile name must be text.');
  const name = value.trim();
  if (!PROFILE_NAME_RE.test(name)) {
    throw new TypeError('Profile names must be 1 to 32 letters, numbers, spaces, hyphens, or underscores.');
  }
  return name;
}

function validProfileId(value) {
  return value === DEFAULT_PROFILE_ID || (typeof value === 'string' && PROFILE_ID_RE.test(value));
}

function isPathInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function pathsOverlap(first, second) {
  return isPathInside(first, second) || isPathInside(second, first);
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function defaultProfilePaths({ appDataPath, appName = 'Nacre' }) {
  if (typeof appDataPath !== 'string' || !path.isAbsolute(appDataPath)) {
    throw new TypeError('appDataPath must be an absolute path.');
  }
  if (typeof appName !== 'string' || !APP_NAME_RE.test(appName)) {
    throw new TypeError('appName must be a simple application name.');
  }
  const container = path.join(path.resolve(appDataPath), `${appName}-profiles`);
  return {
    registryPath: path.join(container, 'profiles.json'),
    profilesDirectory: path.join(container, 'data')
  };
}

function createLocalProfiles(options = {}) {
  const fileSystem = options.fs || fs;
  if (typeof options.defaultProfilePath !== 'string' || !path.isAbsolute(options.defaultProfilePath)) {
    throw new TypeError('defaultProfilePath must be an absolute path.');
  }

  const defaultProfilePath = path.resolve(options.defaultProfilePath);
  const pathDefaults = options.appDataPath
    ? defaultProfilePaths({ appDataPath: options.appDataPath, appName: options.appName || 'Nacre' })
    : defaultProfilePaths({ appDataPath: path.dirname(defaultProfilePath), appName: options.appName || 'Nacre' });
  const registryPath = path.resolve(options.registryPath || pathDefaults.registryPath);
  const profilesDirectory = path.resolve(options.profilesDirectory || pathDefaults.profilesDirectory);

  if (pathsOverlap(defaultProfilePath, registryPath)) {
    throw new TypeError('The profile registry must be outside the default profile folder.');
  }
  if (pathsOverlap(defaultProfilePath, profilesDirectory)) {
    throw new TypeError('New profile folders must be outside the default profile folder.');
  }
  if (pathsOverlap(registryPath, profilesDirectory)) {
    throw new TypeError('The profile registry must be outside the profile data folder.');
  }

  const createId = typeof options.createId === 'function'
    ? options.createId
    : () => crypto.randomBytes(12).toString('hex');
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  let catalog = null;
  let runningProfileId = null;

  function timestamp() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Profile clock returned an invalid date.');
    return date.toISOString();
  }

  function profilePath(id) {
    if (!validProfileId(id)) throw new TypeError('Invalid local profile id.');
    if (id === DEFAULT_PROFILE_ID) return defaultProfilePath;
    const resolved = path.resolve(profilesDirectory, id);
    if (!isPathInside(profilesDirectory, resolved) || resolved === profilesDirectory) {
      throw new TypeError('Local profile path escaped its data folder.');
    }
    return resolved;
  }

  function publicProfile(entry, selectedId = catalog && catalog.selectedProfileId) {
    return {
      id: entry.id,
      name: entry.name,
      path: profilePath(entry.id),
      selected: entry.id === selectedId,
      isDefault: entry.id === DEFAULT_PROFILE_ID,
      retired: Boolean(entry.retiredAt),
      ...(entry.retiredAt ? { retiredAt: entry.retiredAt } : {})
    };
  }

  function encodeCatalog(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  function atomicWriteCatalog(value) {
    fileSystem.mkdirSync(path.dirname(registryPath), { recursive: true });
    const temporaryPath = `${registryPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const contents = encodeCatalog(value);
    try {
      fileSystem.writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      try {
        fileSystem.renameSync(temporaryPath, registryPath);
      } catch (error) {
        // Some managed Windows folders reject rename even within one folder.
        // Keep the preference writable there; normal filesystems still use the
        // atomic same-directory replacement above.
        if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
        fileSystem.writeFileSync(registryPath, contents, { encoding: 'utf8', mode: 0o600 });
        try { fileSystem.unlinkSync(temporaryPath); } catch {}
      }
    } catch (error) {
      try { fileSystem.unlinkSync(temporaryPath); } catch {}
      throw error;
    }
  }

  function backupMalformedRegistry() {
    const backupPath = `${registryPath}.corrupt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
    try {
      fileSystem.renameSync(registryPath, backupPath);
    } catch (renameError) {
      // Preserve the source before attempting a replacement when a managed
      // folder does not allow a same-volume rename.
      try {
        if (fileSystem.lstatSync(registryPath).isSymbolicLink()) throw renameError;
        fileSystem.copyFileSync(registryPath, backupPath);
      } catch (copyError) {
        if (copyError !== renameError) copyError.cause = renameError;
        throw copyError;
      }
    }
    return backupPath;
  }

  function freshCatalog() {
    return {
      version: REGISTRY_VERSION,
      selectedProfileId: DEFAULT_PROFILE_ID,
      profiles: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: timestamp() }]
    };
  }

  function normalizeCatalog(raw) {
    if (!isPlainRecord(raw) || raw.version !== REGISTRY_VERSION || !Array.isArray(raw.profiles)) {
      return { catalog: freshCatalog(), replace: true };
    }

    const seenIds = new Set([DEFAULT_PROFILE_ID]);
    const activeNames = new Set([DEFAULT_PROFILE_NAME.toLocaleLowerCase('en-US')]);
    const profiles = [{
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      createdAt: raw.profiles.find((item) => isPlainRecord(item) && item.id === DEFAULT_PROFILE_ID && validTimestamp(item.createdAt))?.createdAt || timestamp()
    }];
    let changed = false;
    const rawDefault = raw.profiles.find((item) => isPlainRecord(item) && item.id === DEFAULT_PROFILE_ID);
    if (!rawDefault || rawDefault.name !== DEFAULT_PROFILE_NAME || !validTimestamp(rawDefault.createdAt)
      || Object.keys(rawDefault).some((key) => !['id', 'name', 'createdAt'].includes(key))) {
      changed = true;
    }

    for (const item of raw.profiles) {
      if (!isPlainRecord(item) || !validProfileId(item.id) || item.id === DEFAULT_PROFILE_ID) {
        changed = true;
        continue;
      }
      if (seenIds.has(item.id)) {
        changed = true;
        continue;
      }
      let name;
      try { name = normalizeProfileName(item.name); }
      catch {
        changed = true;
        continue;
      }
      const retiredAt = validTimestamp(item.retiredAt) ? item.retiredAt : null;
      const normalizedName = name.toLocaleLowerCase('en-US');
      if (!retiredAt && activeNames.has(normalizedName)) {
        changed = true;
        continue;
      }
      seenIds.add(item.id);
      if (!retiredAt) activeNames.add(normalizedName);
      profiles.push({
        id: item.id,
        name,
        createdAt: validTimestamp(item.createdAt) ? item.createdAt : timestamp(),
        ...(retiredAt ? { retiredAt } : {})
      });
      if (item.name !== name || !validTimestamp(item.createdAt) || Boolean(item.retiredAt) !== Boolean(retiredAt)
        || Object.keys(item).some((key) => !['id', 'name', 'createdAt', 'retiredAt'].includes(key))) changed = true;
    }

    const selectedExists = profiles.some((item) => item.id === raw.selectedProfileId && !item.retiredAt);
    const selectedProfileId = selectedExists ? raw.selectedProfileId : DEFAULT_PROFILE_ID;
    if (!selectedExists) changed = true;
    if (profiles.length !== raw.profiles.length || raw.profiles[0]?.id !== DEFAULT_PROFILE_ID) changed = true;

    return {
      catalog: { version: REGISTRY_VERSION, selectedProfileId, profiles },
      replace: changed
    };
  }

  function ensureLoaded() {
    if (!catalog) throw new Error('Local profiles have not been initialized.');
  }

  function initialize() {
    if (catalog) return publicProfile(catalog.profiles.find((entry) => entry.id === catalog.selectedProfileId));

    let raw;
    let replace = false;
    try {
      const metadata = fileSystem.lstatSync(registryPath);
      if (metadata.isSymbolicLink()) {
        backupMalformedRegistry();
        raw = null;
        replace = true;
      } else {
        try {
          raw = JSON.parse(fileSystem.readFileSync(registryPath, 'utf8'));
        } catch (error) {
          if (error instanceof SyntaxError) {
            backupMalformedRegistry();
            raw = null;
            replace = true;
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      raw = null;
      replace = true;
    }

    if (raw === null) {
      catalog = freshCatalog();
      replace = true;
    } else {
      const normalized = normalizeCatalog(raw);
      catalog = normalized.catalog;
      replace = replace || normalized.replace;
      if (normalized.replace && raw && (!isPlainRecord(raw) || raw.version !== REGISTRY_VERSION || !Array.isArray(raw.profiles))) {
        backupMalformedRegistry();
      }
    }

    if (replace) atomicWriteCatalog(catalog);
    runningProfileId = catalog.selectedProfileId;
    return publicProfile(catalog.profiles.find((entry) => entry.id === catalog.selectedProfileId));
  }

  function listProfiles(options = {}) {
    ensureLoaded();
    const includeRetired = options.includeRetired === true;
    return catalog.profiles
      .filter((entry) => includeRetired || !entry.retiredAt)
      .map((entry) => publicProfile(entry));
  }

  function getSelectedProfile() {
    ensureLoaded();
    return publicProfile(catalog.profiles.find((entry) => entry.id === catalog.selectedProfileId));
  }

  function getRunningProfile() {
    ensureLoaded();
    const entry = catalog.profiles.find((item) => item.id === runningProfileId);
    return entry ? { ...publicProfile(entry), running: true } : null;
  }

  function getProfilePath(id) {
    ensureLoaded();
    if (!validProfileId(id)) throw new TypeError('Invalid local profile id.');
    const entry = catalog.profiles.find((item) => item.id === id && !item.retiredAt);
    if (!entry) throw new Error('Local profile is not available.');
    return profilePath(entry.id);
  }

  function selectProfile(id) {
    ensureLoaded();
    const entry = catalog.profiles.find((item) => item.id === id && !item.retiredAt);
    if (!entry) throw new Error('Local profile is not available.');
    if (id !== DEFAULT_PROFILE_ID) fileSystem.mkdirSync(profilePath(id), { recursive: true });
    const next = { ...catalog, selectedProfileId: id };
    atomicWriteCatalog(next);
    catalog = next;
    return getSelectedProfile();
  }

  function createProfile(inputName) {
    ensureLoaded();
    const name = normalizeProfileName(inputName);
    const normalizedName = name.toLocaleLowerCase('en-US');
    if (catalog.profiles.some((entry) => !entry.retiredAt && entry.name.toLocaleLowerCase('en-US') === normalizedName)) {
      throw new Error('A profile with this name already exists.');
    }

    let id = null;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = createId();
      if (typeof candidate === 'string' && PROFILE_ID_RE.test(candidate)
        && !catalog.profiles.some((entry) => entry.id === candidate)) {
        id = candidate;
        break;
      }
    }
    if (!id) throw new Error('Could not allocate a unique local profile id.');

    const entry = { id, name, createdAt: timestamp() };
    const next = { ...catalog, profiles: [...catalog.profiles, entry] };
    const newPath = profilePath(id);
    fileSystem.mkdirSync(newPath, { recursive: true });
    atomicWriteCatalog(next);
    catalog = next;
    return publicProfile(entry);
  }

  function removeProfile(id) {
    ensureLoaded();
    if (id === DEFAULT_PROFILE_ID) throw new Error('The original Personal profile cannot be removed.');
    if (id === runningProfileId) throw new Error('Restart into another profile before removing the profile currently in use.');
    if (id === catalog.selectedProfileId) throw new Error('Select another profile before removing this profile.');
    const index = catalog.profiles.findIndex((item) => item.id === id && !item.retiredAt);
    if (index < 0) throw new Error('Local profile is not available.');
    const entry = { ...catalog.profiles[index], retiredAt: timestamp() };
    const profiles = catalog.profiles.slice();
    profiles[index] = entry;
    const next = { ...catalog, profiles };
    atomicWriteCatalog(next);
    catalog = next;
    return publicProfile(entry);
  }

  function restoreProfile(id) {
    ensureLoaded();
    const index = catalog.profiles.findIndex((item) => item.id === id && Boolean(item.retiredAt));
    if (index < 0) throw new Error('Retired local profile was not found.');
    const entry = catalog.profiles[index];
    const normalizedName = entry.name.toLocaleLowerCase('en-US');
    if (catalog.profiles.some((item) => !item.retiredAt && item.name.toLocaleLowerCase('en-US') === normalizedName)) {
      throw new Error('An active profile already uses this name.');
    }
    const restored = { id: entry.id, name: entry.name, createdAt: entry.createdAt };
    const profiles = catalog.profiles.slice();
    profiles[index] = restored;
    const next = { ...catalog, profiles };
    atomicWriteCatalog(next);
    catalog = next;
    return publicProfile(restored);
  }

  return {
    initialize,
    listProfiles,
    getSelectedProfile,
    getRunningProfile,
    getProfilePath,
    selectProfile,
    createProfile,
    removeProfile,
    restoreProfile,
    registryPath,
    profilesDirectory
  };
}

module.exports = {
  REGISTRY_VERSION,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  defaultProfilePaths,
  normalizeProfileName,
  validProfileId,
  createLocalProfiles
};
