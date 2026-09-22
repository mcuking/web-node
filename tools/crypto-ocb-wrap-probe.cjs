// M93.4c differential probe: AES-OCB (RFC 7253) and AES key wrap (RFC 3394/5649).
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. Fixed keys/IVs make every value deterministic,
// including the RFC 3394/5649 vectors.
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

// --- info -------------------------------------------------------------------
obs.info = {};
for (const n of [
  'aes-128-ocb',
  'aes-192-ocb',
  'aes-256-ocb',
  'aes-128-wrap',
  'aes128-wrap',
  'id-aes128-wrap',
  'aes-128-wrap-pad',
  'aes128-wrap-pad',
  'id-aes128-wrap-pad',
  'aes-256-wrap',
  'aes256-wrap',
]) {
  obs.info[n] = crypto.getCipherInfo(n);
}

// --- OCB --------------------------------------------------------------------
{
  const KEY = {
    128: fromHex('000102030405060708090a0b0c0d0e0f'),
    192: fromHex('000102030405060708090a0b0c0d0e0f1011121314151617'),
    256: fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
  };
  // RFC 7253 Appendix A vector: K, N, A, P.
  const N = fromHex('000102030405060708090a0b');
  const A = fromHex('000102030405060708090a0b0c0d0e0f');
  const P = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const e = crypto.createCipheriv('aes-128-ocb', KEY[128], N, { authTagLength: 16 });
  e.setAAD(A);
  const ct = Buffer.concat([e.update(P), e.final()]);
  obs.rfc_ct = hex(ct);
  obs.rfc_tag = hex(e.getAuthTag());
  const d = crypto.createDecipheriv('aes-128-ocb', KEY[128], N, { authTagLength: 16 });
  d.setAAD(A);
  d.setAuthTag(e.getAuthTag());
  obs.rfc_pt = hex(Buffer.concat([d.update(ct), d.final()]));

  const nonce = fromHex('000102030405060708090a0b');
  const aad = fromHex('aabbccddee');
  const run = (bits, tag, iv, a, payload) => {
    const enc = crypto.createCipheriv(`aes-${bits}-ocb`, KEY[bits], iv, { authTagLength: tag });
    if (a) enc.setAAD(a);
    const u = enc.update(payload);
    const f = enc.final();
    const tagBytes = enc.getAuthTag();
    const dec = crypto.createDecipheriv(`aes-${bits}-ocb`, KEY[bits], iv, { authTagLength: tag });
    if (a) dec.setAAD(a);
    dec.setAuthTag(tagBytes);
    const du = dec.update(Buffer.concat([u, f]));
    const df = dec.final();
    return `${hex(u)}|${hex(f)}|${hex(tagBytes)}|${hex(du)}|${hex(df)}`;
  };
  obs.modes = {
    a128: run(128, 16, nonce, aad, Buffer.from('hello world')),
    a192: run(192, 16, nonce, aad, Buffer.from('hello world')),
    a256: run(256, 16, nonce, aad, Buffer.from('hello world')),
    noAad: run(128, 16, nonce, null, Buffer.from('hello world')),
    empty: run(128, 16, nonce, aad, Buffer.alloc(0)),
    block16: run(128, 16, nonce, aad, Buffer.alloc(16, 7)),
    block40: run(128, 16, nonce, aad, Buffer.alloc(40, 7)),
    iv13: run(128, 16, fromHex('000102030405060708090a0b0c'), aad, Buffer.from('hello world')),
    iv15: run(128, 16, fromHex('000102030405060708090a0b0c0d0e'), aad, Buffer.from('hi')),
    iv8: run(128, 16, fromHex('0001020304050607'), aad, Buffer.from('hi')),
    tag8: run(128, 8, nonce, aad, Buffer.from('hello world')),
    tag12: run(128, 12, nonce, aad, Buffer.from('hello world')),
  };
  // Streaming: the update/final split must match OpenSSL exactly.
  const enc = crypto.createCipheriv('aes-128-ocb', KEY[128], nonce, { authTagLength: 16 });
  enc.setAAD(aad);
  const c1 = enc.update(Buffer.alloc(16, 3));
  const c2 = enc.update(Buffer.alloc(16, 4));
  const c3 = enc.update(Buffer.alloc(5, 5));
  const c4 = enc.final();
  obs.streaming = [hex(c1), hex(c2), hex(c3), hex(c4), hex(enc.getAuthTag())].join('|');
}

// --- OCB errors -------------------------------------------------------------
{
  const key = fromHex('000102030405060708090a0b0c0d0e0f');
  const nonce = fromHex('000102030405060708090a0b');
  const aad = fromHex('aabbccddee');
  obs.ocbErr = {
    noTag: err(() => crypto.createCipheriv('aes-128-ocb', key, nonce)),
    tag17: err(() => crypto.createCipheriv('aes-128-ocb', key, nonce, { authTagLength: 17 })),
    tag0: err(() => {
      const e = crypto.createCipheriv('aes-128-ocb', key, nonce, { authTagLength: 0 });
      e.setAAD(aad);
      const ct = Buffer.concat([e.update(Buffer.from('hi')), e.final()]);
      return `${hex(ct)}|${hex(e.getAuthTag())}`;
    }),
    iv16: err(() => crypto.createCipheriv('aes-128-ocb', key, Buffer.alloc(16, 1), { authTagLength: 16 })),
    iv0: err(() => crypto.createCipheriv('aes-128-ocb', key, Buffer.alloc(0), { authTagLength: 16 })),
    badKey: err(() => crypto.createCipheriv('aes-128-ocb', Buffer.alloc(15, 1), nonce, { authTagLength: 16 })),
    badTag: err(() => {
      const e = crypto.createCipheriv('aes-128-ocb', key, nonce, { authTagLength: 16 });
      e.setAAD(aad);
      const ct = Buffer.concat([e.update(Buffer.from('hello world')), e.final()]);
      const d = crypto.createDecipheriv('aes-128-ocb', key, nonce, { authTagLength: 16 });
      d.setAAD(aad);
      d.setAuthTag(Buffer.alloc(16, 9));
      d.update(ct);
      return d.final();
    }),
    noTagSet: err(() => {
      const e = crypto.createCipheriv('aes-128-ocb', key, nonce, { authTagLength: 16 });
      e.setAAD(aad);
      const ct = Buffer.concat([e.update(Buffer.from('hello world')), e.final()]);
      const d = crypto.createDecipheriv('aes-128-ocb', key, nonce, { authTagLength: 16 });
      d.setAAD(aad);
      d.update(ct);
      return d.final();
    }),
    getTagEarly: err(() => {
      const e = crypto.createCipheriv('aes-128-ocb', key, nonce, { authTagLength: 16 });
      return e.getAuthTag();
    }),
    undefinedName: err(() => crypto.getCipherInfo('aes-128-ocb')),
  };
}

// --- key wrap ---------------------------------------------------------------
{
  const K128 = fromHex('000102030405060708090A0B0C0D0E0F');
  const K192 = fromHex('000102030405060708090A0B0C0D0E0F1011121314151617');
  const K256 = fromHex('000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F');
  const IV8 = fromHex('A6A6A6A6A6A6A6A6');
  const ICV4 = fromHex('A65959A6');
  const P128 = fromHex('00112233445566778899AABBCCDDEEFF');
  const P192 = fromHex('00112233445566778899AABBCCDDEEFF0001020304050607');
  const P256 = fromHex('00112233445566778899AABBCCDDEEFF000102030405060708090A0B0C0D0E0F');

  const wrapOne = (name, kek, iv, data) => {
    const x = crypto.createCipheriv(name, kek, iv);
    const u = x.update(data);
    const f = x.final();
    const ct = Buffer.concat([u, f]);
    const y = crypto.createDecipheriv(name, kek, iv);
    const pu = y.update(ct);
    const pf = y.final();
    return `${hex(u)}|${hex(f)}|${hex(Buffer.concat([pu, pf]))}`;
  };

  obs.wrap = {
    aes128: wrapOne('aes-128-wrap', K128, IV8, P128),
    aes192: wrapOne('aes-192-wrap', K192, IV8, P192),
    aes256: wrapOne('aes-256-wrap', K256, IV8, P256),
    alias: wrapOne('aes128-wrap', K128, IV8, P128),
    idAlias: wrapOne('id-aes128-wrap', K128, IV8, P128),
    pad20: wrapOne('aes-128-wrap-pad', K128, ICV4, fromHex('00112233445566778899AABBCCDDEEFF00010203')),
    pad8: wrapOne('aes-128-wrap-pad', K128, ICV4, fromHex('0011223344556677')),
    pad1: wrapOne('aes-128-wrap-pad', K128, ICV4, fromHex('11')),
    padAlias: wrapOne('aes128-wrap-pad', K128, ICV4, fromHex('00112233445566778899AABBCCDDEEFF00010203')),
  };

  obs.wrapErr = {
    noIv: err(() => crypto.createCipheriv('aes-128-wrap', K128, null)),
    badIv: err(() => crypto.createCipheriv('aes-128-wrap', K128, Buffer.alloc(4, 1))),
    padNoIv: err(() => crypto.createCipheriv('aes-128-wrap-pad', K128, null)),
    pad8Iv: err(() => crypto.createCipheriv('aes-128-wrap-pad', K128, IV8)),
    shortData: err(() => {
      const x = crypto.createCipheriv('aes-128-wrap', K128, IV8);
      return x.update(Buffer.alloc(8, 1));
    }),
    oddData: err(() => {
      const x = crypto.createCipheriv('aes-128-wrap', K128, IV8);
      return x.update(Buffer.alloc(17, 1));
    }),
    secondUpdate: err(() => {
      const x = crypto.createCipheriv('aes-128-wrap', K128, IV8);
      x.update(P128);
      return x.update(P128);
    }),
    unwrapBadIv: err(() => {
      const y = crypto.createDecipheriv('aes-128-wrap', K128, IV8);
      return y.update(Buffer.alloc(24, 0));
    }),
    unwrapShort: err(() => {
      const y = crypto.createDecipheriv('aes-128-wrap', K128, IV8);
      return y.update(Buffer.alloc(16, 0));
    }),
    padUnwrapBad: err(() => {
      const y = crypto.createDecipheriv('aes-128-wrap-pad', K128, ICV4);
      return y.update(Buffer.alloc(24, 0));
    }),
    finalWithoutUpdate: err(() => {
      const x = crypto.createCipheriv('aes-128-wrap', K128, IV8);
      return x.final();
    }),
  };
}

console.log('__OBS__' + JSON.stringify(obs));
