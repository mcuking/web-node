// Differential observation program for `crypto.argon2` / `crypto.argon2Sync`.
// Run by tools/crypto-argon2-oracle.mjs on a real Node, and by
// test/crypto-argon2.test.ts inside web-node; the two JSON documents must match.
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
const hex = (b) => Buffer.from(b).toString('hex');
const filled = (n, v) => Buffer.alloc(n, v);

// -- RFC 9106 §5 test vectors (full parameter set) --------------------------
const vec = {
  message: filled(32, 1),
  nonce: filled(16, 2),
  secret: filled(8, 3),
  associatedData: filled(12, 4),
  parallelism: 4,
  tagLength: 32,
  memory: 32,
  passes: 3,
};
out.vectors = {
  argon2d: hex(crypto.argon2Sync('argon2d', vec)),
  argon2i: hex(crypto.argon2Sync('argon2i', vec)),
  argon2id: hex(crypto.argon2Sync('argon2id', vec)),
};

// -- assorted parameter combinations ----------------------------------------
out.combos = {};
const combos = [
  ['id_simple', 'argon2id', { message: 'password', nonce: 'somesalt', parallelism: 1, tagLength: 32, memory: 64, passes: 2 }],
  ['i_simple', 'argon2i', { message: 'password', nonce: 'somesalt', parallelism: 1, tagLength: 32, memory: 64, passes: 2 }],
  ['d_simple', 'argon2d', { message: 'password', nonce: 'somesalt', parallelism: 2, tagLength: 24, memory: 256, passes: 3 }],
  ['id_bytes', 'argon2id', { message: Buffer.from([0, 1, 2, 3, 255]), nonce: Buffer.alloc(12, 9), parallelism: 1, tagLength: 48, memory: 128, passes: 1 }],
  ['id_ab', 'argon2id', { message: Uint8Array.from([1, 2, 3]).buffer, nonce: Uint8Array.from([4, 5, 6, 7, 8, 9, 10, 11]), parallelism: 3, tagLength: 64, memory: 512, passes: 2 }],
  ['id_secret_ad', 'argon2id', { message: 'pw', nonce: 'salt-salt', parallelism: 1, tagLength: 32, memory: 64, passes: 2, secret: 'sk', associatedData: 'ad' }],
  ['id_min_mem', 'argon2id', { message: 'x', nonce: '12345678', parallelism: 2, tagLength: 4, memory: 16, passes: 1 }],
];
for (const [name, algorithm, parameters] of combos) {
  out.combos[name] = hex(crypto.argon2Sync(algorithm, parameters));
}

// -- error surface ----------------------------------------------------------
out.errors = {
  badAlgorithm: err(() => crypto.argon2Sync('argon2x', {})),
  algorithmNumber: err(() => crypto.argon2Sync(1, {})),
  parametersNumber: err(() => crypto.argon2Sync('argon2id', 1)),
  missingMessage: err(() => crypto.argon2Sync('argon2id', { nonce: filled(8, 1), parallelism: 1, tagLength: 32, memory: 64, passes: 2 })),
  messageNumber: err(() => crypto.argon2Sync('argon2id', { message: 5, nonce: filled(8, 1), parallelism: 1, tagLength: 32, memory: 64, passes: 2 })),
  nonceShort: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: Buffer.alloc(4), parallelism: 1, tagLength: 32, memory: 64, passes: 2 })),
  nonceMissing: err(() => crypto.argon2Sync('argon2id', { message: 'x', parallelism: 1, tagLength: 32, memory: 64, passes: 2 })),
  tagLengthSmall: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: filled(8, 1), parallelism: 1, tagLength: 2, memory: 64, passes: 2 })),
  tagLengthFloat: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: filled(8, 1), parallelism: 1, tagLength: 32.5, memory: 64, passes: 2 })),
  memoryTooSmall: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: filled(8, 1), parallelism: 2, tagLength: 32, memory: 8, passes: 2 })),
  parallelismZero: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: filled(8, 1), parallelism: 0, tagLength: 32, memory: 64, passes: 2 })),
  parallelismMissing: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: filled(8, 1), tagLength: 32, memory: 64, passes: 2 })),
  passesZero: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: filled(8, 1), parallelism: 1, tagLength: 32, memory: 64, passes: 0 })),
  secretNumber: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: filled(8, 1), parallelism: 1, tagLength: 32, memory: 64, passes: 2, secret: 5 })),
  adNumber: err(() => crypto.argon2Sync('argon2id', { message: 'x', nonce: filled(8, 1), parallelism: 1, tagLength: 32, memory: 64, passes: 2, associatedData: 5 })),
  asyncNoCb: err(() => crypto.argon2('argon2id', { message: 'x', nonce: filled(8, 1), parallelism: 1, tagLength: 32, memory: 64, passes: 2 })),
};

out.arities = { argon2: crypto.argon2.length, argon2Sync: crypto.argon2Sync.length };

// -- async form -------------------------------------------------------------
const parameters = { message: 'password', nonce: 'somesalt', parallelism: 1, tagLength: 32, memory: 64, passes: 2 };
crypto.argon2('argon2id', parameters, (e, tag) => {
  out.async = e ? { error: String(e) } : { isBuffer: Buffer.isBuffer(tag), length: tag.length, hex: hex(tag) };
  console.log('__OBS__' + JSON.stringify(out));
});
