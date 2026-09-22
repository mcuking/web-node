// M93.4d differential probe: AES-SIV (RFC 5297) and AES-XTS (IEEE 1619).
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. Fixed keys/IVs keep every value deterministic.
const crypto = require('crypto');

const hex = (b) => Buffer.from(b).toString('hex');
const fromHex = (h) => Buffer.from(h, 'hex');
const obs = {};

function err(fn) {
  try {
    const value = fn();
    if (Buffer.isBuffer(value)) return { ok: true, value: hex(value) };
    if (Array.isArray(value)) return { ok: true, value: value.map((v) => (Buffer.isBuffer(v) ? hex(v) : v)) };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, name: e.name, code: e.code, message: e.message };
  }
}

// --- info -------------------------------------------------------------------
obs.info = {};
for (const n of ['aes-128-siv', 'aes-192-siv', 'aes-256-siv', 'aes-128-xts', 'aes-192-xts', 'aes-256-xts']) {
  obs.info[n] = crypto.getCipherInfo(n);
}

const K32 = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const K48 = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f',
);
const K64 = fromHex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f' +
    '303132333435363738393a3b3c3d3e3f',
);
const K128 = fromHex('000102030405060708090a0b0c0d0e0f');
const K256 = K64;
const AAD = fromHex('aabbccddee');

// --- SIV --------------------------------------------------------------------
{
  const runSiv = (name, key, aad, pt) => {
    const enc = crypto.createCipheriv(name, key, null, { authTagLength: 16 });
    if (aad) enc.setAAD(aad);
    const cu = enc.update(pt);
    const cf = enc.final();
    const tag = enc.getAuthTag();
    const full = Buffer.concat([cu, cf]);
    const dec = crypto.createDecipheriv(name, key, null, { authTagLength: 16 });
    if (aad) dec.setAAD(aad);
    dec.setAuthTag(tag);
    const du = dec.update(full);
    const df = dec.final();
    return [hex(cu), hex(cf), hex(tag), hex(Buffer.concat([du, df]))].join('|');
  };
  obs.siv = {
    a128: runSiv('aes-128-siv', K32, AAD, Buffer.from('hello world')),
    a192: runSiv('aes-192-siv', K48, AAD, Buffer.from('hello world')),
    a256: runSiv('aes-256-siv', K64, AAD, Buffer.from('hello world')),
    noAad: runSiv('aes-128-siv', K32, null, Buffer.from('hello world')),
    empty: runSiv('aes-128-siv', K32, AAD, Buffer.alloc(0)),
    block16: runSiv('aes-128-siv', K32, AAD, Buffer.alloc(16, 7)),
    block32: runSiv('aes-128-siv', K32, AAD, Buffer.alloc(32, 7)),
    block40: runSiv('aes-128-siv', K32, AAD, Buffer.alloc(40, 7)),
  };
  // Multiple AAD components are each mixed in.
  const multi = crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
  multi.setAAD(Buffer.from('aa'));
  multi.setAAD(Buffer.from('bb'));
  const mct = Buffer.concat([multi.update(Buffer.from('hi')), multi.final()]);
  obs.sivMultiAad = `${hex(mct)}|${hex(multi.getAuthTag())}`;
}

obs.sivErr = {
  iv16: err(() => crypto.createCipheriv('aes-128-siv', K32, Buffer.alloc(16, 1), { authTagLength: 16 })),
  ivEmptyOk: err(() => {
    const x = crypto.createCipheriv('aes-128-siv', K32, Buffer.alloc(0), { authTagLength: 16 });
    x.setAAD(AAD);
    const ct = Buffer.concat([x.update(Buffer.from('hi')), x.final()]);
    return `${hex(ct)}|${hex(x.getAuthTag())}`;
  }),
  badKeyLen: err(() => crypto.createCipheriv('aes-128-siv', K128, null, { authTagLength: 16 })),
  tag12: err(() => crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 12 })),
  defaultTag: err(() => {
    const x = crypto.createCipheriv('aes-128-siv', K32, null);
    x.setAAD(AAD);
    const ct = Buffer.concat([x.update(Buffer.from('hi')), x.final()]);
    return `${hex(ct)}|${hex(x.getAuthTag())}`;
  }),
  secondUpdate: err(() => {
    const x = crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    x.setAAD(AAD);
    x.update(Buffer.from('hi'));
    return x.update(Buffer.from('hi'));
  }),
  aadAfterUpdate: err(() => {
    const x = crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    x.setAAD(AAD);
    x.update(Buffer.from('hi'));
    x.setAAD(Buffer.from('cc'));
  }),
  getTagEarly: err(() => {
    const x = crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    return x.getAuthTag();
  }),
  finalNoUpdate: err(() => {
    const x = crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    return x.final();
  }),
  badTag: err(() => {
    const e = crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    e.setAAD(AAD);
    const ct = Buffer.concat([e.update(Buffer.from('hello world')), e.final()]);
    const d = crypto.createDecipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    d.setAAD(AAD);
    d.setAuthTag(Buffer.alloc(16, 9));
    d.update(ct);
    return d.final();
  }),
  noTag: err(() => {
    const e = crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    e.setAAD(AAD);
    const ct = Buffer.concat([e.update(Buffer.from('hello world')), e.final()]);
    const d = crypto.createDecipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    d.setAAD(AAD);
    d.update(ct);
    return d.final();
  }),
  setTagAfterUpdate: err(() => {
    const d = crypto.createDecipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    d.setAAD(AAD);
    d.update(Buffer.alloc(16, 0));
    d.setAuthTag(Buffer.alloc(16, 0));
  }),
  setAutoPadding: err(() => {
    const x = crypto.createCipheriv('aes-128-siv', K32, null, { authTagLength: 16 });
    x.setAutoPadding(false);
    return 'ok';
  }),
};

// --- XTS --------------------------------------------------------------------
{
  const IV = fromHex('00112233445566778899aabbccddeeff');
  const IV0 = fromHex('00000000000000000000000000000000');
  const runXts = (name, key, iv, pt) => {
    const enc = crypto.createCipheriv(name, key, iv);
    const cu = enc.update(pt);
    const cf = enc.final();
    const ct = Buffer.concat([cu, cf]);
    const dec = crypto.createDecipheriv(name, key, iv);
    const du = dec.update(ct);
    const df = dec.final();
    return [hex(cu), hex(cf), hex(Buffer.concat([du, df]))].join('|');
  };
  obs.xts = {
    a128_32: runXts('aes-128-xts', K32, IV, Buffer.alloc(32, 7)),
    a128_16: runXts('aes-128-xts', K32, IV, Buffer.alloc(16, 7)),
    a128_20: runXts('aes-128-xts', K32, IV, Buffer.alloc(20, 7)),
    a128_33: runXts('aes-128-xts', K32, IV0, Buffer.alloc(33, 7)),
    a128_48: runXts('aes-128-xts', K32, IV, Buffer.alloc(48, 9)),
    a256_32: runXts('aes-256-xts', K64, IV, Buffer.alloc(32, 7)),
    a256_20: runXts('aes-256-xts', K64, IV, Buffer.alloc(20, 7)),
  };
  // 1000-byte known vector for good measure.
  const big = fromHex(
    (() => {
      let s = '';
      for (let i = 0; i < 1000; i++) s += (i & 0xff).toString(16).padStart(2, '0');
      return s;
    })(),
  );
  obs.xtsBig = runXts('aes-128-xts', K32, IV, big);
}

obs.xtsErr = {
  short8: err(() => {
    const x = crypto.createCipheriv('aes-128-xts', K32, fromHex('00112233445566778899aabbccddeeff'));
    return Buffer.concat([x.update(Buffer.alloc(8, 7)), x.final()]);
  }),
  empty: err(() => {
    const x = crypto.createCipheriv('aes-128-xts', K32, fromHex('00112233445566778899aabbccddeeff'));
    return Buffer.concat([x.update(Buffer.alloc(0)), x.final()]);
  }),
  secondUpdate: err(() => {
    const x = crypto.createCipheriv('aes-128-xts', K32, fromHex('00112233445566778899aabbccddeeff'));
    x.update(Buffer.alloc(16, 1));
    return x.update(Buffer.alloc(16, 2));
  }),
  noIv: err(() => crypto.createCipheriv('aes-128-xts', K32, null)),
  iv8: err(() => crypto.createCipheriv('aes-128-xts', K32, Buffer.alloc(8, 1))),
  badKeyLen: err(() => crypto.createCipheriv('aes-128-xts', Buffer.alloc(16, 1), Buffer.alloc(16, 2))),
  badKeyLen64: err(() => crypto.createCipheriv('aes-256-xts', K32, Buffer.alloc(16, 2))),
  dupKeys: err(() => crypto.createCipheriv('aes-128-xts', Buffer.alloc(32, 5), Buffer.alloc(16, 2))),
  dupKeys256: err(() => crypto.createCipheriv('aes-256-xts', Buffer.concat([K128, K128]), Buffer.alloc(16, 2))),
  finalNoUpdate: err(() => {
    const x = crypto.createCipheriv('aes-128-xts', K32, Buffer.alloc(16, 2));
    return x.final();
  }),
  getTag: err(() => {
    const x = crypto.createCipheriv('aes-128-xts', K32, Buffer.alloc(16, 2));
    return x.getAuthTag();
  }),
  setAad: err(() => {
    const x = crypto.createCipheriv('aes-128-xts', K32, Buffer.alloc(16, 2));
    x.setAAD(Buffer.from('aa'));
  }),
  setAutoPadding: err(() => {
    const x = crypto.createCipheriv('aes-128-xts', K32, Buffer.alloc(16, 2));
    x.setAutoPadding(false);
    return 'ok';
  }),
  decipherSetTag: err(() => {
    const d = crypto.createDecipheriv('aes-128-xts', K32, Buffer.alloc(16, 2));
    d.setAuthTag(Buffer.alloc(16, 0));
  }),
};

console.log('__OBS__' + JSON.stringify(obs));
