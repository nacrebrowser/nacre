'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Antivirus and indexing services can hold a freshly written file for a few
// milliseconds on Windows, making rename fail with EPERM, EACCES or EBUSY.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return fs.renameSync(from, to); } catch (error) {
      if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
    }
  }
}

function createProfileIntegrity(directory, safeStorage) {
  let key;
  function secret() {
    if (key) return key;
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure profile key storage unavailable');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'integrity-key.bin');
    let encoded = null;
    if (fs.existsSync(file)) {
      // Chromium keeps the safeStorage key in Local State and writes it late. If
      // the first run is killed before that, the key file can never be decrypted
      // again. Set it aside and start a new key: data signed with the old one is
      // then rejected once, with a backup, instead of every save failing forever.
      try { encoded = safeStorage.decryptString(fs.readFileSync(file)); }
      catch { renameWithRetry(file, file + '.unreadable-' + Date.now()); }
    }
    if (encoded !== null) {
      if (!/^[a-f0-9]{64}$/.test(encoded)) throw new Error('Invalid profile integrity key');
      key = Buffer.from(encoded, 'hex');
    }
    else {
      key = crypto.randomBytes(32);
      fs.writeFileSync(file, safeStorage.encryptString(key.toString('hex')), { flag: 'wx', mode: 0o600 });
    }
    if (key.length !== 32) throw new Error('Invalid profile integrity key');
    return key;
  }
  const mac = (purpose, payload) => crypto.createHmac('sha256', secret()).update(purpose + '\0').update(payload).digest('hex');
  function seal(purpose, data) {
    const payload = JSON.stringify(data);
    return JSON.stringify({ version: 1, payload, hmac: mac(purpose, payload) });
  }
  function open(purpose, text) {
    const envelope = JSON.parse(text);
    if (envelope.version !== 1 || typeof envelope.payload !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.hmac)) throw new Error('Unsigned profile data rejected');
    if (!crypto.timingSafeEqual(Buffer.from(envelope.hmac, 'hex'), Buffer.from(mac(purpose, envelope.payload), 'hex'))) throw new Error('Profile integrity mismatch');
    return JSON.parse(envelope.payload);
  }
  function write(file, purpose, data) {
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, seal(purpose, data), { mode: 0o600 });
    renameWithRetry(temporary, file);
  }
  return { seal, open, write };
}
module.exports = { createProfileIntegrity };
