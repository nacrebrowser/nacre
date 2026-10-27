'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWorkspaceIdentityState: normalize, createSerialQueue, waitForAll, workspaceSessionEntries } = require('../src/workspace-sessions.cjs');
const workspaces = [{ id: 'personal' }, { id: 'work' }];

test('legacy data and saved policies migrate only to their original identity and remain stable', () => {
  const old = normalize({ workspaces, legacySitePermissions: { 'example.test': { camera: 'allow' } }, legacySiteCookiePolicies: { 'example.test': 'allow' } });
  assert.equal(old.workspaceSessionPartitions.personal, 'persist:nacre');
  assert.notEqual(old.workspaceSessionPartitions.work, 'persist:nacre');
  assert.equal(old.workspaceSitePermissions.personal['example.test'].camera, 'allow');
  assert.equal(old.workspaceSitePermissions.work['example.test'], undefined);
  assert.equal(old.workspaceSiteCookiePolicies.work['example.test'], undefined);
  const restored = normalize({ workspaces, storedLegacyOwner: old.workspaceLegacyOwner, storedPartitions: old.workspaceSessionPartitions,
    storedSitePermissionsByWorkspace: old.workspaceSitePermissions, storedCookiePoliciesByWorkspace: old.workspaceSiteCookiePolicies });
  assert.deepEqual(restored, old);
});

test('deleted legacy owner is never reassigned, even when an identity reuses its old name', () => {
  const result = normalize({ workspaces, storedLegacyOwner: null, storedPartitions: { personal: 'persist:nacre' } });
  assert.equal(result.workspaceLegacyOwner, null);
  for (const partition of Object.values(result.workspaceSessionPartitions)) assert.notEqual(partition, 'persist:nacre');
});

test('untrusted partition aliases, duplicate mappings and accessor values cannot merge identities', () => {
  const duplicate = 'persist:nacre-workspace-' + 'a'.repeat(24);
  const partitions = Object.create(null);
  Object.defineProperty(partitions, 'personal', { get() { throw Error('getter executed'); } });
  partitions.work = duplicate;
  partitions.third = duplicate;
  const result = normalize({ workspaces: [...workspaces, { id: 'third' }], storedLegacyOwner: null,
    storedPartitions: partitions });
  assert.equal(new Set(Object.values(result.workspaceSessionPartitions)).size, 3);
  assert.equal(Object.getPrototypeOf(result.workspaceSessionPartitions), null);
  assert.equal(workspaceSessionEntries(workspaces, { personal: 'persist:arbitrary', work: duplicate }).length, 1);
});

test('identity mutations wait for pending predecessors and continue after a failure', async () => {
  const queue = createSerialQueue(), calls = [];
  let release;
  const first = queue.run(async () => { calls.push('first'); await new Promise(resolve => { release = resolve; }); throw Error('clear failed'); });
  const second = queue.run(() => calls.push('second'));
  await Promise.resolve();
  assert.deepEqual(calls, ['first']);
  release();
  await assert.rejects(first, /clear failed/);
  await second; await queue.idle();
  assert.deepEqual(calls, ['first', 'second']);
});

test('multi-session operations wait for every outcome before reporting collected failures', async () => {
  let release, finished = false;
  const first = Error('first failure'), second = Error('second failure');
  const pending = waitForAll([Promise.reject(first), new Promise((_resolve, reject) => { release = () => reject(second); })]);
  pending.catch(() => { finished = true; });
  await new Promise(setImmediate);
  assert.equal(finished, false);
  release();
  await assert.rejects(pending, error => error instanceof AggregateError && error.errors[0] === first && error.errors[1] === second);
});
