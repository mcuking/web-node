/**
 * Pure-JS digest / MAC / KDF primitives.
 *
 * The browser ships WebCrypto, but WebCrypto is *asynchronous* — `subtle.digest`
 * returns a promise. Node's `crypto` is overwhelmingly called from synchronous
 * code (`createHash().digest()`, `createHmac`, `pbkdf2Sync`, `scryptSync`, …),
 * so a promise-based shim cannot stand in for it. Every algorithm here is
 * therefore implemented directly against its published specification and is
 * checked against Node's OpenSSL-backed output in `test/crypto.test.ts`.
 *
 * The surface now covers everything OpenSSL exposes that we can implement in
 * plain JS: MD5, SHA-1, SHA-2 (224/256/384/512), SHA-3 and Keccak (224/256/
 * 384/512), the SHAKE/KMAC XOFs, and the OpenSSL spellings around them
 * (`sha256`, `sha-256`, `RSA-SHA256`, `sha256WithRSAEncryption`, ...) through
 * `resolveHash`.
 */

import {
  keccak224,
  keccak256,
  keccak384,
  keccak512,
  keccakKmac,
  sha3_224 as keccakSha3_224,
  sha3_256 as keccakSha3_256,
  sha3_384 as keccakSha3_384,
  sha3_512 as keccakSha3_512,
  shake128,
  shake256,
} from './keccak';
import { blake2b } from './blake2b';
import { blake2s } from './blake2s';
import { sm3 } from './sm3';
import { ripemd160 } from './ripemd160';

export type DigestFn = (bytes: Uint8Array, outputLength?: number) => Uint8Array;

export interface HashAlgo {
  /** Canonical lower-case name (`sha256`). */
  name: string;
  /** HMAC block size in bytes (64 for SHA-1/SHA-2 ≤ 256, 128 for SHA-384/512). */
  blockSize: number;
  /** Digest size in bytes. */
  digestSize: number;
  hash: DigestFn;
  /** Extendable-output function: `digest()` may request any `outputLength`. */
  xof?: boolean;
  /** Output length used when a XOF is finalised without `options.outputLength`. */
  defaultOutputLength?: number;
}

// --- shared helpers ----------------------------------------------------------

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// --- SHA-1 -------------------------------------------------------------------

function sha1(bytes: Uint8Array): Uint8Array {
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const len = bytes.length;
  const withPad = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPad);
  buf.set(bytes);
  buf[len] = 0x80;
  const bitLen = len * 8;
  const view = new DataView(buf.buffer);
  view.setUint32(withPad - 4, bitLen >>> 0, false);
  view.setUint32(withPad - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(80);
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = ((v << 1) | (v >>> 31)) >>> 0;
    }
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
}

// --- SHA-224 / SHA-256 -------------------------------------------------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV256 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const IV224 = new Uint32Array([
  0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha2_32(bytes: Uint8Array, iv: Uint32Array, outBytes: number): Uint8Array {
  const H = new Uint32Array(iv);
  const len = bytes.length;
  const withPad = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPad);
  buf.set(bytes);
  buf[len] = 0x80;
  const bitLen = len * 8;
  const view = new DataView(buf.buffer);
  view.setUint32(withPad - 4, bitLen >>> 0, false);
  view.setUint32(withPad - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(outBytes);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < outBytes / 4; i++) outView.setUint32(i * 4, H[i], false);
  return out;
}

const sha256: DigestFn = (bytes) => sha2_32(bytes, IV256, 32);
const sha224: DigestFn = (bytes) => sha2_32(bytes, IV224, 28);

// --- SHA-384 / SHA-512 -------------------------------------------------------
//
// These run on 64-bit words. A pair of Uint32Array limbs would work, but the
// BigInt core is considerably shorter *and* easier to check against the spec,
// and the extra cost is irrelevant for the payload sizes a browser tab sees.

const MASK64 = (1n << 64n) - 1n;

const K512: bigint[] = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];
const IV512: bigint[] = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const IV384: bigint[] = [
  0xcbbb9d5dc1059ed8n, 0x629a292a367cd507n, 0x9159015a3070dd17n, 0x152fecd8f70e5939n,
  0x67332667ffc00b31n, 0x8eb44a8768581511n, 0xdb0c2e0d64f98fa7n, 0x47b5481dbefa4fa4n,
];

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function readU64(bytes: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[off + i]);
  return v;
}

function writeU64(out: Uint8Array, off: number, value: bigint): void {
  let v = value;
  for (let i = 7; i >= 0; i--) {
    out[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function sha2_64(bytes: Uint8Array, iv: bigint[], outBytes: number): Uint8Array {
  const H = iv.slice();
  const len = bytes.length;
  const withPad = ((len + 17 + 127) >> 7) << 7;
  const buf = new Uint8Array(withPad);
  buf.set(bytes);
  buf[len] = 0x80;
  // 128-bit big-endian bit length. A tab's payload never approaches 2^64 bits,
  // so the high 64 bits are always zero; only the low half is written.
  writeU64(buf, withPad - 8, BigInt(len) * 8n);

  const w = new Array<bigint>(80);
  for (let off = 0; off < withPad; off += 128) {
    for (let i = 0; i < 16; i++) w[i] = readU64(buf, off + i * 8);
    for (let i = 16; i < 80; i++) {
      const s0 = rotr64(w[i - 15], 1n) ^ rotr64(w[i - 15], 8n) ^ (w[i - 15] >> 7n);
      const s1 = rotr64(w[i - 2], 19n) ^ rotr64(w[i - 2], 61n) ^ (w[i - 2] >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K512[i] + w[i]) & MASK64;
      const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64;
      h = g; g = f; f = e; e = (d + t1) & MASK64;
      d = c; c = b; b = a; a = (t1 + t2) & MASK64;
    }
    H[0] = (H[0] + a) & MASK64; H[1] = (H[1] + b) & MASK64;
    H[2] = (H[2] + c) & MASK64; H[3] = (H[3] + d) & MASK64;
    H[4] = (H[4] + e) & MASK64; H[5] = (H[5] + f) & MASK64;
    H[6] = (H[6] + g) & MASK64; H[7] = (H[7] + h) & MASK64;
  }
  const out = new Uint8Array(outBytes);
  for (let i = 0; i < outBytes / 8; i++) writeU64(out, i * 8, H[i]);
  return out;
}

const sha512: DigestFn = (bytes) => sha2_64(bytes, IV512, 64);
const sha384: DigestFn = (bytes) => sha2_64(bytes, IV384, 48);

// --- MD5 ---------------------------------------------------------------------

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;

function md5(bytes: Uint8Array): Uint8Array {
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const len = bytes.length;
  const withPad = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPad);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(withPad - 8, (len * 8) >>> 0, true);
  view.setUint32(withPad - 4, Math.floor((len * 8) / 0x100000000), true);

  for (let off = 0; off < withPad; off += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c; c = b;
      const sum = (a + f + MD5_K[i] + m[g]) >>> 0;
      const rot = MD5_S[i];
      b = (b + ((sum << rot) | (sum >>> (32 - rot)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

// --- algorithm registry ------------------------------------------------------

interface AlgoDef {
  name: string;
  blockSize: number;
  digestSize: number;
  hash: DigestFn;
  aliases: string[];
  xof?: boolean;
  defaultOutputLength?: number;
}

const DEFS: AlgoDef[] = [
  { name: 'md5', blockSize: 64, digestSize: 16, hash: md5, aliases: ['RSA-MD5', 'md5WithRSAEncryption'] },
  { name: 'sha1', blockSize: 64, digestSize: 20, hash: sha1, aliases: ['sha-1', 'sha1WithRSAEncryption', 'RSA-SHA1', 'RSA-SHA1-2'] },
  { name: 'sha224', blockSize: 64, digestSize: 28, hash: sha224, aliases: ['sha-224', 'sha224WithRSAEncryption', 'RSA-SHA224'] },
  { name: 'sha256', blockSize: 64, digestSize: 32, hash: sha256, aliases: ['sha-256', 'sha256WithRSAEncryption', 'RSA-SHA256'] },
  { name: 'sha384', blockSize: 128, digestSize: 48, hash: sha384, aliases: ['sha-384', 'sha384WithRSAEncryption', 'RSA-SHA384'] },
  { name: 'sha512', blockSize: 128, digestSize: 64, hash: sha512, aliases: ['sha-512', 'sha512WithRSAEncryption', 'RSA-SHA512'] },
  // SHA-3 (FIPS 202).
  { name: 'sha3-224', blockSize: 144, digestSize: 28, hash: (b) => keccakSha3_224(b), aliases: ['RSA-SHA3-224', 'id-rsassa-pkcs1-v1_5-with-sha3-224'] },
  { name: 'sha3-256', blockSize: 136, digestSize: 32, hash: (b) => keccakSha3_256(b), aliases: ['RSA-SHA3-256', 'id-rsassa-pkcs1-v1_5-with-sha3-256'] },
  { name: 'sha3-384', blockSize: 104, digestSize: 48, hash: (b) => keccakSha3_384(b), aliases: ['RSA-SHA3-384', 'id-rsassa-pkcs1-v1_5-with-sha3-384'] },
  { name: 'sha3-512', blockSize: 72, digestSize: 64, hash: (b) => keccakSha3_512(b), aliases: ['RSA-SHA3-512', 'id-rsassa-pkcs1-v1_5-with-sha3-512'] },
  // Original Keccak padding (0x01), as exposed by OpenSSL.
  { name: 'keccak-224', blockSize: 144, digestSize: 28, hash: (b) => keccak224(b), aliases: [] },
  { name: 'keccak-256', blockSize: 136, digestSize: 32, hash: (b) => keccak256(b), aliases: [] },
  { name: 'keccak-384', blockSize: 104, digestSize: 48, hash: (b) => keccak384(b), aliases: [] },
  { name: 'keccak-512', blockSize: 72, digestSize: 64, hash: (b) => keccak512(b), aliases: [] },
  // XOFs.
  { name: 'shake128', blockSize: 168, digestSize: 16, hash: (b, n) => shake128(b, n ?? 16), xof: true, defaultOutputLength: 16, aliases: ['shake-128'] },
  { name: 'shake256', blockSize: 136, digestSize: 32, hash: (b, n) => shake256(b, n ?? 32), xof: true, defaultOutputLength: 32, aliases: ['shake-256'] },
  { name: 'keccak-kmac-128', blockSize: 168, digestSize: 32, hash: (b, n) => keccakKmac(128, b, n ?? 32), xof: true, defaultOutputLength: 32, aliases: ['keccak-kmac128'] },
  { name: 'keccak-kmac-256', blockSize: 136, digestSize: 64, hash: (b, n) => keccakKmac(256, b, n ?? 64), xof: true, defaultOutputLength: 64, aliases: ['keccak-kmac256'] },
  // BLAKE2 (unkeyed digests; BLAKE2b block 128, BLAKE2s block 64).
  { name: 'blake2b512', blockSize: 128, digestSize: 64, hash: (b) => blake2b(b, 64), aliases: ['blake2b-512'] },
  { name: 'blake2s256', blockSize: 64, digestSize: 32, hash: (b) => blake2s(b, 32), aliases: ['blake2s-256'] },
  // SM3 and RIPEMD-160.
  { name: 'sm3', blockSize: 64, digestSize: 32, hash: sm3, aliases: ['RSA-SM3', 'sm3WithRSAEncryption'] },
  { name: 'ripemd160', blockSize: 64, digestSize: 20, hash: ripemd160, aliases: ['ripemd', 'ripemd-160', 'rmd160', 'RSA-RIPEMD160', 'ripemd160WithRSA'] },
];

/** Collapse an OpenSSL digest spelling to a bare, alphanumeric tag. */
function normalizeHashName(algorithm: string): string {
  return algorithm
    .toLowerCase()
    .replace(/^rsa-/, '')
    .replace(/withrsaencryption$/, '')
    .replace(/[^a-z0-9]/g, '');
}

const LOOKUP = new Map<string, HashAlgo>();
for (const def of DEFS) {
  const algo: HashAlgo = {
    name: def.name,
    blockSize: def.blockSize,
    digestSize: def.digestSize,
    hash: def.hash,
    xof: def.xof,
    defaultOutputLength: def.defaultOutputLength,
  };
  LOOKUP.set(def.name, algo);
  LOOKUP.set(normalizeHashName(def.name), algo);
  for (const alias of def.aliases) {
    LOOKUP.set(alias.toLowerCase(), algo);
    LOOKUP.set(normalizeHashName(alias), algo);
  }
}

/** Resolve a Node/OpenSSL digest name, or `undefined` when unsupported. */
export function resolveHash(algorithm: unknown): HashAlgo | undefined {
  if (typeof algorithm !== 'string') return undefined;
  return LOOKUP.get(algorithm.toLowerCase()) ?? LOOKUP.get(normalizeHashName(algorithm));
}

/** `crypto.getHashes()` — every digest spelling we can actually compute. */
export function listHashes(): string[] {
  const names = new Set<string>();
  for (const def of DEFS) {
    names.add(def.name);
    for (const alias of def.aliases) names.add(alias);
  }
  return [...names].sort();
}

// --- HMAC --------------------------------------------------------------------

/** RFC 2104 HMAC over any of the digests above. */
export function hmac(algo: HashAlgo, key: Uint8Array, data: Uint8Array): Uint8Array {
  let blockKey = key;
  if (blockKey.length > algo.blockSize) blockKey = algo.hash(blockKey);
  const padded = new Uint8Array(algo.blockSize);
  padded.set(blockKey);

  const inner = new Uint8Array(algo.blockSize + data.length);
  const outer = new Uint8Array(algo.blockSize + algo.digestSize);
  for (let i = 0; i < algo.blockSize; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }
  inner.set(data, algo.blockSize);
  outer.set(algo.hash(inner), algo.blockSize);
  return algo.hash(outer);
}

// --- PBKDF2 ------------------------------------------------------------------

/** RFC 8018 PBKDF2. */
export function pbkdf2(
  algo: HashAlgo,
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keylen: number,
): Uint8Array {
  const hLen = algo.digestSize;
  const blocks = Math.ceil(keylen / hLen);
  const out = new Uint8Array(blocks * hLen);
  const salted = new Uint8Array(salt.length + 4);
  salted.set(salt);

  for (let i = 1; i <= blocks; i++) {
    salted[salt.length] = (i >>> 24) & 0xff;
    salted[salt.length + 1] = (i >>> 16) & 0xff;
    salted[salt.length + 2] = (i >>> 8) & 0xff;
    salted[salt.length + 3] = i & 0xff;
    let u = hmac(algo, password, salted);
    const acc = u.slice();
    for (let j = 1; j < iterations; j++) {
      u = hmac(algo, password, u);
      for (let k = 0; k < hLen; k++) acc[k] ^= u[k];
    }
    out.set(acc, (i - 1) * hLen);
  }
  return out.slice(0, keylen);
}

// --- HKDF --------------------------------------------------------------------

/** RFC 5869 HKDF (extract-then-expand) over any of the digests above. */
export function hkdf(
  algo: HashAlgo,
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  keylen: number,
): Uint8Array {
  const zeroSalt = new Uint8Array(algo.digestSize);
  const prk = hmac(algo, salt.length ? salt : zeroSalt, ikm);

  const blocks = Math.ceil(keylen / algo.digestSize);
  const out = new Uint8Array(blocks * algo.digestSize);
  let t: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < blocks; i++) {
    const input = new Uint8Array(t.length + info.length + 1);
    input.set(t);
    input.set(info, t.length);
    input[input.length - 1] = i + 1;
    t = hmac(algo, prk, input);
    out.set(t, i * algo.digestSize);
  }
  return out.slice(0, keylen);
}

// --- scrypt ------------------------------------------------------------------

const SCRYPT_DEFAULTS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

export interface ScryptOptions {
  N?: number;
  r?: number;
  p?: number;
  maxmem?: number;
}

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** The Salsa20/8 core used by scrypt's BlockMix (RFC 7914). */
function salsa20_8(input: Uint32Array): Uint32Array {
  const x = input.slice();
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= rotl32((x[0] + x[12]) >>> 0, 7); x[8] ^= rotl32((x[4] + x[0]) >>> 0, 9);
    x[12] ^= rotl32((x[8] + x[4]) >>> 0, 13); x[0] ^= rotl32((x[12] + x[8]) >>> 0, 18);
    x[9] ^= rotl32((x[5] + x[1]) >>> 0, 7); x[13] ^= rotl32((x[9] + x[5]) >>> 0, 9);
    x[1] ^= rotl32((x[13] + x[9]) >>> 0, 13); x[5] ^= rotl32((x[1] + x[13]) >>> 0, 18);
    x[14] ^= rotl32((x[10] + x[6]) >>> 0, 7); x[2] ^= rotl32((x[14] + x[10]) >>> 0, 9);
    x[6] ^= rotl32((x[2] + x[14]) >>> 0, 13); x[10] ^= rotl32((x[6] + x[2]) >>> 0, 18);
    x[3] ^= rotl32((x[15] + x[11]) >>> 0, 7); x[7] ^= rotl32((x[3] + x[15]) >>> 0, 9);
    x[11] ^= rotl32((x[7] + x[3]) >>> 0, 13); x[15] ^= rotl32((x[11] + x[7]) >>> 0, 18);

    x[1] ^= rotl32((x[0] + x[3]) >>> 0, 7); x[2] ^= rotl32((x[1] + x[0]) >>> 0, 9);
    x[3] ^= rotl32((x[2] + x[1]) >>> 0, 13); x[0] ^= rotl32((x[3] + x[2]) >>> 0, 18);
    x[6] ^= rotl32((x[5] + x[4]) >>> 0, 7); x[7] ^= rotl32((x[6] + x[5]) >>> 0, 9);
    x[4] ^= rotl32((x[7] + x[6]) >>> 0, 13); x[5] ^= rotl32((x[4] + x[7]) >>> 0, 18);
    x[11] ^= rotl32((x[10] + x[9]) >>> 0, 7); x[8] ^= rotl32((x[11] + x[10]) >>> 0, 9);
    x[9] ^= rotl32((x[8] + x[11]) >>> 0, 13); x[10] ^= rotl32((x[9] + x[8]) >>> 0, 18);
    x[12] ^= rotl32((x[15] + x[14]) >>> 0, 7); x[13] ^= rotl32((x[12] + x[15]) >>> 0, 9);
    x[14] ^= rotl32((x[13] + x[12]) >>> 0, 13); x[15] ^= rotl32((x[14] + x[13]) >>> 0, 18);
  }
  for (let i = 0; i < 16; i++) x[i] = (x[i] + input[i]) >>> 0;
  return x;
}

function readLE32(bytes: Uint8Array, off: number): number {
  return (
    (bytes[off] |
      (bytes[off + 1] << 8) |
      (bytes[off + 2] << 16) |
      (bytes[off + 3] << 24)) >>> 0
  );
}

function writeLE32(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = value & 0xff;
  bytes[off + 1] = (value >>> 8) & 0xff;
  bytes[off + 2] = (value >>> 16) & 0xff;
  bytes[off + 3] = (value >>> 24) & 0xff;
}

function blockMix(input: Uint8Array, r: number): Uint8Array {
  const words = 2 * r;
  const out = new Uint8Array(words * 64);
  const x = new Uint32Array(16);
  let last = (words - 1) * 64;
  for (let i = 0; i < 16; i++) x[i] = readLE32(input, last + i * 4);

  const scratch = new Uint32Array(16);
  for (let i = 0; i < words; i++) {
    for (let k = 0; k < 16; k++) scratch[k] = x[k] ^ readLE32(input, i * 64 + k * 4);
    const mixed = salsa20_8(scratch);
    for (let k = 0; k < 16; k++) x[k] = mixed[k];
    // Y[2k] lands in the first half, Y[2k+1] in the second (RFC 7914 §5).
    const block = (i & 1) === 0 ? i >> 1 : r + (i >> 1);
    for (let k = 0; k < 16; k++) writeLE32(out, block * 64 + k * 4, x[k]);
  }
  return out;
}

function roMix(block: Uint8Array, N: number, r: number): Uint8Array {
  const size = 128 * r;
  const v: Uint8Array[] = new Array(N);
  let x = block;
  for (let i = 0; i < N; i++) {
    v[i] = x;
    x = blockMix(x, r);
  }
  const buffer = new Uint8Array(size);
  for (let i = 0; i < N; i++) {
    const j = readLE32(x, (2 * r - 1) * 64) % N;
    const vj = v[j];
    for (let k = 0; k < size; k++) buffer[k] = x[k] ^ vj[k];
    x = blockMix(buffer, r);
  }
  return x;
}

/**
 * RFC 7914 scrypt. `maxmem` is enforced before allocating so an absurd `N`
 * fails loudly rather than exhausting the tab's memory.
 */
export function scrypt(
  password: Uint8Array,
  salt: Uint8Array,
  keylen: number,
  options: ScryptOptions = {},
): Uint8Array {
  const N = options.N ?? SCRYPT_DEFAULTS.N;
  const r = options.r ?? SCRYPT_DEFAULTS.r;
  const p = options.p ?? SCRYPT_DEFAULTS.p;
  const maxmem = options.maxmem ?? SCRYPT_DEFAULTS.maxmem;
  const sha256Algo = LOOKUP.get('sha256')!;

  const valid =
    Number.isSafeInteger(N) && N > 1 && (N & (N - 1)) === 0 &&
    Number.isSafeInteger(r) && r > 0 &&
    Number.isSafeInteger(p) && p > 0 &&
    r * p < 2 ** 30 &&
    128 * N * r <= maxmem;
  if (!valid) {
    const err = new Error('Invalid scrypt params');
    (err as { code?: string }).code = 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS';
    throw err;
  }

  const b = pbkdf2(sha256Algo, password, salt, 1, p * 128 * r);
  for (let i = 0; i < p; i++) {
    const start = i * 128 * r;
    b.set(roMix(b.slice(start, start + 128 * r), N, r), start);
  }
  return pbkdf2(sha256Algo, password, b, 1, keylen);
}

export { concat as concatBytes };
