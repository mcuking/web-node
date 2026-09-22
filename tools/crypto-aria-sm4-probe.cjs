// M93.4b differential probe: ARIA (RFC 5794) and SM4 (GB/T 32907).
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. Fixed keys/IVs make every value deterministic.
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
  aria128: fromHex('000102030405060708090a0b0c0d0e0f'),
  aria192: fromHex('000102030405060708090a0b0c0d0e0f1011121314151617'),
  aria256: fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
  sm4: fromHex('0123456789abcdeffedcba9876543210'),
};
const IV = fromHex('00112233445566778899aabbccddeeff');
const PT = fromHex('1111111111111111111111111111111122222222222222222222222222222222');

// --- info -------------------------------------------------------------------
obs.info = {};
for (const bits of [128, 192, 256]) {
  for (const mode of ['ecb', 'cbc', 'cfb', 'ofb', 'ctr']) {
    obs.info[`aria-${bits}-${mode}`] = crypto.getCipherInfo(`aria-${bits}-${mode}`);
  }
  obs.info[`aria${bits}`] = crypto.getCipherInfo(`aria${bits}`);
}
for (const mode of ['ecb', 'cbc', 'cfb', 'ofb', 'ctr']) obs.info[`sm4-${mode}`] = crypto.getCipherInfo(`sm4-${mode}`);
obs.info.sm4 = crypto.getCipherInfo('sm4');

// --- block modes ------------------------------------------------------------
obs.modes = {};
for (const [name, key] of [
  ['aria-128', KEYS.aria128],
  ['aria-192', KEYS.aria192],
  ['aria-256', KEYS.aria256],
  ['sm4', KEYS.sm4],
]) {
  for (const mode of ['ecb', 'cbc', 'cfb', 'ofb', 'ctr']) {
    const full = `${name}-${mode}`;
    const iv = mode === 'ecb' ? null : IV;
    const enc = crypto.createCipheriv(full, key, iv);
    const ct = Buffer.concat([enc.update(PT), enc.final()]);
    const dec = crypto.createDecipheriv(full, key, iv);
    const back = Buffer.concat([dec.update(ct), dec.final()]);
    obs.modes[full] = hex(ct) + '|' + hex(back);
  }
}

// --- streaming / padding ----------------------------------------------------
{
  const enc = crypto.createCipheriv('aria-128-cbc', KEYS.aria128, IV);
  const chunked = Buffer.concat([enc.update(PT.subarray(0, 7)), enc.update(PT.subarray(7)), enc.final()]);
  const oneShot = (() => {
    const e = crypto.createCipheriv('aria-128-cbc', KEYS.aria128, IV);
    return Buffer.concat([e.update(PT), e.final()]);
  })();
  obs.streaming = hex(chunked) + '|' + String(hex(chunked) === hex(oneShot));
  const e2 = crypto.createCipheriv('sm4-cbc', KEYS.sm4, IV);
  e2.setAutoPadding(false);
  obs.noPad = hex(Buffer.concat([e2.update(PT), e2.final()]));
}

// --- CMAC -------------------------------------------------------------------
obs.cmac = {
  aria128: hex(crypto.createMac('cmac', KEYS.aria128, { cipher: 'aria-128-cbc' }).update('data').final()),
  aria192: hex(crypto.createMac('cmac', KEYS.aria192, { cipher: 'aria-192-cbc' }).update('data').final()),
  aria256: hex(crypto.createMac('cmac', KEYS.aria256, { cipher: 'aria-256-cbc' }).update('data').final()),
  sm4: hex(crypto.createMac('cmac', KEYS.sm4, { cipher: 'sm4-cbc' }).update('data').final()),
  block: hex(crypto.createMac('cmac', KEYS.sm4, { cipher: 'sm4-cbc' }).update(Buffer.alloc(16, 9)).final()),
  empty: hex(crypto.createMac('cmac', KEYS.sm4, { cipher: 'sm4-cbc' }).final()),
};

// --- errors -----------------------------------------------------------------
obs.err = {
  ariaBadKeyLen: err(() => crypto.createCipheriv('aria-128-cbc', Buffer.alloc(15, 1), IV)),
  ariaBadIvLen: err(() => crypto.createCipheriv('aria-128-cbc', KEYS.aria128, Buffer.alloc(8, 1))),
  ariaEcbWithIv: err(() => crypto.createCipheriv('aria-128-ecb', KEYS.aria128, IV)),
  ariaWrongKeyLen: err(() => crypto.createCipheriv('aria-256-cbc', KEYS.aria128, IV)),
  ariaUnknown: err(() => crypto.createCipheriv('aria-999-cbc', KEYS.aria128, IV)),
  sm4BadKeyLen: err(() => crypto.createCipheriv('sm4-cbc', Buffer.alloc(24, 1), IV)),
  sm4Unknown: err(() => crypto.createCipheriv('sm4-999-cbc', KEYS.sm4, IV)),
  cmacAriaWrongKeyLen: err(() => crypto.createMac('cmac', Buffer.alloc(8, 1), { cipher: 'aria-128-cbc' })),
  cmacSm4Ecb: err(() => crypto.createMac('cmac', KEYS.sm4, { cipher: 'sm4-ecb' })),
};

console.log('__OBS__' + JSON.stringify(obs));
