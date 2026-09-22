// BLAKE2s (RFC 7693) — pure JS. The 32-bit sibling of `blake2b.ts`, used by
// `crypto.createMac('blake2smac')`. Keeps the full parameter block (key, salt,
// personalization) so the keyed MAC form matches OpenSSL.

const MASK32 = 0xffffffff;

const IV: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SIGMA: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function readLE32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function mix(v: number[], a: number, b: number, c: number, d: number, mx: number, my: number): void {
  v[a] = (v[a] + v[b] + mx) >>> 0;
  v[d] = rotr32(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = rotr32(v[b] ^ v[c], 12);
  v[a] = (v[a] + v[b] + my) >>> 0;
  v[d] = rotr32(v[d] ^ v[a], 8);
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = rotr32(v[b] ^ v[c], 7);
}

function compress(h: number[], block: Uint8Array, blockOffset: number, t: bigint, last: boolean): void {
  const m: number[] = new Array(16);
  for (let i = 0; i < 16; i++) m[i] = readLE32(block, blockOffset + i * 4);

  const v: number[] = new Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i];
  for (let i = 0; i < 8; i++) v[8 + i] = IV[i];
  v[12] ^= Number(t & 0xffffffffn) >>> 0;
  v[13] ^= Number((t >> 32n) & 0xffffffffn) >>> 0;
  if (last) v[14] = (v[14] ^ MASK32) >>> 0;

  for (let r = 0; r < 10; r++) {
    const s = SIGMA[r];
    mix(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
    mix(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
    mix(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
    mix(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
    mix(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
    mix(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
    mix(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
    mix(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
  }

  for (let i = 0; i < 8; i++) h[i] = (h[i] ^ v[i] ^ v[i + 8]) >>> 0;
}

const EMPTY = new Uint8Array(0);

/** BLAKE2s with an optional key, salt (<= 8 bytes) and personalization (<= 8). */
export function blake2s(
  input: Uint8Array,
  outLen = 32,
  key: Uint8Array = EMPTY,
  salt: Uint8Array = EMPTY,
  personal: Uint8Array = EMPTY,
): Uint8Array {
  const h = IV.slice();
  h[0] = (h[0] ^ (outLen | (key.length << 8) | (1 << 16) | (1 << 24))) >>> 0;
  const saltWord = (index: number): number =>
    index < salt.length ? salt[index] | ((salt[index + 1] ?? 0) << 8) | ((salt[index + 2] ?? 0) << 16) | ((salt[index + 3] ?? 0) << 24) : 0;
  const persWord = (index: number): number =>
    index < personal.length
      ? personal[index] | ((personal[index + 1] ?? 0) << 8) | ((personal[index + 2] ?? 0) << 16) | ((personal[index + 3] ?? 0) << 24)
      : 0;
  // Parameter block: bytes 16-23 are the salt (words 4-5), bytes 24-31 the
  // personalization (words 6-7).
  h[4] = (h[4] ^ (saltWord(0) >>> 0)) >>> 0;
  h[5] = (h[5] ^ (saltWord(4) >>> 0)) >>> 0;
  h[6] = (h[6] ^ (persWord(0) >>> 0)) >>> 0;
  h[7] = (h[7] ^ (persWord(4) >>> 0)) >>> 0;

  let offset = 0;
  let counter = 0n;

  if (key.length > 0) {
    const keyBlock = new Uint8Array(64);
    keyBlock.set(key);
    counter += 64n;
    compress(h, keyBlock, 0, counter, false);
  }

  while (input.length - offset > 64) {
    counter += 64n;
    compress(h, input, offset, counter, false);
    offset += 64;
  }

  const finalBlock = new Uint8Array(64);
  const remaining = input.length - offset;
  finalBlock.set(input.subarray(offset), 0);
  counter += BigInt(remaining);
  compress(h, finalBlock, 0, counter, true);

  const out = new Uint8Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = (h[i >> 2] >>> (8 * (i & 3))) & 0xff;
  }
  return out;
}
