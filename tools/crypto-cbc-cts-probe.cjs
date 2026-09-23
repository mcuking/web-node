// M93.4g differential probe: CBC with ciphertext stealing (NIST CTS).
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
const CIV = fromHex('101112131415161718191a1b1c1d1e1f'); // camellia shares length

obs.info = {};
for (const n of [
  'aes-128-cbc-cts',
  'aes-192-cbc-cts',
  'aes-256-cbc-cts',
  'camellia-128-cbc-cts',
  'camellia-192-cbc-cts',
  'camellia-256-cbc-cts',
]) {
  obs.info[n] = crypto.getCipherInfo(n);
}

const data = (len) => {
  const b = Buffer.alloc(len);
  for (let i = 0; i < len; i++) b[i] = (i * 37 + 11) & 0xff;
  return b;
};

function round(name, key, iv, buf) {
  const e = crypto.createCipheriv(name, key, iv);
  const ct = Buffer.concat([e.update(buf), e.final()]);
  const d = crypto.createDecipheriv(name, key, iv);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  return `${hex(ct)}|${pt.equals(buf) ? 'OK' : hex(pt)}`;
}

obs.cases = {};
for (const len of [16, 17, 18, 20, 31, 32, 33, 47, 48, 49, 64, 1000]) {
  obs.cases[`aes128_${len}`] = round('aes-128-cbc-cts', KEYS[128], IV, data(len));
}
obs.cases.camellia256_17 = round('camellia-256-cbc-cts', KEYS[256], CIV, data(17));
obs.cases.camellia192_33 = round('camellia-192-cbc-cts', KEYS[192], CIV, data(33));

// CTS is one-shot in OpenSSL: a single update emits everything, a second update
// fails, and update/final short inputs raise the unsupported-state error.
function oneshot(name, key, iv, buf) {
  const e = crypto.createCipheriv(name, key, iv);
  const u = e.update(buf);
  const f = e.final();
  return `u=${u.length} f=${f.length} ct=${hex(u)}`;
}
obs.oneshot = {
  aes128_16: oneshot('aes-128-cbc-cts', KEYS[128], IV, data(16)),
  aes128_33: oneshot('aes-128-cbc-cts', KEYS[128], IV, data(33)),
  camellia128_17: oneshot('camellia-128-cbc-cts', KEYS[128], CIV, data(17)),
  aes256_48: oneshot('aes-256-cbc-cts', KEYS[256], IV, data(48)),
  autoPadOff: (() => {
    const e = crypto.createCipheriv('aes-128-cbc-cts', KEYS[128], IV);
    e.setAutoPadding(false);
    const u = e.update(data(17));
    const f = e.final();
    return `u=${u.length} f=${f.length} ct=${hex(u)}`;
  })(),
};

obs.errors = {
  short15: err(() => {
    const e = crypto.createCipheriv('aes-128-cbc-cts', KEYS[128], IV);
    return e.update(data(15));
  }),
  empty: err(() => crypto.createCipheriv('aes-128-cbc-cts', KEYS[128], IV).update(Buffer.alloc(0))),
  secondUpdate: err(() => {
    const e = crypto.createCipheriv('aes-128-cbc-cts', KEYS[128], IV);
    e.update(data(16));
    return e.update(data(16));
  }),
  finalOnly: err(() => crypto.createCipheriv('aes-128-cbc-cts', KEYS[128], IV).final()),
  secondFinal: err(() => {
    const e = crypto.createCipheriv('aes-128-cbc-cts', KEYS[128], IV);
    e.update(data(16));
    e.final();
    return e.final();
  }),
  badIv: err(() => crypto.createCipheriv('aes-128-cbc-cts', KEYS[128], Buffer.alloc(8))),
  getTag: err(() => {
    const e = crypto.createCipheriv('aes-128-cbc-cts', KEYS[128], IV);
    e.update(data(16));
    e.final();
    return e.getAuthTag();
  }),
};

console.log('__OBS__' + JSON.stringify(obs));
