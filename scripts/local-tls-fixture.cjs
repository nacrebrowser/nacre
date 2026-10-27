'use strict';
// Test-only, ephemeral self-signed certificate. Never installed in a trust store.
const crypto = require('node:crypto');
function tlsFixture() {
  const der = (tag, value) => { const body = Buffer.from(value); let size = body.length;
    const bytes = []; do { bytes.unshift(size & 255); size >>>= 8; } while (size);
    return Buffer.concat([Buffer.from([tag, ...(body.length < 128 ? [body.length] : [128 | bytes.length, ...bytes])]), body]); };
  const sequence = (...items) => der(0x30, Buffer.concat(items));
  const algorithm = sequence(der(6, [42,134,72,134,247,13,1,1,11]), der(5, []));
  const name = sequence(der(0x31, sequence(der(6, [85,4,3]), der(12, Buffer.from('Nacre local test')))));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const date = value => der(0x18, Buffer.from(value.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'));
  const now = Date.now();
  const serial = crypto.randomBytes(16); serial[0] &= 127;
  const body = sequence(der(2, serial), algorithm, name,
    sequence(date(new Date(now - 86400000)), date(new Date(now + 86400000))), name,
    publicKey.export({ type: 'spki', format: 'der' }));
  const certDer = sequence(body, algorithm, der(3, Buffer.concat([Buffer.from([0]), crypto.sign('sha256', body, privateKey)])));
  const cert = '-----BEGIN CERTIFICATE-----\n' + certDer.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  return { cert, key: privateKey.export({ type: 'pkcs8', format: 'pem' }), fingerprint: new crypto.X509Certificate(cert).fingerprint256 };
}
module.exports = { tlsFixture };
