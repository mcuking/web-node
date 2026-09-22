// Differential observation program for crypto asymmetric encryption (RSA
// OAEP / PKCS#1 v1.5) and ECDH. Fixed keys and ciphertexts were produced by
// real Node v26.9.0. Runs unchanged on real Node and inside web-node.
const crypto = require('crypto');

const KEYS = {
  rsaPriv: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCUhcfdLracU6wG\nLtjlHB+RvQoYavuoVpkgPPYuP+EtaeadjJEtaUr5SnG1OyixlBAgYN5yY1Edj693\nFXsYm85JAaNvu1YsA8qo4aXxoRrLim8irPwyFi5fN0ndHx3aT6x8yPuuAtWRUJ3b\nXWutDYBQ3M6kbsbSHxl2iqMbTu4zy8wlqRgWJ1e8vaHnzY6TqIewNFkm+T1gYHXc\neXS5ICo0awgEplI/irtzuP2A8j+oBdTQ/xLqx+tePVqAESZilHiKdNiJlwkrMVcS\nQNVv26v9bBaW7gAK6yuucwdeSGNf0hCjY28gsc1Aotr6YM8JwT9XNS/e2ytDweA4\ns7kqvk/pAgMBAAECggEAAQLtcQoUmBzjNCevy5xMDtnvsE19/L4vV36AHlpYZwe+\nO/JEa9UNtKBnPccE4xB6QqMTk2ZYlKcKClXt61AfNG2vLY2kEtbwU4NgUnR1KXNo\nzyzkyuP41dD+7wbe+KVg3eqR6xezA+iEuHbMp1ZngX5bdR8LcvbtpH3FQvm1Uy4h\ntUMxAcqEyyRbXWHV+mA8Sm9BohZGcg/2w0ganKbZMFA06mO0/uT9V3knmkbiG8b4\nI07tlhs+Xul+Lg1Bju+K1bOPcNAkSkSVDMbnQoFhd+klf4BxgEBN+Fmx2v62Dzpb\nuAsJgu41U9n6APgp8ALXf3Kbeh4Owsj8apUENYYX3QKBgQDLtO1GLedWk52IrYJL\noiNhiyxEod/d2+msSiCIZ9teLILU5RdfTTHgDlXNa0v04O5LalccGZYwalTkY52i\nFVkgC3m/tqqmE0NszsSE27Ui3ukZWLk3pi4XOwd12s5F6ZNlIz8rFdBOH8M1idSF\nwbCB5PuzJcDeTLXaB8Z+BMHdVQKBgQC6pkuXOBOxf2XBRC9c44kh32BHoMvCZZ8O\nMuddK2sIY5VXwy/EB1bz9F/xE2k83xtIK5XgZSsloeHP7us1SkIfG6Ifqw8P/VB4\nqRI1vFVUrMcbyCBa0f47SXgJoyVh7iRg7PZk+q2Y5/HglUYO1WBy96Mm79RgJK6B\n/EoxrUcIRQKBgBPxUolcVRmUugd3dRoSdYRHK75MWq5NqULEvwqboE5H7UcKZo9d\n71QQEzZZGsaOfsXDU2Pc3WdAAa+aUQRdMqyAcxrhtzMrD57HX1XibIlNaWSh2wAn\ntLtxe/l9wlP12gg8uyJssEf1tBa5t6SgobcVw852E7uvpt4BhN0xeglBAoGAJmB4\n3F/QVMeQAXvmjR/Pm2JVZoTeQFsqp/25aoO53yCynTfpw1GLBF/zthq6oaRx9JXZ\nnCjRBUzSpDFItU1OaR0CaaZ/U1dPS2/f6aKOnPllewXb+TCCKGiDwN+FmSwg2LkA\nNGUCepT+O6IVpIkk6p6WMjRPo3EHXHymOK6bE00CgYEApYAqgsRtn3h9bQUzbX7C\nZQb9iDjuktXkg1GGjlegrwX6IR5388zE4FIiIr24DtTRRrjNkOWkA6yQ+E46GwjV\nXY6E+COsRpp8nscLsI6a/ha2shAeQ9rS3gcwPDMi3zD0MJCB7uq72hTRIRe4Rmst\n42b4unn2otK/zaXd6XUtHw4=\n-----END PRIVATE KEY-----\n",
  rsaPub: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlIXH3S62nFOsBi7Y5Rwf\nkb0KGGr7qFaZIDz2Lj/hLWnmnYyRLWlK+UpxtTsosZQQIGDecmNRHY+vdxV7GJvO\nSQGjb7tWLAPKqOGl8aEay4pvIqz8MhYuXzdJ3R8d2k+sfMj7rgLVkVCd211rrQ2A\nUNzOpG7G0h8ZdoqjG07uM8vMJakYFidXvL2h582Ok6iHsDRZJvk9YGB13Hl0uSAq\nNGsIBKZSP4q7c7j9gPI/qAXU0P8S6sfrXj1agBEmYpR4inTYiZcJKzFXEkDVb9ur\n/WwWlu4ACusrrnMHXkhjX9IQo2NvILHNQKLa+mDPCcE/VzUv3tsrQ8HgOLO5Kr5P\n6QIDAQAB\n-----END PUBLIC KEY-----\n",
  ecPriv: "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSxIl6QmVVzHeaL89\nKwBCGm5TAjPgAzhVrba6mh9VVWOhRANCAAQocE7RAmeqSGQy2PG+PahDc+b648Dv\nrjJDJS8nz6TJs4RgX+DzGZeLO4bN/BxwCM+sR+ngM/3wu3AKwX+UJxHo\n-----END PRIVATE KEY-----\n",
  ecPub: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEKHBO0QJnqkhkMtjxvj2oQ3Pm+uPA\n764yQyUvJ8+kybOEYF/g8xmXizuGzfwccAjPrEfp4DP98LtwCsF/lCcR6A==\n-----END PUBLIC KEY-----\n",
};

const FIX = {
  message: "7765622d6e6f646520656e6320636f72707573",
  label: "6c6162656c2d3432",
  oaep: "3bde61268804bc73608945b1cbd7aa293c90fe1585c38d345948b4efb27b421cc7e91d51be83bfa378288c9569d85c04020b38509eccbb3ad50ab05659fc6fe0bb7d9b60cbb4bad2aac65c694799b89e54b441458d89d5b48aca77406089914110c840f959af28e15131c535c51d1b5cbfcf05070d4f91632831a913e432bc3f85d3827c271732f7615dbb0dd2e918c33cbfb87b52f1f4823330f906981e79de11ed2e3392f7cd53c886f51816a5d2250f1af34b6bbe88f320387cdbfaca6b92ec1f0eca9a95da96d26b3ee5c2ca600b4401eed8f89b0d332318e659c3d2f4e45dda5f40340f0c50993dec4779785bbf91c52d8f062db8322c07adffaa163ef5",
  oaepSha1: "6ddf6fd1cab4963f3170748c1544cc5fa25e481afe11d57b34ecf4bf8e10669528a4ee34e7cc1a063c2b4710033e58f2524352e739fa14a5141f9ba2dda9a12a3182e7f732bbf411b220a8a6776df65f66f5502ae7d0e21b0c74c78728af1d5ee3609122b8afc95d9754556bf348245752d344aa19dc893521383fe073897bbf4714258969876b1a04c90ff6a5a0c5fc03b9f7bff61bce24016fd461c0269e5f5d322b01afbff6e8801fa68a3347f8b190c5d9d20f0eaba4f257731d3dc9be0635ae1feb88bdabc9c3533a2e8d8c2324e12748ee62b75f436f91d3a0802184206c20dc888cbfe07596f3cd569abed4e33cc85a8380b61752a72e106881ff633f",
  pkcs1: "7c99d9fe9573ed735c821d2ae96aebf9ebd8320c39640d12d47bf66f864df34a5b7bc56e619886d3b9b491a993499df55b3ca48777f93147392317358c4942c1b215e2b315e0ffc693b233fc8e999e1e492410d59ec03aad6f69ce193f8eba91e9552bd327f2bbe73d01b778a9813ae6778b44c76f3c91364ca917de2ac270a7fc32fc8971e96d31174914aac0f1c7686e0079764feb86e43153daa8f0515e32d0119a3109e8985a34b92f6260fdce3001aef4dfaddf86fc0e34e025409c6c6e02ddee17b9389378f195037a3c207ae6dadaeeaab5e84f45647f8e4849933f9b4e08a9d7afe00d61a2dfd5aed6fc9a80e777fb7eb967da841a743e59f8b9c263",
  aPrivHex: "4b1225e909955731de68bf3d2b00421a6e530233e0033855adb6ba9a1f555563",
  aPub: "0428704ed10267aa486432d8f1be3da84373e6fae3c0efae3243252f27cfa4c9b384605fe0f319978b3b86cdfc1c7008cfac47e9e033fdf0bb700ac17f942711e8",
  bPrivHex: "711a9582dd1831beb77169e2c3062144f931a9563989b564180a0011c43fe983",
  bPub: "04fd715b40f35d8f8376224a1c09f8e1ef7d2ba6b379ba4e56b9584571539204c59109ba5e5cf03fe2e324fbc6f680006ff42ed99499aca26474f1b6215bf91e8b",
  bPubCompressed: "03fd715b40f35d8f8376224a1c09f8e1ef7d2ba6b379ba4e56b9584571539204c5",
  sharedHex: "6b5ec00f4ab83db95221598dd4d3674b94f0a9470ce8404e8f2c009e61c5fb56",
};

const out = {};
const hex = (b) => Buffer.from(b).toString('hex');
const message = Buffer.from(FIX.message, 'hex');
const label = Buffer.from(FIX.label, 'hex');

const rsaPriv = crypto.createPrivateKey(KEYS.rsaPriv);
const rsaPub = crypto.createPublicKey(KEYS.rsaPub);

// --- RSA OAEP ---------------------------------------------------------------
out.oaepDecryptFixed = hex(crypto.privateDecrypt({ key: rsaPriv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: label }, Buffer.from(FIX.oaep, 'hex')));
out.oaepDecryptFixedSha1 = hex(crypto.privateDecrypt({ key: rsaPriv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(FIX.oaepSha1, 'hex')));
const oaepCipher = crypto.publicEncrypt({ key: rsaPub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: label }, message);
out.oaepCipherLength = oaepCipher.length;
out.oaepRoundtrip = hex(crypto.privateDecrypt({ key: rsaPriv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: label }, oaepCipher));
out.oaepWrongLabelThrows = (() => { try { crypto.privateDecrypt({ key: rsaPriv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: Buffer.from('other') }, oaepCipher); return 'no-throw'; } catch (e) { return 'throws'; } })();

// --- RSA PKCS#1 v1.5 --------------------------------------------------------
out.pkcs1DecryptFixed = hex(crypto.privateDecrypt({ key: rsaPriv, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(FIX.pkcs1, 'hex')));
const pkcs1Cipher = crypto.publicEncrypt({ key: rsaPub, padding: crypto.constants.RSA_PKCS1_PADDING }, message);
out.pkcs1CipherLength = pkcs1Cipher.length;
out.pkcs1Roundtrip = hex(crypto.privateDecrypt({ key: rsaPriv, padding: crypto.constants.RSA_PKCS1_PADDING }, pkcs1Cipher));
out.pkcs1CipherDiffers = !pkcs1Cipher.equals(Buffer.from(FIX.pkcs1, 'hex')); // random padding

// --- privateEncrypt / publicDecrypt -----------------------------------------
const raw = crypto.privateEncrypt(rsaPriv, message);
out.privateEncryptLength = raw.length;
out.publicDecryptRoundtrip = hex(crypto.publicDecrypt(rsaPub, raw));

// --- ECDH -------------------------------------------------------------------
const a = crypto.createECDH('prime256v1');
a.setPrivateKey(Buffer.from(FIX.aPrivHex, 'hex'));
out.ecdhAPub = a.getPublicKey('hex');
out.ecdhAPriv = a.getPrivateKey('hex');
out.ecdhSharedFromFixed = a.computeSecret(Buffer.from(FIX.bPub, 'hex'), undefined, 'hex');
out.ecdhSharedMatchesOracle = out.ecdhSharedFromFixed === FIX.sharedHex;
out.ecdhSharedLength = a.computeSecret(Buffer.from(FIX.bPub, 'hex')).length;

const a2 = crypto.createECDH('prime256v1');
a2.setPrivateKey(Buffer.from(FIX.aPrivHex, 'hex'));
const b = crypto.createECDH('prime256v1');
b.setPrivateKey(Buffer.from(FIX.bPrivHex, 'hex'));
out.ecdhSymmetric = a2.computeSecret(b.getPublicKey(), undefined, 'hex') === b.computeSecret(a2.getPublicKey(), undefined, 'hex');

const gen = crypto.createECDH('prime256v1');
out.ecdhGenPubLength = gen.generateKeys().length;
out.ecdhGenPrivLength = gen.getPrivateKey().length;
out.ecdhCompressedLength = gen.getPublicKey(undefined, 'compressed').length;
out.ecdhGenRoundtrip = (() => { const peer = crypto.createECDH('prime256v1'); peer.generateKeys(); return gen.computeSecret(peer.getPublicKey(), undefined, 'hex') === peer.computeSecret(gen.getPublicKey(), undefined, 'hex'); })();

out.convertKeyCompressed = crypto.ECDH.convertKey(Buffer.from(FIX.bPub, 'hex'), 'prime256v1', undefined, 'hex', 'compressed');
out.convertKeyCompressedMatches = out.convertKeyCompressed === FIX.bPubCompressed;
out.convertKeyUncompressed = crypto.ECDH.convertKey(Buffer.from(FIX.bPubCompressed, 'hex'), 'prime256v1', 'hex', 'hex', 'uncompressed');
out.convertKeyRoundtrip = out.convertKeyUncompressed === FIX.bPub;
out.ecdhPubIsBuffer = Buffer.isBuffer(a.getPublicKey());
out.ecdhSecretIsBuffer = Buffer.isBuffer(a.computeSecret(Buffer.from(FIX.bPub, 'hex')));
out.convertKeyIsBuffer = Buffer.isBuffer(crypto.ECDH.convertKey(Buffer.from(FIX.bPub, 'hex'), 'prime256v1', undefined, undefined, 'compressed'));
out.badCurve = (() => { try { crypto.createECDH('nope'); return 'no-throw'; } catch (e) { return 'throws'; } })();

console.log('__OBS__' + JSON.stringify(out));
