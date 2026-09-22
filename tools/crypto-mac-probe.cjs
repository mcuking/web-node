// Differential observation program for `crypto.createMac` / `crypto.getMacs`
// (M90.1: the front-end plus HMAC and BLAKE2b MAC). Run by
// tools/crypto-mac-oracle.mjs on a real Node, and by test/crypto-mac.test.ts
// inside web-node; the two JSON documents must match.
const crypto = require('crypto');

const out = {};
const err = (fn) => {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    return { name: e.name, code: e.code, message: e.message };
  }
};
const hex = (b) => Buffer.from(b).toString('hex');

out.macs = crypto.getMacs();
out.arities = { createMac: crypto.createMac.length, getMacs: crypto.getMacs.length };

// -- HMAC ------------------------------------------------------------------
out.hmac = {};
for (const digest of ['sha1', 'sha256', 'sha384', 'sha512', 'md5']) {
  out.hmac[digest] = hex(crypto.createMac('hmac', Buffer.from('key'), { digest }).update('data').final());
}
out.hmacUpperCase = hex(crypto.createMac('HMAC', Buffer.from('key'), { digest: 'SHA256' }).update('data').final());
out.hmacEmptyKey = hex(crypto.createMac('hmac', Buffer.alloc(0), { digest: 'sha256' }).update('data').final());
out.hmacMulti = hex(
  crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('a').update('b').update('c').final(),
);
out.hmacBinaryData = hex(
  crypto.createMac('hmac', Buffer.from([0, 1, 2, 255]), { digest: 'sha512' })
    .update(Buffer.from([9, 8, 7, 6]))
    .final(),
);

// -- BLAKE2b MAC -----------------------------------------------------------
out.blake2b = {};
out.blake2b['default'] = hex(crypto.createMac('blake2bmac', Buffer.alloc(64, 1)).update('data').final());
out.blake2b['out16'] = hex(crypto.createMac('blake2bmac', Buffer.alloc(64, 1), { outputLength: 16 }).update('data').final());
out.blake2b['out4'] = hex(crypto.createMac('blake2bmac', Buffer.alloc(32, 1), { outputLength: 4 }).update('data').final());
out.blake2b['key1'] = hex(crypto.createMac('blake2bmac', Buffer.from([7])).update('data').final());
out.blake2b['key64'] = hex(crypto.createMac('blake2bmac', Buffer.alloc(64, 0xab)).update('message').final());
out.blake2b['multi'] = hex(
  crypto.createMac('blake2bmac', Buffer.alloc(48, 3), { outputLength: 48 })
    .update('a')
    .update(Buffer.from('b'))
    .update('c', 'utf8')
    .final(),
);

// -- KMAC (SP 800-185) -----------------------------------------------------
out.kmac = {};
out.kmac['128-default'] = hex(crypto.createMac('kmac128', Buffer.alloc(32, 1)).update('data').final());
out.kmac['256-default'] = hex(crypto.createMac('kmac256', Buffer.alloc(32, 1)).update('data').final());
out.kmac['128-out16'] = hex(crypto.createMac('kmac128', Buffer.alloc(32, 1), { outputLength: 16 }).update('data').final());
out.kmac['128-out64'] = hex(crypto.createMac('kmac128', Buffer.alloc(32, 1), { outputLength: 64 }).update('data').final());
out.kmac['256-out32'] = hex(crypto.createMac('kmac256', Buffer.alloc(32, 1), { outputLength: 32 }).update('data').final());
out.kmac['128-custom'] = hex(
  crypto.createMac('kmac128', Buffer.alloc(32, 1), { customization: Buffer.from('cust') }).update('data').final(),
);
out.kmacKeyLengths = {};
for (const len of [1, 2, 3, 4, 8, 12, 15, 16, 17, 20, 31, 32, 33, 64]) {
  try {
    out.kmacKeyLengths[len] = hex(crypto.createMac('kmac128', Buffer.alloc(len, 9)).update('d').final());
  } catch (e) {
    out.kmacKeyLengths[len] = e.code;
  }
}
out.kmac['128-empty-msg'] = hex(crypto.createMac('kmac128', Buffer.alloc(32, 1)).final());
out.kmac['128-multi'] = hex(
  crypto.createMac('kmac128', Buffer.alloc(48, 3), { customization: Buffer.from([1, 2, 3]) })
    .update('a')
    .update(Buffer.from('b'))
    .update('c', 'utf8')
    .final(),
);
// NIST SP 800-185 sample vectors.
const kmacK = Buffer.from('404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f', 'hex');
const kmacX = Buffer.from('00010203', 'hex');
const kmacS = Buffer.from('My Tagged Application');
out.kmac['sample#1'] = hex(crypto.createMac('kmac128', kmacK, { customization: kmacS, outputLength: 32 }).update(kmacX).final());
out.kmac['sample#2'] = hex(
  crypto.createMac('kmac128', kmacK, { customization: kmacS, outputLength: 32 }).update(Buffer.concat([kmacX, kmacX])).final(),
);
out.kmac['sample#4'] = hex(crypto.createMac('kmac256', kmacK, { customization: kmacS, outputLength: 64 }).update(kmacX).final());
out.kmac['sample#5'] = hex(
  crypto.createMac('kmac256', kmacK, { customization: kmacS, outputLength: 64 }).update(Buffer.concat([kmacX, kmacX])).final(),
);
out.kmac['sample#6'] = hex(
  crypto.createMac('kmac256', kmacK, { outputLength: 64 }).update(Buffer.concat([kmacX, kmacX, kmacX])).final(),
);

// -- output / input encodings ----------------------------------------------
out.encodings = {};
out.encodings.finalHex = crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('d').final('hex');
out.encodings.finalBase64 = crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('d').final('base64');
out.encodings.finalBuffer = (() => {
  const r = crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('d').final('buffer');
  return { isBuffer: Buffer.isBuffer(r), hex: hex(r) };
})();
out.encodings.updateHex = crypto
  .createMac('hmac', Buffer.from('k'), { digest: 'sha256' })
  .update('64617461', 'hex')
  .final('hex');
out.encodings.updateLatin1 = hex(
  crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('\xe9', 'latin1').final(),
);

// -- KeyObject key ---------------------------------------------------------
out.secretKeyObject = hex(
  crypto.createMac('hmac', crypto.createSecretKey(Buffer.from('k')), { digest: 'sha256' }).update('d').final(),
);

// -- stream interface ------------------------------------------------------
const chunks = [];
const streamMac = crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' });
streamMac.on('data', (c) => chunks.push(c));
streamMac.on('end', () => {
  out.stream = {
    hex: Buffer.concat(chunks).toString('hex'),
    reference: hex(crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('chunk1chunk2').final()),
  };

  // -- error surface (must be captured only after the async stream settles) --
  out.errors = {
    algorithmNumber: err(() => crypto.createMac(1, Buffer.from('k'))),
    algorithmEmpty: err(() => crypto.createMac('', Buffer.from('k'))),
    algorithmNul: err(() => crypto.createMac('hm\0ac', Buffer.from('k'))),
    optionsNumber: err(() => crypto.createMac('hmac', Buffer.from('k'), 5)),
    keyNumber: err(() => crypto.createMac('foo', 5)),
    keyString: err(() => crypto.createMac('hmac', 'key', { digest: 'sha256' })),
    keyPublic: err(() => {
      const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 512 });
      return crypto.createMac('hmac', publicKey, { digest: 'sha256' });
    }),
    unknownMac: err(() => crypto.createMac('foo', Buffer.from('k'))),
    digestMissing: err(() => crypto.createMac('hmac', Buffer.from('k'))),
    digestNumber: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 5 })),
    digestEmpty: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: '' })),
    digestUnknown: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 'nope' }).update('d').final()),
    ivBad: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256', iv: 5 })),
    customizationBad: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256', customization: 'x' })),
    saltBad: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256', salt: 5 })),
    outputLengthBad: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256', outputLength: -1 })),
    blake2bDigestUnsupported: err(() => crypto.createMac('blake2bmac', Buffer.alloc(32, 1), { digest: 'sha256' })),
    blake2bKeyEmpty: err(() => crypto.createMac('blake2bmac', Buffer.alloc(0)).update('d').final()),
    blake2bKeyLong: err(() => crypto.createMac('blake2bmac', Buffer.alloc(65, 1)).update('d').final()),
    blake2bOut0: err(() => crypto.createMac('blake2bmac', Buffer.alloc(64, 1), { outputLength: 0 }).update('d').final()),
    blake2bOut65: err(() => crypto.createMac('blake2bmac', Buffer.alloc(64, 1), { outputLength: 65 }).update('d').final()),
    kmacKeyEmpty: err(() => crypto.createMac('kmac128', Buffer.alloc(0)).update('d').final()),
    kmacDigestOpt: err(() => crypto.createMac('kmac128', Buffer.alloc(32, 1), { digest: 'sha256' }).update('d').final()),
    kmacCustomBad: err(() => crypto.createMac('kmac128', Buffer.alloc(32, 1), { customization: 'x' })),
    kmacOutNegative: err(() => crypto.createMac('kmac128', Buffer.alloc(32, 1), { outputLength: -1 })),
    cmacNoCipher: err(() => crypto.createMac('cmac', Buffer.alloc(16, 1)).update('d').final()),
    gmacNoCipher: err(() => crypto.createMac('gmac', Buffer.alloc(16, 1)).update('d').final()),
    updateNumber: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update(5)),
    finalTwice: err(() => {
      const m = crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('d');
      m.final();
      return m.final();
    }),
    updateAfterFinal: err(() => {
      const m = crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('d');
      m.final();
      return m.update('e');
    }),
    badOutputEncoding: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('d').final('bogus')),
    badInputEncoding: err(() => crypto.createMac('hmac', Buffer.from('k'), { digest: 'sha256' }).update('d', 'bogus')),
  };

  console.log('__OBS__' + JSON.stringify(out));
});

streamMac.write('chunk1');
streamMac.end('chunk2');
