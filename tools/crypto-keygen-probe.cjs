// Differential observation program for symmetric key generation
// (`crypto.generateKey` / `crypto.generateKeySync`) and the FIPS flag.
// Keys are random, so this observes shape (type/size/length/jwk) plus errors.
const crypto = require('crypto');

const out = {};
const err = (fn) => {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    return { ctor: e.constructor.name, code: e.code, message: e.message };
  }
};

for (const [type, length] of [
  ['hmac', 256], ['hmac', 100], ['hmac', 257], ['hmac', 1000],
  ['aes', 128], ['aes', 192], ['aes', 256],
]) {
  const key = crypto.generateKeySync(type, { length });
  out[`sync_${type}_${length}`] = {
    type: key.type,
    size: key.symmetricKeySize,
    len: key.export().length,
    jwkKty: key.export({ format: 'jwk' }).kty,
    isBuffer: Buffer.isBuffer(key.export()),
    asym: key.asymmetricKeyType,
  };
}

out.roundtrip = (() => {
  const key = crypto.generateKeySync('hmac', { length: 256 });
  return key.equals(crypto.createSecretKey(key.export()));
})();

out.errors = {
  typeNumber: err(() => crypto.generateKeySync(5, { length: 256 })),
  optionsNull: err(() => crypto.generateKeySync('hmac', null)),
  optionsMissing: err(() => crypto.generateKeySync('hmac')),
  lenMissing: err(() => crypto.generateKeySync('hmac', {})),
  lenStringHmac: err(() => crypto.generateKeySync('hmac', { length: '256' })),
  lenTooSmall: err(() => crypto.generateKeySync('hmac', { length: 1 })),
  lenAesString: err(() => crypto.generateKeySync('aes', { length: '128' })),
  lenAesBad: err(() => crypto.generateKeySync('aes', { length: 129 })),
  badTypeRsa: err(() => crypto.generateKeySync('rsa', { length: 256 })),
  badTypeDes: err(() => crypto.generateKeySync('des', { length: 64 })),
  asyncNoCb: err(() => crypto.generateKey('hmac', { length: 256 })),
  asyncBadType: err(() => crypto.generateKey(null, { length: 256 }, () => {})),
};

out.arities = {
  generateKey: crypto.generateKey.length,
  generateKeySync: crypto.generateKeySync.length,
  getFips: crypto.getFips.length,
  setFips: crypto.setFips.length,
};

crypto.generateKey('hmac', { length: 256 }, (error, key) => {
  out.asyncOk = error ? { error: String(error) } : { type: key.type, size: key.symmetricKeySize };
  // FIPS last: toggling it changes OpenSSL behaviour, so nothing else runs after.
  out.getFips = crypto.getFips();
  out.setFipsReturn = String(crypto.setFips(true));
  crypto.setFips(false);
  console.log('__OBS__' + JSON.stringify(out));
});
