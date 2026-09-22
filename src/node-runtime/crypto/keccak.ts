/**
 * Keccak / SHA-3 / SHAKE / cSHAKE / KMAC — pure JS, no native binding.
 *
 * The browser has no OpenSSL, so the KMAC providers listed by `crypto.getMacs()`
 * (and, later, the SHA-3 digests) are computed here. Everything is built on one
 * Keccak-f[1600] permutation and a sponge; cSHAKE and KMAC then follow NIST
 * SP 800-185, which is what OpenSSL implements, so the bytes line up with Node.
 *
 * Performance is not the goal (a page is fine with BigInt lanes); correctness
 * is, and it is pinned by a differential corpus in test/crypto-mac.test.ts.
 */

const MASK64 = (1n << 64n) - 1n;

/** Keccak round constants (iota step). */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rho rotation offsets, indexed `R[x][y]` (lane = x + 5y). */
const R = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function rotl64(value: bigint, shift: number): bigint {
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK64;
}

function keccakF(state: bigint[]): void {
  const c = new Array<bigint>(5);
  const d = new Array<bigint>(5);
  const b = new Array<bigint>(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    for (let x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x + 5 * y] ^= d[x];
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[x + 5 * y], R[x][y]);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & MASK64 & b[((x + 2) % 5) + 5 * y]);
      }
    }
    state[0] ^= RC[round];
  }
}

/** Absorb one full block into the state (little-endian lanes). */
function xorBlock(state: bigint[], block: Uint8Array, offset: number, length: number): void {
  for (let i = 0; i < length; i++) {
    const lane = i >> 3;
    state[lane] ^= BigInt(block[offset + i]) << BigInt(8 * (i & 7));
  }
}

/**
 * Sponge construction with `pad10*1` and a caller-chosen domain-separation
 * suffix (0x06 for SHA-3, 0x1f for SHAKE, 0x04 for cSHAKE/KMAC).
 */
function keccak(rate: number, suffix: number, outputLen: number, input: Uint8Array): Uint8Array {
  const state = new Array<bigint>(25).fill(0n);
  let i = 0;
  while (i + rate <= input.length) {
    xorBlock(state, input, i, rate);
    keccakF(state);
    i += rate;
  }
  const block = new Uint8Array(rate);
  const rem = input.length - i;
  block.set(input.subarray(i, i + rem));
  block[rem] ^= suffix;
  block[rate - 1] ^= 0x80;
  xorBlock(state, block, 0, rate);
  keccakF(state);

  const out = new Uint8Array(outputLen);
  let o = 0;
  while (o < outputLen) {
    for (let j = 0; j < rate && o < outputLen; j++) {
      out[o++] = Number((state[j >> 3] >> BigInt(8 * (j & 7))) & 0xffn);
    }
    if (o < outputLen) keccakF(state);
  }
  return out;
}

// --- SP 800-185 helpers ------------------------------------------------------

/** left_encode(x): big-endian bytes of x prefixed with their count. */
function leftEncode(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Uint8Array.from([bytes.length, ...bytes]);
}

/** right_encode(x): big-endian bytes of x suffixed with their count. */
function rightEncode(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Uint8Array.from([...bytes, bytes.length]);
}

/** encode_string(S) = left_encode(bitlen(S)) || S. */
function encodeString(bytes: Uint8Array): Uint8Array {
  const prefix = leftEncode(bytes.length * 8);
  const out = new Uint8Array(prefix.length + bytes.length);
  out.set(prefix, 0);
  out.set(bytes, prefix.length);
  return out;
}

/** bytepad(X, w) = left_encode(w) || X || 0* until the length is a multiple of w. */
function bytepad(x: Uint8Array, w: number): Uint8Array {
  const prefix = leftEncode(w);
  const total = prefix.length + x.length;
  const padded = Math.ceil(total / w) * w;
  const out = new Uint8Array(padded);
  out.set(prefix, 0);
  out.set(x, prefix.length);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * cSHAKE128/256 (SP 800-185 §3.3). With empty `n` and `s` this is exactly
 * SHAKE128/256, so the caller passes the empty strings to get plain SHAKE.
 */
export function cshake(bitLevel: 128 | 256, input: Uint8Array, outputLen: number, n: Uint8Array, s: Uint8Array): Uint8Array {
  const rate = bitLevel === 128 ? 168 : 136;
  const empty = n.length === 0 && s.length === 0;
  const suffix = empty ? 0x1f : 0x04;
  const prefix = empty ? new Uint8Array(0) : bytepad(concat([encodeString(n), encodeString(s)]), rate);
  return keccak(rate, suffix, outputLen, concat([prefix, input]));
}

const KMAC_N = Uint8Array.from('KMAC', (ch) => ch.charCodeAt(0));

/**
 * KMAC128/256 (SP 800-185 §4.3.1, the fixed-length variant). `customization`
 * maps to `S`; the trailing `right_encode(L)` carries the output length in bits
 * (KMACXOF is the variant that sends `right_encode(0)`, and Node does not expose
 * it through createMac).
 */
export function kmac(bitLevel: 128 | 256, key: Uint8Array, input: Uint8Array, outputLen: number, customization: Uint8Array): Uint8Array {
  const rate = bitLevel === 128 ? 168 : 136;
  const body = concat([bytepad(encodeString(key), rate), input, rightEncode(outputLen * 8)]);
  return cshake(bitLevel, body, outputLen, KMAC_N, customization);
}

// --- SHA-3 / SHAKE -----------------------------------------------------------

export function sha3_224(input: Uint8Array): Uint8Array {
  return keccak(144, 0x06, 28, input);
}
export function sha3_256(input: Uint8Array): Uint8Array {
  return keccak(136, 0x06, 32, input);
}
export function sha3_384(input: Uint8Array): Uint8Array {
  return keccak(104, 0x06, 48, input);
}
export function sha3_512(input: Uint8Array): Uint8Array {
  return keccak(72, 0x06, 64, input);
}
export function shake128(input: Uint8Array, outputLen: number): Uint8Array {
  return keccak(168, 0x1f, outputLen, input);
}
export function shake256(input: Uint8Array, outputLen: number): Uint8Array {
  return keccak(136, 0x1f, outputLen, input);
}
