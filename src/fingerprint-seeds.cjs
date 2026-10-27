'use strict';

const crypto = require('node:crypto');

function createFingerprintSeedStore(randomBytes = crypto.randomBytes) {
  const sessions = new WeakMap();
  return Object.freeze({
    forSite(session, registrableDomain) {
      if (!session || (typeof session !== 'object' && typeof session !== 'function')) throw new TypeError('Session Electron requise.');
      if (typeof registrableDomain !== 'string' || !/^(?=.{1,253}$)[a-z0-9.-]+$/i.test(registrableDomain)) throw new TypeError('Domaine enregistrable invalide.');
      let secret = sessions.get(session);
      if (!secret) {
        secret = randomBytes(32);
        if (!Buffer.isBuffer(secret) || secret.length !== 32) throw new TypeError('Le secret doit contenir 32 octets.');
        sessions.set(session, secret);
      }
      return crypto.createHmac('sha256', secret).update(registrableDomain.toLowerCase()).digest('hex');
    }
  });
}

function fingerprintNoise(secret, index) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret) || !Number.isSafeInteger(index) || index < 0) throw new TypeError('Entrée de bruit d’empreinte invalide.');
  let seed = 2166136261;
  for (const char of secret) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  let value = (seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value & 1) ? 1 : -1;
}

module.exports = { createFingerprintSeedStore, fingerprintNoise };
