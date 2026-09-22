// RIPEMD-160 (ISO/IEC 10118-3) — pure JS, 160-bit digest. Used by
// `crypto.createHash('ripemd160')` and the `ripemd`/`rmd160`/`RSA-RIPEMD160`
// spellings.

const IV = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

const RL = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
];
const RR = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
];
const SL = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];
const SR = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
];
const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function f(j: number, x: number, y: number, z: number): number {
  if (j < 16) return (x ^ y ^ z) >>> 0;
  if (j < 32) return ((x & y) | (~x & z)) >>> 0;
  if (j < 48) return ((x | ~y) ^ z) >>> 0;
  if (j < 64) return ((x & z) | (y & ~z)) >>> 0;
  return (x ^ (y | ~z)) >>> 0;
}

function readLE32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function compress(h: number[], block: Uint8Array, offset: number): void {
  const x = new Array<number>(16);
  for (let i = 0; i < 16; i++) x[i] = readLE32(block, offset + i * 4);

  let [a, b, c, d, e] = h;
  let [ap, bp, cp, dp, ep] = h;

  for (let j = 0; j < 80; j++) {
    const t = (rotl((a + f(j, b, c, d) + x[RL[j]] + KL[(j / 16) | 0]) >>> 0, SL[j]) + e) >>> 0;
    a = e;
    e = d;
    d = rotl(c, 10);
    c = b;
    b = t;
  }
  for (let j = 0; j < 80; j++) {
    const t = (rotl((ap + f(79 - j, bp, cp, dp) + x[RR[j]] + KR[(j / 16) | 0]) >>> 0, SR[j]) + ep) >>> 0;
    ap = ep;
    ep = dp;
    dp = rotl(cp, 10);
    cp = bp;
    bp = t;
  }

  const t = (h[1] + c + dp) >>> 0;
  h[1] = (h[2] + d + ep) >>> 0;
  h[2] = (h[3] + e + ap) >>> 0;
  h[3] = (h[4] + a + bp) >>> 0;
  h[4] = (h[0] + b + cp) >>> 0;
  h[0] = t;
}

export function ripemd160(input: Uint8Array): Uint8Array {
  const h = IV.slice();
  const bitLength = BigInt(input.length) * 8n;

  let offset = 0;
  while (input.length - offset >= 64) {
    compress(h, input, offset);
    offset += 64;
  }

  const remaining = input.length - offset;
  const tail = new Uint8Array((remaining >= 56 ? 2 : 1) * 64);
  tail.set(input.subarray(offset), 0);
  tail[remaining] = 0x80;
  for (let i = 0; i < 8; i++) tail[tail.length - 8 + i] = Number((bitLength >> BigInt(8 * i)) & 0xffn);
  for (let i = 0; i < tail.length; i += 64) compress(h, tail, i);

  const out = new Uint8Array(20);
  for (let i = 0; i < 5; i++) {
    out[i * 4] = h[i] & 0xff;
    out[i * 4 + 1] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (h[i] >>> 24) & 0xff;
  }
  return out;
}
