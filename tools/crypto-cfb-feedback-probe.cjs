// M93.4d differential probe: CFB with 1-/8-bit feedback plus the SM4 CFB/OFB
// 128-bit aliases.
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. Fixed keys/IVs make every value deterministic.
const crypto = require('crypto');

const hex = (b) => Buffer.from(b).toString('hex');
const fromHex = (h) => Buffer.from(h, 'hex');
const obs = {};

const KEY = {
  128: fromHex('000102030405060708090a0b0c0d0e0f'),
  192: fromHex('000102030405060708090a0b0c0d0e0f1011121314151617'),
  256: fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
  64: fromHex('000102030405060708090a0b0c0d0e0f'),
  24: fromHex('000102030405060708090a0b0c0d0e0f1011121314151617'),
};
const IV16 = fromHex('101112131415161718191a1b1c1d1e1f');
const IV8 = fromHex('1011121314151617');

// A fixed, varied plaintext: every byte value once, so bit-order differences show.
const PT = new Uint8Array(48);
for (let i = 0; i < PT.length; i++) PT[i] = (i * 37 + 11) & 0xff;

obs.info = {};
obs.names = {};
obs.cases = {};
const CASES = [
  ['aes-128-cfb1', KEY[128], IV16],
  ['aes-192-cfb1', KEY[192], IV16],
  ['aes-256-cfb1', KEY[256], IV16],
  ['aes-128-cfb8', KEY[128], IV16],
  ['aes-192-cfb8', KEY[192], IV16],
  ['aes-256-cfb8', KEY[256], IV16],
  ['aria-128-cfb1', KEY[128], IV16],
  ['aria-192-cfb1', KEY[192], IV16],
  ['aria-256-cfb1', KEY[256], IV16],
  ['aria-128-cfb8', KEY[128], IV16],
  ['aria-192-cfb8', KEY[192], IV16],
  ['aria-256-cfb8', KEY[256], IV16],
  ['camellia-128-cfb1', KEY[128], IV16],
  ['camellia-192-cfb1', KEY[192], IV16],
  ['camellia-256-cfb1', KEY[256], IV16],
  ['camellia-128-cfb8', KEY[128], IV16],
  ['camellia-192-cfb8', KEY[192], IV16],
  ['camellia-256-cfb8', KEY[256], IV16],
  ['des-ede3-cfb1', KEY[24], IV8],
  ['des-ede3-cfb8', KEY[24], IV8],
  ['sm4-cfb128', KEY[128], IV16],
  ['sm4-ofb128', KEY[128], IV16],
];

const CIPHERS = new Set(crypto.getCiphers());

for (const [name, key, iv] of CASES) {
  obs.info[name] = crypto.getCipherInfo(name);
  obs.names[name] = CIPHERS.has(name);
  const entry = {};
  // Several lengths, including empty and non-block-aligned ones.
  for (const len of [0, 1, 7, 8, 15, 16, 17, 33, 48]) {
    const pt = PT.subarray(0, len);
    const c = crypto.createCipheriv(name, key, iv);
    const ct = Buffer.concat([c.update(pt), c.final()]);
    const d = crypto.createDecipheriv(name, key, iv);
    const back = Buffer.concat([d.update(ct), d.final()]);
    entry[len] = { ct: hex(ct), back: hex(back) };
  }
  // Streaming split at an odd boundary must equal the one-shot result.
  {
    const c = crypto.createCipheriv(name, key, iv);
    const ct = Buffer.concat([c.update(PT.subarray(0, 5)), c.update(PT.subarray(5)), c.final()]);
    entry.stream = hex(ct);
  }
  obs.cases[name] = entry;
}

console.log('__OBS__' + JSON.stringify(obs));
