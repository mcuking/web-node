// BLAKE2b (RFC 7693) — pure JS. Used by Argon2's H0 / H' steps.
//
// Only the unkeyed, one-shot form is needed here, but the implementation keeps
// the keyed parameter block so it stays faithful to the spec.

const MASK64 = (1n << 64n) - 1n;

const IV: readonly bigint[] = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
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
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function readLE64(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value;
}

function mix(v: bigint[], a: number, b: number, c: number, d: number, mx: bigint, my: bigint): void {
  v[a] = (v[a] + v[b] + mx) & MASK64;
  v[d] = rotr64(v[d] ^ v[a], 32n);
  v[c] = (v[c] + v[d]) & MASK64;
  v[b] = rotr64(v[b] ^ v[c], 24n);
  v[a] = (v[a] + v[b] + my) & MASK64;
  v[d] = rotr64(v[d] ^ v[a], 16n);
  v[c] = (v[c] + v[d]) & MASK64;
  v[b] = rotr64(v[b] ^ v[c], 63n);
}

function compress(h: bigint[], block: Uint8Array, blockOffset: number, t: bigint, last: boolean): void {
  const m: bigint[] = new Array(16);
  for (let i = 0; i < 16; i++) m[i] = readLE64(block, blockOffset + i * 8);

  const v: bigint[] = new Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i];
  for (let i = 0; i < 8; i++) v[8 + i] = IV[i];
  v[12] ^= t & MASK64;
  v[13] ^= (t >> 64n) & MASK64;
  if (last) v[14] ^= MASK64;

  for (let r = 0; r < 12; r++) {
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

  for (let i = 0; i < 8; i++) h[i] = (h[i] ^ v[i] ^ v[i + 8]) & MASK64;
}

const EMPTY_KEY = new Uint8Array(0);

export function blake2b(input: Uint8Array, outLen = 64, key: Uint8Array = EMPTY_KEY): Uint8Array {
  const h = IV.slice();
  h[0] ^= 0x01010000n ^ (BigInt(key.length) << 8n) ^ BigInt(outLen);

  let offset = 0;
  let counter = 0n;

  if (key.length > 0) {
    const keyBlock = new Uint8Array(128);
    keyBlock.set(key);
    counter += 128n;
    compress(h, keyBlock, 0, counter, false);
  }

  // All but the final block.
  while (input.length - offset > 128) {
    counter += 128n;
    compress(h, input, offset, counter, false);
    offset += 128;
  }

  // Final block, zero padded to 128 bytes.
  const finalBlock = new Uint8Array(128);
  const remaining = input.length - offset;
  finalBlock.set(input.subarray(offset), 0);
  counter += BigInt(remaining);
  compress(h, finalBlock, 0, counter, true);

  const out = new Uint8Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = Number((h[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
  }
  return out;
}
