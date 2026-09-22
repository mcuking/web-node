/**
 * ML-KEM (FIPS 203) — the post-quantum key-encapsulation mechanism behind
 * Node's `crypto.encapsulate` / `crypto.decapsulate` and the `ml-kem-*` key
 * types. Implemented from the standard in pure JS on top of the runtime's own
 * Keccak (SHA3/SHAKE), aligned with OpenSSL's `crypto/ml_kem/ml_kem.c`, which
 * is what real Node uses.
 *
 * The scheme is a Fujisaki–Okamoto transform of the IND-CPA "K-PKE" public-key
 * encryption. Everything here — the NTT over Z_3329, the coefficient
 * encode/decode and compress/decompress, the rejection sampling — is derived
 * from the specification, and the precomputed constants (the NTT twiddle
 * factors, `ζ = 17`) are computed at load time rather than transcribed, so they
 * cannot drift.
 */
import { sha3_256, sha3_512, shake128, shake256 } from './keccak';

/** The NTT modulus, a prime. */
const Q = 3329;
/** Polynomial degree. */
const N = 256;
/** `ζ`, a primitive 256th root of unity mod `Q`. */
const ROOT = 17;
/** `(N/2)^-1 mod Q`, the inverse-NTT scaling factor. */
const INVERSE_DEGREE = 3303;

export type MlKemParam = 'ml-kem-512' | 'ml-kem-768' | 'ml-kem-1024';

interface MlKemParams {
  readonly k: number;
  readonly eta1: number;
  readonly eta2: number;
  readonly du: number;
  readonly dv: number;
}

const PARAMETERS: Record<MlKemParam, MlKemParams> = {
  'ml-kem-512': { k: 2, eta1: 3, eta2: 2, du: 10, dv: 4 },
  'ml-kem-768': { k: 3, eta1: 2, eta2: 2, du: 10, dv: 4 },
  'ml-kem-1024': { k: 4, eta1: 2, eta2: 2, du: 11, dv: 5 },
};

export function isMlKemParam(name: string): name is MlKemParam {
  return Object.prototype.hasOwnProperty.call(PARAMETERS, name);
}

/** Bit-reverse the low seven bits of `i` (FIPS 203's `BitRev7`). */
function bitRev7(i: number): number {
  let r = 0;
  for (let b = 0; b < 7; b++) if ((i >>> b) & 1) r |= 1 << (6 - b);
  return r;
}

function powMod(base: number, exp: number): number {
  let result = 1;
  let b = base % Q;
  let e = exp;
  while (e > 0) {
    if (e & 1) result = (result * b) % Q;
    b = (b * b) % Q;
    e >>>= 1;
  }
  return result;
}

/** `zetas[i] = 17^BitRev7(i) mod q` — the forward/inverse NTT twiddle factors. */
const ZETAS = new Int32Array(128);
for (let i = 0; i < 128; i++) ZETAS[i] = powMod(ROOT, bitRev7(i));

/** `17^(2·BitRev7(i)+1) mod q` — the base-case multiplication constants. */
const MOD_ROOTS = new Int32Array(128);
for (let i = 0; i < 128; i++) MOD_ROOTS[i] = powMod(ROOT, 2 * bitRev7(i) + 1);

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// --- NTT over Z_q[X]/(X^256 + 1) -------------------------------------------

/** FIPS 203 Algorithm 9 (Cooley–Tukey), in place. */
function ntt(f: Int32Array): void {
  let zetaIndex = 1;
  for (let len = 128; len >= 2; len >>= 1) {
    for (let start = 0; start < N; start += 2 * len) {
      const zeta = ZETAS[zetaIndex++];
      for (let j = start; j < start + len; j++) {
        const t = (zeta * f[j + len]) % Q;
        f[j + len] = (f[j] - t + Q) % Q;
        f[j] = (f[j] + t) % Q;
      }
    }
  }
}

/** FIPS 203 Algorithm 10 (Gentleman–Sande), in place. */
function inverseNtt(f: Int32Array): void {
  let zetaIndex = 127;
  for (let len = 2; len <= 128; len <<= 1) {
    for (let start = 0; start < N; start += 2 * len) {
      const zeta = ZETAS[zetaIndex--];
      for (let j = start; j < start + len; j++) {
        const t = f[j];
        f[j] = (t + f[j + len]) % Q;
        f[j + len] = (zeta * (f[j + len] - t + Q)) % Q;
      }
    }
  }
  for (let j = 0; j < N; j++) f[j] = (f[j] * INVERSE_DEGREE) % Q;
}

/** FIPS 203 Algorithm 11/12: multiply two NTT-domain polynomials. */
function multiplyNtts(f: Int32Array, g: Int32Array): Int32Array {
  const h = new Int32Array(N);
  for (let i = 0; i < 128; i++) {
    const gamma = MOD_ROOTS[i];
    const a0 = f[2 * i];
    const a1 = f[2 * i + 1];
    const b0 = g[2 * i];
    const b1 = g[2 * i + 1];
    h[2 * i] = (a0 * b0 + (((a1 * b1) % Q) * gamma) % Q) % Q;
    h[2 * i + 1] = (a0 * b1 + a1 * b0) % Q;
  }
  return h;
}

/** `acc += f ∘ g` (NTT domain), accumulating into `acc`. */
function multiplyNttsAdd(acc: Int32Array, f: Int32Array, g: Int32Array): void {
  for (let i = 0; i < 128; i++) {
    const gamma = MOD_ROOTS[i];
    const a0 = f[2 * i];
    const a1 = f[2 * i + 1];
    const b0 = g[2 * i];
    const b1 = g[2 * i + 1];
    acc[2 * i] = (acc[2 * i] + a0 * b0 + (((a1 * b1) % Q) * gamma) % Q) % Q;
    acc[2 * i + 1] = (acc[2 * i + 1] + a0 * b1 + a1 * b0) % Q;
  }
}

// --- sampling ---------------------------------------------------------------

/** FIPS 203 Algorithm 7: rejection-sample a uniform NTT-domain polynomial. */
function sampleNtt(seed: Uint8Array): Int32Array {
  const a = new Int32Array(N);
  let streamLength = 672;
  let stream = shake128(seed, streamLength);
  let pos = 0;
  let ctr = 0;
  while (ctr < N) {
    if (pos + 3 > stream.length) {
      streamLength += 168;
      stream = shake128(seed, streamLength);
    }
    const b0 = stream[pos];
    const b1 = stream[pos + 1];
    const b2 = stream[pos + 2];
    pos += 3;
    const d1 = b0 | ((b1 & 0x0f) << 8);
    const d2 = (b1 >> 4) | (b2 << 4);
    if (d1 < Q) a[ctr++] = d1;
    if (ctr < N && d2 < Q) a[ctr++] = d2;
  }
  return a;
}

/** FIPS 203 Algorithm 8: sample a polynomial from a centered binomial dist. */
function samplePolyCbd(seedByte: Uint8Array, eta: number): Int32Array {
  const buf = shake256(seedByte, 64 * eta);
  const f = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    let x = 0;
    let y = 0;
    for (let j = 0; j < eta; j++) {
      const a = 2 * i * eta + j;
      const b = 2 * i * eta + eta + j;
      x += (buf[a >> 3] >> (a & 7)) & 1;
      y += (buf[b >> 3] >> (b & 7)) & 1;
    }
    f[i] = (((x - y) % Q) + Q) % Q;
  }
  return f;
}

/** `SamplePolyCBD_η(PRF_η(seed, nonce))`, keeping the PRF nonce. */
function prfCbd(seed: Uint8Array, nonce: number, eta: number): Int32Array {
  return samplePolyCbd(concat(seed, Uint8Array.of(nonce & 0xff)), eta);
}

// --- coefficient encoding / compression ------------------------------------

/** FIPS 203 Algorithm 5: ByteEncode_d, little-endian bit packing. */
function byteEncode(coeffs: Int32Array, d: number): Uint8Array {
  const out = new Uint8Array((d * N) / 8);
  let bitPos = 0;
  for (let i = 0; i < N; i++) {
    const c = coeffs[i];
    for (let b = 0; b < d; b++) {
      if ((c >>> b) & 1) out[bitPos >> 3] |= 1 << (bitPos & 7);
      bitPos++;
    }
  }
  return out;
}

/** FIPS 203 Algorithm 6: ByteDecode_d. */
function byteDecode(bytes: Uint8Array, d: number): Int32Array {
  const out = new Int32Array(N);
  const mask = (1 << d) - 1;
  let bitPos = 0;
  for (let i = 0; i < N; i++) {
    let value = 0;
    for (let b = 0; b < d; b++) {
      const bit = (bytes[bitPos >> 3] >> (bitPos & 7)) & 1;
      value |= bit << b;
      bitPos++;
    }
    out[i] = value & mask;
  }
  return out;
}

/** FIPS 203 Equation (4.7): Compress_d. */
function compress(x: number, d: number): number {
  const quotient = Math.floor(((x << d) + (Q >> 1)) / Q);
  return quotient & ((1 << d) - 1);
}

/** FIPS 203 Equation (4.8): Decompress_d. */
function decompress(y: number, d: number): number {
  return Math.floor((Q * y + (1 << (d - 1))) / (1 << d));
}

function compressPoly(f: Int32Array, d: number): Int32Array {
  const out = new Int32Array(N);
  for (let i = 0; i < N; i++) out[i] = compress(f[i], d);
  return out;
}

function decompressPoly(f: Int32Array, d: number): Int32Array {
  const out = new Int32Array(N);
  for (let i = 0; i < N; i++) out[i] = decompress(f[i], d);
  return out;
}

// --- K-PKE ------------------------------------------------------------------

type PolyVec = Int32Array[];

function expandMatrix(rho: Uint8Array, k: number): PolyVec[] {
  const a: PolyVec[] = [];
  for (let i = 0; i < k; i++) {
    const row: PolyVec = [];
    for (let j = 0; j < k; j++) {
      row.push(sampleNtt(concat(rho, Uint8Array.of(j, i))));
    }
    a.push(row);
  }
  return a;
}

function encodePolyVec(vec: PolyVec, d: number): Uint8Array {
  return concat(...vec.map((p) => byteEncode(p, d)));
}

/** Algorithm 13: K-PKE.KeyGen — returns `(ek, dk)` in wire form. */
function kpkeKeyGen(d: Uint8Array, params: MlKemParams): { ek: Uint8Array; dk: Uint8Array } {
  const { k, eta1 } = params;
  const g = sha3_512(concat(d, Uint8Array.of(k)));
  const rho = g.subarray(0, 32);
  const sigma = g.subarray(32, 64);
  const a = expandMatrix(rho, k);

  let nonce = 0;
  const sHat: PolyVec = [];
  const eHat: PolyVec = [];
  for (let i = 0; i < k; i++) {
    const s = prfCbd(sigma, nonce++, eta1);
    ntt(s);
    sHat.push(s);
  }
  for (let i = 0; i < k; i++) {
    const e = prfCbd(sigma, nonce++, eta1);
    ntt(e);
    eHat.push(e);
  }

  const tHat: PolyVec = [];
  for (let i = 0; i < k; i++) {
    const t = Int32Array.from(eHat[i]);
    for (let j = 0; j < k; j++) multiplyNttsAdd(t, a[i][j], sHat[j]);
    tHat.push(t);
  }

  const ek = concat(encodePolyVec(tHat, 12), rho);
  const dk = encodePolyVec(sHat, 12);
  return { ek, dk };
}

/** Algorithm 14: K-PKE.Encrypt. */
function kpkeEncrypt(
  ek: Uint8Array,
  message: Uint8Array,
  randomness: Uint8Array,
  params: MlKemParams,
): Uint8Array {
  const { k, eta1, eta2, du, dv } = params;
  const tHat = byteDecodeAll(ek, 12, k);
  const rho = ek.subarray(384 * k, 384 * k + 32);
  const a = expandMatrix(rho, k);

  let nonce = 0;
  const y: PolyVec = [];
  for (let i = 0; i < k; i++) {
    const p = prfCbd(randomness, nonce++, eta1);
    ntt(p);
    y.push(p);
  }
  const e1: PolyVec = [];
  for (let i = 0; i < k; i++) e1.push(prfCbd(randomness, nonce++, eta2));
  const e2 = prfCbd(randomness, nonce++, eta2);

  const u: PolyVec = [];
  for (let i = 0; i < k; i++) {
    let acc = new Int32Array(N);
    for (let j = 0; j < k; j++) multiplyNttsAdd(acc, a[j][i], y[j]);
    inverseNtt(acc);
    for (let c = 0; c < N; c++) acc[c] = (acc[c] + e1[i][c]) % Q;
    u.push(acc);
  }

  let v = new Int32Array(N);
  for (let i = 0; i < k; i++) multiplyNttsAdd(v, tHat[i], y[i]);
  inverseNtt(v);
  const mu = decompressPoly(byteDecode(message, 1), 1);
  for (let c = 0; c < N; c++) v[c] = (v[c] + e2[c] + mu[c]) % Q;

  const c1 = encodePolyVec(u.map((p) => compressPoly(p, du)), du);
  const c2 = byteEncode(compressPoly(v, dv), dv);
  return concat(c1, c2);
}

/** Algorithm 15: K-PKE.Decrypt — returns the 32-byte plaintext. */
function kpkeDecrypt(dk: Uint8Array, ciphertext: Uint8Array, params: MlKemParams): Uint8Array {
  const { k, du, dv } = params;
  const sHat = byteDecodeAll(dk, 12, k);

  const uBytes = (du * 32) * k;
  const c1 = ciphertext.subarray(0, uBytes);
  const c2 = ciphertext.subarray(uBytes);

  const u: PolyVec = [];
  for (let i = 0; i < k; i++) {
    const p = decompressPoly(byteDecode(c1.subarray(i * du * 32, (i + 1) * du * 32), du), du);
    ntt(p);
    u.push(p);
  }
  const v = decompressPoly(byteDecode(c2, dv), dv);

  let w = new Int32Array(N);
  for (let i = 0; i < k; i++) multiplyNttsAdd(w, sHat[i], u[i]);
  inverseNtt(w);
  const out = new Int32Array(N);
  for (let c = 0; c < N; c++) out[c] = (v[c] - w[c] + Q) % Q;
  return byteEncode(compressPoly(out, 1), 1);
}

function byteDecodeAll(bytes: Uint8Array, d: number, k: number): PolyVec {
  const stride = (d * N) / 8;
  const out: PolyVec = [];
  for (let i = 0; i < k; i++) out.push(byteDecode(bytes.subarray(i * stride, (i + 1) * stride), d));
  return out;
}

// --- ML-KEM -----------------------------------------------------------------

/** Algorithm 16: ML-KEM.KeyGen_internal — `d` and `z` are 32 bytes each. */
function keyGenInternal(
  d: Uint8Array,
  z: Uint8Array,
  params: MlKemParams,
): { ek: Uint8Array; dk: Uint8Array } {
  const { ek, dk: dkPke } = kpkeKeyGen(d, params);
  const h = sha3_256(ek);
  const dk = concat(dkPke, ek, h, z);
  return { ek, dk };
}

/** Algorithm 17: ML-KEM.Encaps_internal. */
function encapsInternal(ek: Uint8Array, m: Uint8Array, params: MlKemParams): {
  sharedKey: Uint8Array;
  ciphertext: Uint8Array;
} {
  const kr = sha3_512(concat(m, sha3_256(ek)));
  const sharedKey = kr.subarray(0, 32);
  const r = kr.subarray(32, 64);
  const ciphertext = kpkeEncrypt(ek, m, r, params);
  return { sharedKey: Uint8Array.from(sharedKey), ciphertext };
}

/** Algorithm 18: ML-KEM.Decaps_internal. */
function decapsInternal(dk: Uint8Array, ciphertext: Uint8Array, params: MlKemParams): Uint8Array {
  const { k } = params;
  const vectorBytes = 384 * k;
  const dkPke = dk.subarray(0, vectorBytes);
  const ekPke = dk.subarray(vectorBytes, 2 * vectorBytes + 32);
  const h = dk.subarray(2 * vectorBytes + 32, 2 * vectorBytes + 64);
  const z = dk.subarray(2 * vectorBytes + 64, 2 * vectorBytes + 96);

  const mPrime = kpkeDecrypt(dkPke, ciphertext, params);
  const kr = sha3_512(concat(mPrime, h));
  const kPrime = kr.subarray(0, 32);
  const rPrime = kr.subarray(32, 64);
  const failureKey = shake256(concat(z, ciphertext), 32);
  const cPrime = kpkeEncrypt(ekPke, mPrime, rPrime, params);

  let equal = cPrime.length === ciphertext.length;
  if (equal) {
    let diff = 0;
    for (let i = 0; i < cPrime.length; i++) diff |= cPrime[i] ^ ciphertext[i];
    equal = diff === 0;
  }
  return equal ? Uint8Array.from(kPrime) : failureKey;
}

// --- public surface ---------------------------------------------------------

export function mlKemPublicKeyLength(param: MlKemParam): number {
  return 384 * PARAMETERS[param].k + 32;
}

export function mlKemPrivateSeedLength(): number {
  return 64;
}

export function mlKemCiphertextLength(param: MlKemParam): number {
  const { k, du, dv } = PARAMETERS[param];
  return 32 * (du * k + dv);
}

export function mlKemSharedKeyLength(): number {
  return 32;
}

/** Derive the encapsulation (public) key from a 64-byte seed. */
export function mlKemPublicFromSeed(seed: Uint8Array, param: MlKemParam): Uint8Array {
  const params = PARAMETERS[param];
  const { ek } = keyGenInternal(seed.subarray(0, 32), seed.subarray(32, 64), params);
  return ek;
}

/** Full key generation output, including the expanded private key. */
export function mlKemExpandSeed(seed: Uint8Array, param: MlKemParam): { ek: Uint8Array; dk: Uint8Array } {
  const params = PARAMETERS[param];
  return keyGenInternal(seed.subarray(0, 32), seed.subarray(32, 64), params);
}

export function mlKemEncapsulate(
  ek: Uint8Array,
  param: MlKemParam,
  randomBytes: (n: number) => Uint8Array,
): { sharedKey: Uint8Array; ciphertext: Uint8Array } {
  const m = randomBytes(32);
  return encapsInternal(ek, m, PARAMETERS[param]);
}

export function mlKemDecapsulate(
  privateKey: Uint8Array,
  ciphertext: Uint8Array,
  param: MlKemParam,
): Uint8Array {
  return decapsInternal(privateKey, ciphertext, PARAMETERS[param]);
}
