// M93.2 differential probe: the DES / 3DES family.
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. Everything uses fixed keys/IVs, so it is fully
// deterministic.
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
const names = ['des-ede', 'des-ede-cbc', 'des-ede-cfb', 'des-ede-ecb', 'des-ede-ofb',
  'des-ede3', 'des-ede3-cbc', 'des-ede3-cfb', 'des-ede3-ecb', 'des-ede3-ofb', 'des3'];
obs.info = {};
for (const n of names) obs.info[n] = crypto.getCipherInfo(n);

// --- deterministic vectors --------------------------------------------------
// NIST SP 800-67 / FIPS 46-3 style keys with all-zero data.
const K16 = fromHex('0123456789abcdeffedcba9876543210');
const K24 = fromHex('0123456789abcdeffedcba98765432100123456789abcdef');
const IV8 = fromHex('0000000000000000');
const PT = Buffer.from('The quick brown fox jumps over the lazy dog!!'); // 45 bytes

const vectors = [
  ['des-ede-ecb', K16, null],
  ['des-ede-cbc', K16, IV8],
  ['des-ede-cfb', K16, IV8],
  ['des-ede-ofb', K16, IV8],
  ['des-ede3-ecb', K24, null],
  ['des-ede3-cbc', K24, IV8],
  ['des-ede3-cfb', K24, IV8],
  ['des-ede3-ofb', K24, IV8],
  ['des3', K24, IV8],
  ['des-ede', K16, null],
  ['des-ede3', K24, null],
];
for (const [name, key, iv] of vectors) {
  const c = crypto.createCipheriv(name, key, iv);
  const ct = Buffer.concat([c.update(PT), c.final()]);
  obs['ct_' + name] = hex(ct);
  const d = crypto.createDecipheriv(name, key, iv);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  obs['rt_' + name] = pt.toString() === PT.toString();
}

// --- streaming across updates ----------------------------------------------
{
  const c = crypto.createCipheriv('des-ede3-cbc', K24, IV8);
  const a = c.update('hello ');
  const b = c.update('world');
  const f = c.final();
  obs.streamCbc = hex(Buffer.concat([a, b, f]));
}

// --- padding ----------------------------------------------------------------
{
  // 8-byte aligned input still gets a full block of padding by default.
  const c = crypto.createCipheriv('des-ede-cbc', K16, IV8);
  const ct = Buffer.concat([c.update(Buffer.alloc(16)), c.final()]);
  obs.padBlockLen = ct.length;
  const c2 = crypto.createCipheriv('des-ede-cbc', K16, IV8);
  c2.setAutoPadding(false);
  const ct2 = Buffer.concat([c2.update(Buffer.alloc(16)), c2.final()]);
  obs.noPadBlockLen = ct2.length;
}

// --- CBC error path ---------------------------------------------------------
{
  // OpenSSL allows the 2-key 16-byte form; a 24-byte key is rejected.
  obs.errKeyShort = err(() => crypto.createCipheriv('des-ede3-cbc', K16, IV8));
  obs.errKeyLong = err(() => crypto.createCipheriv('des-ede-cbc', K24, IV8));
  obs.errIv = err(() => crypto.createCipheriv('des-ede-cbc', K16, fromHex('0000000000')));
  obs.errEcbIv = err(() => crypto.createCipheriv('des-ede-ecb', K16, IV8));
  obs.errBadPadding = (() => {
    const c = crypto.createCipheriv('des-ede-cbc', K16, IV8);
    const ct = Buffer.concat([c.update(PT), c.final()]);
    ct[ct.length - 1] ^= 0xff;
    const d = crypto.createDecipheriv('des-ede-cbc', K16, IV8);
    d.update(ct);
    return err(() => d.final());
  })();
}

console.log('__OBS__' + JSON.stringify(obs));
