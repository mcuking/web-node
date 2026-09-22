/**
 * ECDH key agreement (`crypto.createECDH` / `crypto.ECDH`), in pure JS on top of
 * the curve maths in `ec.ts`.
 *
 * Node's ECDH surface:
 *  - `ECDH.convertKey(key, curve, inputEncoding, outputEncoding, format)`
 *  - `ECDH.getCurves()`
 *  - instances: `generateKeys`, `computeSecret`, `getPrivateKey`, `getPublicKey`,
 *    `setPrivateKey`, `setPublicKey`
 *
 * Public keys are SEC1 points (uncompressed by default, compressed on request);
 * the shared secret is the big-endian X coordinate padded to the field size.
 */
import { bytesToBigInt } from './der';
import {
  coordToBytes,
  decodePublicKey,
  encodePublicKey,
  generator,
  mod,
  pointMul,
  P256,
  P384,
  P521,
  type Curve,
  type Point,
} from './ec';

/** The curve names `createECDH` accepts (OpenSSL spellings only). */
const ECDH_CURVE_NAMES = new Map<string, Curve>([
  ['prime256v1', P256],
  ['secp384r1', P384],
  ['secp521r1', P521],
]);

function randomScalar(curve: Curve): bigint {
  const bytes = new Uint8Array(curve.byteLength + 8);
  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    const value = bytesToBigInt(bytes) % curve.n;
    if (value !== 0n) return value;
  }
}

function coded(name: string, code: string, message: string): Error {
  const Ctor = name === 'TypeError' ? TypeError : Error;
  const err = new Ctor(message);
  (err as { code?: string }).code = code;
  return err;
}

function toBytes(value: unknown, encoding?: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    const enc = typeof encoding === 'string' ? encoding.toLowerCase() : 'utf8';
    if (enc === 'hex') {
      const clean = value.length % 2 === 0 ? value : '0' + value;
      const out = new Uint8Array(clean.length >> 1);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
      return out;
    }
    if (enc === 'base64' || enc === 'base64url') {
      const normalized = enc === 'base64url' ? value.replace(/-/g, '+').replace(/_/g, '/') : value;
      const binary = atob(normalized);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(value);
  }
  throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', 'The "key" argument must be a string or Buffer');
}

function encodeOutput(bytes: Uint8Array, encoding?: unknown): Uint8Array | string {
  if (encoding === undefined || encoding === null) return bytes;
  const enc = String(encoding).toLowerCase();
  if (enc === 'hex') {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
  }
  if (enc === 'base64' || enc === 'base64url') {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    return enc === 'base64url' ? base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : base64;
  }
  if (enc === 'buffer') return bytes;
  throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The argument 'encoding' is invalid. Received '${enc}'`);
}

function resolveCurve(name: unknown): Curve {
  if (typeof name !== 'string') {
    throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', 'The "curve" argument must be of type string');
  }
  // `createECDH` only accepts OpenSSL spellings (`P-256` is rejected), unlike
  // `generateKeyPairSync('ec', { namedCurve })` — match Node here.
  const curve = ECDH_CURVE_NAMES.get(name);
  if (!curve) throw coded('Error', 'ERR_CRYPTO_INVALID_CURVE', 'Invalid EC curve name');
  return curve;
}

export class ECDH {
  #curve: Curve;
  #privateKey?: bigint;
  #publicKey?: Point;

  constructor(curveName: unknown) {
    this.#curve = resolveCurve(curveName);
  }

  static convertKey(
    key: unknown,
    curve: unknown,
    inputEncoding?: unknown,
    outputEncoding?: unknown,
    format?: unknown,
  ): Uint8Array | string {
    const resolved = resolveCurve(curve);
    const raw = toBytes(key, inputEncoding);
    const point = decodePublicKey(raw, resolved);
    const compressed = format === 'compressed';
    return encodeOutput(encodePublicKey(point, resolved, compressed), outputEncoding);
  }

  generateKeys(encoding?: unknown, format?: unknown): Uint8Array | string {
    this.#privateKey = randomScalar(this.#curve);
    const point = pointMul(this.#privateKey, generator(this.#curve), this.#curve);
    if (point === null) throw new Error('ECDH: key generation failed');
    this.#publicKey = point;
    return this.getPublicKey(encoding, format);
  }

  computeSecret(otherPublicKey: unknown, inputEncoding?: unknown, outputEncoding?: unknown): Uint8Array | string {
    if (this.#privateKey === undefined) throw coded('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state: no private key');
    const raw = toBytes(otherPublicKey, inputEncoding);
    const point = decodePublicKey(raw, this.#curve);
    if (point.x === 0n && point.y === 0n) {
      throw coded('Error', 'ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY', 'Public key is not valid for specified curve.');
    }
    const shared = pointMul(this.#privateKey, point, this.#curve);
    if (shared === null) throw coded('Error', 'ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY', 'Public key is not valid for specified curve.');
    const x = mod(shared.x, this.#curve.p);
    return encodeOutput(coordToBytes(x, this.#curve), outputEncoding);
  }

  getPrivateKey(encoding?: unknown): Uint8Array | string {
    if (this.#privateKey === undefined) throw coded('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state: no private key');
    return encodeOutput(coordToBytes(this.#privateKey, this.#curve), encoding);
  }

  setPrivateKey(key: unknown, encoding?: unknown): void {
    const value = bytesToBigInt(toBytes(key, encoding));
    if (value <= 0n || value >= this.#curve.n) {
      throw coded('Error', 'ERR_CRYPTO_ECDH_INVALID_PRIVATE_KEY', 'Invalid private key for specified curve.');
    }
    this.#privateKey = value;
    const point = pointMul(value, generator(this.#curve), this.#curve);
    if (point === null) throw new Error('ECDH: invalid private key');
    this.#publicKey = point;
  }

  getPublicKey(encoding?: unknown, format?: unknown): Uint8Array | string {
    if (this.#publicKey === undefined) throw coded('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state: no public key');
    const compressed = format === 'compressed';
    return encodeOutput(encodePublicKey(this.#publicKey, this.#curve, compressed), encoding);
  }

  setPublicKey(key: unknown, encoding?: unknown): void {
    this.#publicKey = decodePublicKey(toBytes(key, encoding), this.#curve);
  }
}

export function createECDH(curveName: unknown): ECDH {
  return new ECDH(curveName);
}
