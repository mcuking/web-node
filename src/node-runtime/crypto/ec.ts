/**
 * Elliptic-curve arithmetic in pure JS (BigInt), for the curves Node exposes
 * that a browser tab actually needs: NIST P-256/P-384/P-521 (ECDSA) and
 * Ed25519 (EdDSA).
 *
 * WebCrypto can do all of this, but only *asynchronously*; Node's `crypto.sign`
 * / `verify` / `createSign` are synchronous, so the maths lives here and the
 * async forms wrap it. Points are affine for the NIST curves (an inversion per
 * operation, which is irrelevant at these sizes) and extended for Ed25519.
 *
 * Everything is checked against OpenSSL through the differential corpus in
 * `tools/crypto-asym-*.mjs`, so no primitive is trusted on faith.
 */
import { resolveHash } from './hash';
import { bigIntToBytes, bytesToBigInt } from './der';

export interface Curve {
  /** Node's `namedCurve` spelling (asymmetricKeyDetails.namedCurve). */
  nodeName: string;
  /** The byte length of a field element / coordinate. */
  byteLength: number;
  p: bigint;
  a: bigint;
  b: bigint;
  gx: bigint;
  gy: bigint;
  n: bigint;
  /** DER OID contents as hex, e.g. "2a8648ce3d030107" for prime256v1. */
  oidHex: string;
}

function hexBig(hex: string): bigint {
  return BigInt('0x' + hex);
}

const P256_P = hexBig('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const P384_P = hexBig('fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff');
const P521_P = (1n << 521n) - 1n;

// Every NIST curve here uses a = -3 (mod p).
const MINUS_THREE = 3n;

export const P256: Curve = {
  nodeName: 'prime256v1',
  byteLength: 32,
  p: P256_P,
  a: P256_P - MINUS_THREE,
  b: hexBig('5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
  gx: hexBig('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
  gy: hexBig('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
  n: hexBig('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
  oidHex: '2a8648ce3d030107',
};

export const P384: Curve = {
  nodeName: 'secp384r1',
  byteLength: 48,
  p: P384_P,
  a: P384_P - MINUS_THREE,
  b: hexBig('b3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef'),
  gx: hexBig('aa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7'),
  gy: hexBig('3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f'),
  n: hexBig('ffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973'),
  oidHex: '2b81040022',
};

export const P521: Curve = {
  nodeName: 'secp521r1',
  byteLength: 66,
  p: P521_P,
  a: P521_P - MINUS_THREE,
  b: hexBig(
    '0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00',
  ),
  gx: hexBig(
    '00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66',
  ),
  gy: hexBig(
    '011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650',
  ),
  n: hexBig(
    '01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409',
  ),
  oidHex: '2b81040023',
};

export const CURVES: Curve[] = [P256, P384, P521];

export function curveByOidHex(oidHex: string): Curve | undefined {
  return CURVES.find((c) => c.oidHex === oidHex);
}

export function curveByNodeName(name: string): Curve | undefined {
  return CURVES.find((c) => c.nodeName === name || nameAliases(c).has(name));
}

function nameAliases(curve: Curve): Set<string> {
  if (curve === P256) return new Set(['P-256', 'prime256v1', 'secp256r1', 'p256']);
  if (curve === P384) return new Set(['P-384', 'secp384r1', 'p384']);
  return new Set(['P-521', 'secp521r1', 'p521']);
}

// --- modular arithmetic -----------------------------------------------------

export function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

/** Modular inverse via the extended Euclidean algorithm. */
export function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error('modInverse: not invertible');
  return mod(old_s, m);
}

export function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

// --- affine points ----------------------------------------------------------

export interface Point {
  x: bigint;
  y: bigint;
}

export function pointAdd(p1: Point | null, p2: Point | null, curve: Curve): Point | null {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  const { p, a } = curve;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y, p) === 0n) return null;
    return pointDouble(p1, curve);
  }
  const lambda = mod((p2.y - p1.y) * modInverse(p2.x - p1.x, p), p);
  const x3 = mod(lambda * lambda - p1.x - p2.x, p);
  const y3 = mod(lambda * (p1.x - x3) - p1.y, p);
  void a;
  return { x: x3, y: y3 };
}

export function pointDouble(p1: Point | null, curve: Curve): Point | null {
  if (p1 === null) return null;
  const { p, a } = curve;
  if (p1.y === 0n) return null;
  const lambda = mod((3n * p1.x * p1.x + a) * modInverse(2n * p1.y, p), p);
  const x3 = mod(lambda * lambda - 2n * p1.x, p);
  const y3 = mod(lambda * (p1.x - x3) - p1.y, p);
  return { x: x3, y: y3 };
}

export function pointMul(k: bigint, point: Point | null, curve: Curve): Point | null {
  let result: Point | null = null;
  let addend = point;
  let scalar = mod(k, curve.n);
  while (scalar > 0n) {
    if (scalar & 1n) result = pointAdd(result, addend, curve);
    addend = pointDouble(addend, curve);
    scalar >>= 1n;
  }
  return result;
}

export function isOnCurve(point: Point, curve: Curve): boolean {
  if (point.x < 0n || point.x >= curve.p || point.y < 0n || point.y >= curve.p) return false;
  const { p, a, b } = curve;
  const left = mod(point.y * point.y, p);
  const right = mod(point.x * point.x * point.x + a * point.x + b, p);
  return left === right;
}

export function generator(curve: Curve): Point {
  return { x: curve.gx, y: curve.gy };
}

/** Byte-encode a coordinate to the curve's fixed field length. */
export function coordToBytes(value: bigint, curve: Curve): Uint8Array {
  return bigIntToBytes(value, curve.byteLength);
}

/** Build an uncompressed SEC1 point: 0x04 || X || Y. */
export function encodePoint(point: Point, curve: Curve): Uint8Array {
  const out = new Uint8Array(1 + 2 * curve.byteLength);
  out[0] = 0x04;
  out.set(coordToBytes(point.x, curve), 1);
  out.set(coordToBytes(point.y, curve), 1 + curve.byteLength);
  return out;
}

export function decodePoint(bytes: Uint8Array, curve: Curve): Point {
  if (bytes.length !== 1 + 2 * curve.byteLength || bytes[0] !== 0x04) {
    throw new Error('ec: unsupported point encoding');
  }
  const x = bytesToBigInt(bytes.subarray(1, 1 + curve.byteLength));
  const y = bytesToBigInt(bytes.subarray(1 + curve.byteLength));
  const point = { x, y };
  if (!isOnCurve(point, curve)) throw new Error('ec: point is not on the curve');
  return point;
}

// --- ECDSA ------------------------------------------------------------------

/** bits2int: take the leftmost `bitlen(n)` bits of the digest. */
function bits2int(digest: Uint8Array, n: bigint): bigint {
  const qlen = n.toString(2).length;
  const v = bytesToBigInt(digest);
  const excess = digest.length * 8 - qlen;
  return excess > 0 ? v >> BigInt(excess) : v;
}

export interface EcdsaSignature {
  r: bigint;
  s: bigint;
}

export function ecdsaSign(digest: Uint8Array, d: bigint, curve: Curve, randomScalar: () => bigint): EcdsaSignature {
  const z = bits2int(digest, curve.n);
  for (;;) {
    const k = randomScalar();
    if (k <= 0n || k >= curve.n) continue;
    const point = pointMul(k, generator(curve), curve);
    if (point === null) continue;
    const r = mod(point.x, curve.n);
    if (r === 0n) continue;
    const s = mod(modInverse(k, curve.n) * (z + r * d), curve.n);
    if (s === 0n) continue;
    return { r, s };
  }
}

export function ecdsaVerify(
  digest: Uint8Array,
  signature: EcdsaSignature,
  publicPoint: Point,
  curve: Curve,
): boolean {
  const { n, p } = curve;
  const { r, s } = signature;
  if (r <= 0n || r >= n || s <= 0n || s >= n) return false;
  const z = bits2int(digest, n);
  const w = modInverse(s, n);
  const u1 = mod(z * w, n);
  const u2 = mod(r * w, n);
  const point = pointAdd(pointMul(u1, generator(curve), curve), pointMul(u2, publicPoint, curve), curve);
  if (point === null) return false;
  const v = mod(point.x, n);
  void p;
  return v === r;
}

// --- Ed25519 ----------------------------------------------------------------

const ED_P = (1n << 255n) - 19n;
const ED_L = (1n << 252n) + 27742317777372353535851937790883648493n;
const ED_D = mod(-121665n * modInverse(121666n, ED_P), ED_P);
const ED_SQRT_M1 = modPow(2n, (ED_P - 1n) / 4n, ED_P);

interface ExtPoint {
  x: bigint;
  y: bigint;
  z: bigint;
  t: bigint;
}

const ED_IDENTITY: ExtPoint = { x: 0n, y: 1n, z: 1n, t: 0n };

function edBase(): ExtPoint {
  const y = mod(4n * modInverse(5n, ED_P), ED_P);
  const x = edRecoverX(y, 0);
  return { x, y, z: 1n, t: mod(x * y, ED_P) };
}

function edRecoverX(y: bigint, sign: number): bigint {
  const u = mod(y * y - 1n, ED_P);
  const v = mod(ED_D * y * y + 1n, ED_P);
  let x = mod(u * modPow(v, 3n, ED_P) * modPow(mod(u * modPow(v, 7n, ED_P), ED_P), (ED_P - 5n) / 8n, ED_P), ED_P);
  if (mod(v * x * x - u, ED_P) !== 0n) {
    x = mod(x * ED_SQRT_M1, ED_P);
    if (mod(v * x * x - u, ED_P) !== 0n) throw new Error('ed25519: point not on curve');
  }
  if (Number(x & 1n) !== (sign & 1)) x = mod(ED_P - x, ED_P);
  return x;
}

function edAdd(p1: ExtPoint, p2: ExtPoint): ExtPoint {
  const a = mod((p1.y - p1.x) * (p2.y - p2.x), ED_P);
  const b = mod((p1.y + p1.x) * (p2.y + p2.x), ED_P);
  const c = mod(p1.t * 2n * ED_D * p2.t, ED_P);
  const d = mod(p1.z * 2n * p2.z, ED_P);
  const e = b - a;
  const f = d - c;
  const g = d + c;
  const h = b + a;
  return {
    x: mod(e * f, ED_P),
    y: mod(g * h, ED_P),
    t: mod(e * h, ED_P),
    z: mod(f * g, ED_P),
  };
}

function edDouble(p1: ExtPoint): ExtPoint {
  const a = mod(p1.x * p1.x, ED_P);
  const b = mod(p1.y * p1.y, ED_P);
  const c = mod(2n * p1.z * p1.z, ED_P);
  const d = mod(-a, ED_P);
  const e = mod(mod(p1.x + p1.y, ED_P) ** 2n - a - b, ED_P);
  const g = d + b;
  const f = g - c;
  const h = d - b;
  return {
    x: mod(e * f, ED_P),
    y: mod(g * h, ED_P),
    t: mod(e * h, ED_P),
    z: mod(f * g, ED_P),
  };
}

function edScalarMul(k: bigint, point: ExtPoint): ExtPoint {
  let result = ED_IDENTITY;
  let addend = point;
  let scalar = k;
  while (scalar > 0n) {
    if (scalar & 1n) result = edAdd(result, addend);
    addend = edDouble(addend);
    scalar >>= 1n;
  }
  return result;
}

function edEncode(point: ExtPoint): Uint8Array {
  const zInv = modInverse(point.z, ED_P);
  const x = mod(point.x * zInv, ED_P);
  const y = mod(point.y * zInv, ED_P);
  // Ed25519 encoding is little-endian y with the sign of x in the top bit.
  const out = bigIntToLe(y, 32);
  out[31] = (out[31] & 0x7f) | (Number(x & 1n) << 7);
  return out;
}

function edDecode(bytes: Uint8Array): ExtPoint {
  if (bytes.length !== 32) throw new Error('ed25519: invalid point length');
  const y = leToBigInt(sub256(bytes)); // little-endian, drop sign bit
  const sign = (bytes[31] >> 7) & 1;
  const x = edRecoverX(y, sign);
  return { x, y, z: 1n, t: mod(x * y, ED_P) };
}

/** Read 32 little-endian bytes into a bigint with the high bit cleared. */
function sub256(bytes: Uint8Array): Uint8Array {
  // `Uint8Array.from` (not `.slice`) — on a Node Buffer, `.slice` returns a
  // *view*, so clearing the sign bit below would corrupt the caller's bytes.
  const out = Uint8Array.from(bytes.subarray(0, 32));
  out[31] &= 0x7f;
  return out;
}

function leToBigInt(bytes: Uint8Array): bigint {
  const reversed = Uint8Array.from(bytes).reverse();
  return bytesToBigInt(reversed);
}

function bigIntToLe(value: bigint, length: number): Uint8Array {
  const be = bigIntToBytes(value, length);
  return Uint8Array.from(be).reverse();
}

function sha512(bytes: Uint8Array): Uint8Array {
  const algo = resolveHash('sha512');
  if (!algo) throw new Error('sha512 unavailable');
  return algo.hash(bytes);
}

/** Clamp the first 32 bytes of `h` (RFC 8032). */
function clampScalar(h: Uint8Array): Uint8Array {
  const out = Uint8Array.from(h.subarray(0, 32));
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

export function ed25519PublicFromSeed(seed: Uint8Array): Uint8Array {
  const h = sha512(seed);
  const a = leToBigInt(clampScalar(h));
  return edEncode(edScalarMul(a, edBase()));
}

export function ed25519Sign(seed: Uint8Array, message: Uint8Array): Uint8Array {
  const h = sha512(seed);
  const a = leToBigInt(clampScalar(h));
  const prefix = h.subarray(32, 64);
  const A = edEncode(edScalarMul(a, edBase()));
  const r = mod(leToBigInt(sha512(concat(prefix, message))), ED_L);
  const R = edEncode(edScalarMul(r, edBase()));
  const k = mod(leToBigInt(sha512(concat(concat(R, A), message))), ED_L);
  const s = mod(r + k * a, ED_L);
  return concat(R, bigIntToLe(s, 32));
}

export function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) return false;
  const R = signature.subarray(0, 32);
  const s = leToBigInt(signature.subarray(32, 64));
  if (s >= ED_L) return false;
  let A: ExtPoint;
  let rPoint: ExtPoint;
  try {
    A = edDecode(publicKey);
    rPoint = edDecode(R);
  } catch {
    return false;
  }
  const k = mod(leToBigInt(sha512(concat(concat(R, publicKey), message))), ED_L);
  const left = edEncode(edScalarMul(s, edBase()));
  const right = edEncode(edAdd(rPoint, edScalarMul(k, A)));
  return bytesEqual(left, right);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
