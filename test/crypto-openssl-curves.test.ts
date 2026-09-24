/**
 * The EC curve surface (M119).
 *
 * `crypto.getCurves()` is `EC_get_builtin_curves` + `OBJ_nid2sn` (then Node's
 * `filterDuplicateStrings`), and a curve name is resolved through
 * `EC_curve_nist2nid` / `OBJ_sn2nid`. Both are answered by the same wasm
 * OpenSSL that performs the operations, so keys for every curve OpenSSL knows —
 * not just the three the runtime has arithmetic for — are generated, exported
 * and used here.
 *
 * Everything is checked against this process's own `node:crypto` in both
 * directions: keys we generate are imported and used by real Node, and keys
 * real Node generates are imported and used here.
 */
import { describe, expect, it, afterAll } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import { opensslReady, setOpensslEnabled } from '../src/node-runtime/bindings/openssl';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const nc = nodeCrypto as any;

afterAll(() => setOpensslEnabled(true));

function boot(): any {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('crypto');
}

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => hex(a) === hex(b);

/** Curves that exercise each family OpenSSL ships. */
const CURVES = [
  'prime256v1', // NIST (has local arithmetic)
  'secp384r1',
  'secp521r1',
  'secp256k1', // Koblitz prime
  'prime192v1', // legacy NIST
  'secp224r1',
  'brainpoolP256r1', // Brainpool
  'brainpoolP384r1',
  'brainpoolP512r1',
  'sect163k1', // binary field
  'wap-wsg-idm-ecid-wtls1',
  'SM2', // Chinese curve (see the note in the details test)
];

/**
 * Curves `getCurves()` advertises but that nothing can use: `Oakley-EC2N-3`
 * and `Oakley-EC2N-4` are `NID_ipsec3/4`, which OpenSSL's object database
 * leaves without an OID. Real Node generates them and then fails to export
 * them (`ERR_OSSL_MISSING_OID`), so they are listed and nothing more.
 */
const UNUSABLE = ['Oakley-EC2N-3', 'Oakley-EC2N-4'];

describe('crypto.getCurves', () => {
  it('lists exactly the curves the wasm OpenSSL knows', () => {
    expect(opensslReady()).toBe(true);
    const crypto = boot();
    expect(crypto.getCurves()).toEqual(nc.getCurves());
    // The full built-in set, not just the curves we implement.
    expect(crypto.getCurves().length).toBeGreaterThan(70);
    expect(crypto.getCurves()).toContain('secp256k1');
    for (const name of UNUSABLE) expect(crypto.getCurves()).toContain(name);
  });
});

describe('EC keys for every curve OpenSSL knows', () => {
  it('generates, exports and re-imports each curve', () => {
    expect(opensslReady()).toBe(true);
    const crypto = boot();
    for (const namedCurve of CURVES) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve });
      const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
      const spki = publicKey.export({ type: 'spki', format: 'der' });

      // Node must accept both halves. Its type is `ec` for every curve except
      // SM2, which OpenSSL decodes as the SM2 algorithm (see the note below).
      const nodePriv = nc.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
      const nodePub = nc.createPublicKey({ key: spki, format: 'der', type: 'spki' });
      const nodeType = namedCurve === 'SM2' ? undefined : 'ec';
      expect(nodePriv.asymmetricKeyType, `${namedCurve} (node reads pkcs8)`).toBe(nodeType);
      expect(nodePub.asymmetricKeyType, `${namedCurve} (node reads spki)`).toBe(nodeType);
      expect(privateKey.asymmetricKeyDetails?.namedCurve, `${namedCurve} (ours)`).toBe(namedCurve);

      // …and the same key round-trips back through our own importer.
      const reimported = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
      expect(reimported.asymmetricKeyDetails?.namedCurve, `${namedCurve} (re-import)`).toBe(namedCurve);

      // The public point has to survive the SEC1 (uncompressed) encoding.
      expect(sameBytes(new Uint8Array(nodePub.export({ type: 'spki', format: 'der' })), new Uint8Array(spki)), `${namedCurve} (spki bytes)`).toBe(true);
    }
  }, 120000);

  it('imports keys real Node generated, for every curve', () => {
    expect(opensslReady()).toBe(true);
    const crypto = boot();
    for (const namedCurve of CURVES) {
      const { privateKey, publicKey } = nc.generateKeyPairSync('ec', { namedCurve });
      const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
      const spki = publicKey.export({ type: 'spki', format: 'der' });

      const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
      const pub = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
      //
      // Documented deviation: OpenSSL decodes an `id-ecPublicKey` key whose
      // parameter is the SM2 curve as the *SM2* algorithm, so Node reports
      // `asymmetricKeyType === undefined` and `{}` details for such a key — and
      // then cannot sign with it at all (`ERR_OSSL_INVALID_DIGEST`; the SM2
      // provider accepts only SM3). We keep the EC view, which names the curve
      // and can sign. Same DER, strictly more capability.
      if (namedCurve === 'SM2') {
        expect(nc.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }).asymmetricKeyType).toBeUndefined();
        expect(priv.asymmetricKeyType).toBe('ec');
        expect(priv.asymmetricKeyDetails).toEqual({ namedCurve: 'SM2' });
      } else {
        expect(priv.asymmetricKeyDetails?.namedCurve, `${namedCurve} (pkcs8)`).toBe(namedCurve);
        expect(pub.asymmetricKeyDetails?.namedCurve, `${namedCurve} (spki)`).toBe(namedCurve);
      }
      expect(sameBytes(priv.export({ type: 'pkcs8', format: 'der' }), new Uint8Array(pkcs8)), `${namedCurve} (pkcs8 bytes)`).toBe(true);
    }
  }, 120000);

  it('signs with our keys and verifies with Node, and the other way round', () => {
    expect(opensslReady()).toBe(true);
    const crypto = boot();
    const data = new TextEncoder().encode('curve parity');
    // SM2 only signs with SM3 (that is the algorithm, and Node behaves the
    // same for a key it imported); the rest sign with SHA-256.
    for (const namedCurve of CURVES) {
      const hash = namedCurve === 'SM2' ? 'sm3' : 'sha256';
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve });
      const spki = publicKey.export({ type: 'spki', format: 'der' });

      // We sign, Node verifies.
      const ours = crypto.sign(hash, data, privateKey);
      expect(nc.verify(hash, data, nc.createPublicKey({ key: spki, format: 'der', type: 'spki' }), ours), `${namedCurve} (node verifies ours)`).toBe(true);

      // Node signs, we verify.
      const nodePriv = nc.createPrivateKey({ key: privateKey.export({ type: 'pkcs8', format: 'der' }), format: 'der', type: 'pkcs8' });
      const theirs = nc.sign(hash, data, nodePriv);
      expect(crypto.verify(hash, data, publicKey, theirs), `${namedCurve} (we verify node's)`).toBe(true);

      if (namedCurve === 'SM2') continue; // no P1363 for SM2
      // P1363 as well, since that path frames the integers itself.
      const oursP1363 = crypto.sign(hash, data, { key: privateKey, dsaEncoding: 'ieee-p1363' });
      expect(
        nc.verify(hash, data, { key: spki, format: 'der', type: 'spki', dsaEncoding: 'ieee-p1363' }, oursP1363),
        `${namedCurve} (p1363)`,
      ).toBe(true);
    }
  }, 120000);

  it('reports the SM2 curve\'s limits the way Node does', () => {
    expect(opensslReady()).toBe(true);
    const crypto = boot();
    const data = new TextEncoder().encode('curve parity');
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'SM2' });

    // A digest other than SM3 is rejected by the SM2 provider. Node reports
    // `ERR_OSSL_INVALID_DIGEST` for an imported SM2 key; we surface the same
    // error from the backend rather than blaming a missing feature.
    const nodeErr = (() => {
      try {
        nc.sign('sha256', data, nc.createPrivateKey({ key: privateKey.export({ type: 'pkcs8', format: 'der' }), format: 'der', type: 'pkcs8' }));
        return null;
      } catch (err) {
        return (err as { code?: string }).code;
      }
    })();
    expect(nodeErr, 'node rejects sha256 for an imported SM2 key').toBe('ERR_OSSL_INVALID_DIGEST');
    expect(() => crypto.sign('sha256', data, privateKey)).toThrowError(/invalid digest/);
    try {
      crypto.sign('sha256', data, privateKey);
      expect.unreachable('sign should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('ERR_OSSL_INVALID_DIGEST');
    }

    //
    // Documented divergence: OpenSSL refuses by design to import SM2-curve
    // material into the EC key manager (`common_check_sm2` in ec_kmgmt.c), and
    // the SM2 key manager has no `derive`. Node can do ECDH only because its
    // keys stay EC-typed from generation and never round-trip through DER;
    // ours always materialise from DER, so ECDH on SM2 is unavailable.
    expect(() =>
      crypto.diffieHellman({
        privateKey,
        publicKey: crypto.createPublicKey({ key: crypto.generateKeyPairSync('ec', { namedCurve: 'SM2' }).publicKey.export({ type: 'spki', format: 'der' }), format: 'der', type: 'spki' }),
      }),
    ).toThrowError(/not supported|not implemented/i);
  }, 120000);

  it('agrees with Node on an ECDH secret for every curve', () => {
    expect(opensslReady()).toBe(true);
    const crypto = boot();
    for (const namedCurve of CURVES) {
      if (namedCurve === 'SM2') continue; // see the SM2 test above
      const ours = crypto.generateKeyPairSync('ec', { namedCurve });
      const theirs = nc.generateKeyPairSync('ec', { namedCurve });

      // Each side works on its own key objects; both read each other's DER.
      const ourSecret = crypto.diffieHellman({
        privateKey: ours.privateKey,
        publicKey: crypto.createPublicKey({ key: theirs.publicKey.export({ type: 'spki', format: 'der' }), format: 'der', type: 'spki' }),
      });
      const theirSecret = nc.diffieHellman({
        privateKey: theirs.privateKey,
        publicKey: nc.createPublicKey({ key: ours.publicKey.export({ type: 'spki', format: 'der' }), format: 'der', type: 'spki' }),
      });
      expect(sameBytes(ourSecret, new Uint8Array(theirSecret)), `${namedCurve} (ecdh)`).toBe(true);
    }
  }, 120000);
});

describe('RSA key generation', () => {
  it('honours any public exponent Node accepts', () => {
    expect(opensslReady()).toBe(true);
    const crypto = boot();
    for (const publicExponent of [3, 17, 65537, 0x10001]) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent });
      expect(privateKey.asymmetricKeyDetails, `e=${publicExponent} (ours)`).toEqual({
        modulusLength: 1024,
        publicExponent: BigInt(publicExponent),
      });
      const nodePriv = nc.createPrivateKey({ key: privateKey.export({ type: 'pkcs8', format: 'der' }), format: 'der', type: 'pkcs8' });
      expect(nodePriv.asymmetricKeyDetails, `e=${publicExponent} (node)`).toEqual({
        modulusLength: 1024,
        publicExponent: BigInt(publicExponent),
      });
      // The pair must actually work in Node.
      const data = new TextEncoder().encode('exponent parity');
      const sig = crypto.sign('sha256', data, privateKey);
      expect(nc.verify('sha256', data, nc.createPublicKey({ key: publicKey.export({ type: 'spki', format: 'der' }), format: 'der', type: 'spki' }), sig)).toBe(true);
    }
  }, 120000);
});
