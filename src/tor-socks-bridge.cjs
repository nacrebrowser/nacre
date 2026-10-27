const net = require('node:net');
const crypto = require('node:crypto');
const { socksToken } = require('./privacy-core.cjs');

function readFixed(socket, length, callback) {
  let data = Buffer.alloc(0);
  const onData = (chunk) => {
    data = Buffer.concat([data, chunk]);
    if (data.length < length) return;
    socket.removeListener('data', onData);
    callback(null, data.subarray(0, length), data.subarray(length));
  };
  socket.on('data', onData);
  socket.once('error', (error) => { socket.removeListener('data', onData); callback(error); });
}

function readSocksReply(socket, prefixLength, callback) {
  let data = Buffer.alloc(0);
  const onData = (chunk) => {
    data = Buffer.concat([data, chunk]);
    if (data.length < prefixLength) return;
    let length = prefixLength;
    const atyp = data[3];
    if (atyp === 1) length += 4;
    else if (atyp === 4) length += 16;
    else if (atyp === 3) {
      if (data.length < 5) return;
      length += 1 + data[4];
    } else return callback(new Error('Réponse SOCKS Tor invalide.'));
    length += 2;
    if (data.length < length) return;
    socket.removeListener('data', onData);
    callback(null, data.subarray(0, length), data.subarray(length));
  };
  socket.on('data', onData);
  socket.once('error', (error) => { socket.removeListener('data', onData); callback(error); });
}

function createTorSocksBridge({ upstreamPort, getDomain, budget = null, onCircuitEvict = () => {} }) {
  let secret = crypto.randomBytes(32);
  const tokens = new Map();
  const allTokens = new Set();
  const sockets = new Set();
  let closed = false;
  let server;

  const listen = () => new Promise((resolve, reject) => {
    server = net.createServer((client) => {
      sockets.add(client);
      let budgetToken = '';
      client.once('close', () => {
        sockets.delete(client);
        if (budgetToken && budget) budget.leave(budgetToken);
      });
      client.once('error', () => client.destroy());
      let input = Buffer.alloc(0);
      let stage = 'greeting';
      let upstream;
      const fail = (code = 5) => {
        if (client.destroyed) return;
        try { client.write(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])); } catch {}
        client.destroy();
        if (upstream && !upstream.destroyed) upstream.destroy();
      };
      const onClientData = (chunk) => {
        input = Buffer.concat([input, chunk]);
        if (stage === 'greeting') {
          if (input.length < 2 || input.length < 2 + input[1]) return;
          // Chromium's SOCKS5 client only offers no-auth. The bridge is bound
          // to an ephemeral loopback port; remote hosts cannot connect to it.
          if (input[0] !== 5 || !input.subarray(2, 2 + input[1]).includes(0)) return fail(7);
          input = input.subarray(2 + input[1]);
          client.write(Buffer.from([5, 0]));
          stage = 'request';
        }
        if (stage !== 'request' || input.length < 5) return;
        const atyp = input[3];
        let addressLength = atyp === 1 ? 4 : atyp === 4 ? 16 : atyp === 3 && input.length >= 5 ? 1 + input[4] : 0;
        if (!addressLength) return fail(8);
        const requestLength = 4 + addressLength + 2;
        if (input.length < requestLength) return;
        const request = input.subarray(0, requestLength);
        const rest = input.subarray(requestLength);
        if (request[0] !== 5 || request[1] !== 1 || request[2] !== 0) return fail(7);
        let host;
        if (atyp === 3) host = request.subarray(5, 5 + request[4]).toString('utf8').toLowerCase();
        else if (atyp === 1) host = Array.from(request.subarray(4, 8)).join('.');
        else host = request.subarray(4, 20).toString('hex');
        const domain = String(getDomain(host) || host).toLowerCase();
        let token = tokens.get(domain);
        if (!token) {
          token = socksToken(domain, secret);
          if (budget && !budget.ensure(token, (evicted) => {
            for (const [knownDomain, knownToken] of tokens) {
              if (knownToken === evicted) tokens.delete(knownDomain);
            }
            allTokens.delete(evicted);
            onCircuitEvict(evicted);
          })) return fail(4);
          tokens.set(domain, token);
          allTokens.add(token);
        }
        if (budget && !budget.enter(token)) return fail(4);
        budgetToken = token;
        input = rest;
        stage = 'upstream';
        client.removeListener('data', onClientData);
        upstream = net.connect(upstreamPort, '127.0.0.1');
        sockets.add(upstream);
        upstream.once('close', () => sockets.delete(upstream));
        upstream.once('error', () => fail());
        upstream.once('connect', () => {
          upstream.write(Buffer.from([5, 1, 2]));
          readFixed(upstream, 2, (greetingError, greeting, pending) => {
            if (greetingError || !greeting || greeting[1] !== 2) return fail();
            const user = Buffer.from('nacre');
            const pass = Buffer.from(token);
            upstream.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
            readFixed(upstream, 2, (authError, auth, authPending) => {
              if (authError || !auth || auth[1] !== 0) return fail();
              const sendConnect = () => {
                upstream.write(request);
                readSocksReply(upstream, 4, (connectError, reply, replyPending) => {
                  if (connectError || !reply || reply[1] !== 0) return fail();
                  client.write(reply);
                  if (replyPending && replyPending.length) client.write(replyPending);
                  if (input.length) upstream.write(input);
                  client.pipe(upstream);
                  upstream.pipe(client);
                });
              };
              sendConnect();
            });
          });
        });
      };
      client.on('data', onClientData);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  const ready = listen();
  return {
    ready,
    get port() { return server && server.address() ? server.address().port : 0; },
    tokenForDomain(domain) {
      let token = tokens.get(domain);
      if (!token) {
        token = socksToken(domain, secret);
        if (budget && !budget.ensure(token, (evicted) => {
          for (const [knownDomain, knownToken] of tokens) if (knownToken === evicted) tokens.delete(knownDomain);
          allTokens.delete(evicted);
          onCircuitEvict(evicted);
        })) throw new Error('Les 16 identités Tor sont occupées. Ferme un onglet ou réessaie plus tard.');
        tokens.set(domain, token);
        allTokens.add(token);
      }
      return token;
    },
    tokens: () => Array.from(allTokens),
    renewIdentity() {
      this.resetConnections();
      for (const token of allTokens) if (budget) budget.release(token);
      secret = crypto.randomBytes(32); tokens.clear(); allTokens.clear();
    },
    resetConnections() { for (const socket of sockets) socket.destroy(); sockets.clear(); },
    async close() {
      if (closed) return;
      closed = true;
      this.resetConnections();
      for (const token of allTokens) if (budget) budget.release(token);
      allTokens.clear(); tokens.clear();
      await ready.catch(() => {});
      if (server && server.listening) await new Promise((resolve) => server.close(resolve));
    }
  };
}

module.exports = { createTorSocksBridge };
