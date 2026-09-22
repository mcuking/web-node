import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fromHex, toHex } from '../src/node-runtime/crypto/der';
import {
  mlKemCiphertextLength,
  mlKemDecapsulate,
  mlKemEncapsulate,
  mlKemExpandSeed,
  mlKemPublicFromSeed,
  type MlKemParam,
} from '../src/node-runtime/crypto/mlkem';

/**
 * M91: ML-KEM (FIPS 203). The fixture is produced by real Node
 * (`tools/crypto-mlkem-oracle.mjs`); the derived public key and the shared
 * secret recovered from Node's ciphertext must match byte-for-byte.
 */
const fixture = JSON.parse(fs.readFileSync('test/fixtures/crypto-mlkem.json', 'utf8')) as Record<
  MlKemParam,
  { spki: string; pkcs8: string; ciphertext: string; sharedKey: string }
>;

const PARAMS: MlKemParam[] = ['ml-kem-512', 'ml-kem-768', 'ml-kem-1024'];

const seedOf = (pkcs8Hex: string): Uint8Array => fromHex(pkcs8Hex).subarray(-64);

describe('ML-KEM (FIPS 203) differential vs real Node', () => {
  for (const param of PARAMS) {
    const vectors = fixture[param];

    it(`${param}: derives the encapsulation key from the seed`, () => {
      const ek = mlKemPublicFromSeed(seedOf(vectors.pkcs8), param);
      // SPKI = SEQUENCE { SEQUENCE{OID}, BIT STRING(0x00 || ek) }; ek is trailing.
      expect(toHex(ek)).toBe(vectors.spki.slice(-(ek.length * 2)));
    });

    it(`${param}: decapsulates Node's ciphertext to the same shared secret`, () => {
      const { dk } = mlKemExpandSeed(seedOf(vectors.pkcs8), param);
      const sharedKey = mlKemDecapsulate(dk, fromHex(vectors.ciphertext), param);
      expect(toHex(sharedKey)).toBe(vectors.sharedKey);
    });

    it(`${param}: round-trips its own encapsulation`, () => {
      const seed = new Uint8Array(64);
      for (let i = 0; i < 64; i++) seed[i] = i;
      const ek = mlKemPublicFromSeed(seed, param);
      const { dk } = mlKemExpandSeed(seed, param);
      let counter = 0;
      const { ciphertext, sharedKey } = mlKemEncapsulate(ek, param, (n) => {
        const b = new Uint8Array(n);
        for (let i = 0; i < n; i++) b[i] = (counter + i * 7) & 0xff;
        counter += n;
        return b;
      });
      expect(ciphertext.length).toBe(mlKemCiphertextLength(param));
      expect(sharedKey.length).toBe(32);
      expect(toHex(mlKemDecapsulate(dk, ciphertext, param))).toBe(toHex(sharedKey));
    });
  }

  it('rejects a tampered ciphertext via implicit rejection', () => {
    const vectors = fixture['ml-kem-512'];
    const { dk } = mlKemExpandSeed(seedOf(vectors.pkcs8), 'ml-kem-512');
    const bad = fromHex(vectors.ciphertext);
    bad[0] ^= 0x01;
    const sharedKey = mlKemDecapsulate(dk, bad, 'ml-kem-512');
    expect(toHex(sharedKey)).not.toBe(vectors.sharedKey);
    expect(sharedKey.length).toBe(32);
  });
});
