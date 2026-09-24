/**
 * The OpenSSL public-key engine (M119).
 *
 * Signatures and RSA encryption are randomized (PSS salts, ECDSA nonces, RSA
 * padding strings), so "same bytes twice" is not the property to check here.
 * Instead every operation is cross-checked against this process's own
 * `node:crypto` in *both* directions — we sign / it verifies, it signs / we
 * verify — and each direction is repeated with the wasm engine switched off,
 * so the pure-JS fallback and the OpenSSL path are held to one standard.
 */
import { describe, expect, it, afterAll } from 'vitest';
import {
  constants as nodeConstants,
  createPrivateKey as nodeCreatePrivateKey,
  getDiffieHellman as nodeGetDiffieHellman,
  createPublicKey as nodeCreatePublicKey,
  decapsulate as nodeDecapsulate,
  diffieHellman as nodeDiffieHellman,
  encapsulate as nodeEncapsulate,
  generateKeyPairSync as nodeGenerateKeyPairSync,
  privateDecrypt as nodePrivateDecrypt,
  publicEncrypt as nodePublicEncrypt,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { opensslReady, setOpensslEnabled } from '../src/node-runtime/bindings/openssl';
import {
  opensslPkeyDecapsulate,
  opensslPkeyEncapsulate,
  opensslPkeyFree,
  opensslPkeyFromDer,
  opensslPkeyFromRaw,
} from '../src/node-runtime/bindings/openssl';
import { mlKemDecapsulate, mlKemExpandSeed } from '../src/node-runtime/crypto/mlkem';
import {
  asymEngine,
  createPrivateKey,
  createPublicKey,
  decapsulate,
  diffieHellman,
  encapsulate,
  generateKeyPairSync,
  publicEncrypt,
  privateDecrypt,
  sign,
  verify,
} from '../src/node-runtime/crypto/asym';

afterAll(() => setOpensslEnabled(true));

const encoder = new TextEncoder();
const MESSAGE = encoder.encode('the quick brown fox jumps over the lazy dog');

/** Lower-case hex of a byte string, for byte-for-byte comparisons. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Run `fn` with the wasm engine off, restoring it afterwards. */
function withJsEngine<T>(fn: () => T): T {
  setOpensslEnabled(false);
  try {
    return fn();
  } finally {
    setOpensslEnabled(true);
  }
}

interface Pair {
  privateKey: string;
  publicKey: string;
  /** The same key pair as real Node sees it, for the cross-checks. */
  nodePrivate: unknown;
  nodePublic: unknown;
}

/** Generate a pair on one engine, exporting it as PEM Node can re-import. */
function makePair(type: string, options: Record<string, unknown>, engine: 'openssl' | 'js'): Pair {
  const build = () =>
    generateKeyPairSync(type, {
      ...options,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    } as never) as unknown as { privateKey: string; publicKey: string };
  const { privateKey, publicKey } = engine === 'openssl' ? build() : withJsEngine(build);
  return {
    privateKey,
    publicKey,
    nodePrivate: nodeCreatePrivateKey(privateKey),
    nodePublic: nodeCreatePublicKey(publicKey),
  };
}

interface Spec {
  /** `undefined` means "no digest" — Ed25519. */
  hash?: string;
  padding?: number;
  saltLength?: number;
  dsaEncoding?: 'der' | 'ieee-p1363';
}

/** Our `sign`/`verify` take the algorithm as an object; Node takes it as a key option. */
function ours(spec: Spec): unknown {
  return spec.hash === undefined ? null : { ...spec };
}

/** The object Node wants in the *key* position of `sign`/`verify`. */
function nodeKey(spec: Spec, key: unknown): unknown {
  const options: Record<string, unknown> = { key };
  if (spec.padding !== undefined) options.padding = spec.padding;
  if (spec.saltLength !== undefined) options.saltLength = spec.saltLength;
  if (spec.dsaEncoding !== undefined) options.dsaEncoding = spec.dsaEncoding;
  return options;
}

/** Sign with one engine and verify with the other, plus with real Node. */
function crossCheck(pair: Pair, spec: Spec, engine: 'openssl' | 'js'): void {
  const algorithm = ours(spec);
  const produce = () => loadEngine(engine, () => sign(algorithm, MESSAGE, pair.privateKey));
  const signature = produce();

  // Our own verifier agrees (whichever engine it picks).
  expect(verify(algorithm, MESSAGE, pair.publicKey, signature), 'self').toBe(true);
  expect(withJsEngine(() => verify(algorithm, MESSAGE, pair.publicKey, signature)), 'js verifier').toBe(true);
  // And so does real Node, on the very same signature.
  expect(
    nodeVerify(spec.hash ?? (null as never), MESSAGE, nodeKey(spec, pair.nodePublic) as never, signature as never),
    'node',
  ).toBe(true);

  // A signature Node produces verifies on both of our engines too.
  const nodeSignature = new Uint8Array(
    nodeSign(spec.hash ?? (null as never), MESSAGE, nodeKey(spec, pair.nodePrivate) as never),
  );
  expect(verify(algorithm, MESSAGE, pair.publicKey, nodeSignature), 'node signature').toBe(true);
  expect(
    withJsEngine(() => verify(algorithm, MESSAGE, pair.publicKey, nodeSignature)),
    'node signature js',
  ).toBe(true);

  // A tampered message must not verify.
  expect(verify(algorithm, encoder.encode('something else'), pair.publicKey, signature), 'tampered').toBe(false);
}

/** Run `fn` on the requested engine. */
function loadEngine<T>(engine: 'openssl' | 'js', fn: () => T): T {
  return engine === 'openssl' ? fn() : withJsEngine(fn);
}

describe('wn_openssl public-key engine', () => {
  it('is loaded in the test environment', () => {
    expect(opensslReady()).toBe(true);
    expect(asymEngine()).toBe('openssl');
  });

  it('agrees with Node on Ed25519 signatures', () => {
    const pair = makePair('ed25519', {}, 'openssl');
    crossCheck(pair, {}, 'openssl');
  });

  it('agrees with Node on RSA PKCS#1 v1.5 signatures', () => {
    const pair = makePair('rsa', { modulusLength: 2048 }, 'openssl');
    crossCheck(pair, { hash: 'sha256' }, 'openssl');
    crossCheck(pair, { hash: 'sha512', padding: nodeConstants.RSA_PKCS1_PADDING }, 'openssl');
  });

  it('agrees with Node on RSA-PSS, including the default salt length', () => {
    const pair = makePair('rsa', { modulusLength: 2048 }, 'openssl');
    const pss = { padding: nodeConstants.RSA_PKCS1_PSS_PADDING };
    // Node's default PSS salt is the *maximum* one; a default-salt signature
    // must still verify, and so must one Node makes with its own default.
    crossCheck(pair, { hash: 'sha256', ...pss }, 'openssl');
    crossCheck(pair, { hash: 'sha256', ...pss, saltLength: 32 }, 'openssl');
    crossCheck(
      pair,
      { hash: 'sha256', ...pss, saltLength: nodeConstants.RSA_PSS_SALTLEN_MAX },
      'openssl',
    );
  });

  it('agrees with Node on ECDSA for every supported curve', () => {
    for (const namedCurve of ['prime256v1', 'secp384r1', 'secp521r1']) {
      const pair = makePair('ec', { namedCurve }, 'openssl');
      crossCheck(pair, { hash: 'sha256' }, 'openssl');
      crossCheck(pair, { hash: 'sha384', dsaEncoding: 'ieee-p1363' }, 'openssl');
    }
  });

  it('agrees with Node on RSA-OAEP and PKCS#1 encryption', () => {
    const pair = makePair('rsa', { modulusLength: 2048 }, 'openssl');
    const secret = encoder.encode('a message that fits in one RSA block');
    const label = encoder.encode('label');

    const cases: Array<{ padding: number; oaepHash?: string; oaepLabel?: Uint8Array }> = [
      { padding: nodeConstants.RSA_PKCS1_OAEP_PADDING },
      { padding: nodeConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      { padding: nodeConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha384', oaepLabel: label },
      { padding: nodeConstants.RSA_PKCS1_PADDING },
    ];

    for (const options of cases) {
      const name = JSON.stringify({ padding: options.padding, oaepHash: options.oaepHash, label: !!options.oaepLabel });

      // Ours -> Node's decrypter.
      const oursCiphertext = publicEncrypt({ key: pair.publicKey, ...options }, secret);
      expect(
        new Uint8Array(nodePrivateDecrypt({ key: pair.nodePrivate as never, ...options } as never, oursCiphertext as never)),
        `ours->node ${name}`,
      ).toEqual(secret);

      // Node's encrypter -> ours.
      const theirs = nodePublicEncrypt({ key: pair.nodePublic as never, ...options } as never, secret as never);
      expect(
        privateDecrypt({ key: pair.privateKey, ...options }, new Uint8Array(theirs)),
        `node->ours ${name}`,
      ).toEqual(secret);
    }
  });

  it('keeps the pure-JS engine byte-compatible where the output is deterministic', () => {
    // PKCS#1 signature padding has no randomness, so both engines — and Node —
    // must produce the same signature for the same key and message.
    const pair = makePair('rsa', { modulusLength: 2048 }, 'openssl');
    const spec: Spec = { hash: 'sha256', padding: nodeConstants.RSA_PKCS1_PADDING };
    const fromWasm = sign(ours(spec), MESSAGE, pair.privateKey);
    const fromJs = withJsEngine(() => sign(ours(spec), MESSAGE, pair.privateKey));
    const fromNode = new Uint8Array(nodeSign('sha256', MESSAGE, nodeKey(spec, pair.nodePrivate) as never));
    expect(fromWasm).toEqual(fromJs);
    expect(fromWasm).toEqual(fromNode);
  });

  it('generates usable keys on both engines', () => {
    for (const engine of ['openssl', 'js'] as const) {
      for (const [type, options] of [
        ['ed25519', {}],
        ['ec', { namedCurve: 'prime256v1' }],
        ['rsa', { modulusLength: 2048 }],
      ] as Array<[string, Record<string, unknown>]>) {
        const pair = makePair(type, options, engine);
        // Node must be able to import what we generated, and sign with it.
        const spec: Spec = type === 'ed25519' ? {} : { hash: 'sha256' };
        const signature = new Uint8Array(
          nodeSign(spec.hash ?? (null as never), MESSAGE, nodeKey(spec, pair.nodePrivate) as never),
        );
        expect(verify(ours(spec), MESSAGE, pair.publicKey, signature), `${engine} ${type}`).toBe(true);
      }
    }
  });

  it('agrees with Node on ECDH and DH shared secrets', () => {
    // ECDH secrets are deterministic, so both engines and Node must agree byte
    // for byte; DH secrets likewise once the private exponents are pinned.
    for (const namedCurve of ['prime256v1', 'secp384r1', 'secp521r1']) {
      const alice = makePair('ec', { namedCurve }, 'openssl');
      const bob = makePair('ec', { namedCurve }, 'openssl');

      const ab = diffieHellman({
        privateKey: createPrivateKey(alice.privateKey),
        publicKey: createPublicKey(bob.publicKey),
      });
      const ba = diffieHellman({
        privateKey: createPrivateKey(bob.privateKey),
        publicKey: createPublicKey(alice.publicKey),
      });
      expect(ab, `${namedCurve} symmetric`).toEqual(ba);
      expect(ab, `${namedCurve} js engine`).toEqual(
        withJsEngine(() =>
          diffieHellman({
            privateKey: createPrivateKey(alice.privateKey),
            publicKey: createPublicKey(bob.publicKey),
          }),
        ),
      );
      expect(ab, `${namedCurve} node`).toEqual(
        new Uint8Array(
          nodeDiffieHellman({
            privateKey: nodeCreatePrivateKey(alice.privateKey),
            publicKey: nodeCreatePublicKey(bob.publicKey),
          } as never),
        ),
      );
    }

    // A DH pair over an OpenSSL-generated (well, Node-generated) group.
    const dh = nodeGenerateKeyPairSync('dh', {
      group: 'modp14',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    } as never);
    const alice = nodeGenerateKeyPairSync('dh', {
      group: 'modp14',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    } as never);
    const ours = diffieHellman({
      privateKey: createPrivateKey(dh.privateKey as never as string),
      publicKey: createPublicKey(alice.publicKey as never as string),
    });
    const theirs = new Uint8Array(
      nodeDiffieHellman({ privateKey: dh.privateKey, publicKey: alice.publicKey } as never),
    );
    expect(ours).toEqual(theirs);
  });

  it('generates DH keys on every group Node knows, interoperating with Node', () => {
    // A named group is the same request as its prime with g = 2, so all eight
    // flow through one OpenSSL entry point. The private exponent is random, so
    // the evidence is interoperation: Node must import our keys and land on the
    // same shared secret, and vice versa.
    for (const group of ['modp1', 'modp2', 'modp5', 'modp14', 'modp15', 'modp16', 'modp17', 'modp18']) {
      const ours = makePair('dh', { group }, 'openssl');
      const theirs = nodeGenerateKeyPairSync('dh', {
        group,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      } as never) as unknown as { privateKey: string; publicKey: string };

      const ab = diffieHellman({
        privateKey: createPrivateKey(ours.privateKey),
        publicKey: createPublicKey(theirs.publicKey),
      });
      const ba = new Uint8Array(
        nodeDiffieHellman({
          privateKey: nodeCreatePrivateKey(theirs.privateKey),
          publicKey: nodeCreatePublicKey(ours.publicKey),
        } as never),
      );
      expect(ab, `${group} shared secret`).toEqual(ba);

      // The only variable-length field is the private exponent, and OpenSSL
      // caps it at the group's own private-key length, so the encodings can
      // differ only by that INTEGER's sign octet.
      const oursLen = (createPrivateKey(ours.privateKey).export({ type: 'pkcs8', format: 'der' }) as Uint8Array).length;
      const theirsLen = (
        nodeCreatePrivateKey(theirs.privateKey).export({ type: 'pkcs8', format: 'der' }) as Uint8Array
      ).length;
      expect(Math.abs(oursLen - theirsLen), `${group} private DER length`).toBeLessThanOrEqual(1);
    }
  });

  it('generates DH keys from explicit prime and generator', () => {
    // Node hands OpenSSL the prime and g = 2 for a named group too, so this is
    // the same code path with the parameters spelled out.
    // `createDiffieHellman('modp14')` hands back the group *name* from
    // `getPrime()`; `getDiffieHellman` hands back the real prime.
    const reference = nodeGetDiffieHellman('modp14');
    const prime = reference.getPrime() as unknown as Uint8Array;
    // `generator` is a number in Node's keygen options, not a byte string.
    const generator = (reference.getGenerator() as unknown as Uint8Array)[0];

    const ours = makePair('dh', { prime, generator }, 'openssl');
    const theirs = nodeGenerateKeyPairSync('dh', {
      prime,
      generator,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    } as never) as unknown as { privateKey: string; publicKey: string };

    expect(
      diffieHellman({
        privateKey: createPrivateKey(ours.privateKey),
        publicKey: createPublicKey(theirs.publicKey),
      }),
    ).toEqual(
      new Uint8Array(
        nodeDiffieHellman({
          privateKey: nodeCreatePrivateKey(theirs.privateKey),
          publicKey: nodeCreatePublicKey(ours.publicKey),
        } as never),
      ),
    );
  });

  it('generates a fresh safe prime for `primeLength`, agreeing with Node', () => {
    // OpenSSL keygen only keys an *existing* group, so `primeLength` asks its
    // safe-prime generator for parameters first. Both sides fix the size of p
    // (and so of the exponent OpenSSL draws), which makes the encodings
    // comparable rather than merely interoperable.
    const ours = makePair('dh', { primeLength: 512 }, 'openssl');
    const theirs = nodeGenerateKeyPairSync('dh', {
      primeLength: 512,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    } as never) as unknown as { privateKey: string; publicKey: string };
    const ourPrivate = nodeCreatePrivateKey(ours.privateKey);
    const theirPrivate = nodeCreatePrivateKey(theirs.privateKey);
    expect(ourPrivate.asymmetricKeyType).toBe('dh');
    expect((ourPrivate.export({ type: 'pkcs8', format: 'der' }) as Uint8Array).length).toBe(
      (theirPrivate.export({ type: 'pkcs8', format: 'der' }) as Uint8Array).length,
    );
    // Node reads the same public key out of our private key, so parameters and
    // key agree.
    expect(hex(nodeCreatePublicKey(ourPrivate).export({ type: 'spki', format: 'der' }) as Uint8Array)).toBe(
      hex(nodeCreatePublicKey(ours.publicKey).export({ type: 'spki', format: 'der' }) as Uint8Array),
    );
  });

  it('refuses an undersized `primeLength` exactly as Node does', () => {
    // The 512-bit floor is OpenSSL's `DH_MIN_MODULUS_BITS`, and the error is a
    // `DH`-library one, so the code only matches if the library name survives
    // the trip out of the wasm module.
    for (const primeLength of [0, 256, 511, 512.5, -1]) {
      const thrownBy = (fn: () => unknown): { name?: string; code?: string; message: string } | null => {
        try {
          fn();
          return null;
        } catch (error) {
          return error as { name?: string; code?: string; message: string };
        }
      };
      const nodeError = thrownBy(() => nodeGenerateKeyPairSync('dh', { primeLength } as never));
      const ourError = thrownBy(() =>
        generateKeyPairSync('dh', {
          primeLength,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        } as never),
      );
      expect(nodeError, `primeLength ${primeLength} node throws`).not.toBeNull();
      expect(ourError, `primeLength ${primeLength} ours throws`).not.toBeNull();
      expect(ourError!.name, `primeLength ${primeLength} name`).toBe(nodeError!.name);
      expect(ourError!.code, `primeLength ${primeLength} code`).toBe(nodeError!.code);
      expect(ourError!.message, `primeLength ${primeLength} message`).toBe(nodeError!.message);
    }
  });

  it('rejects the same DH option combinations Node rejects', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['missing everything', {}],
      ['group and prime', { group: 'modp14', prime: new Uint8Array(1) }],
      ['group and primeLength', { group: 'modp14', primeLength: 512 }],
      ['group and generator', { group: 'modp14', generator: 5 }],
      ['prime and primeLength', { prime: new Uint8Array(1), primeLength: 512 }],
      ['unknown group', { group: 'modp99' }],
    ];
    for (const [label, options] of cases) {
      const thrownBy = (fn: () => unknown): { code?: string; message: string } | null => {
        try {
          fn();
          return null;
        } catch (error) {
          return error as { code?: string; message: string };
        }
      };
      const nodeError = thrownBy(() => nodeGenerateKeyPairSync('dh', options as never));
      const ourError = thrownBy(() =>
        generateKeyPairSync('dh', {
          ...options,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        } as never),
      );
      expect(nodeError, `${label} node throws`).not.toBeNull();
      expect(ourError, `${label} ours throws`).not.toBeNull();
      expect(ourError!.code, `${label} code`).toBe(nodeError!.code);
      expect(ourError!.message, `${label} message`).toBe(nodeError!.message);
    }
  });

  it('generates ML-KEM keys on the wasm engine, interoperating with Node', () => {
    for (const type of ['ml-kem-512', 'ml-kem-768', 'ml-kem-1024']) {
      const ours = makePair(type, {}, 'openssl');
      const nodePrivate = nodeCreatePrivateKey(ours.privateKey);
      expect(nodePrivate.asymmetricKeyType, `${type} type`).toBe(type);

      // Node emits the seed form of PKCS#8 (a 66-byte inner payload; 86 bytes in
      // all), and OpenSSL's default is the seed-and-expanded form. Our parse has
      // to read both; our encoder writes the seed form, which both accept.
      const privateDer = createPrivateKey(ours.privateKey).export({ type: 'pkcs8', format: 'der' }) as Uint8Array;
      const nodePrivateDer = nodePrivate.export({ type: 'pkcs8', format: 'der' }) as Uint8Array;
      expect(privateDer.length, `${type} pkcs8 length`).toBe(nodePrivateDer.length);
      const handle = opensslPkeyFromDer(privateDer, true);
      expect(handle, `${type} openssl import`).toBeGreaterThan(0);
      opensslPkeyFree(handle);

      // Encapsulate against our key, decapsulate with Node; then the reverse.
      const { sharedKey, ciphertext } = encapsulate(ours.publicKey);
      expect(
        new Uint8Array(nodeDecapsulate(nodePrivate, ciphertext as never) as never),
        `${type} ours->node`,
      ).toEqual(sharedKey);
      const theirs = nodeEncapsulate(nodeCreatePublicKey(ours.publicKey));
      expect(decapsulate(ours.privateKey, new Uint8Array(theirs.ciphertext as never)), `${type} node->ours`).toEqual(
        new Uint8Array(theirs.sharedKey as never),
      );
    }
  });

  it('agrees with Node on ML-KEM encapsulation', () => {
    for (const type of ['ml-kem-512', 'ml-kem-768', 'ml-kem-1024']) {
      const { privateKey, publicKey } = generateKeyPairSync(type, {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      } as never) as unknown as { privateKey: string; publicKey: string };

      // Ours -> ours.
      const { sharedKey, ciphertext } = encapsulate(publicKey);
      expect(decapsulate(privateKey, ciphertext), `${type} round trip`).toEqual(sharedKey);

      // Ours -> Node's decapsulator, and Node's encapsulation -> ours.
      expect(
        new Uint8Array(
          nodeDecapsulate(nodeCreatePrivateKey(privateKey), ciphertext as never) as never,
        ),
        `${type} ours->node`,
      ).toEqual(sharedKey);
      const theirs = nodeEncapsulate(nodeCreatePublicKey(publicKey));
      expect(
        decapsulate(privateKey, new Uint8Array(theirs.ciphertext as never)),
        `${type} node->ours`,
      ).toEqual(new Uint8Array(theirs.sharedKey as never));

      // The pure-JS engine must agree with the wasm one for the same input.
      expect(withJsEngine(() => decapsulate(privateKey, ciphertext)), `${type} js`).toEqual(sharedKey);

      // A truncated ciphertext is rejected the same way Node rejects it.
      expect(() => decapsulate(privateKey, ciphertext.subarray(0, ciphertext.length - 1))).toThrow(
        /Decapsulation failed/,
      );
    }
  });

  it('hands OpenSSL the DER it accepts, so the routes are really taken', () => {
    // Our own `export({ format: 'der' })` runs the same encoders the routing
    // hands to `wn_pkey_from_der`; if OpenSSL could not import them the code
    // would silently fall back to JS for every operation.
    for (const [type, options] of [
      ['ed25519', {}],
      ['ec', { namedCurve: 'prime256v1' }],
      ['rsa', { modulusLength: 2048 }],
      ['ml-kem-768', {}],
      ['dh', { group: 'modp14' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const pair = makePair(type, options, 'openssl');
      const privateDer = createPrivateKey(pair.privateKey).export({
        type: 'pkcs8',
        format: 'der',
      }) as Uint8Array;
      const publicDer = createPublicKey(pair.publicKey).export({
        type: 'spki',
        format: 'der',
      }) as Uint8Array;
      const privateHandle = opensslPkeyFromDer(privateDer, true);
      const publicHandle = opensslPkeyFromDer(publicDer, false);
      expect(privateHandle, `${type} private DER`).toBeGreaterThan(0);
      expect(publicHandle, `${type} public DER`).toBeGreaterThan(0);
      opensslPkeyFree(privateHandle);
      opensslPkeyFree(publicHandle);
    }
  });

  it('decapsulates ML-KEM on the wasm engine, agreeing with the pure-JS implementation', () => {
    // OpenSSL's *raw* private key for ML-KEM is the expanded `dk` (the seed is
    // only reachable through PKCS#8, which the routing test above covers), so
    // round-trip through `dk` and check it matches our own FIPS 203 code.
    const seed = new Uint8Array(64);
    globalThis.crypto.getRandomValues(seed);
    for (const param of ['ml-kem-512', 'ml-kem-768', 'ml-kem-1024'] as const) {
      const { ek, dk } = mlKemExpandSeed(seed, param);
      const publicHandle = opensslPkeyFromRaw(param.toUpperCase(), ek, false);
      const privateHandle = opensslPkeyFromRaw(param.toUpperCase(), dk, true);
      expect(publicHandle, `${param} public`).toBeGreaterThan(0);
      expect(privateHandle, `${param} private`).toBeGreaterThan(0);
      try {
        const encapsulated = opensslPkeyEncapsulate(publicHandle);
        expect(encapsulated, `${param} encapsulate`).not.toBeNull();
        const { ciphertext, sharedKey } = encapsulated!;
        expect(opensslPkeyDecapsulate(privateHandle, ciphertext), `${param} decapsulate`).toEqual(sharedKey);
        // The same ciphertext through the pure-JS decapsulator.
        expect(mlKemDecapsulate(dk, ciphertext, param), `${param} js`).toEqual(sharedKey);
      } finally {
        opensslPkeyFree(privateHandle);
        opensslPkeyFree(publicHandle);
      }
    }
  });
});
