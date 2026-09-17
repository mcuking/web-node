import type { BuiltinSpec } from './types';

/**
 * `crypto` — the subset tooling actually calls in a browser tab.
 *
 * `randomBytes` / `randomUUID` / `getRandomValues` are backed by the browser's
 * WebCrypto. Synchronous digests (`createHash`) have no browser equivalent, so
 * SHA-1, SHA-256 and MD5 are implemented here in plain JS — enough for the
 * content hashing bundlers and dev servers do. Anything else (HMAC, ciphers,
 * key derivation) throws a loud, typed error rather than returning garbage.
 */

// --- SHA-256 -----------------------------------------------------------------

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

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256(bytes: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
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
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i], false);
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

const DIGESTS: Record<string, (bytes: Uint8Array) => Uint8Array> = {
  sha1: sha1,
  sha256: sha256,
  md5: md5,
};

function toBytes(data: unknown, encoding?: string): Uint8Array {
  if (typeof data === 'string') {
    if (encoding === 'hex') {
      const out = new Uint8Array(data.length >> 1);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(data.substr(i * 2, 2), 16);
      return out;
    }
    if (encoding === 'base64') {
      const bin = atob(data);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (encoding === 'latin1' || encoding === 'binary') {
      const out = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff;
      return out;
    }
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(0);
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export const cryptoSpec: BuiltinSpec = {
  id: 'crypto',
  aliases: ['node:crypto'],
  origin: 'web-node',
  init: () => {
    const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
    if (!webcrypto) throw new Error('web-node: this host has no WebCrypto');

    const randomBytes = (size: number): Uint8Array => {
      const out = new Uint8Array(size);
      webcrypto.getRandomValues(out);
      return out;
    };

    const createHash = (algorithm: string) => {
      const digest = DIGESTS[algorithm.toLowerCase().replace('-', '')];
      if (!digest) {
        throw new Error(`web-node: crypto.createHash('${algorithm}') is not supported (sha1, sha256, md5 only)`);
      }
      const chunks: Uint8Array[] = [];
      const api = {
        update(data: unknown, encoding?: string) {
          chunks.push(toBytes(data, encoding));
          return api;
        },
        digest(encoding?: string): unknown {
          let total = 0;
          for (const c of chunks) total += c.length;
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) { merged.set(c, offset); offset += c.length; }
          const result = digest(merged);
          if (encoding === 'hex') return toHex(result);
          if (encoding === 'base64') return toBase64(result);
          return result;
        },
        copy() {
          return createHash(algorithm);
        },
      };
      return api;
    };

    return {
      createHash,
      randomBytes,
      randomUUID: () => webcrypto.randomUUID(),
      randomFillSync: (buffer: Uint8Array) => webcrypto.getRandomValues(buffer),
      getRandomValues: (buffer: Uint8Array) => webcrypto.getRandomValues(buffer),
      webcrypto,
      crypto: webcrypto,
      constants: {},
      default: { createHash, randomBytes, webcrypto },
    };
  },
};
