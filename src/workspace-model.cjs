'use strict';

const MAX_WORKSPACES = 20;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 64;
const PRIVATE_WORKSPACE_ID = 'private';

const DEFAULT_WORKSPACES = Object.freeze([
  Object.freeze({ id: 'personal', name: 'Personal' }),
  Object.freeze({ id: 'work', name: 'Work' })
]);

const PROTOTYPE_KEYS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype'
]);

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownDataValue(record, key) {
  if (!isPlainRecord(record)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function workspaceId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return null;
  if (id === PRIVATE_WORKSPACE_ID || PROTOTYPE_KEYS.has(id)) return null;
  return id;
}

function workspaceName(value, truncate = false) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const characters = Array.from(trimmed);
  if (!truncate && characters.length > MAX_NAME_LENGTH) return null;
  return characters.slice(0, MAX_NAME_LENGTH).join('').trim() || null;
}

function sanitizeWorkspaceList(raw) {
  if (!Array.isArray(raw)) return null;

  let length;
  try {
    length = raw.length;
  } catch {
    return null;
  }

  const items = [];
  const seen = new Set();
  for (let index = 0; index < length && items.length < MAX_WORKSPACES; index += 1) {
    let candidate;
    try {
      candidate = raw[index];
    } catch {
      continue;
    }
    const id = workspaceId(ownDataValue(candidate, 'id'));
    const name = workspaceName(ownDataValue(candidate, 'name'), true);
    if (id === null || name === null || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, name });
  }
  return items;
}

function rawWorkspaceList(raw) {
  let candidate = raw;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  if (isPlainRecord(candidate)) {
    candidate = ownDataValue(candidate, 'workspaces');
  }
  return Array.isArray(candidate) ? candidate : null;
}

function normalizeWorkspaces(raw) {
  try {
    const list = rawWorkspaceList(raw);
    const normalized = list ? sanitizeWorkspaceList(list) : null;
    if (!normalized || normalized.length === 0) {
      return DEFAULT_WORKSPACES.map(({ id, name }) => ({ id, name }));
    }
    return normalized;
  } catch {
    return DEFAULT_WORKSPACES.map(({ id, name }) => ({ id, name }));
  }
}

function existingWorkspaces(existing) {
  try {
    return sanitizeWorkspaceList(existing);
  } catch {
    return null;
  }
}

function createWorkspace(existing, name, id) {
  const current = existingWorkspaces(existing);
  const safeName = workspaceName(name);
  const safeId = workspaceId(id);
  if (!current || safeName === null || safeId === null || current.length >= MAX_WORKSPACES) return existing;
  if (current.some((workspace) => workspace.id === safeId)) return existing;
  return [...current, { id: safeId, name: safeName }];
}

function renameWorkspace(existing, id, name) {
  const current = existingWorkspaces(existing);
  const safeId = workspaceId(id);
  const safeName = workspaceName(name);
  if (!current || safeId === null || safeName === null) return existing;
  if (!current.some((workspace) => workspace.id === safeId)) return existing;
  return current.map((workspace) => ({
    id: workspace.id,
    name: workspace.id === safeId ? safeName : workspace.name
  }));
}

function removeWorkspace(existing, id) {
  const current = existingWorkspaces(existing);
  const safeId = workspaceId(id);
  if (!current || safeId === null || current.length <= 1) return existing;
  if (!current.some((workspace) => workspace.id === safeId)) return existing;
  return current.filter((workspace) => workspace.id !== safeId);
}

function normalWorkspaceId(id, workspaces) {
  const safeId = workspaceId(id);
  return safeId !== null && workspaces.some((workspace) => workspace.id === safeId) ? safeId : null;
}

function workspaceForTab(tab, normalWorkspaces, activeWorkspaceId) {
  const workspaces = normalizeWorkspaces(normalWorkspaces);
  if (ownDataValue(tab, 'private') === true) return PRIVATE_WORKSPACE_ID;

  // Normal workspace IDs organize tabs only; they never select a separate session.
  const tabId = normalWorkspaceId(ownDataValue(tab, 'workspaceId'), workspaces);
  if (tabId !== null) return tabId;

  const activeId = normalWorkspaceId(activeWorkspaceId, workspaces);
  return activeId || workspaces[0].id;
}

function publicWorkspaceState(normalWorkspaces, activeId, tabs) {
  const workspaces = normalizeWorkspaces(normalWorkspaces);
  const selectedId = activeId === PRIVATE_WORKSPACE_ID
    ? PRIVATE_WORKSPACE_ID
    : normalWorkspaceId(activeId, workspaces) || workspaces[0].id;
  const counts = {};
  for (const workspace of workspaces) counts[workspace.id] = 0;
  counts[PRIVATE_WORKSPACE_ID] = 0;

  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      const id = workspaceForTab(tab, workspaces, selectedId);
      counts[id] += 1;
    }
  }

  return {
    items: [
      ...workspaces.map(({ id, name }) => ({ id, name })),
      { id: PRIVATE_WORKSPACE_ID, name: '', private: true }
    ],
    activeId: selectedId,
    counts
  };
}

function persistWorkspaceState(normalWorkspaces, activeId) {
  const workspaces = normalizeWorkspaces(normalWorkspaces);
  return {
    workspaces: workspaces.map(({ id, name }) => ({ id, name })),
    activeId: normalWorkspaceId(activeId, workspaces) || workspaces[0].id
  };
}

module.exports = {
  normalizeWorkspaces,
  createWorkspace,
  renameWorkspace,
  removeWorkspace,
  workspaceForTab,
  publicWorkspaceState,
  persistWorkspaceState
};
