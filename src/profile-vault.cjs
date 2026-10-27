'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIG_FILE = 'profile-vault.json';
const SETTINGS_FILE = 'settings.json';
const JOURNAL_FILE = '.profile-vault-transaction.json';
const CONFIG_FORMAT = 'nacre-profile-vault-key';
const ENVELOPE_FORMAT = 'nacre-profile-vault-envelope';
const JOURNAL_FORMAT = 'nacre-profile-vault-transaction';
const WRAP_PURPOSE = 'vault-key-wrap';
const KDF = Object.freeze({ name: 'scrypt', N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PASSWORD_BYTES = 1024;
const MIN_PASSWORD_CODEPOINTS = 12;
const MAX_PLAINTEXT_BYTES = 5_000_000;
const MAX_ENVELOPE_BYTES = 7_000_000;
const MAX_TRANSACTION_FILES = 4;
const ALLOWED_FILES = new Set([SETTINGS_FILE, CONFIG_FILE, 'bookmarks.json']);

class VaultLockedError extends Error {
  constructor() {
    super('The profile vault is locked');
    this.name = 'VaultLockedError';
  }
}

class VaultAuthenticationError extends Error {
  constructor() {
    // Keep wrong passwords, damaged metadata, and altered ciphertext identical.
    super('Unable to authenticate protected profile data');
    this.name = 'VaultAuthenticationError';
  }
}

class VaultTransactionError extends Error {
  constructor() {
    super('The profile file transaction could not be completed safely');
    this.name = 'VaultTransactionError';
  }
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value, expectedLength) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('invalid');
  const result = Buffer.from(value, 'base64url');
  if (result.toString('base64url') !== value || (expectedLength !== undefined && result.length !== expectedLength)) throw new Error('invalid');
  return result;
}

function validatePurpose(purpose) {
  if (typeof purpose !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(purpose)) throw new TypeError('Invalid vault purpose');
  return purpose;
}

function passwordBytes(password, requireStrong) {
  if (typeof password !== 'string') throw new TypeError('Password must be a string');
  const bytes = Buffer.from(password, 'utf8');
  const codepoints = [...password].length;
  if (bytes.length > MAX_PASSWORD_BYTES || (requireStrong && codepoints < MIN_PASSWORD_CODEPOINTS)) {
    bytes.fill(0);
    throw new RangeError(requireStrong
      ? `Password must contain at least ${MIN_PASSWORD_CODEPOINTS} characters and at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`
      : 'Invalid password');
  }
  return bytes;
}

function deriveKey(password, salt) {
  const pass = passwordBytes(password, false);
  return new Promise((resolve, reject) => {
    crypto.scrypt(pass, salt, KEY_BYTES, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: KDF.maxmem }, (error, derived) => {
      pass.fill(0);
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

function aad(purpose) {
  return Buffer.from(`nacre-profile-vault:v1:${validatePurpose(purpose)}`, 'utf8');
}

function encryptBuffer(purpose, plaintext, key) {
  const bytes = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new RangeError('Protected profile data exceeds the size limit');
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(purpose));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    format: ENVELOPE_FORMAT,
    version: 1,
    purpose,
    nonce: encode(nonce),
    ciphertext: encode(ciphertext),
    tag: encode(cipher.getAuthTag())
  };
}

function decryptBuffer(purpose, envelope, key) {
  try {
    const parsed = typeof envelope === 'string'
      ? (envelope.length <= MAX_ENVELOPE_BYTES ? JSON.parse(envelope) : null)
      : envelope;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.format !== ENVELOPE_FORMAT || parsed.version !== 1 || parsed.purpose !== purpose) throw new Error('invalid');
    const nonce = decode(parsed.nonce, NONCE_BYTES);
    const ciphertext = decode(parsed.ciphertext);
    const tag = decode(parsed.tag, TAG_BYTES);
    if (ciphertext.length > MAX_PLAINTEXT_BYTES) throw new Error('invalid');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(purpose));
    decipher.setAuthTag(tag);
    const result = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (result.length > MAX_PLAINTEXT_BYTES) throw new Error('invalid');
    return result;
  } catch {
    throw new VaultAuthenticationError();
  }
}

function isEncrypted(value) {
  if (typeof value !== 'string' || value.length > MAX_ENVELOPE_BYTES) return false;
  try {
    const parsed = JSON.parse(value);
    return Boolean(parsed && parsed.format === ENVELOPE_FORMAT && parsed.version === 1);
  } catch {
    return false;
  }
}

function parseConfig(text) {
  try {
    if (typeof text !== 'string' || text.length > 16_384) throw new Error('invalid');
    const config = JSON.parse(text);
    if (!config || typeof config !== 'object' || Array.isArray(config)
      || config.format !== CONFIG_FORMAT || config.version !== 1
      || !config.kdf || config.kdf.name !== KDF.name || config.kdf.N !== KDF.N
      || config.kdf.r !== KDF.r || config.kdf.p !== KDF.p) throw new Error('invalid');
    decode(config.salt, SALT_BYTES);
    const wrapped = config.wrappedKey;
    if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)
      || wrapped.format !== ENVELOPE_FORMAT || wrapped.version !== 1 || wrapped.purpose !== WRAP_PURPOSE) throw new Error('invalid');
    decode(wrapped.nonce, NONCE_BYTES);
    decode(wrapped.ciphertext, KEY_BYTES);
    decode(wrapped.tag, TAG_BYTES);
    return config;
  } catch {
    throw new VaultAuthenticationError();
  }
}

function wrapDataKey(password, dataKey) {
  const salt = crypto.randomBytes(SALT_BYTES);
  return deriveKey(password, salt).then((wrappingKey) => {
    try {
      return JSON.stringify({
        format: CONFIG_FORMAT,
        version: 1,
        kdf: { name: KDF.name, N: KDF.N, r: KDF.r, p: KDF.p },
        salt: encode(salt),
        wrappedKey: encryptBuffer(WRAP_PURPOSE, dataKey, wrappingKey)
      });
    } finally {
      wrappingKey.fill(0);
    }
  });
}

function ensureDirectory(directory, fileSystem) {
  fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function existsRegular(filePath, fileSystem) {
  try {
    const stat = fileSystem.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new VaultTransactionError();
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function allowedName(name) {
  return typeof name === 'string' && ALLOWED_FILES.has(name);
}

function writeNewFile(filePath, content, fileSystem) {
  const fd = fileSystem.openSync(filePath, 'wx', 0o600);
  try {
    fileSystem.writeFileSync(fd, content);
    fileSystem.fsyncSync(fd);
  } finally {
    fileSystem.closeSync(fd);
  }
}

function removeIfExists(filePath, fileSystem) {
  try { fileSystem.unlinkSync(filePath); } catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
}

function writeJournal(directory, journal, fileSystem) {
  const temporary = path.join(directory, `.profile-vault-transaction-${journal.id}.journal.tmp`);
  const target = path.join(directory, JOURNAL_FILE);
  writeNewFile(temporary, JSON.stringify(journal), fileSystem);
  fileSystem.renameSync(temporary, target);
}

function readJournal(directory, fileSystem) {
  const file = path.join(directory, JOURNAL_FILE);
  if (!existsRegular(file, fileSystem)) return null;
  let journal;
  try {
    const stat = fileSystem.statSync(file);
    if (stat.size > 16_384) throw new Error('invalid');
    journal = JSON.parse(fileSystem.readFileSync(file, 'utf8'));
  } catch {
    throw new VaultTransactionError();
  }
  if (!journal || journal.format !== JOURNAL_FORMAT || journal.version !== 1
    || typeof journal.id !== 'string' || !/^[a-f0-9]{24}$/.test(journal.id)
    || !Array.isArray(journal.records) || journal.records.length < 1 || journal.records.length > MAX_TRANSACTION_FILES) {
    throw new VaultTransactionError();
  }
  const seen = new Set();
  for (const record of journal.records) {
    if (!record || !allowedName(record.name) || seen.has(record.name)
      || typeof record.hadOriginal !== 'boolean' || typeof record.remove !== 'boolean') {
      throw new VaultTransactionError();
    }
    seen.add(record.name);
  }
  return journal;
}

function recordPaths(directory, journal, index) {
  const stem = `.profile-vault-tx-${journal.id}-${index}`;
  return {
    target: path.join(directory, journal.records[index].name),
    temporary: path.join(directory, `${stem}.tmp`),
    backup: path.join(directory, `${stem}.bak`)
  };
}

function recoverTransaction(directory, fileSystem) {
  if (!fileSystem.existsSync(directory)) return;
  const journal = readJournal(directory, fileSystem);
  if (journal) {
    const markerPath = path.join(directory, `.profile-vault-tx-${journal.id}.committed`);
    const committed = existsRegular(markerPath, fileSystem);
    if (committed) {
      for (let index = 0; index < journal.records.length; index++) {
        const files = recordPaths(directory, journal, index);
        removeIfExists(files.backup, fileSystem);
        removeIfExists(files.temporary, fileSystem);
      }
    } else {
      for (let index = journal.records.length - 1; index >= 0; index--) {
        const record = journal.records[index];
        const files = recordPaths(directory, journal, index);
        const hasBackup = existsRegular(files.backup, fileSystem);
        if (record.hadOriginal && hasBackup) {
          removeIfExists(files.target, fileSystem);
          fileSystem.renameSync(files.backup, files.target);
        } else if (!record.hadOriginal) {
          removeIfExists(files.target, fileSystem);
        }
        removeIfExists(files.temporary, fileSystem);
      }
    }
    removeIfExists(path.join(directory, JOURNAL_FILE), fileSystem);
    removeIfExists(path.join(directory, `.profile-vault-tx-${journal.id}.committed`), fileSystem);
  }
  // An orphan commit marker means the journal was removed after a completed transaction.
  for (const name of fileSystem.readdirSync(directory)) {
    if (/^\.profile-vault-tx-[a-f0-9]{24}\.committed$/.test(name)) removeIfExists(path.join(directory, name), fileSystem);
    if (/^\.profile-vault-transaction-[a-f0-9]{24}\.journal\.tmp$/.test(name)) removeIfExists(path.join(directory, name), fileSystem);
  }
}

function transact(directory, changes, fileSystem) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_TRANSACTION_FILES) throw new TypeError('Invalid profile transaction');
  ensureDirectory(directory, fileSystem);
  recoverTransaction(directory, fileSystem);
  const seen = new Set();
  const normalized = changes.map((change) => {
    if (!change || !allowedName(change.name) || seen.has(change.name)
      || !(change.content === null || typeof change.content === 'string' || Buffer.isBuffer(change.content))) {
      throw new TypeError('Invalid profile transaction');
    }
    seen.add(change.name);
    if (change.content !== null && Buffer.byteLength(change.content) > MAX_ENVELOPE_BYTES) throw new RangeError('Profile file exceeds the size limit');
    const target = path.join(directory, change.name);
    return { ...change, hadOriginal: existsRegular(target, fileSystem) };
  });
  const id = crypto.randomBytes(12).toString('hex');
  const journal = {
    format: JOURNAL_FORMAT,
    version: 1,
    id,
    records: normalized.map(({ name, hadOriginal, content }) => ({ name, hadOriginal, remove: content === null }))
  };
  const marker = path.join(directory, `.profile-vault-tx-${id}.committed`);
  try {
    writeJournal(directory, journal, fileSystem);
    for (let index = 0; index < normalized.length; index++) {
      const change = normalized[index];
      if (change.content !== null) {
        const files = recordPaths(directory, journal, index);
        writeNewFile(files.temporary, change.content, fileSystem);
      }
    }
    for (let index = 0; index < normalized.length; index++) {
      const change = normalized[index];
      const files = recordPaths(directory, journal, index);
      if (change.hadOriginal) fileSystem.renameSync(files.target, files.backup);
      if (change.content !== null) fileSystem.renameSync(files.temporary, files.target);
    }
    writeNewFile(marker, '', fileSystem);
  } catch {
    let committed = false;
    try { committed = existsRegular(marker, fileSystem); } catch {}
    if (committed) {
      try { recoverTransaction(directory, fileSystem); } catch { throw new VaultTransactionError(); }
      return;
    }
    try { recoverTransaction(directory, fileSystem); } catch { throw new VaultTransactionError(); }
    throw new VaultTransactionError();
  }
  try {
    recoverTransaction(directory, fileSystem);
  } catch {
    throw new VaultTransactionError();
  }
}

function createProfileVault(directory, options = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('Profile directory is required');
  const fileSystem = options.fs || fs;
  const root = path.resolve(directory);
  const configPath = path.join(root, CONFIG_FILE);
  const settingsPath = path.join(root, SETTINGS_FILE);
  let dataKey = null;

  // Recover interrupted enable/disable/password-change operations before callers read settings.
  recoverTransaction(root, fileSystem);

  function isConfigured() {
    return existsRegular(configPath, fileSystem);
  }

  function isUnlocked() {
    return Boolean(dataKey);
  }

  function requireKey() {
    if (!dataKey) throw new VaultLockedError();
    return dataKey;
  }

  function seal(purpose, plaintext) {
    validatePurpose(purpose);
    if (typeof plaintext !== 'string' && !Buffer.isBuffer(plaintext)) throw new TypeError('Protected profile data must be text or bytes');
    const envelope = encryptBuffer(purpose, plaintext, requireKey());
    return JSON.stringify(envelope);
  }

  function open(purpose, envelopeText) {
    validatePurpose(purpose);
    if (typeof envelopeText !== 'string') throw new VaultAuthenticationError();
    return decryptBuffer(purpose, envelopeText, requireKey()).toString('utf8');
  }

  function lock() {
    if (dataKey) dataKey.fill(0);
    dataKey = null;
  }

  async function unwrapDataKey(password) {
    let wrappingKey;
    try {
      const configText = fileSystem.readFileSync(configPath, 'utf8');
      const config = parseConfig(configText);
      wrappingKey = await deriveKey(password, decode(config.salt, SALT_BYTES));
      const key = decryptBuffer(WRAP_PURPOSE, config.wrappedKey, wrappingKey);
      if (key.length !== KEY_BYTES) {
        key.fill(0);
        throw new VaultAuthenticationError();
      }
      return key;
    } catch {
      throw new VaultAuthenticationError();
    } finally {
      if (wrappingKey) wrappingKey.fill(0);
    }
  }

  async function verifyPassword(password) {
    const candidateKey = await unwrapDataKey(password);
    try {
      if (dataKey && !crypto.timingSafeEqual(candidateKey, dataKey)) throw new VaultAuthenticationError();
      return true;
    } finally {
      candidateKey.fill(0);
    }
  }

  async function enable(password, signedSettingsText) {
    passwordBytes(password, true).fill(0);
    if (isConfigured()) throw new Error('Profile vault is already enabled');
    if (typeof signedSettingsText !== 'string' || Buffer.byteLength(signedSettingsText) > MAX_PLAINTEXT_BYTES) {
      throw new RangeError('Settings data exceeds the size limit');
    }
    const key = crypto.randomBytes(KEY_BYTES);
    try {
      const configText = await wrapDataKey(password, key);
      const encryptedSettings = JSON.stringify(encryptBuffer('settings', signedSettingsText, key));
      transact(root, [
        { name: SETTINGS_FILE, content: encryptedSettings },
        { name: CONFIG_FILE, content: configText }
      ], fileSystem);
      dataKey = key;
      return true;
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }

  async function unlock(password) {
    if (dataKey) return verifyPassword(password);
    dataKey = await unwrapDataKey(password);
    return true;
  }

  async function changePassword(password) {
    const key = requireKey();
    passwordBytes(password, true).fill(0);
    const configText = await wrapDataKey(password, key);
    transact(root, [{ name: CONFIG_FILE, content: configText }], fileSystem);
    return true;
  }

  function disable() {
    const key = requireKey();
    let signedSettingsText;
    try {
      const encryptedSettings = fileSystem.readFileSync(settingsPath, 'utf8');
      signedSettingsText = decryptBuffer('settings', encryptedSettings, key).toString('utf8');
    } catch (error) {
      if (error instanceof VaultAuthenticationError) throw error;
      throw new VaultAuthenticationError();
    }
    transact(root, [
      { name: SETTINGS_FILE, content: signedSettingsText },
      { name: CONFIG_FILE, content: null }
    ], fileSystem);
    lock();
    return true;
  }

  return Object.freeze({
    isConfigured,
    isUnlocked,
    isEncrypted,
    seal,
    open,
    enable,
    unlock,
    verifyPassword,
    changePassword,
    disable,
    lock
  });
}

module.exports = {
  createProfileVault,
  isVaultEnvelope: isEncrypted,
  VaultLockedError,
  VaultAuthenticationError,
  VaultTransactionError,
  limits: Object.freeze({
    kdf: Object.freeze({ name: KDF.name, N: KDF.N, r: KDF.r, p: KDF.p, maxmem: KDF.maxmem }),
    minPasswordCodepoints: MIN_PASSWORD_CODEPOINTS,
    maxPasswordBytes: MAX_PASSWORD_BYTES,
    maxPlaintextBytes: MAX_PLAINTEXT_BYTES,
    maxEnvelopeBytes: MAX_ENVELOPE_BYTES
  })
};
