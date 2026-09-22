// M93.4a differential probe: Camellia (RFC 3713).
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
  128: fromHex('0123456789abcdeffedcba9876543210'),
  192: fromHex('0123456789abcdeffedcba98765432100123456789abcdef'),
  256: fromHex('0123456789abcdeffedcba98765432100123456789abcdeffedcba9876543210'),
};
const IV = fromHex('00112233445566778899aabbccddeeff');
const PT = fromHex('1111111111111111111111111111111122222222222222222222222222222222');
const AAD = fromHex('aabbccdd');

// --- info -------------------------------------------------------------------
obs.info = {};
for (const bits of [128, 192, 256]) {
  for (const mode of ['ecb', 'cbc', 'cfb', 'ofb', 'ctr']) {
    obs.info[`camellia-${bits}-${mode}`] = crypto.getCipherInfo(`camellia-${bits}-${mode}`);
  }
  obs.info[`camellia${bits}`] = crypto.getCipherInfo(`camellia${bits}`);
}

// --- block modes ------------------------------------------------------------
obs.modes = {};
for (const bits of [128, 192, 256]) {
  for (const mode of ['ecb', 'cbc', 'cfb', 'ofb', 'ctr']) {
    const name = `camellia-${bits}-${mode}`;
    const key = KEYS[bits];
    const iv = mode === 'ecb' ? null : IV;
    const enc = crypto.createCipheriv(name, key, iv);
    const ct = Buffer.concat([enc.update(PT), enc.final()]);
    const dec = crypto.createDecipheriv(name, key, iv);
    const back = Buffer.concat([dec.update(ct), dec.final()]);
    obs.modes[name] = hex(ct) + '|' + hex(back);
  }
}

// --- streaming / padding ----------------------------------------------------
{
  const enc = crypto.createCipheriv('camellia-128-cbc', KEYS[128], IV);
  const chunked = Buffer.concat([enc.update(PT.subarray(0, 5)), enc.update(PT.subarray(5)), enc.final()]);
  const oneShot = (() => {
    const e = crypto.createCipheriv('camellia-128-cbc', KEYS[128], IV);
    return Buffer.concat([e.update(PT), e.final()]);
  })();
  obs.streaming = hex(chunked) + '|' + String(hex(chunked) === hex(oneShot));
  // No padding, block-aligned.
  const e2 = crypto.createCipheriv('camellia-256-cbc', KEYS[256], IV);
  e2.setAutoPadding(false);
  obs.noPad = hex(Buffer.concat([e2.update(PT), e2.final()]));
}

// --- CMAC -------------------------------------------------------------------
obs.cmac = {
  128: hex(crypto.createMac('cmac', KEYS[128], { cipher: 'camellia-128-cbc' }).update('data').final()),
  192: hex(crypto.createMac('cmac', KEYS[192], { cipher: 'camellia-192-cbc' }).update('data').final()),
  256: hex(crypto.createMac('cmac', KEYS[256], { cipher: 'camellia-256-cbc' }).update('data').final()),
  block: hex(crypto.createMac('cmac', KEYS[128], { cipher: 'camellia-128-cbc' }).update(Buffer.alloc(16, 9)).final()),
  empty: hex(crypto.createMac('cmac', KEYS[128], { cipher: 'camellia-128-cbc' }).final()),
};

// --- errors -----------------------------------------------------------------
obs.err = {
  badKeyLen: err(() => crypto.createCipheriv('camellia-128-cbc', Buffer.alloc(15, 1), IV)),
  badIvLen: err(() => crypto.createCipheriv('camellia-128-cbc', KEYS[128], Buffer.alloc(8, 1))),
  ecbWithIv: err(() => crypto.createCipheriv('camellia-128-ecb', KEYS[128], IV)),
  ecbNoIv: err(() => crypto.createCipheriv('camellia-128-ecb', KEYS[128])).ok,
  unknown: err(() => crypto.createCipheriv('camellia-999-cbc', KEYS[128], IV)),
  wrongKeyLen: err(() => crypto.createCipheriv('camellia-256-cbc', KEYS[128], IV)),
  cmacWrongKeyLen: err(() => crypto.createMac('cmac', Buffer.alloc(8, 1), { cipher: 'camellia-128-cbc' })),
  cmacEcb: err(() => crypto.createMac('cmac', KEYS[128], { cipher: 'camellia-128-ecb' })),
};

console.log('__OBS__' + JSON.stringify(obs));
