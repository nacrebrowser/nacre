'use strict';

// Update security state, kept outside resettable preferences and shared by
// every profile of one installation. Values only move forward: the highest
// metadata seen, revoked keys and the completed version never go back, so a
// merge with what is on disk can never lose a revocation.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareSeen, compareVersions, parseVersion, parseTimestamp } = require('./update-verify.cjs');

// Revocations are never evicted: past this bound the state is refused
// (fail closed) rather than silently forgetting a revoked key.
const MAX_REVOKED = 1000;

function emptyState() {
  return { schema: 1, highestSeen: null, revokedKeyIds: [], pending: null, completedVersion: '', lastCheck: '' };
}

function validSeen(value) {
  return Boolean(value) && typeof value === 'object' && parseVersion(value.version) && Number.isFinite(parseTimestamp(value.issued));
}

function validPending(value) {
  return Boolean(value) && typeof value === 'object' && parseVersion(value.version)
    && Number.isSafeInteger(value.attempts) && value.attempts >= 0 && value.attempts <= 100
    && Number.isFinite(parseTimestamp(value.startedAt));
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== 1) throw new Error('Unreadable update state.');
  const state = emptyState();
  if (raw.highestSeen != null) {
    if (!validSeen(raw.highestSeen)) throw new Error('Unreadable update state.');
    state.highestSeen = { version: raw.highestSeen.version, issued: raw.highestSeen.issued };
  }
  if (!Array.isArray(raw.revokedKeyIds) || !raw.revokedKeyIds.every((id) => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id))) throw new Error('Unreadable update state.');
  state.revokedKeyIds = [...new Set(raw.revokedKeyIds)].sort();
  if (state.revokedKeyIds.length > MAX_REVOKED) throw new Error('Unreadable update state.');
  if (raw.pending != null) {
    if (!validPending(raw.pending)) throw new Error('Unreadable update state.');
    state.pending = { version: raw.pending.version, attempts: raw.pending.attempts, startedAt: raw.pending.startedAt };
  }
  if (raw.completedVersion && !parseVersion(raw.completedVersion)) throw new Error('Unreadable update state.');
  state.completedVersion = raw.completedVersion || '';
  state.lastCheck = Number.isFinite(parseTimestamp(raw.lastCheck)) ? raw.lastCheck : '';
  return state;
}

function laterTimestamp(a, b) {
  if (!a) return b;
  if (!b) return a;
  return parseTimestamp(a) >= parseTimestamp(b) ? a : b;
}

// Monotonic merge of two states. The (version, issued) pair is one ordered
// value: never a maximum taken field by field.
function mergeState(left, right) {
  const a = normalizeState(left);
  const b = normalizeState(right);
  const merged = emptyState();
  if (a.highestSeen && b.highestSeen) merged.highestSeen = compareSeen(a.highestSeen, b.highestSeen) >= 0 ? a.highestSeen : b.highestSeen;
  else merged.highestSeen = a.highestSeen || b.highestSeen;
  merged.revokedKeyIds = [...new Set([...a.revokedKeyIds, ...b.revokedKeyIds])].sort();
  if (merged.revokedKeyIds.length > MAX_REVOKED) throw new Error('Too many revoked update keys.');
  if (a.completedVersion && b.completedVersion) merged.completedVersion = compareVersions(a.completedVersion, b.completedVersion) >= 0 ? a.completedVersion : b.completedVersion;
  else merged.completedVersion = a.completedVersion || b.completedVersion;
  if (a.pending && b.pending && a.pending.version === b.pending.version) {
    merged.pending = { version: a.pending.version, attempts: Math.max(a.pending.attempts, b.pending.attempts), startedAt: laterTimestamp(a.pending.startedAt, b.pending.startedAt) };
  } else if (a.pending && b.pending) {
    merged.pending = parseTimestamp(a.pending.startedAt) >= parseTimestamp(b.pending.startedAt) ? a.pending : b.pending;
  } else {
    merged.pending = a.pending || b.pending;
  }
  // A pending installation of a version already completed is finished.
  if (merged.pending && merged.completedVersion && compareVersions(merged.pending.version, merged.completedVersion) <= 0) merged.pending = null;
  merged.lastCheck = laterTimestamp(a.lastCheck, b.lastCheck);
  return merged;
}

function readState(file, fileSystem = fs) {
  let text;
  try { text = fileSystem.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return emptyState(); throw error; }
  if (text.length > 64 * 1024) throw new Error('Unreadable update state.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('Unreadable update state.'); }
  return normalizeState(raw);
}

// Temporary file, fsync, then rename: a crash leaves either the old or the
// new state, never a partial one.
function writeState(file, state, fileSystem = fs) {
  const data = JSON.stringify(normalizeState(state), null, 2) + '\n';
  fileSystem.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const descriptor = fileSystem.openSync(temporary, 'wx', 0o600);
  try {
    fileSystem.writeSync(descriptor, data);
    fileSystem.fsyncSync(descriptor);
  } finally {
    fileSystem.closeSync(descriptor);
  }
  try { fileSystem.renameSync(temporary, file); }
  catch (error) { try { fileSystem.unlinkSync(temporary); } catch {} throw error; }
}

// Re-read under ownership, apply the change to what is on disk, merge, write.
function updateState(file, change, fileSystem = fs) {
  const current = readState(file, fileSystem);
  const merged = mergeState(current, change(structuredClone(current)));
  writeState(file, merged, fileSystem);
  return merged;
}

function ownershipName(file, platform = process.platform) {
  let resolved = path.resolve(file);
  try { resolved = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved)); } catch {}
  if (platform === 'win32') resolved = resolved.toLowerCase();
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 24);
  if (platform === 'win32') return `\\\\.\\pipe\\nacre-updater-${hash}`;
  if (platform === 'linux') return `\0nacre-updater-${hash}`;
  return '';
}

// Ownership of updater work for one state file: an exclusive listening pipe
// (Windows) or abstract socket (Linux). The operating system releases it when
// the owning process dies; a live owner is never dispossessed, whatever the
// duration of its operation. Resolves to a release function, or null when
// another process owns it.
function acquireOwnership(file, platform = process.platform) {
  const name = ownershipName(file, platform);
  if (!name) return Promise.resolve(null);
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once('error', () => resolve(null));
    server.listen(name, () => {
      server.unref();
      let released = false;
      resolve(() => new Promise((done) => {
        if (released) { done(); return; }
        released = true;
        server.close(() => done());
      }));
    });
  });
}

module.exports = { emptyState, normalizeState, mergeState, readState, writeState, updateState, ownershipName, acquireOwnership };
