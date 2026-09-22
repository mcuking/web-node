// Differential observation program for `crypto.createHash` over the digest
// surface added in M90.5 (SHA-3, Keccak, SHAKE and the keccak-kmac XOFs). Run
// by tools/crypto-hashes-oracle.mjs on a real Node, and by
// test/crypto-hashes.test.ts inside web-node; the two JSON documents must match.
const crypto = require('crypto');

const hex = (b) => Buffer.from(b).toString('hex');
const messages = {
  empty: Buffer.alloc(0),
  abc: Buffer.from('abc'),
  pangram: Buffer.from('The quick brown fox jumps over the lazy dog'),
  binary: Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
  long: Buffer.alloc(1000, 7),
};

// XOF names need an explicit outputLength; fixed names must not receive one.
const cases = [
  ['sha3-224', undefined], ['sha3-256', undefined], ['sha3-384', undefined], ['sha3-512', undefined],
  ['keccak-224', undefined], ['keccak-256', undefined], ['keccak-384', undefined], ['keccak-512', undefined],
  ['shake128', 16], ['shake128', 32], ['shake256', 32], ['shake256', 64],
  ['keccak-kmac-128', 32], ['keccak-kmac-128', 16], ['keccak-kmac-256', 64], ['keccak-kmac-256', 32],
  ['RSA-SHA3-256', undefined], ['id-rsassa-pkcs1-v1_5-with-sha3-224', undefined],
  ['shake-128', 32], ['keccak-kmac128', 32],
  ['blake2b512', undefined], ['blake2b-512', undefined], ['blake2s256', undefined], ['blake2s-256', undefined],
  ['sm3', undefined], ['RSA-SM3', undefined], ['ripemd160', undefined], ['ripemd-160', undefined], ['rmd160', undefined], ['RSA-RIPEMD160', undefined],
];

const out = {};
for (const [name, outputLength] of cases) {
  const key = outputLength === undefined ? name : `${name}@${outputLength}`;
  out[key] = {};
  for (const [label, message] of Object.entries(messages)) {
    const hash = outputLength === undefined
      ? crypto.createHash(name)
      : crypto.createHash(name, { outputLength });
    out[key][label] = hex(hash.update(message).digest());
  }
}

// Error surface: a fixed digest must reject outputLength.
out.errors = {};
try {
  crypto.createHash('sha3-256', { outputLength: 16 });
  out.errors.sha3OutputLength = 'no-throw';
} catch (e) {
  out.errors.sha3OutputLength = { name: e.name, code: e.code, message: e.message };
}

console.log('__OBS__' + JSON.stringify(out));
