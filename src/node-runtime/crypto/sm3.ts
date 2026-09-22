// SM3 (GB/T 32905-2016; also ISO/IEC 10118-3) — pure JS, 256-bit digest.
// Used by `crypto.createHash('sm3')` and the `RSA-SM3`/`sm3WithRSAEncryption`
// spellings.

const IV = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function readBE32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function compress(v: number[], block: Uint8Array, offset: number): void {
  const w = new Array<number>(68);
  const w1 = new Array<number>(64);
  for (let i = 0; i < 16; i++) w[i] = readBE32(block, offset + i * 4);
  for (let i = 16; i < 68; i++) {
    const x = w[i - 16] ^ w[i - 9] ^ rotl(w[i - 3], 15);
    w[i] = (x ^ rotl(x, 15) ^ rotl(x, 23) ^ rotl(w[i - 13], 7) ^ w[i - 6]) >>> 0;
  }
  for (let i = 0; i < 64; i++) w1[i] = (w[i] ^ w[i + 4]) >>> 0;

  let [a, b, c, d, e, f, g, h] = v;
  for (let j = 0; j < 64; j++) {
    const t = j < 16 ? 0x79cc4519 : 0x7a879d8a;
    const ss1 = rotl((rotl(a, 12) + e + rotl(t, j % 32)) >>> 0, 7);
    const ss2 = (ss1 ^ rotl(a, 12)) >>> 0;
    const ff = j < 16 ? a ^ b ^ c : (a & b) | (a & c) | (b & c);
    const gg = j < 16 ? e ^ f ^ g : (e & f) | (~e & g);
    const tt1 = (ff + d + ss2 + w1[j]) >>> 0;
    const tt2 = (gg + h + ss1 + w[j]) >>> 0;
    d = c;
    c = rotl(b, 9);
    b = a;
    a = tt1;
    h = g;
    g = rotl(f, 19);
    f = e;
    e = (tt2 ^ rotl(tt2, 9) ^ rotl(tt2, 17)) >>> 0;
  }
  v[0] = (v[0] ^ a) >>> 0;
  v[1] = (v[1] ^ b) >>> 0;
  v[2] = (v[2] ^ c) >>> 0;
  v[3] = (v[3] ^ d) >>> 0;
  v[4] = (v[4] ^ e) >>> 0;
  v[5] = (v[5] ^ f) >>> 0;
  v[6] = (v[6] ^ g) >>> 0;
  v[7] = (v[7] ^ h) >>> 0;
}

export function sm3(input: Uint8Array): Uint8Array {
  const v = IV.slice();
  const bitLength = BigInt(input.length) * 8n;

  let offset = 0;
  while (input.length - offset >= 64) {
    compress(v, input, offset);
    offset += 64;
  }

  const remaining = input.length - offset;
  const tailBlocks = remaining >= 56 ? 2 : 1;
  const tail = new Uint8Array(tailBlocks * 64);
  tail.set(input.subarray(offset), 0);
  tail[remaining] = 0x80;
  for (let i = 0; i < 8; i++) tail[tail.length - 1 - i] = Number((bitLength >> BigInt(8 * i)) & 0xffn);
  for (let i = 0; i < tail.length; i += 64) compress(v, tail, i);

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (v[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (v[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (v[i] >>> 8) & 0xff;
    out[i * 4 + 3] = v[i] & 0xff;
  }
  return out;
}
