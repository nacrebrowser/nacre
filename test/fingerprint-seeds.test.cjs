'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFingerprintSeedStore, fingerprintNoise } = require('../src/fingerprint-seeds.cjs');

test('le bruit d’empreinte est stable par domaine dans une session et change entre sites et sessions', () => {
  let sequence = 0;
  const store = createFingerprintSeedStore((size) => Buffer.alloc(size, ++sequence));
  const firstSession = {};
  const secondSession = {};
  const firstSite = store.forSite(firstSession, 'example.co.uk');
  assert.equal(store.forSite(firstSession, 'example.co.uk'), firstSite);
  const otherSite = store.forSite(firstSession, 'other.example');
  const otherSession = store.forSite(secondSession, 'example.co.uk');
  assert.notEqual(firstSite, otherSite);
  assert.notEqual(firstSite, otherSession);
  const noise = (secret) => Array.from({ length: 128 }, (_, index) => fingerprintNoise(secret, index));
  assert.deepEqual(noise(firstSite), noise(firstSite));
  assert.notDeepEqual(noise(firstSite), noise(otherSession));
  assert.notDeepEqual(noise(firstSite), noise(otherSite));
});

test('les secrets invalides et domaines non valides sont rejetés', () => {
  const store = createFingerprintSeedStore();
  assert.throws(() => store.forSite({}, 'not a domain'));
  assert.throws(() => fingerprintNoise('secret', 0));
});
