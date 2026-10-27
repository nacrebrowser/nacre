const net = require('node:net');
const fs = require('node:fs');
const crypto = require('node:crypto');

function safeCookieProof(cookie, clientNonce, challenge) {
  const fields = fieldsFromEvent(challenge);
  if (!/^[a-f0-9]{64}$/i.test(fields.SERVERNONCE || '') || !/^[a-f0-9]{64}$/i.test(fields.SERVERHASH || '')) throw new Error('Invalid SAFECOOKIE challenge');
  const material = Buffer.concat([cookie, clientNonce, Buffer.from(fields.SERVERNONCE, 'hex')]);
  const hmac = direction => crypto.createHmac('sha256', `Tor safe cookie authentication ${direction} hash`).update(material).digest();
  if (!crypto.timingSafeEqual(hmac('server-to-controller'), Buffer.from(fields.SERVERHASH, 'hex'))) throw new Error('Tor SAFECOOKIE server authentication failed');
  return hmac('controller-to-server').toString('hex');
}

function readControlPort(file) {
  const match = /^PORT=127\.0\.0\.1:([0-9]{1,5})\s*$/.exec(fs.readFileSync(file, 'utf8'));
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new Error('Invalid Tor control listener');
  return Number(match[1]);
}

function fieldsFromEvent(line) {
  const fields = {};
  const pattern = /([A-Z_]+)=(?:"((?:\\.|[^"\\])*)"|(\S+))/g;
  for (const match of line.matchAll(pattern)) fields[match[1]] = (match[2] || match[3] || '').replace(/\\(.)/g, '$1');
  return fields;
}

function connectTorControl(port, cookiePath, onStream) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = '';
    let authStarted = false;
    let settled = false;
    let closed = false;
    let pending = null;
    let currentReply = [];
    const circuitsByToken = new Map();
    const timeout = setTimeout(() => finish(new Error('Le ControlPort Tor ne répond pas.')), 8000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) { closed = true; socket.destroy(); reject(error); }
      else resolve(controller);
    };
    const removeCircuit = (circuitId) => {
      for (const [token, ids] of circuitsByToken) {
        ids.delete(circuitId);
        if (!ids.size) circuitsByToken.delete(token);
      }
    };
    const trackStream = (line) => {
      const fields = fieldsFromEvent(line);
      const token = fields.SOCKS_PASSWORD;
      const parts = line.split(/\s+/);
      const circuitId = parts[4];
      if (!token || !circuitId || circuitId === '0') return;
      const state = parts[3] || '';
      if (state === 'CLOSED' || state === 'FAILED') return;
      if (fields.SOCKS_USERNAME !== 'nacre') return;
      if (!circuitsByToken.has(token)) circuitsByToken.set(token, new Set());
      circuitsByToken.get(token).add(circuitId);
      if (onStream) onStream({ token, circuitId, state });
    };
    const command = (text) => new Promise((resolveCommand, rejectCommand) => {
      if (closed || socket.destroyed) return rejectCommand(new Error('Le ControlPort Tor est fermé.'));
      if (pending) return rejectCommand(new Error('Une commande Tor est déjà en cours.'));
      pending = { resolve: resolveCommand, reject: rejectCommand };
      currentReply = [];
      socket.write(text + '\r\n');
    });
    const controller = {
      circuitsByToken,
      async socksPort() {
        const response = await command('GETINFO net/listeners/socks');
        const line = response.find(line => /^250[- ]net\/listeners\/socks=/.test(line));
        const match = line && /="127\.0\.0\.1:([0-9]{1,5})"$/.exec(line);
        if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new Error('Invalid Tor SOCKS listener');
        return Number(match[1]);
      },
      async signalNewnym() {
        const response = await command('SIGNAL NEWNYM');
        if (!response.some((line) => /^250 /.test(line))) throw new Error('Tor a refusé SIGNAL NEWNYM.');
      },
      async closeCircuitsForTokens(tokens) {
        const ids = new Set();
        for (const token of tokens) for (const id of circuitsByToken.get(token) || []) ids.add(id);
        for (const id of ids) {
          try { await command('CLOSECIRCUIT ' + id); } catch {}
          removeCircuit(id);
        }
      },
      close() {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        socket.destroy();
      }
    };
    const authenticate = async () => {
      if (authStarted) return;
      authStarted = true;
      try {
        // The Tor control protocol is client-driven: the first command is
        // PROTOCOLINFO, not a server greeting. Waiting for a banner leaves
        // this socket connected but idle until the timeout.
        const protocolInfo = await command('PROTOCOLINFO 1');
        if (!protocolInfo.some((line) => /^250 /.test(line))) throw new Error('Tor n’a pas répondu à PROTOCOLINFO.');
        if (!protocolInfo.some(line => /AUTH METHODS=(?:[A-Z]+,)*SAFECOOKIE(?:,|\s)/.test(line))) throw new Error('Tor SAFECOOKIE unavailable');
        const cookie = fs.readFileSync(cookiePath);
        if (cookie.length !== 32) throw new Error('Le cookie d’authentification Tor a une taille inattendue.');
        const nonce = crypto.randomBytes(32);
        const challenge = await command('AUTHCHALLENGE SAFECOOKIE ' + nonce.toString('hex'));
        const proof = safeCookieProof(cookie, nonce, challenge.find(line => /^250 AUTHCHALLENGE /.test(line)) || '');
        const auth = await command('AUTHENTICATE ' + proof);
        cookie.fill(0);
        if (!auth.some((line) => /^250 /.test(line))) throw new Error('L’authentification Tor a échoué.');
        const events = await command('SETEVENTS EXTENDED STREAM CIRC');
        if (!events.some((line) => /^250 /.test(line))) throw new Error('Tor n’a pas activé les événements de circuits.');
        finish();
      } catch (error) { finish(error); }
    };
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 1024 * 1024) return finish(new Error('Tor control reply too large'));
      let lineEnd;
      while ((lineEnd = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        if (line.startsWith('650 STREAM ')) { trackStream(line); continue; }
        if (line.startsWith('650 CIRC ')) {
          const eventParts = line.split(/\s+/);
          if (eventParts[3] === 'CLOSED' || eventParts[3] === 'FAILED') {
            removeCircuit(eventParts[2]);
            if (onStream) onStream({ type: 'circuit', circuitId: eventParts[2], state: eventParts[3] });
          }
          continue;
        }
        if (/^250[ +\-]/.test(line)) currentReply.push(line);
        if (/^250 /.test(line) && pending) {
          const task = pending;
          pending = null;
          task.resolve(currentReply.slice());
        } else if (/^[45]\d\d /.test(line) && pending) {
          const task = pending;
          pending = null;
          task.reject(new Error(line.replace(/^\d{3} /, '')));
        }
      }
    });
    socket.once('error', (error) => {
      if (!settled) finish(new Error('Connexion au ControlPort Tor impossible: ' + error.message));
      else if (pending) { pending.reject(error); pending = null; }
    });
    socket.once('connect', authenticate);
    socket.once('close', () => {
      if (!closed) {
        closed = true;
        clearTimeout(timeout);
        const error = new Error('Le ControlPort Tor s’est fermé.');
        if (!settled) finish(error);
        else if (pending) { pending.reject(error); pending = null; }
      }
    });
  });
}

module.exports = { connectTorControl, safeCookieProof, readControlPort };
