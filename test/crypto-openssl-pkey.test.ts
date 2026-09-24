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
