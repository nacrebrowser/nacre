'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createTorSocksBridge } = require('../src/tor-socks-bridge.cjs');

function readBytes(socket, length) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => finish(new Error('SOCKS test timed out')), 3000);
    const cleanup = () => { clearTimeout(timeout); socket.off('data', onData); socket.off('error', onError); };
    const finish = (error, result) => { cleanup(); error ? reject(error) : resolve(result); };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= length) finish(null, buffer.subarray(0, length));
    };
    const onError = (error) => finish(error);
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function createFakeTorSocks() {
  const seen = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let stage = 'greeting';
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting' && buffer.length >= 3) {
        buffer = buffer.subarray(3);
        stage = 'auth';
        socket.write(Buffer.from([5, 2]));
      }
      if (stage === 'auth' && buffer.length >= 2) {
        const userLength = buffer[1];
        if (buffer.length < 2 + userLength + 1) return;
        const passwordLength = buffer[2 + userLength];
        const authLength = 3 + userLength + passwordLength;
        if (buffer.length < authLength) return;
        const username = buffer.subarray(2, 2 + userLength).toString();
        const password = buffer.subarray(3 + userLength, authLength).toString();
        seen.push({ username, password, host: '' });
        buffer = buffer.subarray(authLength);
        stage = 'connect';
        socket.write(Buffer.from([1, 0]));
      }
      if (stage === 'connect' && buffer.length >= 5) {
        const hostLength = buffer[3] === 3 ? 1 + buffer[4] : buffer[3] === 1 ? 4 : 16;
        const requestLength = 4 + hostLength + 2;
        if (buffer.length < requestLength) return;
        const host = buffer[3] === 3 ? buffer.subarray(5, 5 + buffer[4]).toString() : '';
        seen.at(-1).host = host;
        buffer = buffer.subarray(requestLength);
        stage = 'stream';
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
      }
    });
  });
  return { server, seen };
}

async function connectThrough(port, host) {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  let response = readBytes(socket, 2);
  socket.write(Buffer.from([5, 1, 0]));
  assert.deepEqual([...await response], [5, 0]);
  const hostBytes = Buffer.from(host);
  response = readBytes(socket, 10);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, hostBytes.length]), hostBytes, Buffer.from([0, 80])]));
  assert.deepEqual([...await response], [5, 0, 0, 1, 127, 0, 0, 1, 0, 80]);
  socket.destroy();
}

test('SOCKS bridge preserves hostnames and sends isolated Tor credentials per registrable domain', async (t) => {
  const fake = createFakeTorSocks();
  try {
    await new Promise((resolve, reject) => { fake.server.once('error', reject); fake.server.listen(0, '127.0.0.1', resolve); });
  } catch (error) {
    if (error.code === 'EACCES') return t.skip('Le sandbox Windows interdit les sockets loopback à ce test d’intégration.');
    throw error;
  }
  const upstreamPort = fake.server.address().port;
  const bridge = createTorSocksBridge({
    upstreamPort,
    getDomain: (host) => host.endsWith('.example.co.uk') || host === 'example.co.uk' ? 'example.co.uk' : host
  });
  try {
    await bridge.ready;
    await connectThrough(bridge.port, 'a.example.co.uk');
    await connectThrough(bridge.port, 'b.example.co.uk');
    await connectThrough(bridge.port, 'example.org');
    assert.deepEqual(fake.seen.map(({ username, host }) => [username, host]), [
      ['nacre', 'a.example.co.uk'], ['nacre', 'b.example.co.uk'], ['nacre', 'example.org']
    ]);
    assert.equal(fake.seen[0].password, fake.seen[1].password);
    assert.notEqual(fake.seen[0].password, fake.seen[2].password);
    assert.equal(fake.seen.every((item) => /^[a-f0-9]{48}$/.test(item.password)), true);
  } catch (error) {
    if (error.code === 'EACCES') return t.skip('Le sandbox Windows interdit les sockets loopback à ce test d’intégration.');
    throw error;
  } finally {
    await bridge.close();
    await new Promise((resolve) => fake.server.close(resolve));
  }
});
