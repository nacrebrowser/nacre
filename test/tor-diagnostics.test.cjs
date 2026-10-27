'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTorLog, explainTorFailure } = require('../src/tor-diagnostics.cjs');

test('bridge diagnosis names selected transport and gives probable timeout cause', () => {
  const result = explainTorFailure('bootstrap timed out', 'Bridge obfs4 176.185.202.9:443 failed', 'obfs4');
  assert.match(result, /Pont obfs4/);
  assert.match(result, /délai dépassé/);
  assert.doesNotMatch(result, /176\.185/);
});

test('bridge diagnosis classifies refusal, transport binary and invalid bridge line', () => {
  assert.match(explainTorFailure('connection refused', '', 'snowflake'), /Pont Snowflake sélectionné · connexion refusée/);
  assert.match(explainTorFailure('lyrebird executable not found', '', 'obfs4'), /binaire de transport manquant/);
  assert.match(explainTorFailure('Tor configuration invalid bridge line', '', 'obfs4'), /ligne de pont invalide/);
});

test('Tor logs redact IPv4, IPv6 and local profile paths', () => {
  const value = sanitizeTorLog('C:\\Users\\ExampleUser\\AppData\\Local 176.185.202.0 2001:db8::1');
  assert.doesNotMatch(value, /ExampleUser|176\.185|2001:db8/);
  assert.match(value, /\[profil local\]/);
  assert.match(value, /\[adresse réseau\]/);
});

test('the normal "Read configuration file" notice is not reported as a refused configuration', () => {
  const log = '[notice] Read configuration file "torrc".\n[notice] Bootstrapped 5% (conn): Connecting to a relay';
  assert.doesNotMatch(explainTorFailure('Tor n’a pas réussi à se connecter au réseau en 2 minutes.', log), /refusé sa configuration/);
  assert.match(explainTorFailure('exited', '[warn] Failed to parse/validate config: Unknown option \'Foo\'.  Failing.'), /refusé sa configuration/);
});
