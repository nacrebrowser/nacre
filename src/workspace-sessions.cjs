'use strict';

const crypto = require('node:crypto');

const LEGACY_PARTITION = 'persist:nacre';
const WORKSPACE_PARTITION_PREFIX = 'persist:nacre-workspace-';
const WORKSPACE_PARTITION_RE = /^persist:nacre-workspace-[a-f0-9]{24}$/;
const WORKSPACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(record, key) {
  if (!isRecord(record)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function validWorkspaceId(value) {
  return typeof value === 'string' && WORKSPACE_ID_RE.test(value)
    && !['private', '__proto__', 'prototype', 'constructor'].includes(value);
}

function validPersistentPartition(value) {
  return value === LEGACY_PARTITION || (typeof value === 'string' && WORKSPACE_PARTITION_RE.test(value));
}

function allocatePartition(createToken, used) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const token = createToken();
    const partition = typeof token === 'string' && WORKSPACE_PARTITION_RE.test(token)
      ? token
      : WORKSPACE_PARTITION_PREFIX + String(token || '').toLowerCase();
    if (WORKSPACE_PARTITION_RE.test(partition) && !used.has(partition)) return partition;
  }
  throw new Error('Could not allocate a unique persistent workspace session partition');
}

function normalizeScopedMap(workspaces, scoped, legacy, normalizeEntry) {
  const source = isRecord(scoped) ? scoped : Object.create(null);
  const result = Object.create(null);
  for (const workspace of workspaces) {
    const ownScoped = Object.hasOwn(source, workspace.id);
    const value = ownScoped ? ownValue(source, workspace.id)
      : workspace.id === legacy.ownerId ? legacy.value : undefined;
    result[workspace.id] = normalizeEntry(value);
  }
  return result;
}

/**
 * Normalize persistent workspace identities and migrate the former global
 * saved permission/cookie exceptions into their original profile identity.
 * The caller supplies the existing workspace list and the policy normalizers
 * used by the application.
 */
function normalizeWorkspaceIdentityState(options = {}) {
  const workspaces = Array.isArray(options.workspaces) ? options.workspaces.filter((item) =>
    item && validWorkspaceId(item.id)) : [];
  if (!workspaces.length) throw new Error('At least one normal workspace is required');

  const storedPartitions = isRecord(options.storedPartitions) ? options.storedPartitions : Object.create(null);
  const hasStoredOwner = Object.hasOwn(options, 'storedLegacyOwner');
  let legacyOwner = null;
  if (hasStoredOwner) {
    legacyOwner = options.storedLegacyOwner === null ? null
      : validWorkspaceId(options.storedLegacyOwner) ? options.storedLegacyOwner : null;
  } else {
    const priorOwner = workspaces.find((workspace) => ownValue(storedPartitions, workspace.id) === LEGACY_PARTITION);
    legacyOwner = priorOwner ? priorOwner.id : workspaces[0].id;
  }

  const partitions = Object.create(null);
  const used = new Set();
  const activeIds = new Set(workspaces.map((workspace) => workspace.id));
  const ownerIsActive = legacyOwner !== null && activeIds.has(legacyOwner);
  const storedOwnerPartition = ownerIsActive ? ownValue(storedPartitions, legacyOwner) : undefined;
  // Only an unmapped original identity may be assigned the old profile. A
  // previously stored custom partition remains that identity's stable home.
  if (ownerIsActive && storedOwnerPartition === LEGACY_PARTITION) {
    partitions[legacyOwner] = LEGACY_PARTITION;
    used.add(LEGACY_PARTITION);
  } else if (ownerIsActive && storedOwnerPartition === undefined) {
    partitions[legacyOwner] = LEGACY_PARTITION;
    used.add(LEGACY_PARTITION);
  }

  for (const workspace of workspaces) {
    const { id } = workspace;
    if (Object.hasOwn(partitions, id)) continue;
    const partition = ownValue(storedPartitions, id);
    if (validPersistentPartition(partition) && partition !== LEGACY_PARTITION && !used.has(partition)) {
      partitions[id] = partition;
      used.add(partition);
    }
  }

  for (const workspace of workspaces) {
    const { id } = workspace;
    if (Object.hasOwn(partitions, id)) continue;
    const partition = allocatePartition(options.createToken || (() => crypto.randomBytes(12).toString('hex')), used);
    partitions[id] = partition;
    used.add(partition);
  }

  const permissionNormalizer = options.normalizePermissions || ((value) => value && typeof value === 'object' && !Array.isArray(value) ? value : Object.create(null));
  const cookieNormalizer = options.normalizeCookiePolicies || permissionNormalizer;
  const workspaceSitePermissions = normalizeScopedMap(workspaces, options.storedSitePermissionsByWorkspace, {
    ownerId: legacyOwner,
    value: options.legacySitePermissions
  }, permissionNormalizer);
  const workspaceSiteCookiePolicies = normalizeScopedMap(workspaces, options.storedCookiePoliciesByWorkspace, {
    ownerId: legacyOwner,
    value: options.legacySiteCookiePolicies
  }, cookieNormalizer);

  return {
    workspaceLegacyOwner: legacyOwner,
    workspaceSessionPartitions: partitions,
    workspaceSitePermissions,
    workspaceSiteCookiePolicies
  };
}

function createSerialQueue() {
  let tail = Promise.resolve();
  return {
    run(task) {
      if (typeof task !== 'function') return Promise.reject(new TypeError('Queue task must be a function'));
      const result = tail.then(task, task);
      tail = result.catch(() => {});
      return result;
    },
    idle() { return tail; }
  };
}

async function waitForAll(operations) {
  const results = await Promise.allSettled(operations);
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) throw new AggregateError(failures, 'Session operations failed');
  return results.map(result => result.value);
}

function workspaceSessionEntries(workspaces, partitions) {
  return (Array.isArray(workspaces) ? workspaces : []).flatMap((workspace) => {
    const partition = ownValue(partitions, workspace && workspace.id);
    return workspace && validWorkspaceId(workspace.id) && validPersistentPartition(partition)
      ? [{ workspaceId: workspace.id, partition }]
      : [];
  });
}

module.exports = {
  LEGACY_PARTITION,
  WORKSPACE_PARTITION_PREFIX,
  WORKSPACE_PARTITION_RE,
  normalizeWorkspaceIdentityState,
  createSerialQueue,
  waitForAll,
  workspaceSessionEntries
};
