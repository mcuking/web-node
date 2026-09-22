// Differential observation program for `net` connection lifecycle and timeouts
// (M95). Runs unchanged on real Node AND inside web-node; the emitted JSON must
// be byte-for-byte equal. Record the oracle with tools/net-lifecycle-oracle.mjs.
'use strict';
const net = require('net');

// The probe attaches a no-op 'error' listener to every client socket so that a
// stray RST cannot abort the run; both runtimes execute this same wrapper, so it
// does not alter the observed event sequences.
const _connect = net.connect.bind(net);
net.connect = (...args) => {
  const s = _connect(...args);
  s.on('error', () => {});
  return s;
};

const out = {};
const norm = (e) => ({ name: e.name, code: e.code, message: e.message });
const call = (fn) => { try { return { ok: fn() }; } catch (e) { return { err: norm(e) }; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitClose = (s, ms = 400) =>
  new Promise((r) => { if (s.destroyed) return r(); s.once('close', () => r()); setTimeout(r, ms); });

async function main() {
  // ---- surface -----------------------------------------------------------
  out.proto = {
    setTimeout: 'setTimeout' in net.Socket.prototype,
    setTimeoutLength: net.Socket.prototype.setTimeout.length,
    _unrefTimer: typeof net.Socket.prototype._unrefTimer,
    _onTimeout: typeof net.Socket.prototype._onTimeout,
    destroySoon: typeof net.Socket.prototype.destroySoon,
    resetAndDestroy: typeof net.Socket.prototype.resetAndDestroy,
    readyState: 'readyState' in net.Socket.prototype,
  };

  // ---- 1. refused connection: event sequence + final state ---------------
  {
    const port = await closedPort();
    const s = net.connect({ port, host: '127.0.0.1' });
    const ev = [];
    s.on('connect', () => ev.push('connect'));
    s.on('ready', () => ev.push('ready'));
    s.on('error', (e) => ev.push('error:' + e.code));
    s.on('close', (hadErr) => ev.push('close:' + hadErr));
    out.refusedConnectingSync = s.connecting;
    await waitClose(s);
    out.refused = {
      ev,
      readyState: s.readyState,
      connecting: s.connecting,
      destroyed: s.destroyed,
      pending: s.pending,
      writableEnded: s.writableEnded,
      readableEnded: s.readableEnded,
    };
  }

  // ---- 2. setTimeout fires after an idle period --------------------------
  {
    const server = net.createServer((sock) => { sock.on('error', () => {}); sock.on('data', () => {}); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const c = net.connect({ port: server.address().port, host: '127.0.0.1' });
    const ev = [];
    c.on('timeout', () => ev.push('timeout'));
    c.on('close', () => ev.push('close'));
    const ret = c.setTimeout(60);
    out.setTimeout = {
      returnsThis: ret === c,
      prop: c.timeout,
      hasOwn: Object.prototype.hasOwnProperty.call(c, 'timeout'),
    };
    await sleep(220);
    out.setTimeoutIdleEvents = ev;
    c.destroy();
    await waitClose(c);
    await new Promise((r) => server.close(r));
  }

  // ---- 3. activity resets the timer (no timeout while busy) --------------
  {
    const server = net.createServer((sock) => {
      sock.on('error', () => {});
      const iv = setInterval(() => { if (sock.writable) sock.write('.'); }, 30);
      sock.on('close', () => clearInterval(iv));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const c = net.connect({ port: server.address().port, host: '127.0.0.1' });
    const ev = [];
    c.on('data', () => {});
    c.on('timeout', () => ev.push('timeout'));
    c.setTimeout(90);
    await sleep(260);
    out.timeoutActivityEvents = ev;
    c.destroy();
    await waitClose(c);
    await new Promise((r) => server.close(r));
  }

  // ---- 4. setTimeout(0) disables + callback handling ---------------------
  {
    const s = new net.Socket();
    const cb = () => {};
    s.setTimeout(50, cb);
    out.setTimeoutCallbackRegistered = s.listenerCount('timeout');
    const r0 = s.setTimeout(0, cb);
    out.setTimeoutZero = { returnsThis: r0 === s, listeners: s.listenerCount('timeout'), timeout: s.timeout };
    s.destroy();
    out.setTimeoutAfterDestroy = call(() => { const d = new net.Socket(); d.destroy(); const v = d.setTimeout(10); return v === d; });
  }

  // ---- 5. setTimeout validation ------------------------------------------
  {
    const s = new net.Socket();
    out.setTimeoutType = call(() => s.setTimeout('x'));
    out.setTimeoutNeg = call(() => s.setTimeout(-1));
    out.setTimeoutBadCb = call(() => s.setTimeout(10, 5));
    s.destroy();
  }

  // ---- 6. allowHalfOpen: false — remote FIN ends our writable side -------
  {
    const server = net.createServer((sock) => { sock.on('error', () => {}); sock.end('bye'); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const c = net.connect({ port: server.address().port, host: '127.0.0.1' });
    const ev = [];
    c.setEncoding('utf8');
    c.on('data', (d) => ev.push('data:' + d));
    c.on('end', () => ev.push('end'));
    c.on('finish', () => ev.push('finish'));
    c.on('close', () => ev.push('close'));
    await waitClose(c);
    out.halfOpenFalse = { ev, writableEnded: c.writableEnded, readableEnded: c.readableEnded };
    await new Promise((r) => server.close(r));
  }

  // ---- 7. allowHalfOpen: true — stay writable after remote FIN -----------
  {
    const serverSockets = [];
    const server = net.createServer((sock) => {
      sock.on('error', () => {});
      serverSockets.push(sock);
      sock.on('data', (d) => sock.write('echo:' + d));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const c = net.connect({ port: server.address().port, host: '127.0.0.1', allowHalfOpen: true });
    const ev = [];
    c.setEncoding('utf8');
    c.on('data', (d) => ev.push('data:' + d));
    c.on('end', () => ev.push('end'));
    c.on('close', () => ev.push('close'));
    c.write('hi');
    await sleep(80);
    out.halfOpenTrueBefore = { writable: c.writable, writableEnded: c.writableEnded, readable: c.readable, destroyed: c.destroyed };
    serverSockets.forEach((s) => s.end());
    await sleep(120);
    out.halfOpenTrueAfter = { writable: c.writable, writableEnded: c.writableEnded, readableEnded: c.readableEnded, destroyed: c.destroyed, ev: ev.slice() };
    c.destroy();
    await waitClose(c);
    await new Promise((r) => server.close(r));
  }

  // ---- 8. connect() callback ordering relative to connect/ready ----------
  {
    const server = net.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const ev = [];
    await new Promise((r) => {
      const c = net.connect({ port: server.address().port, host: '127.0.0.1' }, () => ev.push('callback'));
      c.on('connect', () => ev.push('connect'));
      c.on('ready', () => ev.push('ready'));
      c.on('close', () => { ev.push('close'); r(); });
      setTimeout(() => { c.destroy(); r(); }, 300);
    });
    out.connectCallbackOrder = ev;
    await new Promise((r) => server.close(r));
  }

  // ---- 9. destroy(error) → 'error' then 'close'(true) --------------------
  {
    const server = net.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const c = net.connect({ port: server.address().port, host: '127.0.0.1' });
    const ev = [];
    c.on('error', (e) => ev.push('error:' + e.message));
    c.on('close', (hadErr) => ev.push('close:' + hadErr));
    await new Promise((r) => c.on('connect', r));
    c.destroy(new Error('boom'));
    await waitClose(c);
    out.destroyError = ev;
    await new Promise((r) => server.close(r));
  }

  // ---- 10. server.close waits for live connections -----------------------
  {
    const server = net.createServer((sock) => { sock.on('error', () => {}); sock.on('data', () => {}); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const c = net.connect({ port: server.address().port, host: '127.0.0.1' });
    await new Promise((r) => c.on('connect', r));
    await sleep(40);
    out.getConnections = await new Promise((res) => server.getConnections((e, n) => res([e === null, n])));
    let closed = false;
    server.close(() => { closed = true; });
    await sleep(60);
    out.serverClosePendingWhileOpen = { listening: server.listening, closed };
    c.destroy();
    await waitClose(c);
    await sleep(60);
    out.serverCloseAfterDrain = { closed, listening: server.listening };
  }

  // ---- 11. destroySoon ---------------------------------------------------
  {
    const server = net.createServer((sock) => { sock.on('error', () => {}); sock.on('data', () => {}); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const c = net.connect({ port: server.address().port, host: '127.0.0.1' });
    const ev = [];
    c.on('finish', () => ev.push('finish'));
    c.on('close', () => ev.push('close'));
    await new Promise((r) => c.on('connect', r));
    c.destroySoon();
    await waitClose(c);
    out.destroySoon = ev;
    await new Promise((r) => server.close(r));
  }

  console.log('__OBS__' + JSON.stringify(out));
}

function closedPort() {
  // Bind then close to obtain a port nobody is listening on.
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

main().catch((e) => {
  console.log('__OBS__' + JSON.stringify({ error: String((e && e.stack) || e) }));
  process.exitCode = 1;
});
