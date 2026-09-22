// Records an ML-KEM oracle from real Node: for each parameter set, the SPKI
// (encapsulation key), the PKCS#8 (64-byte seed), a ciphertext produced by
// Node's own encapsulate(), and the shared secret Node's decapsulate() yields.
// web-node must reproduce the derived public key and the shared secret.
import { createPrivateKey, createPublicKey, decapsulate, encapsulate, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const out = {};
for (const param of ['ml-kem-512', 'ml-kem-768', 'ml-kem-1024']) {
  const { publicKey, privateKey } = generateKeyPairSync(param);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  // PKCS#8 body: SEQUENCE { INTEGER 0, SEQUENCE { OID }, OCTET STRING { OCTET STRING(seed) } }
  const { ciphertext, sharedKey } = encapsulate(publicKey);
  // Re-import from the raw wire forms to prove they round-trip.
  const pub2 = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const priv2 = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const ss2 = decapsulate(priv2, ciphertext);
  if (!ss2.equals(sharedKey)) throw new Error(`${param}: re-imported key mismatch`);
  out[param] = {
    spki: Buffer.from(spki).toString('hex'),
    pkcs8: Buffer.from(pkcs8).toString('hex'),
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    sharedKey: Buffer.from(sharedKey).toString('hex'),
    publicKeyType: publicKey.asymmetricKeyType,
    publicKeyDetails: publicKey.asymmetricKeyDetails,
  };
}

writeFileSync(join(root, 'test/fixtures/crypto-mlkem.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote test/fixtures/crypto-mlkem.json');
