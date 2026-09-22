// Differential observation program for Diffie-Hellman
// (`createDiffieHellman` / `getDiffieHellman` / `DiffieHellman` /
// `DiffieHellmanGroup`). Runs unchanged on real Node and inside web-node.
//
// Everything here is deterministic: random `generateKeys()` results are only
// observed through their lengths, and the shared-secret vectors are built from
// fixed private keys plus in-probe modular exponentiation.
const crypto = require('crypto');

const hex = (b) => Buffer.from(b).toString('hex');
const out = {};

const GROUPS = ['modp1', 'modp2', 'modp5', 'modp14', 'modp15', 'modp16', 'modp17', 'modp18'];

// --- named groups -----------------------------------------------------------
for (const name of GROUPS) {
  const g = crypto.getDiffieHellman(name);
  const entry = {
    primeLen: g.getPrime().length,
    genHex: g.getGenerator('hex'),
    genIsBuffer: Buffer.isBuffer(g.getGenerator()),
    primeIsBuffer: Buffer.isBuffer(g.getPrime()),
    verifyError: g.verifyError,
    isDH: g instanceof crypto.DiffieHellman,
    ctor: g.constructor.name,
  };
  g.generateKeys();
  entry.privLen = g.getPrivateKey().length;
  entry.privIsBuffer = Buffer.isBuffer(g.getPrivateKey());
  entry.pubIsBuffer = Buffer.isBuffer(g.getPublicKey());
  entry.pubLenOk = [entry.primeLen, entry.primeLen - 1].includes(g.getPublicKey().length);
  out['group_' + name] = entry;
}

// --- explicit prime, fixed private keys, in-probe modular exponentiation -----
const powmod = (base, exp, mod) => {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
};
const toBig = (buf) => BigInt('0x' + buf.toString('hex'));
const fromBig = (v, len) => {
  let h = v.toString(16);
  if (h.length % 2) h = '0' + h;
  while (h.length < len * 2) h = '00' + h;
  return Buffer.from(h, 'hex');
};

const prime = crypto.getDiffieHellman('modp1').getPrime();
const pv = toBig(prime);
const xBuf = Buffer.alloc(32, 0x11);
const yBuf = Buffer.alloc(32, 0x22);
const gx = powmod(2n, toBig(xBuf), pv);
const gy = powmod(2n, toBig(yBuf), pv);

const a = crypto.createDiffieHellman(prime, 2);
a.setPrivateKey(xBuf);
a.setPublicKey(fromBig(gx, prime.length));
const b = crypto.createDiffieHellman(prime, 2);
b.setPrivateKey(yBuf);
b.setPublicKey(fromBig(gy, prime.length));

out.detAPub = a.getPublicKey('hex');
out.detAPubMatchesExp = out.detAPub === fromBig(gx, prime.length).toString('hex');
out.detAPriv = a.getPrivateKey('hex');
out.detBpub = b.getPublicKey('hex');
const sharedAB = a.computeSecret(b.getPublicKey(), undefined, 'hex');
out.detShared = sharedAB;
out.detSharedMatchesExp = sharedAB === fromBig(powmod(2n, toBig(xBuf) * toBig(yBuf), pv), prime.length).toString('hex');
out.detSymmetric = sharedAB === b.computeSecret(a.getPublicKey(), undefined, 'hex');
out.detSharedLen = a.computeSecret(b.getPublicKey()).length;
out.detSharedIsBuffer = Buffer.isBuffer(a.computeSecret(b.getPublicKey()));
out.detPrimeHex = a.getPrime('hex');
out.detGenHex = a.getGenerator('hex');
out.detVerifyError = a.verifyError;

// --- (prime, encoding, generator) overload ----------------------------------
const c1 = crypto.createDiffieHellman(prime.toString('hex'), 'hex', 2);
c1.setPrivateKey(xBuf);
c1.setPublicKey(fromBig(gx, prime.length));
out.overloadPub = c1.getPublicKey('hex');
out.overloadPrimeLen = c1.getPrime().length;

// --- class constructor ------------------------------------------------------
const d = new crypto.DiffieHellman(prime, 2);
d.setPrivateKey(xBuf);
d.setPublicKey(fromBig(gx, prime.length));
out.classPub = d.getPublicKey('hex');
out.classPrivLen = d.getPrivateKey().length;

// --- length form ------------------------------------------------------------
const e = crypto.createDiffieHellman(512, 2);
e.generateKeys();
out.lenForm = { primeLen: e.getPrime().length, privLen: e.getPrivateKey().length, genHex: e.getGenerator('hex') };

// --- string generator -------------------------------------------------------
const f = crypto.createDiffieHellman(prime, 2, '02', 'hex');
out.strGenHex = f.getGenerator('hex');

// --- prototypes -------------------------------------------------------------
out.dhProto = Object.getOwnPropertyNames(crypto.DiffieHellman.prototype).sort();
out.dhgProto = Object.getOwnPropertyNames(crypto.DiffieHellmanGroup.prototype).sort();
out.dhLength = crypto.DiffieHellman.length;
out.dhgLength = crypto.DiffieHellmanGroup.length;
out.createDHLength = crypto.createDiffieHellman.length;
out.getDHLength = crypto.getDiffieHellman.length;

// --- error cases ------------------------------------------------------------
const err = (fn) => {
  try {
    fn();
    return 'no-throw';
  } catch (err) {
    return { ctor: err.constructor.name, code: err.code, message: err.message };
  }
};

out.errUnknownGroup = err(() => crypto.getDiffieHellman('nope'));
out.errGroupCtorUnknown = err(() => new crypto.DiffieHellmanGroup('nope'));
out.errNoArgs = err(() => crypto.createDiffieHellman());
out.errTooSmall = err(() => crypto.createDiffieHellman(256, 2));
out.errNoPrivate = err(() => crypto.getDiffieHellman('modp14').getPrivateKey());
out.errNoPublic = err(() => crypto.getDiffieHellman('modp14').getPublicKey());
out.errSetPrivThenPub = err(() => {
  const g = crypto.createDiffieHellman(prime, 2);
  g.setPrivateKey(xBuf);
  return g.getPublicKey('hex');
});
out.errNoSecret = err(() => crypto.getDiffieHellman('modp14').computeSecret(Buffer.alloc(64, 1)));
out.errBadGen = err(() => crypto.createDiffieHellman(prime, 1));
out.errNewNoArgs = err(() => new crypto.DiffieHellman());
out.errPeerZero = err(() => {
  const g = crypto.getDiffieHellman('modp14');
  g.generateKeys();
  return g.computeSecret(Buffer.alloc(256, 0)).length;
});
out.errPeerFf = err(() => {
  const g = crypto.getDiffieHellman('modp14');
  g.generateKeys();
  return g.computeSecret(Buffer.alloc(256, 255)).length;
});
out.peerOneLen = (() => {
  const g = crypto.getDiffieHellman('modp14');
  g.generateKeys();
  return g.computeSecret(Buffer.alloc(256, 1)).length;
})();

console.log('__OBS__' + JSON.stringify(out));
