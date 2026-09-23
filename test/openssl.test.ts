/**
 * `wn_openssl` — the wasi-built OpenSSL subset (M119).
 *
 * The module is linked against `libcrypto.a` that OpenSSL's own
 * `Configure`/`make` produced for `wasm32-wasip1` (see `native/build.mjs` and
 * `native/openssl/99-wasi.conf`). These tests pin two things:
 *
 *  1. the ABI works at all (version, alloc, one-shot + streaming digests, HMAC);
 *  2. it is **byte-identical to Node** — every value is compared against this
 *     process's own `node:crypto`, which is OpenSSL 3.5.8 too.
 *
 * `test/setup-wasm.ts` installs every committed artifact, so `wn_openssl` is
 * ready here and `crypto/hash.ts` routes digests through it (asserted below via
 * `hashEngine`).
 */
import { describe, expect, it } from 'vitest';
import { createHash, createHmac, getHashes } from 'node:crypto';

/** `process.versions`, reached without `@types/node` (tsconfig has `types: []`). */
const hostVersions = (globalThis as { process?: { versions?: Record<string, string> } }).process
  ?.versions as Record<string, string>;
import {
  opensslDigest,
  opensslDigestSize,
  opensslHmac,
  opensslReady,
  opensslVersion,
} from '../src/node-runtime/bindings/openssl';
import { hashEngine, resolveHash } from '../src/node-runtime/crypto/hash';

/** The digests the subset must provide, with their OpenSSL fetch names. */
const DIGESTS: Array<[node: string, openssl: string]> = [
  ['md5', 'MD5'],
  ['sha1', 'SHA1'],
  ['sha224', 'SHA2-224'],
  ['sha256', 'SHA2-256'],
  ['sha384', 'SHA2-384'],
  ['sha512', 'SHA2-512'],
  ['sha3-256', 'SHA3-256'],
  ['sha3-512', 'SHA3-512'],
  ['keccak-256', 'KECCAK-256'],
  ['blake2b512', 'BLAKE2B-512'],
  ['blake2s256', 'BLAKE2S-256'],
  ['sm3', 'SM3'],
  ['ripemd160', 'RIPEMD160'],
  ['md5-sha1', 'MD5-SHA1'],
];

const encoder = new TextEncoder();
/** Mixed sizes, including the empty input and non-block-aligned tails. */
const INPUTS = [new Uint8Array(0), new Uint8Array([0]), encoder.encode('abc'), encoder.encode('x'.repeat(55)), encoder.encode('y'.repeat(64)), encoder.encode('z'.repeat(1000))];

describe('wn_openssl binding', () => {
  it('is installed and reports the same OpenSSL version as Node', () => {
    expect(opensslReady()).toBe(true);
    // `process.versions.openssl` is e.g. "3.5.8"; version_num packs it as
    // 0xMNNFFPPS (major << 28 | minor << 20 | fix << 12 | patch << 4 | status).
    const [, major, minor, patch] = /^(\d+)\.(\d+)\.(\d+)/.exec(
      hostVersions.openssl,
    ) as RegExpExecArray;
    expect(opensslVersion()).toBe(
      ((Number(major) << 28) | (Number(minor) << 20) | (Number(patch) << 4)) >>> 0,
    );
  });

  it('reports digest sizes, and -1 for anything OpenSSL does not know', () => {
    for (const [nodeName, opensslName] of DIGESTS) {
      expect(opensslDigestSize(opensslName), opensslName).toBe(
        createHash(nodeName).update('').digest().length,
      );
    }
    expect(opensslDigestSize('NOT-A-DIGEST')).toBe(-1);
  });

  it('digests byte-for-byte like Node', () => {
    for (const [nodeName, opensslName] of DIGESTS) {
      for (const input of INPUTS) {
        const expected = createHash(nodeName).update(input).digest();
        expect(opensslDigest(opensslName, input), `${nodeName} ${input.length}B`).toEqual(
          new Uint8Array(expected),
        );
      }
    }
  });

  it('stretches XOF output to any length', () => {
    const input = encoder.encode('xof input');
    for (const name of ['SHAKE-128', 'SHAKE-256'] as const) {
      const nodeName = name === 'SHAKE-128' ? 'shake128' : 'shake256';
      for (const length of [1, 16, 32, 200]) {
        const expected = createHash(nodeName, { outputLength: length }).update(input).digest();
        expect(opensslDigest(name, input, length)).toEqual(new Uint8Array(expected));
      }
    }
  });

  it('HMACs byte-for-byte like Node', () => {
    const keys = [new Uint8Array(0), encoder.encode('key'), encoder.encode('k'.repeat(200))];
    for (const [nodeName, opensslName] of DIGESTS) {
      if (nodeName === 'md5-sha1') continue; // HMAC-MD5-SHA1 is not a thing
      for (const key of keys) {
        const data = encoder.encode('message in a bottle');
        const expected = createHmac(nodeName, key).update(data).digest();
        expect(opensslHmac(opensslName, key, data), `${nodeName} key ${key.length}B`).toEqual(
          new Uint8Array(expected),
        );
      }
    }
  });

  it('returns null (never a wrong answer) for an unknown algorithm', () => {
    expect(opensslDigest('NOT-A-DIGEST', encoder.encode('x'))).toBeNull();
    expect(opensslHmac('NOT-A-DIGEST', encoder.encode('k'), encoder.encode('x'))).toBeNull();
  });

  it('routes crypto/hash digests through OpenSSL once it is ready', () => {
    for (const [nodeName, opensslName] of DIGESTS) {
      expect(hashEngine(nodeName), `${nodeName} -> ${opensslName}`).toBe('openssl');
    }
    // KMAC has no digest analogue: it must stay on the pure-JS path.
    expect(hashEngine('keccak-kmac-128')).toBe('js');
    expect(hashEngine('not-a-hash')).toBe('unknown');
    // …and the engine swap must not change a single byte: the wasm-backed
    // `hash` must equal what this process's own OpenSSL produces.
    for (const [nodeName] of DIGESTS) {
      const data = encoder.encode('engine parity');
      const algo = resolveHash(nodeName);
      expect(algo, nodeName).toBeDefined();
      expect(algo?.hash(data), nodeName).toEqual(
        new Uint8Array(createHash(nodeName).update(data).digest()),
      );
      expect(algo?.digestSize).toBe(createHash(nodeName).update('').digest().length);
    }
  });

  it('keeps every advertised digest working', () => {
    for (const name of getHashes()) {
      expect(() => createHash(name).update('x').digest(), name).not.toThrow();
    }
  });
});
