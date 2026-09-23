// M93.4h differential probe: AES-GCM-SIV, ARIA CCM/GCM and SM4 CCM/GCM/XTS.
// Runs unchanged on real Node v26.9.0 and inside web-node.
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

const KEYS = {
  128: fromHex('000102030405060708090a0b0c0d0e0f'),
  192: fromHex('000102030405060708090a0b0c0d0e0f1011121314151617'),
  256: fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
};
const IV = fromHex('101112131415161718191a1b1c1d1e1f');
const NONCE = fromHex('101112131415161718191a1b');
const AAD = fromHex('aabbccddeeff');

const NAMES = [
  'aes-128-gcm-siv',
  'aes-192-gcm-siv',
  'aes-256-gcm-siv',
  'aria-128-ccm',
  'aria-192-ccm',
  'aria-256-ccm',
  'aria-128-gcm',
  'aria-192-gcm',
  'aria-256-gcm',
  'sm4-ccm',
  'sm4-gcm',
  'sm4-xts',
];

obs.info = {};
for (const n of NAMES) obs.info[n] = crypto.getCipherInfo(n);

const data = (len) => {
  const b = Buffer.alloc(len);
  for (let i = 0; i < len; i++) b[i] = (i * 37 + 11) & 0xff;
  return b;
};

// AEAD round-trip. `tagLen` is only passed for the CCM family (which requires
// it); the plaintext length is announced via setAAD for CCM.
function aead(name, key, nonce, len, tagLen) {
  const pt = data(len);
  const isCcm = tagLen !== undefined;
  const opts = isCcm ? { authTagLength: tagLen } : {};
  const aadOpts = isCcm ? { plaintextLength: len } : undefined;
  const e = crypto.createCipheriv(name, key, nonce, opts);
  e.setAAD(AAD, aadOpts);
  const ct = Buffer.concat([e.update(pt), e.final()]);
  const tag = e.getAuthTag();
  const d = crypto.createDecipheriv(name, key, nonce, opts);
  d.setAAD(AAD, aadOpts);
  d.setAuthTag(tag);
  const back = Buffer.concat([d.update(ct), d.final()]);
  return `${hex(ct)}|tag=${hex(tag)}|${back.equals(pt) ? 'OK' : hex(back)}`;
}

obs.aead = {
  siv128_20: aead('aes-128-gcm-siv', KEYS[128], NONCE, 20),
  siv128_0: aead('aes-128-gcm-siv', KEYS[128], NONCE, 0),
  siv128_16: aead('aes-128-gcm-siv', KEYS[128], NONCE, 16),
  siv128_31: aead('aes-128-gcm-siv', KEYS[128], NONCE, 31),
  siv192_20: aead('aes-192-gcm-siv', KEYS[192], NONCE, 20),
  siv256_20: aead('aes-256-gcm-siv', KEYS[256], NONCE, 20),
  siv256_48: aead('aes-256-gcm-siv', KEYS[256], NONCE, 48),
  ariccm128_20: aead('aria-128-ccm', KEYS[128], NONCE, 20, 16),
  ariccm192_20: aead('aria-192-ccm', KEYS[192], NONCE, 20, 16),
  ariccm256_20: aead('aria-256-ccm', KEYS[256], NONCE, 20, 16),
  ariccm256_0: aead('aria-256-ccm', KEYS[256], NONCE, 0, 16),
  arigcm128_20: aead('aria-128-gcm', KEYS[128], NONCE, 20),
  arigcm192_20: aead('aria-192-gcm', KEYS[192], NONCE, 20),
  arigcm256_20: aead('aria-256-gcm', KEYS[256], NONCE, 20),
  arigcm256_33: aead('aria-256-gcm', KEYS[256], NONCE, 33),
  sm4ccm_20: aead('sm4-ccm', KEYS[128], NONCE, 20, 16),
  sm4ccm_7: aead('sm4-ccm', KEYS[128], NONCE, 7, 16),
  sm4gcm_20: aead('sm4-gcm', KEYS[128], NONCE, 20),
  sm4gcm_0: aead('sm4-gcm', KEYS[128], NONCE, 0),
};

// SM4-XTS round-trip (32-byte key, 16-byte IV).
function xts(len) {
  const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const iv = fromHex('101112131415161718191a1b1c1d1e1f');
  const pt = data(len);
  const e = crypto.createCipheriv('sm4-xts', key, iv);
  const ct = Buffer.concat([e.update(pt), e.final()]);
  const d = crypto.createDecipheriv('sm4-xts', key, iv);
  const back = Buffer.concat([d.update(ct), d.final()]);
  return `${hex(ct)}|${back.equals(pt) ? 'OK' : hex(back)}`;
}
obs.xts = {
  sm4_16: xts(16),
  sm4_17: xts(17),
  sm4_32: xts(32),
  sm4_48: xts(48),
  sm4_64: xts(64),
};

// AES-GCM-SIV one-shot + error surface.
obs.sivSemantics = {
  twoUpdates: err(() => {
    const e = crypto.createCipheriv('aes-128-gcm-siv', KEYS[128], NONCE);
    e.update(data(16));
    return e.update(data(16));
  }),
  finalOnly: err(() => crypto.createCipheriv('aes-128-gcm-siv', KEYS[128], NONCE).final()),
  getTagBeforeFinal: err(() => {
    const e = crypto.createCipheriv('aes-128-gcm-siv', KEYS[128], NONCE);
    e.update(data(16));
    return e.getAuthTag();
  }),
  twoFinals: err(() => {
    const e = crypto.createCipheriv('aes-128-gcm-siv', KEYS[128], NONCE);
    e.update(data(16));
    e.final();
    return e.final();
  }),
  badIvLength: err(() => crypto.createCipheriv('aes-128-gcm-siv', KEYS[128], Buffer.alloc(8))),
  badTagLength: err(() => crypto.createCipheriv('aes-128-gcm-siv', KEYS[128], NONCE, { authTagLength: 12 })),
  setAuthTagLength: err(() => {
    const d = crypto.createDecipheriv('aes-128-gcm-siv', KEYS[128], NONCE);
    d.setAuthTag(Buffer.alloc(12));
    return 'ok';
  }),
  decryptNoTag: err(() => {
    const d = crypto.createDecipheriv('aes-128-gcm-siv', KEYS[128], NONCE);
    d.update(Buffer.alloc(3));
    return d.final();
  }),
  decryptBadTag: err(() => {
    const e = crypto.createCipheriv('aes-128-gcm-siv', KEYS[128], NONCE);
    const ct = Buffer.concat([e.update(data(20)), e.final()]);
    const tag = Buffer.from(e.getAuthTag());
    tag[0] ^= 1;
    const d = crypto.createDecipheriv('aes-128-gcm-siv', KEYS[128], NONCE);
    d.setAuthTag(tag);
    d.update(ct);
    return d.final();
  }),
};

// SM4-XTS / CCM error surface.
obs.errors = {
  xtsShort: err(() => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    return crypto.createCipheriv('sm4-xts', key, IV).update(data(15));
  }),
  xtsBadIv: err(() => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    return crypto.createCipheriv('sm4-xts', key, Buffer.alloc(8));
  }),
  xtsSameKeys: err(() => {
    const key = Buffer.concat([Buffer.alloc(16, 1), Buffer.alloc(16, 1)]);
    crypto.createCipheriv('sm4-xts', key, IV);
    return 'ok';
  }),
  ccmMissingPtLen: err(() => {
    const e = crypto.createCipheriv('aria-128-ccm', KEYS[128], NONCE, { authTagLength: 16 });
    return e.setAAD(AAD);
  }),
  ccmNoTagLen: err(() => crypto.createCipheriv('aria-128-ccm', KEYS[128], NONCE)),
  ccmTagBeforeFinal: err(() => {
    const e = crypto.createCipheriv('sm4-ccm', KEYS[128], NONCE, { authTagLength: 16 });
    e.setAAD(AAD, { plaintextLength: 20 });
    e.update(data(20));
    return e.getAuthTag();
  }),
};

console.log('__OBS__' + JSON.stringify(obs));
