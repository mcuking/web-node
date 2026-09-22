// Differential observation program for `crypto.generatePrime` / `generatePrimeSync`
// / `checkPrime` / `checkPrimeSync`. Run by tools/crypto-primes-oracle.mjs on a
// real Node, and by test/crypto-primes.test.ts inside web-node; the two JSON
// documents must be identical.
const crypto = require('crypto');

const out = {};
const err = (fn) => {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    return { name: e.name, code: e.code, message: e.message };
  }
};

const toBig = (p) => {
  if (typeof p === 'bigint') return p;
  const u8 = p instanceof ArrayBuffer ? new Uint8Array(p) : Uint8Array.from(p);
  let v = 0n;
  for (const b of u8) v = (v << 8n) | BigInt(b);
  return v;
};
const bitsOf = (n) => (n === 0n ? 0 : n.toString(2).length);

// -- checkPrimeSync: deterministic primality answers -------------------------
const candidates = [
  0n, 1n, 2n, 3n, 4n, 5n, 7n, 8n, 9n, 15n, 16n, 17n, 25n, 49n, 91n,
  97n, 121n, 341n, 561n, 1105n, 1729n, 2047n, 2049n, 7919n, 65537n,
  2147483647n, 2147483649n, 1000000007n, 1000000009n,
  2305843009213693951n, 2305843009213693955n,
  32416190071n, 32416190073n,
];
out.checkSync = {};
for (const c of candidates) out.checkSync[String(c)] = crypto.checkPrimeSync(c);

out.checkBig = {
  p61: crypto.checkPrimeSync(2n ** 61n - 1n),
  c61: crypto.checkPrimeSync(2n ** 61n - 3n),
  p127: crypto.checkPrimeSync(2n ** 127n - 1n),
  c127: crypto.checkPrimeSync(2n ** 127n - 3n),
  p256: crypto.checkPrimeSync(2n ** 256n - 189n),
  mersenne_p521: crypto.checkPrimeSync(2n ** 521n - 1n),
};

out.checks = {
  bigChecks: crypto.checkPrimeSync(32416190071n, { checks: 40 }),
  composite: crypto.checkPrimeSync(32416190073n, { checks: 40 }),
  zero: crypto.checkPrimeSync(97n, { checks: 0 }),
  undefinedOptions: crypto.checkPrimeSync(97n, undefined),
};

out.forms = {
  buffer: crypto.checkPrimeSync(Buffer.from([0x61, 0x1f])),
  u8: crypto.checkPrimeSync(Uint8Array.from([0x61, 0x1f])),
  ab: crypto.checkPrimeSync(Uint8Array.from([0x61, 0x1f]).buffer),
  bigint: crypto.checkPrimeSync(BigInt(0x611f)),
  emptyBuf: crypto.checkPrimeSync(Buffer.alloc(0)),
  oneByte: crypto.checkPrimeSync(Buffer.from([2])),
  leadingZero: crypto.checkPrimeSync(Buffer.from([0x00, 0x61, 0x1f])),
};

// -- error surface ----------------------------------------------------------
out.errors = {
  sizeNull: err(() => crypto.generatePrimeSync(null)),
  sizeNaN: err(() => crypto.generatePrimeSync(NaN)),
  sizeStr: err(() => crypto.generatePrimeSync('8')),
  sizeZero: err(() => crypto.generatePrimeSync(0)),
  sizeNeg: err(() => crypto.generatePrimeSync(-8)),
  sizeFloat: err(() => crypto.generatePrimeSync(8.5)),
  sizeOne: err(() => crypto.generatePrimeSync(1)),
  optsNull: err(() => crypto.generatePrimeSync(8, null)),
  optsNumber: err(() => crypto.generatePrimeSync(8, 5)),
  safeNumber: err(() => crypto.generatePrimeSync(8, { safe: 1 })),
  bigintNumber: err(() => crypto.generatePrimeSync(8, { bigint: 1 })),
  addTooBig: err(() => crypto.generatePrimeSync(8, { add: (1n << 9n) + 1n })),
  remGeAdd: err(() => crypto.generatePrimeSync(16, { add: 30n, rem: 30n })),
  addNumber: err(() => crypto.generatePrimeSync(16, { add: 5 })),
  addNegative: err(() => crypto.generatePrimeSync(16, { add: -30n, rem: 1n })),
  remNegative: err(() => crypto.generatePrimeSync(16, { add: 30n, rem: -1n })),
  remString: err(() => crypto.generatePrimeSync(16, { add: 30n, rem: 'x' })),
  genAsyncNoCb: err(() => crypto.generatePrime(8)),
  checkNumber: err(() => crypto.checkPrimeSync(97)),
  checkString: err(() => crypto.checkPrimeSync('97')),
  checkNull: err(() => crypto.checkPrimeSync(null)),
  checkNegative: err(() => crypto.checkPrimeSync(-5n)),
  checkOptsNumber: err(() => crypto.checkPrimeSync(97n, 5)),
  checkOptsNull: err(() => crypto.checkPrimeSync(97n, null)),
  checkNegChecks: err(() => crypto.checkPrimeSync(97n, { checks: -1 })),
  checkFloatChecks: err(() => crypto.checkPrimeSync(97n, { checks: 1.5 })),
  checkAsyncNoCb: err(() => crypto.checkPrime(97n)),
};

out.arities = {
  generatePrime: crypto.generatePrime.length,
  generatePrimeSync: crypto.generatePrimeSync.length,
  checkPrime: crypto.checkPrime.length,
  checkPrimeSync: crypto.checkPrimeSync.length,
};

// -- generatePrimeSync shape (structural invariants) ------------------------
const shape = (p) => {
  const n = toBig(p);
  const b = bitsOf(n);
  return {
    ctor: p.constructor.name,
    isArrayBuffer: p instanceof ArrayBuffer,
    isBigInt: typeof p === 'bigint',
    bytes: p instanceof ArrayBuffer ? new Uint8Array(p).length : null,
    bits: b,
    topBit: b >= 1 ? (n >> BigInt(b - 1)) === 1n : null,
    topTwoBits: b >= 2 ? (n >> BigInt(b - 2)) === 3n : null,
    isPrime: crypto.checkPrimeSync(n),
  };
};

out.gen = {};
for (const bits of [2, 8, 16, 32, 64, 128, 256]) {
  out.gen[bits] = shape(crypto.generatePrimeSync(bits));
}
{
  const b = crypto.generatePrimeSync(64, { bigint: true });
  out.gen.bigint = { isBigInt: typeof b === 'bigint', bits: bitsOf(b), isPrime: crypto.checkPrimeSync(b) };
}
{
  const s = crypto.generatePrimeSync(32, { safe: true });
  const n = toBig(s);
  out.gen.safe = { bits: bitsOf(n), isPrime: crypto.checkPrimeSync(n), halfPrime: crypto.checkPrimeSync((n - 1n) / 2n) };
}
{
  const a = crypto.generatePrimeSync(48, { add: 30n, rem: 11n });
  const n = toBig(a);
  out.gen.addRem = { bits: bitsOf(n), modAdd: String(n % 30n), isPrime: crypto.checkPrimeSync(n) };
}
{
  const a = crypto.generatePrimeSync(48, { add: Buffer.from([30]) });
  const n = toBig(a);
  out.gen.addBuffer = { bits: bitsOf(n), modAdd: String(n % 30n), isPrime: crypto.checkPrimeSync(n) };
}
{
  const a = crypto.generatePrimeSync(32, { add: 30n });
  const n = toBig(a);
  out.gen.addOnly = { modAdd: String(n % 30n), isPrime: crypto.checkPrimeSync(n) };
}
{
  const a = crypto.generatePrimeSync(32, { add: 30n, rem: 11n, bigint: true });
  out.gen.addRemBigint = { modAdd: String(a % 30n), isPrime: crypto.checkPrimeSync(a) };
}
{
  // `rem` without `add` is accepted (and ignored by OpenSSL).
  const a = crypto.generatePrimeSync(16, { rem: 5n });
  out.gen.remWithoutAdd = shape(a);
}
{
  // Large `add` (odd) forces a congruence walk; still a valid `bits`-bit prime.
  const a = crypto.generatePrimeSync(128, { add: (1n << 40n) + 7n, rem: 3n });
  const n = toBig(a);
  out.gen.bigAdd = { bits: bitsOf(n), topBit: (n >> 127n) === 1n, modAdd: String(n % ((1n << 40n) + 7n)), isPrime: crypto.checkPrimeSync(n) };
}

// -- async forms ------------------------------------------------------------
let pending = 3;
const finish = () => { if (--pending === 0) console.log('__OBS__' + JSON.stringify(out)); };

crypto.checkPrime(32416190071n, { checks: 20 }, (e, r) => {
  out.asyncCheck = e ? { error: String(e) } : { result: r };
  finish();
});
crypto.generatePrime(32, { bigint: true }, (e, p) => {
  out.asyncGen = e ? { error: String(e) } : { isBigInt: typeof p === 'bigint', isPrime: crypto.checkPrimeSync(p) };
  finish();
});
crypto.checkPrime(2n, (e, r) => {
  out.asyncCheckSmall = e ? { error: String(e) } : { result: r };
  finish();
});
