// Generates tools/crypto-kem-probe.cjs with embedded, real-Node-produced
// ML-KEM vectors (SPKI, PKCS#8 seed, a ciphertext and its shared secret). The
// probe is deterministic so it can run unchanged on real Node and in web-node.
import { createPrivateKey, createPublicKey, decapsulate, encapsulate, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const vectors = {};
for (const param of ['ml-kem-512', 'ml-kem-768', 'ml-kem-1024']) {
  const { publicKey, privateKey } = generateKeyPairSync(param);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const { ciphertext, sharedKey } = encapsulate(publicKey);
  // Re-import so the recorded ciphertext is guaranteed to pair with the keys.
  const priv2 = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  if (!decapsulate(priv2, ciphertext).equals(sharedKey)) throw new Error(`${param}: key/ciphertext mismatch`);
  void createPublicKey;
  vectors[param] = {
    spki: Buffer.from(spki).toString('hex'),
    pkcs8: Buffer.from(pkcs8).toString('hex'),
    ct: Buffer.from(ciphertext).toString('hex'),
    ss: Buffer.from(sharedKey).toString('hex'),
  };
}

const probe = `// crypto.encapsulate / crypto.decapsulate + ml-kem KeyObjects (M91).
//
// Deterministic: the vectors are real-Node-produced, so decapsulating the
// embedded ciphertext and every structural observation must match byte-for-byte
// between real Node and web-node. The only random operation is encapsulate(); we
// record only its lengths and the round-trip result, never raw output.
'use strict';
const crypto = require('crypto');
const VECTORS = ${JSON.stringify(vectors, null, 2)};

const obs = {};
const norm = (e) => ({ name: e.name, code: e.code, message: e.message });
const call = (fn) => { try { return { ok: fn() }; } catch (e) { return { err: norm(e) }; } };

obs.surface = {
  encapsulate: typeof crypto.encapsulate,
  encapsulateLength: crypto.encapsulate.length,
  decapsulate: typeof crypto.decapsulate,
  decapsulateLength: crypto.decapsulate.length,
};

obs.params = {};
for (const [param, v] of Object.entries(VECTORS)) {
  const spki = Buffer.from(v.spki, 'hex');
  const pkcs8 = Buffer.from(v.pkcs8, 'hex');
  const ct = Buffer.from(v.ct, 'hex');
  const pub = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const o = {};
  o.pubType = pub.type;
  o.pubAsym = pub.asymmetricKeyType;
  o.privType = priv.type;
  o.privAsym = priv.asymmetricKeyType;
  o.pubDetails = pub.asymmetricKeyDetails;
  o.spkiRoundTrip = pub.export({ type: 'spki', format: 'der' }).equals(spki);
  o.pkcs8RoundTrip = priv.export({ type: 'pkcs8', format: 'der' }).equals(pkcs8);
  o.pubPemHead = pub.export({ type: 'spki', format: 'pem' }).split('\\n')[0];
  o.privPemHead = priv.export({ type: 'pkcs8', format: 'pem' }).split('\\n')[0];
  o.derivedFromPrivate = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).equals(spki);
  o.decapsulateEmbeddedCt = crypto.decapsulate(priv, ct).toString('hex');
  o.decapsulatePemPrivate = crypto.decapsulate(priv.export({ type: 'pkcs8', format: 'pem' }), ct).toString('hex');
  const enc = crypto.encapsulate(pub);
  o.ssLen = enc.sharedKey.length;
  o.ctLen = enc.ciphertext.length;
  o.ssIsBuffer = Buffer.isBuffer(enc.sharedKey);
  o.ctIsBuffer = Buffer.isBuffer(enc.ciphertext);
  o.roundTrip = crypto.decapsulate(priv, enc.ciphertext).equals(enc.sharedKey);
  o.encapFromPem = crypto.encapsulate(pub.export({ type: 'spki', format: 'pem' })).ciphertext.length;
  o.encapFromPrivate = crypto.encapsulate(priv).ciphertext.length;
  obs.params[param] = o;
}

const kp = crypto.generateKeyPairSync('ml-kem-768');
const pub = kp.publicKey;
const priv = kp.privateKey;
const secret = crypto.createSecretKey(Buffer.alloc(32));
const ct768 = Buffer.from(VECTORS['ml-kem-768'].ct, 'hex');

obs.errors = {
  encapNoArg: call(() => crypto.encapsulate()),
  encapNumber: call(() => crypto.encapsulate(42)),
  encapSecret: call(() => crypto.encapsulate(secret)),
  encapBadCb: call(() => crypto.encapsulate(pub, 'x')),
  decapNoCt: call(() => crypto.decapsulate(priv)),
  decapNumberCt: call(() => crypto.decapsulate(priv, 42)),
  decapPublic: call(() => crypto.decapsulate(pub, ct768)),
  decapBadLen: call(() => crypto.decapsulate(priv, Buffer.alloc(ct768.length - 1))),
  decapBadCb: call(() => crypto.decapsulate(priv, ct768, 'x')),
};

(async () => {
  obs.asyncEncap = await new Promise((resolve) => {
    crypto.encapsulate(pub, (err, result) => {
      resolve(err ? norm(err) : { ssLen: result.sharedKey.length, ctLen: result.ciphertext.length });
    });
  });
  obs.asyncDecap = await new Promise((resolve) => {
    crypto.encapsulate(pub, (err, enc) => {
      if (err) return resolve(norm(err));
      crypto.decapsulate(priv, enc.ciphertext, (err2, ss) => {
        resolve(err2 ? norm(err2) : ss.equals(enc.sharedKey));
      });
    });
  });
  console.log('__OBS__' + JSON.stringify(obs));
})();
`;

writeFileSync(join(root, 'tools/crypto-kem-probe.cjs'), probe);
console.log('wrote tools/crypto-kem-probe.cjs');
