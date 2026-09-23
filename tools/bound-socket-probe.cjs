'use strict';
/**
 * Differential probe for `net.BoundSocket` (M102).
 *
 * Runs unchanged on real Node (the oracle) and inside web-node. Both emit one
 * `__OBS__ <json>` line; the two blobs must be equal. Nondeterministic parts
 * (the OS-assigned port, the OS file descriptor) are normalised or excluded —
 * `fd()` is a documented deviation (web-node returns -1, the "no fd" value).
 */
const net = require('node:net');

const obs = {};

obs.protoMembers = Object.getOwnPropertyNames(net.BoundSocket.prototype).sort();
obs.ctorLength = net.BoundSocket.length;
obs.ctorName = net.BoundSocket.name;
obs.hasDispose = typeof net.BoundSocket.prototype[Symbol.dispose] === 'function';
obs.isPipeIsGetter =
  (Object.getOwnPropertyDescriptor(net.BoundSocket.prototype, 'isPipe') || {}).get !== undefined;

// --- TCP bind with an explicit host -----------------------------------------
const b1 = new net.BoundSocket({ port: 0, host: '127.0.0.1' });
const a1 = b1.address();
obs.explicit = {
  isPipe: b1.isPipe,
  address: a1.address,
  family: a1.family,
  portIsInt: Number.isInteger(a1.port) && a1.port > 0,
};
obs.afterClose = (() => {
  b1.close();
  try {
    b1.address();
    return 'no-throw';
  } catch (e) {
    return e.code;
  }
})();
obs.fdAfterClose = (() => {
  try {
    b1.fd();
    return 'no-throw';
  } catch (e) {
    return e.code;
  }
})();

// --- default host ------------------------------------------------------------
const b2 = new net.BoundSocket({ port: 0 });
const a2 = b2.address();
obs.defaultHost = { address: a2.address, family: a2.family };

// --- conflicting bind (EADDRINUSE, forced synchronously) ---------------------
const port = a2.port;
try {
  new net.BoundSocket({ port, host: a2.address });
  obs.conflict = 'no-throw';
} catch (e) {
  obs.conflict = {
    code: e.code,
    errno: e.errno,
    syscall: e.syscall,
    address: e.address,
    name: e.name,
    msg: e.message.split(String(port)).join('<port>'),
  };
}
b2.close();

// --- validation surface ------------------------------------------------------
const grab = (fn) => {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    return { code: e.code, name: e.name, msg: e.message };
  }
};
obs.badHost = grab(() => new net.BoundSocket({ port: 0, host: 'localhost' }));
obs.badPort = grab(() => new net.BoundSocket({ port: 70000 }));
obs.notObject = grab(() => new net.BoundSocket(5));
obs.badIpv6Only = grab(() => new net.BoundSocket({ port: 0, ipv6Only: 'yes' }));
obs.pathAndPort = (() => {
  try {
    new net.BoundSocket({ path: '/x', port: 1 });
    return 'no-throw';
  } catch (e) {
    return { code: e.code, name: e.name };
  }
})();

console.log('__OBS__ ' + JSON.stringify(obs));
