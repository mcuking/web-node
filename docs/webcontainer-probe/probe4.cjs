const out = (k, v) => console.log(k, '::', typeof v === 'string' ? v : JSON.stringify(v));
const crypto = require('crypto');

out('ciphers', crypto.getCiphers().length + ' hashes=' + crypto.getHashes().length);

// 非对称：RSA 生成 + 签名/验签
try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sig = crypto.sign('sha256', Buffer.from('hi'), privateKey);
  const ok = crypto.verify('sha256', Buffer.from('hi'), publicKey, sig);
  out('RSA-sign-verify', ok);
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  out('RSA-spki-pem-head', String(pem).split('\n')[0]);
  try { const x = new crypto.X509Certificate(pem); out('X509-from-pem', 'ok subject=' + JSON.stringify(x.subject)); }
  catch (e) { out('X509-err', (e && e.code) || (e && e.message)); }
} catch (e) { out('RSA-err', (e && e.code) || (e && e.message)); }

// Ed25519
try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  out('ED25519', crypto.verify(null, Buffer.from('x'), publicKey, crypto.sign(null, Buffer.from('x'), privateKey)));
} catch (e) { out('ED25519-err', (e && e.code) || (e && e.message)); }

// EC
try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  out('EC-P256', crypto.verify('sha256', Buffer.from('x'), publicKey, crypto.sign('sha256', Buffer.from('x'), privateKey)));
} catch (e) { out('EC-err', (e && e.code) || (e && e.message)); }

// scrypt
try { out('scrypt', crypto.scryptSync('pw', 'salt', 16).toString('hex')); }
catch (e) { out('scrypt-err', (e && e.code) || (e && e.message)); }

// ML-KEM（Node 22 有吗？）
try { out('ML-KEM', typeof crypto.generateKeyPairSync === 'function' ? String(crypto.getCurves().includes('x25519')) : 'n/a'); } catch {}

// 自签证书能不能造（决定 https server 能不能起）
try {
  const { generateKeyPairSync } = crypto;
  out('X509Certificate-class', typeof crypto.X509Certificate);
} catch (e) { out('x509.err', e.message); }
