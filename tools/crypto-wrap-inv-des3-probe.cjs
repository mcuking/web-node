// M93.4f differential probe: AES key wrap with the inverse cipher (SP 800-38F
// `*-wrap-inv` / `*-wrap-pad-inv`) and DES-EDE3-CBC key wrap (RFC 3217 / CMS).
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line.
//
// The `*-wrap-inv` modes are deterministic (fixed key + IV). `des3-wrap` is not:
// OpenSSL generates a random IV for every wrap (and rejects any caller-supplied
// non-empty IV), so we compare the *decrypt* direction against fixed ciphertexts
// recorded from real Node v26.9.0 (see `DES3_RECORDED`) plus a decrypt(encrypt)
// round-trip.
const crypto = require('crypto');

const hex = (b) => Buffer.from(b).toString('hex');
const fromHex = (h) => Buffer.from(h, 'hex');
const obs = {};

function err(fn) {
  try {
    const value = fn();
    return { ok: true, value: Buffer.isBuffer(value) ? hex(value) : value };
  } catch (e) {
    return { ok: false, name: e.name, code: e.code, message: e.message };
  }
}

const K128 = fromHex('000102030405060708090a0b0c0d0e0f');
const K192 = fromHex('000102030405060708090a0b0c0d0e0f1011121314151617');
const K256 = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const IV8 = fromHex('a6a6a6a6a6a6a6a6');
const ICV4 = fromHex('a65959a6');

// --- info -------------------------------------------------------------------
obs.info = {};
for (const n of [
  'aes-128-wrap-inv',
  'aes128-wrap-inv',
  'aes-192-wrap-inv',
  'aes-256-wrap-inv',
  'aes-128-wrap-pad-inv',
  'aes128-wrap-pad-inv',
  'aes-192-wrap-pad-inv',
  'aes-256-wrap-pad-inv',
  'des3-wrap',
  'id-smime-alg-cms3deswrap',
]) {
  obs.info[n] = crypto.getCipherInfo(n);
}

// --- AES inverse key wrap ---------------------------------------------------
{
  const one = (name, kek, iv, data) => {
    const x = crypto.createCipheriv(name, kek, iv);
    const ct = Buffer.concat([x.update(data), x.final()]);
    const y = crypto.createDecipheriv(name, kek, iv);
    const pt = Buffer.concat([y.update(ct), y.final()]);
    return `${hex(ct)}|${hex(pt)}`;
  };
  const P128 = fromHex('00112233445566778899aabbccddeeff');
  const P192 = fromHex('00112233445566778899aabbccddeeff0001020304050607');
  const P256 = fromHex('00112233445566778899aabbccddeeff000102030405060708090a0b0c0d0e0f');
  obs.wrapInv = {
    aes128: one('aes-128-wrap-inv', K128, IV8, P128),
    aes192: one('aes-192-wrap-inv', K192, IV8, P192),
    aes256: one('aes-256-wrap-inv', K256, IV8, P256),
    alias: one('aes128-wrap-inv', K128, IV8, P128),
    pad20: one('aes-128-wrap-pad-inv', K128, ICV4, fromHex('00112233445566778899aabbccddeeff00010203')),
    pad8: one('aes-128-wrap-pad-inv', K128, ICV4, fromHex('0011223344556677')),
    pad1: one('aes-128-wrap-pad-inv', K128, ICV4, fromHex('11')),
    padAlias: one('aes128-wrap-pad-inv', K128, ICV4, fromHex('00112233445566778899aabbccddeeff00010203')),
    // The inverse wrapper must still be invertible by the *inverse* unwrapper and
    // must differ from the forward mode for the same inputs.
    forward128: one('aes-128-wrap', K128, IV8, P128),
  };

  obs.wrapInvErr = {
    noIv: err(() => crypto.createCipheriv('aes-128-wrap-inv', K128, null)),
    badIv: err(() => crypto.createCipheriv('aes-128-wrap-inv', K128, Buffer.alloc(4, 1))),
    pad8Iv: err(() => crypto.createCipheriv('aes-128-wrap-pad-inv', K128, IV8)),
    shortData: err(() => {
      const x = crypto.createCipheriv('aes-128-wrap-inv', K128, IV8);
      return x.update(Buffer.alloc(8, 1));
    }),
    secondUpdate: err(() => {
      const x = crypto.createCipheriv('aes-128-wrap-inv', K128, IV8);
      x.update(P128);
      return x.update(P128);
    }),
    unwrapBadIv: err(() => {
      const y = crypto.createDecipheriv('aes-128-wrap-inv', K128, IV8);
      return y.update(Buffer.alloc(24, 0));
    }),
    padUnwrapBad: err(() => {
      const y = crypto.createDecipheriv('aes-128-wrap-pad-inv', K128, ICV4);
      return y.update(Buffer.alloc(24, 0));
    }),
    getTag: err(() => {
      const x = crypto.createCipheriv('aes-128-wrap-inv', K128, IV8);
      return x.getAuthTag();
    }),
  };
}

// --- DES-EDE3-CBC wrap (RFC 3217) -------------------------------------------
{
  const K24 = fromHex('000102030405060708090a0b0c0d0e0f1011121314151617');
  // Ciphertexts captured from real Node v26.9.0 `createCipheriv('des3-wrap', K24, null)`
  // for the plaintexts shown; the IV is random so only decrypt is comparable.
  const DES3_RECORDED = [
    {
      pt: '00112233445566778899aabbccddeeff',
      ct: 'c99821e8861f01748d15419760c39347bb42e2132a9357818a72dcfb287b10f3',
    },
    {
      pt: '00112233445566778899aabbccddeeff0011223344556677',
      ct: '706e61255a7c11b32deaae65b75f1b4d6ad637b049ee86acd15619f3ec42bc81de35c8a1558f750e',
    },
  ];
  obs.des3Wrap = {};
  for (const { pt, ct } of DES3_RECORDED) {
    const d = crypto.createDecipheriv('des3-wrap', K24, null);
    obs.des3Wrap[pt] = hex(Buffer.concat([d.update(fromHex(ct)), d.final()]));
  }
  // Round-trip: random IV, but decrypt(encrypt(x)) must be x.
  const round = (data) => {
    const x = crypto.createCipheriv('des3-wrap', K24, null);
    const ct = Buffer.concat([x.update(data), x.final()]);
    const d = crypto.createDecipheriv('des3-wrap', K24, null);
    const pt = Buffer.concat([d.update(ct), d.final()]);
    return { ctLen: ct.length, pt: hex(pt) };
  };
  obs.des3Round = {
    len16: round(fromHex('00112233445566778899aabbccddeeff')),
    len24: round(fromHex('00112233445566778899aabbccddeeff0011223344556677')),
    len32: round(fromHex('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff')),
    empty: round(Buffer.alloc(0)),
  };

  obs.des3Err = {
    badData: err(() => {
      const x = crypto.createCipheriv('des3-wrap', K24, null);
      return x.update(Buffer.alloc(20, 1));
    }),
    oddData: err(() => {
      const x = crypto.createCipheriv('des3-wrap', K24, null);
      return x.update(Buffer.alloc(3, 1));
    }),
    nonEmptyIv: err(() => crypto.createCipheriv('des3-wrap', K24, Buffer.alloc(8, 1))),
    undefinedIv: err(() => crypto.createCipheriv('des3-wrap', K24, undefined)),
    secondUpdate: err(() => {
      const x = crypto.createCipheriv('des3-wrap', K24, null);
      x.update(Buffer.alloc(16, 1));
      return x.update(Buffer.alloc(16, 1));
    }),
    shortDecrypt: err(() => {
      const d = crypto.createDecipheriv('des3-wrap', K24, null);
      return d.update(Buffer.alloc(16, 0));
    }),
    badTag: err(() => {
      const d = crypto.createDecipheriv('des3-wrap', K24, null);
      return Buffer.concat([d.update(Buffer.alloc(32, 0)), d.final()]);
    }),
    getTag: err(() => {
      const x = crypto.createCipheriv('des3-wrap', K24, null);
      return x.getAuthTag();
    }),
    finalNoUpdate: err(() => {
      const x = crypto.createCipheriv('des3-wrap', K24, null);
      return x.final();
    }),
  };
}

console.log('__OBS__' + JSON.stringify(obs));
