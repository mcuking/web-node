// M93.3 differential probe: AES-CCM.
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. Fixed keys/IVs make every value deterministic,
// including the SP 800-38C Appendix C vectors.
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
for (const n of ['aes-128-ccm', 'aes-192-ccm', 'aes-256-ccm', 'id-aes128-ccm', 'id-aes256-ccm']) {
  obs.info[n] = crypto.getCipherInfo(n);
}

// --- SP 800-38C Appendix C --------------------------------------------------
{
  // Example 1: AES-128, 13-byte nonce, 13-byte AAD, 4-byte tag.
  const K = fromHex('404142434445464748494a4b4c4d4e4f');
  const N = fromHex('101112131415161718191a1b');
  const A = fromHex('000102030405060708090a0b0c0d0e0f10111213');
  const P = fromHex('20212223');
  const e = crypto.createCipheriv('aes-128-ccm', K, N, { authTagLength: 4 });
  e.setAAD(A, { plaintextLength: P.length });
  const ct = Buffer.concat([e.update(P), e.final()]);
  obs.sp38c_ex1_ct = hex(ct);
  obs.sp38c_ex1_tag = hex(e.getAuthTag());
  const d = crypto.createDecipheriv('aes-128-ccm', K, N, { authTagLength: 4 });
  d.setAAD(A, { plaintextLength: P.length });
  d.setAuthTag(e.getAuthTag());
  obs.sp38c_ex1_pt = hex(Buffer.concat([d.update(ct), d.final()]));
}

// --- fixed key/nonce sweep --------------------------------------------------
{
  const key = Buffer.alloc(16, 1);
  const key24 = Buffer.alloc(24, 1);
  const key32 = Buffer.alloc(32, 1);
  const nonce = Buffer.alloc(12, 2);
  const aad = fromHex('aabbccddee');
  const pt = Buffer.from('hello123');
  const run = (name, k, tag, aadBytes, ptBytes) => {
    const e = crypto.createCipheriv(name, k, nonce, { authTagLength: tag });
    if (aadBytes) e.setAAD(aadBytes, { plaintextLength: ptBytes.length });
    const ct = Buffer.concat([e.update(ptBytes), e.final()]);
    const d = crypto.createDecipheriv(name, k, nonce, { authTagLength: tag });
    if (aadBytes) d.setAAD(aadBytes, { plaintextLength: ptBytes.length });
    d.setAuthTag(e.getAuthTag());
    return hex(ct) + '|' + hex(e.getAuthTag()) + '|' + hex(Buffer.concat([d.update(ct), d.final()]));
  };
  obs.aes128 = run('aes-128-ccm', key, 16, aad, pt);
  obs.aes192 = run('aes-192-ccm', key24, 16, aad, pt);
  obs.aes256 = run('aes-256-ccm', key32, 16, aad, pt);
  obs.noAad = run('aes-128-ccm', key, 16, null, pt);
  // Tag lengths.
  obs.tags = {};
  for (const t of [4, 6, 8, 10, 12, 14, 16]) {
    const e = crypto.createCipheriv('aes-128-ccm', key, nonce, { authTagLength: t });
    e.setAAD(aad, { plaintextLength: pt.length });
    const ct = Buffer.concat([e.update(pt), e.final()]);
    obs.tags[t] = hex(ct) + '|' + hex(e.getAuthTag());
  }
  // Nonce lengths 7..13.
  obs.nonces = {};
  for (const n of [7, 8, 11, 12, 13]) {
    const nn = Buffer.alloc(n, 2);
    const e = crypto.createCipheriv('aes-128-ccm', key, nn, { authTagLength: 16 });
    e.setAAD(aad, { plaintextLength: pt.length });
    const ct = Buffer.concat([e.update(pt), e.final()]);
    obs.nonces[n] = hex(ct) + '|' + hex(e.getAuthTag());
  }
  // Empty payload.
  const e0 = crypto.createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 16 });
  e0.setAAD(aad, { plaintextLength: 0 });
  obs.emptyPayload = hex(Buffer.concat([e0.update(Buffer.alloc(0)), e0.final()])) + '|' + hex(e0.getAuthTag());
}

// --- argument validation ----------------------------------------------------
{
  const key = Buffer.alloc(16, 1);
  const nonce = Buffer.alloc(12, 2);
  const aad = fromHex('aabbccddee');
  obs.errNoTagLength = err(() => crypto.createCipheriv('aes-128-ccm', key, nonce));
  obs.errTag5 = err(() => crypto.createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 5 }));
  obs.errTag18 = err(() => crypto.createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 18 }));
  obs.errIv6 = err(() => crypto.createCipheriv('aes-128-ccm', key, Buffer.alloc(6), { authTagLength: 16 }));
  obs.errIv14 = err(() => crypto.createCipheriv('aes-128-ccm', key, Buffer.alloc(14), { authTagLength: 16 }));
  obs.errAadNoLength = err(() => {
    const e = crypto.createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 16 });
    e.setAAD(aad);
  });
  obs.errShortUpdate = err(() => {
    const e = crypto.createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 16 });
    e.setAAD(aad, { plaintextLength: 5 });
    return e.update(Buffer.alloc(3));
  });
  obs.errLongUpdate = err(() => {
    const e = crypto.createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 16 });
    e.setAAD(aad, { plaintextLength: 2 });
    return e.update(Buffer.alloc(3));
  });
  obs.errBadTag = err(() => {
    const e = crypto.createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 16 });
    e.setAAD(aad, { plaintextLength: 2 });
    const ct = Buffer.concat([e.update(Buffer.from('hi')), e.final()]);
    const d = crypto.createDecipheriv('aes-128-ccm', key, nonce, { authTagLength: 16 });
    d.setAAD(aad, { plaintextLength: 2 });
    d.setAuthTag(Buffer.alloc(16, 9));
    return Buffer.concat([d.update(ct), d.final()]);
  });
  obs.errWrongKeyLen = err(() => crypto.createCipheriv('aes-128-ccm', Buffer.alloc(24, 1), nonce, { authTagLength: 16 }));
}

console.log('__OBS__' + JSON.stringify(obs));
