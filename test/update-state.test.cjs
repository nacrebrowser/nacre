'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const store = require('../src/update-state.cjs');

function tempFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-update-state-'));
  return { directory, file: path.join(directory, 'update-state.json') };
}

test('(highestSeenVersion, highestSeenIssued) merge as one ordered pair, never field by field', () => {
  const older = { ...store.emptyState(), highestSeen: { version: '1.1.1', issued: '2026-11-05T12:00:00Z' } };
  const newer = { ...store.emptyState(), highestSeen: { version: '1.1.2', issued: '2026-11-05T11:45:00Z' } };
  assert.deepEqual(store.mergeState(older, newer).highestSeen, { version: '1.1.2', issued: '2026-11-05T11:45:00Z' });
  assert.deepEqual(store.mergeState(newer, older).highestSeen, { version: '1.1.2', issued: '2026-11-05T11:45:00Z' });
});

test('revocations and completed versions only move forward; a completed pending install is cleared', () => {
  const a = { ...store.emptyState(), revokedKeyIds: ['k1'], pending: { version: '1.1.1', attempts: 1, startedAt: '2026-11-05T12:00:00Z' } };
  const b = { ...store.emptyState(), revokedKeyIds: ['k2'], completedVersion: '1.1.1' };
  const merged = store.mergeState(a, b);
  assert.deepEqual(merged.revokedKeyIds, ['k1', 'k2']);
  assert.equal(merged.pending, null);
  assert.equal(merged.completedVersion, '1.1.1');
});

test('the state file survives interleaved writers: no revocation or advance is lost', () => {
  const { directory, file } = tempFile();
  try {
    // Two processes each start from an old copy, then write in turn.
    store.updateState(file, (state) => ({ ...state, revokedKeyIds: ['k-revoked'] }));
    store.updateState(file, (state) => ({ ...state, highestSeen: { version: '1.1.2', issued: '2026-11-05T12:00:00Z' }, revokedKeyIds: [] }));
    store.updateState(file, (state) => ({ ...state, pending: { version: '1.1.2', attempts: 1, startedAt: '2026-11-05T12:00:00Z' }, highestSeen: null }));
    const state = store.readState(file);
    assert.deepEqual(state.revokedKeyIds, ['k-revoked']);
    assert.deepEqual(state.highestSeen, { version: '1.1.2', issued: '2026-11-05T12:00:00Z' });
    assert.equal(state.pending.version, '1.1.2');
    assert.deepEqual(fs.readdirSync(directory), ['update-state.json'], 'no temporary file left behind');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a damaged state file is reported, never silently replaced by an empty state', () => {
  const { directory, file } = tempFile();
  try {
    fs.writeFileSync(file, '{"schema":1,"revokedKeyIds":"oops"}');
    assert.throws(() => store.readState(file), /Unreadable update state/);
    assert.throws(() => store.updateState(file, (state) => state), /Unreadable update state/);
    assert.deepEqual(store.readState(path.join(directory, 'missing.json')), store.emptyState());
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('ownership: two simultaneous acquisitions give one owner; release lets the next one in', async () => {
  const { directory, file } = tempFile();
  try {
    const [first, second] = await Promise.all([store.acquireOwnership(file), store.acquireOwnership(file)]);
    assert.equal([first, second].filter(Boolean).length, 1);
    const owner = first || second;
    assert.equal(await store.acquireOwnership(file), null, 'a live owner keeps ownership, whatever the time elapsed');
    await owner();
    const next = await store.acquireOwnership(file);
    assert.ok(next);
    await next();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('ownership held by a killed process is released by the operating system', async () => {
  const { directory, file } = tempFile();
  const child = spawn(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(__dirname, '..', 'src', 'update-state.cjs'))}).acquireOwnership(${JSON.stringify(file)})
      .then((release) => { process.stdout.write(release ? 'owned\\n' : 'busy\\n'); setInterval(() => {}, 1000); });
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const line = await new Promise((resolve) => child.stdout.once('data', (data) => resolve(String(data).trim())));
    assert.equal(line, 'owned');
    assert.equal(await store.acquireOwnership(file), null);
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
    let reclaimed = null;
    for (let attempt = 0; attempt < 20 && !reclaimed; attempt += 1) {
      reclaimed = await store.acquireOwnership(file);
      if (!reclaimed) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(reclaimed, 'the next process takes over after the owner died');
    await reclaimed();
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('revocations are never evicted: too many means the state is refused, not truncated', () => {
  const many = Array.from({ length: 1000 }, (_, index) => 'k' + String(index).padStart(4, '0'));
  const state = store.normalizeState({ ...store.emptyState(), revokedKeyIds: many });
  assert.equal(state.revokedKeyIds.length, 1000);
  assert.throws(() => store.mergeState(state, { ...store.emptyState(), revokedKeyIds: ['zzz-extra'] }), /Too many revoked/);
  assert.throws(() => store.normalizeState({ ...store.emptyState(), revokedKeyIds: [...many, 'zzz-extra'] }), /Unreadable/);
});
