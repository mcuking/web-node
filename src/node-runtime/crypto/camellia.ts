/**
 * Camellia (RFC 3713) — a pure JS implementation of the 128-bit block cipher
 * with 128/192/256-bit keys.
 *
 * The key schedule and the Feistel data path are written against BigInt so the
 * 64/128-bit rotations read exactly like the spec; the F-function's eight
 * S-box lookups then work on plain bytes. It conforms to the `BlockCipher`
 * interface the shared AES-style mode driver consumes.
 */

const MASK8 = 0xffn;
const MASK32 = 0xffffffffn;
const MASK64 = 0xffffffffffffffffn;
const MASK128 = 0xffffffffffffffffffffffffffffffffn;

/** The RFC 3713 s1 table; s2..s4 are rotations of it. */
const SBOX1 = new Uint8Array([
  112, 130, 44, 236, 179, 39, 192, 229, 228, 133, 87, 53, 234, 12, 174, 65, 35, 239, 107, 147, 69,
  25, 165, 33, 237, 14, 79, 78, 29, 101, 146, 189, 134, 184, 175, 143, 124, 235, 31, 206, 62, 48,
  220, 95, 94, 197, 11, 26, 166, 225, 57, 202, 213, 71, 93, 61, 217, 1, 90, 214, 81, 86, 108, 77,
  139, 13, 154, 102, 251, 204, 176, 45, 116, 18, 43, 32, 240, 177, 132, 153, 223, 76, 203, 194, 52,
  126, 118, 5, 109, 183, 169, 49, 209, 23, 4, 215, 20, 88, 58, 97, 222, 27, 17, 28, 50, 15, 156,
  22, 83, 24, 242, 34, 254, 68, 207, 178, 195, 181, 122, 145, 36, 8, 232, 168, 96, 252, 105, 80,
  170, 208, 160, 125, 161, 137, 98, 151, 84, 91, 30, 149, 224, 255, 100, 210, 16, 196, 0, 72, 163,
  247, 117, 219, 138, 3, 230, 218, 9, 63, 221, 148, 135, 92, 131, 2, 205, 74, 144, 51, 115, 103,
  246, 243, 157, 127, 191, 226, 82, 155, 216, 38, 200, 55, 198, 59, 129, 150, 111, 75, 19, 190, 99,
  46, 233, 121, 167, 140, 159, 110, 188, 142, 41, 245, 249, 182, 47, 253, 180, 89, 120, 152, 6, 106,
  231, 70, 113, 186, 212, 37, 171, 66, 136, 162, 141, 250, 114, 7, 185, 85, 248, 238, 172, 10, 54,
  73, 42, 104, 60, 56, 241, 164, 64, 40, 211, 123, 187, 201, 67, 193, 21, 227, 173, 244, 119, 199,
  128, 158,
]);

const rotl8 = (v: number, n: number): number => ((v << n) | (v >>> (8 - n))) & 0xff;
const SBOX2 = new Uint8Array(256);
const SBOX3 = new Uint8Array(256);
const SBOX4 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  SBOX2[i] = rotl8(SBOX1[i], 1);
  SBOX3[i] = rotl8(SBOX1[i], 7);
  SBOX4[i] = SBOX1[rotl8(i, 1)];
}

const SIGMA1 = 0xa09e667f3bcc908bn;
const SIGMA2 = 0xb67ae8584caa73b2n;
const SIGMA3 = 0xc6ef372fe94f82ben;
const SIGMA4 = 0x54ff53a5f1d36f1cn;
const SIGMA5 = 0x10e527fade682d1dn;
const SIGMA6 = 0xb05688c2b3e6c1fdn;

const rotl128 = (x: bigint, n: number): bigint => ((x << BigInt(n)) | (x >> BigInt(128 - n))) & MASK128;
const rotl32 = (x: bigint, n: number): bigint => ((x << BigInt(n)) | (x >> BigInt(32 - n))) & MASK32;

/** The Camellia F-function (RFC 3713 §2.4.1). */
function F(fin: bigint, ke: bigint): bigint {
  const x = fin ^ ke;
  const t1 = SBOX1[Number((x >> 56n) & MASK8)];
  const t2 = SBOX2[Number((x >> 48n) & MASK8)];
  const t3 = SBOX3[Number((x >> 40n) & MASK8)];
  const t4 = SBOX4[Number((x >> 32n) & MASK8)];
  const t5 = SBOX2[Number((x >> 24n) & MASK8)];
  const t6 = SBOX3[Number((x >> 16n) & MASK8)];
  const t7 = SBOX4[Number((x >> 8n) & MASK8)];
  const t8 = SBOX1[Number(x & MASK8)];
  const y1 = t1 ^ t3 ^ t4 ^ t6 ^ t7 ^ t8;
  const y2 = t1 ^ t2 ^ t4 ^ t5 ^ t7 ^ t8;
  const y3 = t1 ^ t2 ^ t3 ^ t5 ^ t6 ^ t8;
  const y4 = t2 ^ t3 ^ t4 ^ t5 ^ t6 ^ t7;
  const y5 = t1 ^ t2 ^ t6 ^ t7 ^ t8;
  const y6 = t2 ^ t3 ^ t5 ^ t7 ^ t8;
  const y7 = t3 ^ t4 ^ t5 ^ t6 ^ t8;
  const y8 = t1 ^ t4 ^ t5 ^ t6 ^ t7;
  return (
    (BigInt(y1) << 56n) |
    (BigInt(y2) << 48n) |
    (BigInt(y3) << 40n) |
    (BigInt(y4) << 32n) |
    (BigInt(y5) << 24n) |
    (BigInt(y6) << 16n) |
    (BigInt(y7) << 8n) |
    BigInt(y8)
  );
}

/** FL (§2.4.2). */
function FL(x: bigint, ke: bigint): bigint {
  let x1 = x >> 32n;
  let x2 = x & MASK32;
  const k1 = ke >> 32n;
  const k2 = ke & MASK32;
  x2 ^= rotl32(x1 & k1, 1);
  x1 ^= x2 | k2;
  return (x1 << 32n) | x2;
}

/** FLINV (§2.4.2). */
function FLINV(y: bigint, ke: bigint): bigint {
  let y1 = y >> 32n;
  let y2 = y & MASK32;
  const k1 = ke >> 32n;
  const k2 = ke & MASK32;
  y1 ^= y2 | k2;
  y2 ^= rotl32(y1 & k1, 1);
  return (y1 << 32n) | y2;
}

interface Schedule {
  kw: bigint[];
  k: bigint[];
  ke: bigint[];
  rounds: number;
}

/** The subkey schedule of §2.2, reversed for decryption when asked. */
function schedule(key: Uint8Array, decrypt: boolean): Schedule {
  const keyBig = bytesToBigInt(key, 0, key.length);
  let KL: bigint;
  let KR: bigint;
  if (key.length === 16) {
    KL = keyBig;
    KR = 0n;
  } else if (key.length === 24) {
    KL = keyBig >> 64n;
    const r = keyBig & MASK64;
    KR = (r << 64n) | (~r & MASK64);
  } else {
    KL = keyBig >> 128n;
    KR = keyBig & MASK128;
  }

  let d1 = (KL ^ KR) >> 64n;
  let d2 = (KL ^ KR) & MASK64;
  d2 ^= F(d1, SIGMA1);
  d1 ^= F(d2, SIGMA2);
  d1 ^= KL >> 64n;
  d2 ^= KL & MASK64;
  d2 ^= F(d1, SIGMA3);
  d1 ^= F(d2, SIGMA4);
  const KA = (d1 << 64n) | d2;
  d1 = (KA ^ KR) >> 64n;
  d2 = (KA ^ KR) & MASK64;
  d2 ^= F(d1, SIGMA5);
  d1 ^= F(d2, SIGMA6);
  const KB = (d1 << 64n) | d2;

  const hi = (x: bigint, n: number): bigint => (rotl128(x, n) >> 64n) & MASK64;
  const lo = (x: bigint, n: number): bigint => rotl128(x, n) & MASK64;

  let kw: bigint[];
  let k: bigint[];
  let ke: bigint[];
  let rounds: number;
  if (key.length === 16) {
    rounds = 18;
    kw = [hi(KL, 0), lo(KL, 0), hi(KA, 111), lo(KA, 111)];
    // The 128-bit schedule is not a run of contiguous halves: k10 is the *low*
    // half of KL<<<60 (RFC 3713 §2.2).
    k = [
      hi(KA, 0),
      lo(KA, 0),
      hi(KL, 15),
      lo(KL, 15),
      hi(KA, 15),
      lo(KA, 15),
      hi(KL, 45),
      lo(KL, 45),
      hi(KA, 45),
      lo(KL, 60),
      hi(KA, 60),
      lo(KA, 60),
      hi(KL, 94),
      lo(KL, 94),
      hi(KA, 94),
      lo(KA, 94),
      hi(KL, 111),
      lo(KL, 111),
    ];
    ke = [hi(KA, 30), lo(KA, 30), hi(KL, 77), lo(KL, 77)];
  } else {
    rounds = 24;
    kw = [hi(KL, 0), lo(KL, 0), hi(KB, 111), lo(KB, 111)];
    k = [
      hi(KB, 0),
      lo(KB, 0),
      hi(KR, 15),
      lo(KR, 15),
      hi(KA, 15),
      lo(KA, 15),
      hi(KB, 30),
      lo(KB, 30),
      hi(KL, 45),
      lo(KL, 45),
      hi(KA, 45),
      lo(KA, 45),
      hi(KR, 60),
      lo(KR, 60),
      hi(KB, 60),
      lo(KB, 60),
      hi(KL, 77),
      lo(KL, 77),
      hi(KR, 94),
      lo(KR, 94),
      hi(KA, 94),
      lo(KA, 94),
      hi(KL, 111),
      lo(KL, 111),
    ];
    ke = [hi(KR, 30), lo(KR, 30), hi(KL, 60), lo(KL, 60), hi(KA, 77), lo(KA, 77)];
  }

  if (decrypt) {
    kw = [kw[2], kw[3], kw[0], kw[1]];
    k = [...k].reverse();
    ke = [...ke].reverse();
  }
  return { kw, k, ke, rounds };
}

function bytesToBigInt(bytes: Uint8Array, offset: number, length: number): bigint {
  let out = 0n;
  for (let i = 0; i < length; i++) out = (out << 8n) | BigInt(bytes[offset + i]);
  return out;
}

function bigIntToBytes(value: bigint, target: Uint8Array, offset: number, length: number): void {
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    target[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/** Runs the Feistel data path (§2.3) with a prepared schedule. */
function crypt(s: Schedule, block: Uint8Array): void {
  let d1 = bytesToBigInt(block, 0, 8);
  let d2 = bytesToBigInt(block, 8, 8);
  d1 ^= s.kw[0];
  d2 ^= s.kw[1];

  const group = (start: number): void => {
    d2 ^= F(d1, s.k[start]);
    d1 ^= F(d2, s.k[start + 1]);
    d2 ^= F(d1, s.k[start + 2]);
    d1 ^= F(d2, s.k[start + 3]);
    d2 ^= F(d1, s.k[start + 4]);
    d1 ^= F(d2, s.k[start + 5]);
  };
  const flPair = (keStart: number): void => {
    d1 = FL(d1, s.ke[keStart]);
    d2 = FLINV(d2, s.ke[keStart + 1]);
  };

  group(0); // rounds 1-6
  flPair(0);
  group(6); // rounds 7-12
  flPair(2);
  if (s.rounds === 24) {
    group(12); // rounds 13-18
    flPair(4);
    group(18); // rounds 19-24
  } else {
    group(12); // rounds 13-18
  }

  d2 ^= s.kw[2];
  d1 ^= s.kw[3];
  bigIntToBytes(d2, block, 0, 8);
  bigIntToBytes(d1, block, 8, 8);
}

export class Camellia {
  #enc: Schedule;
  #dec: Schedule;

  constructor(key: Uint8Array) {
    if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
      throw new Error('Invalid key length');
    }
    this.#enc = schedule(key, false);
    this.#dec = schedule(key, true);
  }

  encryptBlock(block: Uint8Array): void {
    crypt(this.#enc, block);
  }

  decryptBlock(block: Uint8Array): void {
    crypt(this.#dec, block);
  }
}
