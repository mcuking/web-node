// Differential observation program for crypto asymmetric keys/signatures.
// Generated with real Node v26.9.0 key material; the fixed signatures below were
// produced by real Node and are verified here. Runs unchanged on real Node and
// inside web-node; the two JSON blobs must match.
const crypto = require('crypto');

const KEYS = {
  rsaPriv: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCUhcfdLracU6wG\nLtjlHB+RvQoYavuoVpkgPPYuP+EtaeadjJEtaUr5SnG1OyixlBAgYN5yY1Edj693\nFXsYm85JAaNvu1YsA8qo4aXxoRrLim8irPwyFi5fN0ndHx3aT6x8yPuuAtWRUJ3b\nXWutDYBQ3M6kbsbSHxl2iqMbTu4zy8wlqRgWJ1e8vaHnzY6TqIewNFkm+T1gYHXc\neXS5ICo0awgEplI/irtzuP2A8j+oBdTQ/xLqx+tePVqAESZilHiKdNiJlwkrMVcS\nQNVv26v9bBaW7gAK6yuucwdeSGNf0hCjY28gsc1Aotr6YM8JwT9XNS/e2ytDweA4\ns7kqvk/pAgMBAAECggEAAQLtcQoUmBzjNCevy5xMDtnvsE19/L4vV36AHlpYZwe+\nO/JEa9UNtKBnPccE4xB6QqMTk2ZYlKcKClXt61AfNG2vLY2kEtbwU4NgUnR1KXNo\nzyzkyuP41dD+7wbe+KVg3eqR6xezA+iEuHbMp1ZngX5bdR8LcvbtpH3FQvm1Uy4h\ntUMxAcqEyyRbXWHV+mA8Sm9BohZGcg/2w0ganKbZMFA06mO0/uT9V3knmkbiG8b4\nI07tlhs+Xul+Lg1Bju+K1bOPcNAkSkSVDMbnQoFhd+klf4BxgEBN+Fmx2v62Dzpb\nuAsJgu41U9n6APgp8ALXf3Kbeh4Owsj8apUENYYX3QKBgQDLtO1GLedWk52IrYJL\noiNhiyxEod/d2+msSiCIZ9teLILU5RdfTTHgDlXNa0v04O5LalccGZYwalTkY52i\nFVkgC3m/tqqmE0NszsSE27Ui3ukZWLk3pi4XOwd12s5F6ZNlIz8rFdBOH8M1idSF\nwbCB5PuzJcDeTLXaB8Z+BMHdVQKBgQC6pkuXOBOxf2XBRC9c44kh32BHoMvCZZ8O\nMuddK2sIY5VXwy/EB1bz9F/xE2k83xtIK5XgZSsloeHP7us1SkIfG6Ifqw8P/VB4\nqRI1vFVUrMcbyCBa0f47SXgJoyVh7iRg7PZk+q2Y5/HglUYO1WBy96Mm79RgJK6B\n/EoxrUcIRQKBgBPxUolcVRmUugd3dRoSdYRHK75MWq5NqULEvwqboE5H7UcKZo9d\n71QQEzZZGsaOfsXDU2Pc3WdAAa+aUQRdMqyAcxrhtzMrD57HX1XibIlNaWSh2wAn\ntLtxe/l9wlP12gg8uyJssEf1tBa5t6SgobcVw852E7uvpt4BhN0xeglBAoGAJmB4\n3F/QVMeQAXvmjR/Pm2JVZoTeQFsqp/25aoO53yCynTfpw1GLBF/zthq6oaRx9JXZ\nnCjRBUzSpDFItU1OaR0CaaZ/U1dPS2/f6aKOnPllewXb+TCCKGiDwN+FmSwg2LkA\nNGUCepT+O6IVpIkk6p6WMjRPo3EHXHymOK6bE00CgYEApYAqgsRtn3h9bQUzbX7C\nZQb9iDjuktXkg1GGjlegrwX6IR5388zE4FIiIr24DtTRRrjNkOWkA6yQ+E46GwjV\nXY6E+COsRpp8nscLsI6a/ha2shAeQ9rS3gcwPDMi3zD0MJCB7uq72hTRIRe4Rmst\n42b4unn2otK/zaXd6XUtHw4=\n-----END PRIVATE KEY-----\n",
  rsaPub: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlIXH3S62nFOsBi7Y5Rwf\nkb0KGGr7qFaZIDz2Lj/hLWnmnYyRLWlK+UpxtTsosZQQIGDecmNRHY+vdxV7GJvO\nSQGjb7tWLAPKqOGl8aEay4pvIqz8MhYuXzdJ3R8d2k+sfMj7rgLVkVCd211rrQ2A\nUNzOpG7G0h8ZdoqjG07uM8vMJakYFidXvL2h582Ok6iHsDRZJvk9YGB13Hl0uSAq\nNGsIBKZSP4q7c7j9gPI/qAXU0P8S6sfrXj1agBEmYpR4inTYiZcJKzFXEkDVb9ur\n/WwWlu4ACusrrnMHXkhjX9IQo2NvILHNQKLa+mDPCcE/VzUv3tsrQ8HgOLO5Kr5P\n6QIDAQAB\n-----END PUBLIC KEY-----\n",
  rsaPrivPkcs1: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAlIXH3S62nFOsBi7Y5Rwfkb0KGGr7qFaZIDz2Lj/hLWnmnYyR\nLWlK+UpxtTsosZQQIGDecmNRHY+vdxV7GJvOSQGjb7tWLAPKqOGl8aEay4pvIqz8\nMhYuXzdJ3R8d2k+sfMj7rgLVkVCd211rrQ2AUNzOpG7G0h8ZdoqjG07uM8vMJakY\nFidXvL2h582Ok6iHsDRZJvk9YGB13Hl0uSAqNGsIBKZSP4q7c7j9gPI/qAXU0P8S\n6sfrXj1agBEmYpR4inTYiZcJKzFXEkDVb9ur/WwWlu4ACusrrnMHXkhjX9IQo2Nv\nILHNQKLa+mDPCcE/VzUv3tsrQ8HgOLO5Kr5P6QIDAQABAoIBAAEC7XEKFJgc4zQn\nr8ucTA7Z77BNffy+L1d+gB5aWGcHvjvyRGvVDbSgZz3HBOMQekKjE5NmWJSnCgpV\n7etQHzRtry2NpBLW8FODYFJ0dSlzaM8s5Mrj+NXQ/u8G3vilYN3qkesXswPohLh2\nzKdWZ4F+W3UfC3L27aR9xUL5tVMuIbVDMQHKhMskW11h1fpgPEpvQaIWRnIP9sNI\nGpym2TBQNOpjtP7k/Vd5J5pG4hvG+CNO7ZYbPl7pfi4NQY7vitWzj3DQJEpElQzG\n50KBYXfpJX+AcYBATfhZsdr+tg86W7gLCYLuNVPZ+gD4KfAC139ym3oeDsLI/GqV\nBDWGF90CgYEAy7TtRi3nVpOdiK2CS6IjYYssRKHf3dvprEogiGfbXiyC1OUXX00x\n4A5VzWtL9ODuS2pXHBmWMGpU5GOdohVZIAt5v7aqphNDbM7EhNu1It7pGVi5N6Yu\nFzsHddrORemTZSM/KxXQTh/DNYnUhcGwgeT7syXA3ky12gfGfgTB3VUCgYEAuqZL\nlzgTsX9lwUQvXOOJId9gR6DLwmWfDjLnXStrCGOVV8MvxAdW8/Rf8RNpPN8bSCuV\n4GUrJaHhz+7rNUpCHxuiH6sPD/1QeKkSNbxVVKzHG8ggWtH+O0l4CaMlYe4kYOz2\nZPqtmOfx4JVGDtVgcvejJu/UYCSugfxKMa1HCEUCgYAT8VKJXFUZlLoHd3UaEnWE\nRyu+TFquTalCxL8Km6BOR+1HCmaPXe9UEBM2WRrGjn7Fw1Nj3N1nQAGvmlEEXTKs\ngHMa4bczKw+ex19V4myJTWlkodsAJ7S7cXv5fcJT9doIPLsibLBH9bQWubekoKG3\nFcPOdhO7r6beAYTdMXoJQQKBgCZgeNxf0FTHkAF75o0fz5tiVWaE3kBbKqf9uWqD\nud8gsp036cNRiwRf87YauqGkcfSV2Zwo0QVM0qQxSLVNTmkdAmmmf1NXT0tv3+mi\njpz5ZXsF2/kwgihog8DfhZksINi5ADRlAnqU/juiFaSJJOqeljI0T6NxB1x8pjiu\nmxNNAoGBAKWAKoLEbZ94fW0FM21+wmUG/Yg47pLV5INRho5XoK8F+iEed/PMxOBS\nIiK9uA7U0Ua4zZDlpAOskPhOOhsI1V2OhPgjrEaafJ7HC7COmv4WtrIQHkPa0t4H\nMDwzIt8w9DCQge7qu9oU0SEXuEZrLeNm+Lp59qLSv82l3el1LR8O\n-----END RSA PRIVATE KEY-----\n",
  rsaPubPkcs1: "-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEAlIXH3S62nFOsBi7Y5Rwfkb0KGGr7qFaZIDz2Lj/hLWnmnYyRLWlK\n+UpxtTsosZQQIGDecmNRHY+vdxV7GJvOSQGjb7tWLAPKqOGl8aEay4pvIqz8MhYu\nXzdJ3R8d2k+sfMj7rgLVkVCd211rrQ2AUNzOpG7G0h8ZdoqjG07uM8vMJakYFidX\nvL2h582Ok6iHsDRZJvk9YGB13Hl0uSAqNGsIBKZSP4q7c7j9gPI/qAXU0P8S6sfr\nXj1agBEmYpR4inTYiZcJKzFXEkDVb9ur/WwWlu4ACusrrnMHXkhjX9IQo2NvILHN\nQKLa+mDPCcE/VzUv3tsrQ8HgOLO5Kr5P6QIDAQAB\n-----END RSA PUBLIC KEY-----\n",
  ecPriv: "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSxIl6QmVVzHeaL89\nKwBCGm5TAjPgAzhVrba6mh9VVWOhRANCAAQocE7RAmeqSGQy2PG+PahDc+b648Dv\nrjJDJS8nz6TJs4RgX+DzGZeLO4bN/BxwCM+sR+ngM/3wu3AKwX+UJxHo\n-----END PRIVATE KEY-----\n",
  ecPub: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEKHBO0QJnqkhkMtjxvj2oQ3Pm+uPA\n764yQyUvJ8+kybOEYF/g8xmXizuGzfwccAjPrEfp4DP98LtwCsF/lCcR6A==\n-----END PUBLIC KEY-----\n",
  ecPrivSec1: "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIEsSJekJlVcx3mi/PSsAQhpuUwIz4AM4Va22upofVVVjoAoGCCqGSM49\nAwEHoUQDQgAEKHBO0QJnqkhkMtjxvj2oQ3Pm+uPA764yQyUvJ8+kybOEYF/g8xmX\nizuGzfwccAjPrEfp4DP98LtwCsF/lCcR6A==\n-----END EC PRIVATE KEY-----\n",
  edPriv: "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIN6brJTqE7aCT4hEvSMvAgOVuGLMzrX+eShCgFOAqP2i\n-----END PRIVATE KEY-----\n",
  edPub: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAMYPwKUMTaj9cz61BFmbOuSVlpxiI/PidxKdtktIj5vY=\n-----END PUBLIC KEY-----\n",
};

const SIGS = {
  msg: "7765622d6e6f64652063727970746f20636f72707573",
  rsaSig: "6fbd048407c921bd6abb3d3bf70789f0fcbc64675493ef5e9ea4ce6d72d513c1e6368861878dc6e8712d40eb91a8265ce83c8b2c7358b43ba7480fbc56716b98a29f1f5bcfabed26aa86c81fbf02b678ee6aa254f5d1f2459c9a22b58dce5a86ed6bdda31a357df9a031b478fed3ebee0384a425efda9fbe947d4a55854888144403bdcbc3a708cb98cc16614c861ea731664ad96c09e07f38e59021b70c4f08c980dcfb3773ffa8249e0372ea1e077cd4857ed428fc7633f77272178da3c73d26982e1e68ab7685f9e43fe1529d956725ea755c9043276159ad01606ae73531e3dd28382872470008ae5bdf57a6e77e21b9b9d7bb4a755c060fa8591ec088d0",
  rsaPssSig: "28fc87319505c9f9cbf6570597c4df06854b1de8403d90eee38f4ad7a36982e69079bcdc4a4210b4b24c7c8c40ad75a89405e448b95b4f32588960fb620c6d36a0d6c2dececfc894399da4859114f203d841f9608d78f020dfdf56f0e866d88509d6b55ce78ea915e1152facdbe16620c7553df8a10f7f0878cab958db753382275f0e15ec9db44660928fdedc6f9de05eae2ded342fb6056570492ecfdf8cd0fa1457d6adce52501391d4d775680f5a41358266cb1b079b2ccf1108b6a86cfb3651a264cfe13b79e2aeca0d74508a954814e62e69e8f0f31b2992a6ee3b8c3f7193237c86a5fd85f51b4032483e39316182c2e16b6bbfe0b1a0fa34c1d7c010",
  pssMaxSig: "8988c6313e29cfb7c5c9b75cd14e3c454e94c6912d6d17928da1eb19562d4fcd28c05a8b5117a139828b0ee1f9fa6a32d29c5c267bcfdac33f33c73df3edbd20d88dcb8371391586e80f683c107383d1aedf2ee495e8c1f2362847b0a9fcb10bc151113b98a8b7f4ff763a6c9de8632a756a213b7f4929b37eb28c7867bb2574486e1c50c468577822d51e5bc483ce3839137e4f7e546929308b813d1229277a7453e56fb5ba706909a0ffa034fc2a0c04949cf3e3092c9d16f246ed66585f9561b239816e57b3b8486dfc5cdc6f3e70c075bc0cffff8b7de17bbc2e329b477178ff19ba0d6d92399243fbace2d60c71fcb8dcd84f02278bf4143740ec239480",
  ecSig: "3045022100c8802a81fbac3def48187b74adc7a06721868405b3900048ab215f54c5d2e6b402207f54033cd5a2d45d573b5d7718ce2206d897edbceca5f398f72cf0d6cfed9230",
  ecSigP1363: "d07e4b95a2111a22977be380a785653b15300fe6b8903729f07806bf95cd7ba7e8f36877ca031d93b36366f1e856156c14d2fd9ba46d74f3e59e76954ffecc3e",
  edSig: "33772386d4d9450c6612ab15666f62bc2967b3b1f5f72e3bc9c6c1bb49533a2a31452f51b8122a63b28003fc8350082525018b3a1c7b562864bd6f8c21fa0c03",
};

const out = {};
const hex = (b) => Buffer.from(b).toString('hex');
const msg = Buffer.from(SIGS.msg, 'hex');

// --- key objects ------------------------------------------------------------
const rsaPriv = crypto.createPrivateKey(KEYS.rsaPriv);
out.rsaPrivType = rsaPriv.type;
out.rsaPrivAsym = rsaPriv.asymmetricKeyType;
out.rsaModulusLength = rsaPriv.asymmetricKeyDetails.modulusLength;
out.rsaPublicExponent = rsaPriv.asymmetricKeyDetails.publicExponent.toString();

const ecPriv = crypto.createPrivateKey(KEYS.ecPriv);
out.ecPrivAsym = ecPriv.asymmetricKeyType;
out.ecNamedCurve = ecPriv.asymmetricKeyDetails.namedCurve;

const edPriv = crypto.createPrivateKey(KEYS.edPriv);
out.edPrivAsym = edPriv.asymmetricKeyType;
out.edDetails = JSON.stringify(edPriv.asymmetricKeyDetails);

const rsaPub = crypto.createPublicKey(KEYS.rsaPub);
out.rsaPubType = rsaPub.type;
out.rsaPubAsym = rsaPub.asymmetricKeyType;

// --- exports round-trip -----------------------------------------------------
out.rsaPrivPkcs8 = hex(crypto.createPrivateKey(KEYS.rsaPriv).export({ type: 'pkcs8', format: 'der' }));
out.rsaPrivPkcs1 = hex(crypto.createPrivateKey(KEYS.rsaPriv).export({ type: 'pkcs1', format: 'der' }));
out.rsaPubSpki = hex(crypto.createPublicKey(KEYS.rsaPub).export({ type: 'spki', format: 'der' }));
out.rsaPubPkcs1 = hex(crypto.createPublicKey(KEYS.rsaPub).export({ type: 'pkcs1', format: 'der' }));
out.ecPrivPkcs8 = hex(ecPriv.export({ type: 'pkcs8', format: 'der' }));
out.ecPrivSec1 = hex(ecPriv.export({ type: 'sec1', format: 'der' }));
out.ecPubSpki = hex(crypto.createPublicKey(KEYS.ecPub).export({ type: 'spki', format: 'der' }));
out.edPrivPkcs8 = hex(edPriv.export({ type: 'pkcs8', format: 'der' }));
out.edPubSpki = hex(crypto.createPublicKey(KEYS.edPub).export({ type: 'spki', format: 'der' }));
out.pkcs1ImportEqualsPkcs8 = crypto.createPrivateKey(KEYS.rsaPrivPkcs1).equals(rsaPriv);
out.sec1ImportEqualsPkcs8 = crypto.createPrivateKey(KEYS.ecPrivSec1).equals(ecPriv);
out.rsaSignHex = hex(crypto.sign('sha256', msg, rsaPriv));
out.rsaVerify = crypto.verify('sha256', msg, rsaPub, Buffer.from(SIGS.rsaSig, 'hex'));
out.rsaVerifyTampered = crypto.verify('sha256', Buffer.from('nope'), rsaPub, Buffer.from(SIGS.rsaSig, 'hex'));
out.rsaPssVerify = crypto.verify('sha256', msg, { key: crypto.createPublicKey(KEYS.rsaPub), padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(SIGS.rsaPssSig, 'hex'));
out.rsaPssMaxVerify = crypto.verify('sha256', msg, { key: crypto.createPublicKey(KEYS.rsaPub), padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_MAX_SIGN }, Buffer.from(SIGS.pssMaxSig, 'hex'));
out.rsaPkcs1SigVerify = crypto.verify('sha256', msg, crypto.createPublicKey(KEYS.rsaPub), Buffer.from(SIGS.rsaSig, 'hex'));
out.rsaConstants = [crypto.constants.RSA_PKCS1_PADDING, crypto.constants.RSA_PKCS1_PSS_PADDING, crypto.constants.RSA_PSS_SALTLEN_DIGEST, crypto.constants.RSA_PSS_SALTLEN_MAX_SIGN];

// --- createSign / createVerify ---------------------------------------------
const s = crypto.createSign('sha256');
s.update(msg);
const streamSig = s.sign(rsaPriv, 'hex');
out.createSignMatches = streamSig === SIGS.rsaSig;
const v = crypto.createVerify('sha256');
v.update(msg);
out.createVerify = v.verify(rsaPub, Buffer.from(SIGS.rsaSig, 'hex'));

// --- ECDSA ------------------------------------------------------------------
out.ecVerifyFixed = crypto.verify('sha256', msg, crypto.createPublicKey(KEYS.ecPub), Buffer.from(SIGS.ecSig, 'hex'));
out.ecVerifyFixedP1363 = crypto.verify('sha256', msg, { key: crypto.createPublicKey(KEYS.ecPub), dsaEncoding: 'ieee-p1363' }, Buffer.from(SIGS.ecSigP1363, 'hex'));
const ecSelf = crypto.sign('sha256', msg, ecPriv);
out.ecSelfVerify = crypto.verify('sha256', msg, crypto.createPublicKey(KEYS.ecPub), ecSelf);
out.ecSigIsDer = ecSelf[0] === 0x30;
const ecSelfP = crypto.sign('sha256', msg, { key: ecPriv, dsaEncoding: 'ieee-p1363' });
out.ecSelfVerifyP1363 = crypto.verify('sha256', msg, { key: crypto.createPublicKey(KEYS.ecPub), dsaEncoding: 'ieee-p1363' }, ecSelfP);
out.ecP1363Length = ecSelfP.length;

// --- Ed25519 (deterministic) -----------------------------------------------
const edPub = crypto.createPublicKey(KEYS.edPub);
out.edSignHex = hex(crypto.sign(null, msg, edPriv));
out.edVerify = crypto.verify(null, msg, edPub, Buffer.from(SIGS.edSig, 'hex'));
out.edVerifyTampered = crypto.verify(null, Buffer.from('x'), edPub, Buffer.from(SIGS.edSig, 'hex'));

// --- key generation (shape only; values are random) -------------------------
const ecGen = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
out.ecGenAsym = ecGen.privateKey.asymmetricKeyType;
out.ecGenCurve = ecGen.privateKey.asymmetricKeyDetails.namedCurve;
const genSig = crypto.sign('sha256', msg, ecGen.privateKey);
out.ecGenRoundtrip = crypto.verify('sha256', msg, ecGen.publicKey, genSig);
const edGen = crypto.generateKeyPairSync('ed25519');
out.edGenAsym = edGen.publicKey.asymmetricKeyType;
out.edGenRoundtrip = crypto.verify(null, msg, edGen.publicKey, crypto.sign(null, msg, edGen.privateKey));
const rsaGen = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
out.rsaGenAsym = rsaGen.privateKey.asymmetricKeyType;
out.rsaGenLength = rsaGen.privateKey.asymmetricKeyDetails.modulusLength;
out.rsaGenRoundtrip = crypto.verify('sha256', msg, rsaGen.publicKey, crypto.sign('sha256', msg, rsaGen.privateKey));

// --- equality (must be last: in real Node a KeyObject.equals() call leaves
// OpenSSL state that makes every later createPrivateKey() fail with
// ERR_OSSL_EVP_DIFFERENT_KEY_TYPES, so nothing parses a key after this point) -
out.pubFromPrivEqual = rsaPub.equals(crypto.createPublicKey(rsaPriv));
out.differentKeysEqual = rsaPub.equals(crypto.createPublicKey(KEYS.ecPub));

// --- errors -----------------------------------------------------------------
out.badPem = (() => { try { crypto.createPrivateKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'); return 'no-throw'; } catch (e) { return e.constructor.name; } })();
out.signWithPublic = (() => { try { crypto.sign('sha256', msg, rsaPub); return 'no-throw'; } catch (e) { return e.message.slice(0, 40); } })();
out.getCurvesHas = ['prime256v1', 'secp384r1', 'secp521r1'].every((c) => crypto.getCurves().includes(c));
out.keyObjectFromThrows = (() => { try { crypto.KeyObject.from({}); return 'no-throw'; } catch (e) { return e.code; } })();
out.newKeyObjectThrows = (() => { try { new crypto.KeyObject(); return 'no-throw'; } catch (e) { return e.code; } })();

console.log('__OBS__' + JSON.stringify(out));
