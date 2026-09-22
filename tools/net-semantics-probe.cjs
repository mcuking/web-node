// Differential observation program for `net`. Runs on real Node AND in web-node.
const net = require('net');

const out = {};

function snap(s) {
  return {
    readyState: s.readyState,
    connecting: s.connecting,
    destroyed: s.destroyed,
    readable: s.readable,
    writable: s.writable,
    pending: s.pending,
    bytesRead: s.bytesRead,
    bytesWritten: s.bytesWritten,
    allowHalfOpen: s.allowHalfOpen,
    timeout: s.timeout,
    remoteAddress: s.remoteAddress,
    remotePort: s.remotePort,
    localAddress: s.localAddress,
    localPort: s.localPort,
  };
}

async function main() {
  out.isIP = [net.isIP('127.0.0.1'), net.isIP('::1'), net.isIP('x')];
  out.isIPv4 = [net.isIPv4('127.0.0.1'), net.isIPv4('::1')];
  out.isIPv6 = [net.isIPv6('::1'), net.isIPv6('127.0.0.1')];
  out.moduleTypes = ['createServer', 'connect', 'createConnection', 'isIP', 'isIPv4', 'isIPv6', 'Socket', 'Server', 'BlockList', 'SocketAddress'].map((k) => `${k}:${typeof net[k]}`);

  out.socketProto = ['connect', 'write', 'end', 'destroy', 'pause', 'resume', 'setTimeout', 'setNoDelay', 'setKeepAlive', 'address', 'ref', 'unref', 'setEncoding', 'pipe'].filter((k) => k in net.Socket.prototype);
  out.socketProtoAccessors = ['remoteAddress', 'remotePort', 'localAddress', 'localPort', 'bytesRead', 'bytesWritten', 'readyState', 'connecting', 'pending', 'destroyed', 'readable', 'writable', 'allowHalfOpen', 'bufferSize'].filter((k) => k in net.Socket.prototype);
  out.serverProto = ['listen', 'close', 'address', 'getConnections', 'ref', 'unref', 'setTimeout'].filter((k) => k in net.Server.prototype);

  const s = new net.Socket();
  out.fresh = snap(s);
  out.fresh.bufferSizeType = typeof s.bufferSize;
  out.fresh.addressType = typeof s.address;
  out.fresh.remoteFamily = s.remoteFamily;
  out.setNoDelayReturnsThis = s.setNoDelay() === s;
  out.setKeepAliveReturnsThis = s.setKeepAlive() === s;
  out.setTimeoutReturnsThis = s.setTimeout(0) === s;
  s.destroy();
  out.afterDestroy = { readyState: s.readyState, destroyed: s.destroyed, connecting: s.connecting, writable: s.writable };

  const events = { server: [], client: [] };
  const server = net.createServer((socket) => {
    events.server.push('connection');
    socket.setEncoding('utf8');
    socket.on('data', (d) => {
      events.server.push(`data:${d}`);
      socket.write(d);
    });
    socket.on('end', () => events.server.push('end'));
    socket.on('close', () => events.server.push('close'));
    socket.on('error', () => events.server.push('error'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  out.afterListen = { listening: server.listening, getConnections: server.getConnections };
  const addr = server.address();
  out.serverAddress = { family: addr.family, address: addr.address, portIsNumber: typeof addr.port === 'number' };
  out.maxConnections = server.maxConnections;
  out.refReturnsThis = server.ref() === server;
  out.unrefReturnsThis = server.unref() === server;
  out.getConnections = await new Promise((res) => server.getConnections((e, n) => res([e === null, n])));

  const client = net.connect({ port: addr.port, host: '127.0.0.1' });
  out.connectReturnsSocket = client instanceof net.Socket;
  out.connectInstaceOfServer = server instanceof net.Server;

  const echo = await new Promise((resolve) => {
    let text = '';
    client.setEncoding('utf8');
    client.on('connect', () => events.client.push('connect'));
    client.on('ready', () => events.client.push('ready'));
    client.on('lookup', () => events.client.push('lookup'));
    client.on('data', (d) => {
      text += d;
      events.client.push('data');
      client.end();
    });
    client.on('end', () => events.client.push('end'));
    client.on('close', () => {
      events.client.push('close');
      resolve(text);
    });
    client.on('error', () => events.client.push('error'));
    client.write('ping');
  });
  out.echo = echo;
  out.clientEvents = events.client;
  out.clientBytes = { read: client.bytesRead, written: client.bytesWritten };
  out.clientAfterClose = { readyState: client.readyState, destroyed: client.destroyed, writable: client.writable, readable: client.readable };

  await new Promise((r) => setTimeout(r, 30));
  out.serverEvents = events.server;

  out.writeReturnsBoolean = typeof client.write('x');
  await new Promise((r) => server.close(r));
  out.afterClose = { listening: server.listening };
  out.serverProtoAfterClose = server.address();

  console.log('__OBS__' + JSON.stringify(out));
}

main().catch((e) => {
  console.log('__OBS__' + JSON.stringify({ error: String((e && e.stack) || e) }));
  process.exitCode = 1;
});
