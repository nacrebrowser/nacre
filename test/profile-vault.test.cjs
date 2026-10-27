'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createProfileVault,
  VaultLockedError,
  VaultAuthenticationError,
  VaultTransactionError,
  limits
} = require('../src/profile-vault.cjs');

const password = 'correct horse battery staple';

function fixture() {
  fs.mkdirSync(path.join(process.cwd(), '.cache'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.cache', 'nacre-profile-vault-'));
  const settingsPath = path.join(directory, 'settings.json');
  const signedSettings = JSON.stringify({ version: 1, payload: JSON.stringify({ theme: 'dark', bookmarks: [] }), hmac: 'a'.repeat(64) });
  fs.writeFileSync(settingsPath, signedSettings, { mode: 0o600 });
  return {
    directory,
    settingsPath,
    signedSettings,
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

async function getRejected(operation, errorType) {
  let rejected;
  try { await operation(); } catch (error) { rejected = error; }
  assert.ok(rejected instanceof errorType, `Expected ${errorType.name} rejection`);
  return rejected;
}

test('vault encrypts a signed settings envelope and opens it only while unlocked', async () => {
  const f = fixture();
  try {
    const vault = createProfileVault(f.directory);
    assert.equal(vault.isConfigured(), false);
    assert.equal(vault.isUnlocked(), false);
    assert.throws(() => vault.open('settings', f.signedSettings), VaultLockedError);

    await vault.enable(password, f.signedSettings);
    assert.equal(vault.isConfigured(), true);
    assert.equal(vault.isUnlocked(), true);
    assert.equal(vault.open('settings', fs.readFileSync(f.settingsPath, 'utf8')), f.signedSettings);
    assert.doesNotMatch(fs.readFileSync(f.settingsPath, 'utf8'), /bookmarks|theme|payload/);
    assert.throws(() => vault.open('bookmarks', fs.readFileSync(f.settingsPath, 'utf8')), VaultAuthenticationError);

    const envelopeA = vault.seal('settings', f.signedSettings);
    const envelopeB = vault.seal('settings', f.signedSettings);
    assert.notEqual(JSON.parse(envelopeA).nonce, JSON.parse(envelopeB).nonce);

    vault.lock();
    assert.equal(vault.isUnlocked(), false);
    assert.equal(await vault.verifyPassword(password), true);
    assert.equal(vault.isUnlocked(), false);
    await vault.unlock(password);
    assert.equal(vault.open('settings', fs.readFileSync(f.settingsPath, 'utf8')), f.signedSettings);
  } finally {
    f.cleanup();
  }
});

test('wrong passwords and altered ciphertext use one generic authentication error without file changes', async () => {
  const f = fixture();
  try {
    const vault = createProfileVault(f.directory);
    await vault.enable(password, f.signedSettings);
    vault.lock();
    const beforeSettings = fs.readFileSync(f.settingsPath, 'utf8');
    const beforeConfig = fs.readFileSync(path.join(f.directory, 'profile-vault.json'), 'utf8');

    const wrongPasswordError = await getRejected(() => vault.unlock('wrong password'), VaultAuthenticationError);
    assert.equal(wrongPasswordError.message, 'Unable to authenticate protected profile data');
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), beforeSettings);
    assert.equal(fs.readFileSync(path.join(f.directory, 'profile-vault.json'), 'utf8'), beforeConfig);

    await vault.unlock(password);
    assert.equal(await vault.verifyPassword(password), true);
    const wrongWhileUnlocked = await getRejected(() => vault.verifyPassword('wrong password'), VaultAuthenticationError);
    assert.equal(wrongWhileUnlocked.message, wrongPasswordError.message);
    await assert.rejects(() => vault.unlock('wrong password'), VaultAuthenticationError);
    assert.equal(vault.isUnlocked(), true);
    const envelope = JSON.parse(beforeSettings);
    envelope.tag = (envelope.tag[0] === 'A' ? 'B' : 'A') + envelope.tag.slice(1);
    let tamperError;
    try { vault.open('settings', JSON.stringify(envelope)); } catch (error) { tamperError = error; }
    assert.ok(tamperError instanceof VaultAuthenticationError);
    assert.equal(tamperError.message, wrongPasswordError.message);
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), beforeSettings);
    assert.equal(fs.readFileSync(path.join(f.directory, 'profile-vault.json'), 'utf8'), beforeConfig);
  } finally {
    f.cleanup();
  }
});

test('password rotation rewraps the same data key and disable restores the signed settings file', async () => {
  const f = fixture();
  try {
    const vault = createProfileVault(f.directory);
    await vault.enable(password, f.signedSettings);
    const encryptedSettings = fs.readFileSync(f.settingsPath, 'utf8');
    const oldConfig = fs.readFileSync(path.join(f.directory, 'profile-vault.json'), 'utf8');

    await vault.changePassword('a different long passphrase');
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), encryptedSettings);
    assert.notEqual(fs.readFileSync(path.join(f.directory, 'profile-vault.json'), 'utf8'), oldConfig);

    vault.lock();
    await assert.rejects(() => vault.unlock(password), VaultAuthenticationError);
    await vault.unlock('a different long passphrase');
    assert.equal(vault.open('settings', encryptedSettings), f.signedSettings);
    assert.equal(vault.disable(), true);
    assert.equal(vault.isConfigured(), false);
    assert.equal(vault.isUnlocked(), false);
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), f.signedSettings);
  } finally {
    f.cleanup();
  }
});

test('invalid KDF metadata, weak setup passwords, and oversized data fail within fixed bounds', async () => {
  const f = fixture();
  try {
    const vault = createProfileVault(f.directory);
    const original = fs.readFileSync(f.settingsPath, 'utf8');
    await assert.rejects(() => vault.enable('short', original), RangeError);
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), original);
    assert.equal(vault.isConfigured(), false);

    await vault.enable(password, original);
    assert.throws(() => vault.seal('settings', 'x'.repeat(limits.maxPlaintextBytes + 1)), RangeError);

    const configPath = path.join(f.directory, 'profile-vault.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.kdf.N = 2 ** 30;
    fs.writeFileSync(configPath, JSON.stringify(config));
    const restartedVault = createProfileVault(f.directory);
    const error = await getRejected(() => restartedVault.unlock(password), VaultAuthenticationError);
    assert.equal(error.message, 'Unable to authenticate protected profile data');
  } finally {
    f.cleanup();
  }
});

test('failed multi-file enable rolls back settings and leaves no enabled sidecar', async () => {
  const f = fixture();
  try {
    let failed = false;
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'renameSync') {
          return (from, to) => {
            if (!failed && to === path.join(f.directory, 'profile-vault.json')) {
              failed = true;
              const error = new Error('simulated second-file replacement failure');
              error.code = 'EIO';
              throw error;
            }
            return target.renameSync(from, to);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const vault = createProfileVault(f.directory, { fs: failingFs });
    await assert.rejects(() => vault.enable(password, f.signedSettings), VaultTransactionError);
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), f.signedSettings);
    assert.equal(fs.existsSync(path.join(f.directory, 'profile-vault.json')), false);
    assert.equal(vault.isConfigured(), false);
    assert.deepEqual(fs.readdirSync(f.directory).sort(), ['settings.json']);
  } finally {
    f.cleanup();
  }
});

test('startup recovery rolls back a transaction interrupted after replacing settings', () => {
  const f = fixture();
  try {
    const id = 'a'.repeat(24);
    const backup = path.join(f.directory, `.profile-vault-tx-${id}-0.bak`);
    fs.renameSync(f.settingsPath, backup);
    fs.writeFileSync(f.settingsPath, 'partial encrypted replacement');
    fs.writeFileSync(path.join(f.directory, `.profile-vault-tx-${id}-1.tmp`), 'staged sidecar');
    fs.writeFileSync(path.join(f.directory, '.profile-vault-transaction.json'), JSON.stringify({
      format: 'nacre-profile-vault-transaction',
      version: 1,
      id,
      records: [
        { name: 'settings.json', hadOriginal: true, remove: false },
        { name: 'profile-vault.json', hadOriginal: false, remove: false }
      ]
    }));

    const vault = createProfileVault(f.directory);
    assert.equal(vault.isConfigured(), false);
    assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), f.signedSettings);
    assert.deepEqual(fs.readdirSync(f.directory).sort(), ['settings.json']);
  } finally {
    f.cleanup();
  }
});
