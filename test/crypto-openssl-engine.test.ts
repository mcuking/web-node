/**
 * The OpenSSL cipher/KDF engine (M119) — where it stands and what it promises.
 *
 * `wn_openssl` is loaded whenever the artifact is present (production routes
 * `crypto` here once the background load lands), so the interesting question is
 * not "does it run" but "is it the same runtime?". These tests answer that by
 * driving the *same* operations through both engines — the wasm OpenSSL subset
 * and the pure-JS implementation it replaced — and asserting they agree byte for
 * byte, including on the errors. Everything is additionally pinned against this
 * process's own `node:crypto`, which is OpenSSL 3.5.8 too.
 */
import { describe, expect, it, afterAll } from 'vitest';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  pbkdf2Sync,
  scryptSync,
} from 'node:crypto';
import {
  opensslCipherInfo,
  opensslReady,
  setOpensslEnabled,
} from '../src/node-runtime/bindings/openssl';
import { createCipher, resolveCipher, type CipherSpec } from '../src/node-runtime/crypto/cipher';
import { opensslCipherName } from '../src/node-runtime/crypto/openssl-cipher';
import { hkdf, pbkdf2, scrypt, resolveHash } from '../src/node-runtime/crypto/hash';

afterAll(() => setOpensslEnabled(true));

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Run `fn` with the wasm engine off, so `createCipher` uses the pure-JS path. */
function withJsEngine<T>(fn: () => T): T {
  setOpensslEnabled(false);
  try {
    return fn();
  } finally {
    setOpensslEnabled(true);
  }
}

/** Run `fn` with the wasm engine on. */
function withWasmEngine<T>(fn: () => T): T {
  setOpensslEnabled(true);
  return fn();
}

interface Case {
  name: string;
  keyLength: number;
  iv: Uint8Array | null;
  /** Extra `createCipheriv` options (AEAD tag length, CCM plaintext length). */
  options?: { authTagLength?: number };
  /** AAD for the AEAD cases. */
  aad?: Uint8Array;
  plaintext: Uint8Array;
}

const KEY: Record<number, Uint8Array> = {
  16: Uint8Array.from({ length: 16 }, (_, i) => i),
  24: Uint8Array.from({ length: 24 }, (_, i) => i + 1),
  32: Uint8Array.from({ length: 32 }, (_, i) => i + 2),
  48: Uint8Array.from({ length: 48 }, (_, i) => i + 3),
  64: Uint8Array.from({ length: 64 }, (_, i) => i + 4),
};
const IV16 = encoder.encode('0123456789abcdef');
const IV12 = encoder.encode('0123456789ab');
const IV8 = encoder.encode('01234567');

/** One representative case per mode, sized to exercise padding and tails. */
const CASES: Case[] = [
  { name: 'aes-128-ecb', keyLength: 16, iv: null, plaintext: encoder.encode('block-aligned!!!') },
  { name: 'aes-128-cbc', keyLength: 16, iv: IV16, plaintext: encoder.encode('a plaintext that is not aligned') },
  { name: 'aes-192-ctr', keyLength: 24, iv: IV16, plaintext: encoder.encode('ctr keeps the length') },
  { name: 'aes-256-cfb', keyLength: 32, iv: IV16, plaintext: encoder.encode('cfb mode payload') },
  { name: 'aes-128-ofb', keyLength: 16, iv: IV16, plaintext: encoder.encode('ofb mode payload') },
  { name: 'aes-128-cfb8', keyLength: 16, iv: IV16, plaintext: encoder.encode('cfb8 mode payload') },
  {
    name: 'aes-128-gcm',
    keyLength: 16,
    iv: IV12,
    options: { authTagLength: 16 },
    aad: encoder.encode('additional data'),
    plaintext: encoder.encode('gcm payload'),
  },
  {
    name: 'chacha20-poly1305',
    keyLength: 32,
    iv: IV12,
    options: { authTagLength: 16 },
    aad: encoder.encode('associated'),
    plaintext: encoder.encode('poly1305 payload'),
  },
  { name: 'des-ede3-cbc', keyLength: 24, iv: IV8, plaintext: encoder.encode('des3 payload that pads') },
  { name: 'camellia-128-cbc', keyLength: 16, iv: IV16, plaintext: encoder.encode('camellia payload') },
  { name: 'aria-192-ofb', keyLength: 24, iv: IV16, plaintext: encoder.encode('aria payload') },
  { name: 'sm4-ctr', keyLength: 16, iv: IV16, plaintext: encoder.encode('sm4 payload') },
  { name: 'aes-128-cbc-cts', keyLength: 16, iv: IV16, plaintext: encoder.encode('a payload that needs stealing now') },
];

/** Encrypt + decrypt `spec` (OpenSSL) and return the hex pair for comparison. */
function roundTrip(spec: CipherSpec, testCase: Case, useWasm: boolean): string {
  const run = useWasm ? withWasmEngine : withJsEngine;
  return run(() => {
    // CTS/XTS/wrap/SIV accept a single `update`, so chunking only where Node does.
    const oneShot = ['cts', 'xts', 'wrap', 'siv'].some((marker) => testCase.name.includes(marker));
    const key = KEY[testCase.keyLength];
    const cipher = createCipher(spec, key, testCase.iv, true, testCase.options?.authTagLength ?? 16);
    let tag: Uint8Array = new Uint8Array(0);
    const parts: Uint8Array[] = [];
    if (testCase.aad) cipher.setAAD(testCase.aad, { plaintextLength: testCase.plaintext.length });
    if (oneShot) {
      parts.push(cipher.update(testCase.plaintext));
    } else {
      parts.push(cipher.update(testCase.plaintext.subarray(0, 5)));
      parts.push(cipher.update(testCase.plaintext.subarray(5)));
    }
    parts.push(cipher.final());
    const isAead = testCase.name.includes('gcm') || testCase.name.includes('poly1305');
    if (isAead) tag = cipher.getAuthTag();

    const decipher = createCipher(spec, key, testCase.iv, false, testCase.options?.authTagLength ?? 16);
    if (testCase.aad) decipher.setAAD(testCase.aad, { plaintextLength: testCase.plaintext.length });
    if (isAead) decipher.setAuthTag(tag);
    const ct = concat(parts);
    const plain: Uint8Array[] = [decipher.update(ct), decipher.final()];
    return `${hex(ct)}|${hex(tag)}|${hex(concat(plain))}`;
  });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `createCipheriv` from `node:crypto`, the same shape the probes use. */
function nodeRoundTrip(testCase: Case): string {
  const key = KEY[testCase.keyLength];
  const iv = testCase.iv;
  const options = testCase.options?.authTagLength ? { authTagLength: testCase.options.authTagLength } : undefined;
  const isAead = testCase.name.includes('gcm') || testCase.name.includes('poly1305');
  const oneShot = ['cts', 'xts', 'wrap', 'siv'].some((marker) => testCase.name.includes(marker));
  const cipher = createCipheriv(testCase.name, key, iv, options);
  if (testCase.aad) cipher.setAAD(testCase.aad, { plaintextLength: testCase.plaintext.length });
  const ct = concat(oneShot ? [cipher.update(testCase.plaintext), cipher.final()] : [cipher.update(testCase.plaintext), cipher.final()]);
  const tag = isAead ? cipher.getAuthTag() : new Uint8Array(0);
  const decipher = createDecipheriv(testCase.name, key, iv, options);
  if (testCase.aad) decipher.setAAD(testCase.aad, { plaintextLength: testCase.plaintext.length });
  if (isAead) decipher.setAuthTag(tag);
  const plain = concat([decipher.update(ct), decipher.final()]);
  return `${hex(ct)}|${hex(tag)}|${hex(plain)}`;
}

describe('wn_openssl cipher engine', () => {
  it('is loaded in the test environment', () => {
    expect(opensslReady()).toBe(true);
  });

  it('resolves the OpenSSL name for every mode we route through wasm', () => {
    const expected: Array<[string, string]> = [
      ['aes-128-cbc', 'AES-128-CBC'],
      ['aes-256-gcm', 'AES-256-GCM'],
      ['aes-128-ccm', 'AES-128-CCM'],
      ['aes-128-ocb', 'AES-128-OCB'],
      ['aes-128-xts', 'AES-128-XTS'],
      ['aes-128-siv', 'AES-128-SIV'],
      ['aes-128-gcm-siv', 'AES-128-GCM-SIV'],
      ['aes-128-cbc-cts', 'AES-128-CBC-CTS'],
      ['aes-128-wrap', 'AES-128-WRAP'],
      ['des3-wrap', 'DES3-WRAP'],
      ['chacha20-poly1305', 'CHACHA20-POLY1305'],
      ['sm4-ctr', 'SM4-CTR'],
      ['camellia-192-cbc', 'CAMELLIA-192-CBC'],
      ['aria-256-gcm', 'ARIA-256-GCM'],
    ];
    for (const [nodeName, opensslName] of expected) {
      const spec = resolveCipher(nodeName);
      expect(spec, nodeName).toBeDefined();
      expect(opensslCipherName(spec!), nodeName).toBe(opensslName);
    }
    // A name OpenSSL does not know stays unresolved, so `createCipher` keeps JS.
    expect(opensslCipherInfo('NOT-A-CIPHER')).toBeNull();
  });

  it('encrypts and decrypts identically through both engines and Node', () => {
    for (const testCase of CASES) {
      const spec = resolveCipher(testCase.name)!;
      const fromWasm = roundTrip(spec, testCase, true);
      const fromJs = roundTrip(spec, testCase, false);
      expect(fromWasm, `${testCase.name} (wasm vs js)`).toBe(fromJs);
      expect(fromWasm, `${testCase.name} (vs node)`).toBe(nodeRoundTrip(testCase));
    }
  });

  it('agrees with Node on the AEAD failure it reports, per engine', () => {
    const spec = resolveCipher('aes-128-gcm')!;
    const key = KEY[16];
    const produce = (useWasm: boolean) => {
      const run = useWasm ? withWasmEngine : withJsEngine;
      return run(() => {
        const cipher = createCipher(spec, key, IV12, true, 16);
        cipher.setAAD(encoder.encode('aad'));
        const ct = concat([cipher.update(encoder.encode('plain')), cipher.final()]);
        const tag = cipher.getAuthTag();
        const decipher = createCipher(spec, key, IV12, false, 16);
        decipher.setAAD(encoder.encode('aad'));
        const tampered = tag.slice();
        tampered[0] ^= 1;
        decipher.setAuthTag(tampered);
        try {
          concat([decipher.update(ct), decipher.final()]);
          return 'no-throw';
        } catch (error) {
          const e = error as { message?: string; code?: string };
          return `${e.message}|${e.code}`;
        }
      });
    };
    expect(produce(true)).toBe(produce(false));
    expect(produce(true)).toBe('Unsupported state or unable to authenticate data|undefined');
  });
});

describe('wn_openssl KDF engine', () => {
  const password = encoder.encode('correct horse battery staple');
  const salt = encoder.encode('a salt for stretching');

  it('matches Node for PBKDF2 through both engines', () => {
    const sha256 = resolveHash('sha256')!;
    for (const [iterations, keylen] of [
      [1, 16],
      [1000, 32],
      [2500, 40],
    ] as Array<[number, number]>) {
      const expected = hex(withWasmEngine(() => pbkdf2(sha256, password, salt, iterations, keylen)));
      expect(expected, `wasm ${iterations}`).toBe(
        hex(pbkdf2Sync(password, salt, iterations, keylen, 'sha256')),
      );
      expect(hex(withJsEngine(() => pbkdf2(sha256, password, salt, iterations, keylen))), `js ${iterations}`).toBe(
        expected,
      );
    }
  });

  it('matches Node for HKDF through both engines', () => {
    const sha512 = resolveHash('sha512')!;
    const info = encoder.encode('context');
    for (const keylen of [16, 42]) {
      const expected = hex(withWasmEngine(() => hkdf(sha512, password, salt, info, keylen)));
      expect(expected, `wasm ${keylen}`).toBe(
        hex(new Uint8Array(hkdfSync('sha512', password, salt, info, keylen))),
      );
      expect(hex(withJsEngine(() => hkdf(sha512, password, salt, info, keylen))), `js ${keylen}`).toBe(expected);
    }
  });

  it('matches Node for scrypt through both engines', () => {
    const params = { N: 1024, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
    for (const keylen of [32, 64]) {
      const expected = hex(withWasmEngine(() => scrypt(password, salt, keylen, params)));
      expect(expected, `wasm ${keylen}`).toBe(
        hex(
          scryptSync(password, salt, keylen, {
            N: params.N,
            r: params.r,
            p: params.p,
            maxmem: params.maxmem,
          }),
        ),
      );
      expect(hex(withJsEngine(() => scrypt(password, salt, keylen, params))), `js ${keylen}`).toBe(expected);
    }
  });
});
