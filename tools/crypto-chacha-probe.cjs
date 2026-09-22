// M93 differential probe: ChaCha20 and ChaCha20-Poly1305.
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. Everything here is deterministic (fixed keys/IVs),
// including the RFC 8439 §2.4.2 / §2.8.2 reference vectors.
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
obs.infoChacha20 = crypto.getCipherInfo('chacha20');
obs.infoPoly = crypto.getCipherInfo('chacha20-poly1305');
obs.infoByNid = crypto.getCipherInfo(1018);
obs.hasCipherNames = crypto.getCiphers().filter((n) => /chacha/.test(n)).sort();

// --- chacha20 (raw stream) --------------------------------------------------
// RFC 8439 §2.4.2: key = 00..1f, nonce = 000000000000004a00000000, ctr = 1.
// OpenSSL's 16-byte IV packs an 8-byte counter then the 8-byte nonce.
{
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  const iv = fromHex('01000000000000000000004a00000000');
  const ct = crypto.createCipheriv('chacha20', key, iv);
  const out = Buffer.concat([ct.update(Buffer.alloc(64)), ct.final()]);
  obs.rfc8439_2_4_2_first64 = hex(out.subarray(0, 64));
}

// `chacha20` with a simple key/iv, split across multiple updates.
{
  const key = Buffer.alloc(32, 1);
  const iv = Buffer.alloc(16, 2);
  const c = crypto.createCipheriv('chacha20', key, iv);
  const a = c.update('hello ');
  const b = c.update('world');
  const f = c.final();
  obs.chacha20MultiUpdate = hex(Buffer.concat([a, b, f]));
  const d = crypto.createDecipheriv('chacha20', key, iv);
  obs.chacha20Roundtrip = Buffer.concat([d.update(Buffer.concat([a, b])), d.final()]).toString();
}

// --- chacha20-poly1305 ------------------------------------------------------
// RFC 8439 §2.8.2 reference vector.
{
  const key = fromHex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  const nonce = fromHex('070000004041424344454647');
  const aad = fromHex('50515253c0c1c2c3c4c5c6c7');
  const plaintext = Buffer.from('Ladies and Gentlemen of the class of \'99: If I could offer you only one tip for the future, sunscreen would be it.');
  const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  obs.rfc8439_2_8_2_ciphertext = hex(ct);
  obs.rfc8439_2_8_2_tag = hex(c.getAuthTag());
}

// Round-trip with AAD and truncated tags, split updates, and decode errors.
{
  const key = Buffer.alloc(32, 1);
  const nonce = Buffer.alloc(12, 2);
  const enc = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  enc.setAAD(Buffer.from('header'));
  const ct = Buffer.concat([enc.update('secret '), enc.update('data'), enc.final()]);
  const tag = enc.getAuthTag();
  obs.polyCiphertext = hex(ct);
  obs.polyTagLen = tag.length;

  const dec = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  dec.setAAD(Buffer.from('header'));
  dec.setAuthTag(tag);
  obs.polyRoundtrip = Buffer.concat([dec.update(ct), dec.final()]).toString();

  // Truncated tag: 12 bytes are accepted and produced.
  const enc12 = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 12 });
  Buffer.concat([enc12.update('abc'), enc12.final()]);
  obs.polyTagLen12 = enc12.getAuthTag().length;
  obs.polyTag12 = hex(enc12.getAuthTag());

  // A wrong tag fails authentication.
  const bad = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  bad.setAuthTag(Buffer.alloc(16, 9));
  obs.polyBadTag = err(() => Buffer.concat([bad.update(ct), bad.final()]));

  // Without calling setAuthTag, Node still verifies against an all-zero tag and
  // fails authentication.
  const clear = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  obs.polyNoVerify = err(() => Buffer.concat([clear.update(ct), clear.final()]));
}

// --- argument validation ----------------------------------------------------
{
  const key = Buffer.alloc(32, 1);
  const iv12 = Buffer.alloc(12, 2);
  const iv16 = Buffer.alloc(16, 2);
  obs.errBadKey = err(() => crypto.createCipheriv('chacha20', Buffer.alloc(16), iv16));
  obs.errBadIv20 = err(() => crypto.createCipheriv('chacha20', key, Buffer.alloc(12)));
  obs.errEmptyIv = err(() => crypto.createCipheriv('chacha20-poly1305', key, Buffer.alloc(0)));
  obs.errIv13 = err(() => crypto.createCipheriv('chacha20-poly1305', key, Buffer.alloc(13)));
  obs.errTag0 = err(() => crypto.createCipheriv('chacha20-poly1305', key, iv12, { authTagLength: 0 }));
  obs.errTag17 = err(() => crypto.createCipheriv('chacha20-poly1305', key, iv12, { authTagLength: 17 }));
  obs.errSetTag8 = err(() => {
    const d = crypto.createDecipheriv('chacha20-poly1305', key, iv12);
    d.setAuthTag(Buffer.alloc(8));
  });
  obs.errGetTagRaw = err(() => crypto.createCipheriv('chacha20', key, iv16).getAuthTag());
  obs.errSetAadRaw = err(() => crypto.createCipheriv('chacha20', key, iv16).setAAD(Buffer.alloc(4)));
  obs.errSetAadAfterData = err(() => {
    const c = crypto.createCipheriv('chacha20-poly1305', key, iv12);
    c.setAAD(Buffer.from('a'));
    c.update('b');
    c.setAAD(Buffer.from('c'));
  });
  obs.okSetAutoPadding = err(() => {
    crypto.createCipheriv('chacha20-poly1305', key, iv12).setAutoPadding(true);
    return 'ok';
  });
}

console.log('__OBS__' + JSON.stringify(obs));
