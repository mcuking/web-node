/**
 * Diffie-Hellman key agreement in pure JS: `crypto.createDiffieHellman`,
 * `crypto.getDiffieHellman`, `crypto.DiffieHellman`, `crypto.DiffieHellmanGroup`.
 *
 * Semantics were derived from the ncrypto + OpenSSL code paths that Node v26
 * uses, and are pinned by `tools/crypto-dh-probe.cjs` (which runs unchanged on
 * real Node and inside web-node):
 *
 *  - The private key size depends on the code path OpenSSL takes. A *named*
 *    group (and an explicit prime that equals a standard group) uses
 *    OpenSSL's recommended exponent size — `BN_priv_rand(bits, TOP_ONE)` for a
 *    named group (fixed byte length), `TOP_ANY` for a matching explicit prime
 *    (variable length). Anything else draws uniformly from `[2, p-2]`.
 *  - `getPrime`/`getGenerator`/`getPublicKey`/`getPrivateKey` return *minimal*
 *    big-endian bytes; the shared secret is padded to the prime length.
 *  - `setPrivateKey` only stores the private key (it does **not** derive the
 *    public key, unlike ECDH); `setPublicKey` only stores the public key.
 *  - `computeSecret` validates the peer first: `<= 1` is "too small",
 *    `>= p - 1` is "too large".
 */
import { bytesToBigInt } from './der';
import { modPow } from './ec';
import { modpGroup, modpGroupNames } from './modp';
import { kByteFactory, outputBytes } from './byte-out';

const ENCODINGS = new Set([
  'utf8', 'utf-8', 'hex', 'base64', 'base64url', 'latin1', 'binary',
  'ascii', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le',
]);

function coded(name: string, code: string, message: string): Error {
  const err = name === 'TypeError'
    ? new TypeError(message)
    : name === 'RangeError'
      ? new RangeError(message)
      : new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

function toBytes(value: unknown, encoding?: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
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
  if (encoding === undefined || encoding === null || encoding === 'buffer') return bytes;
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
  // latin1/utf8/... fall back to returning the raw bytes (Node round-trips the
  // buffer for single-byte encodings of an arbitrary key).
  return bytes;
}

/** OpenSSL's recommended exponent sizes (bits) for the standard groups. */
const GROUP_PRIVATE_BITS: Record<string, number> = {
  modp5: 200,
  modp14: 225,
  modp15: 275,
  modp16: 325,
  modp17: 375,
  modp18: 400,
};

interface DhState {
  prime: bigint;
  primeLength: number;
  generator: bigint;
  generatorLength: number;
  privateKey?: Uint8Array;
  publicKey?: Uint8Array;
  groupName?: string;
}

const STATES = new WeakMap<object, DhState>();

function stateOf(receiver: unknown): DhState {
  const state = STATES.get(receiver as object);
  if (!state) throw new Error('web-node: invalid DiffieHellman receiver');
  return state;
}

function bigIntLength(value: bigint): number {
  return Math.max(1, Math.ceil(value.toString(2).length / 8));
}

/** Minimal big-endian bytes, padded to `length` on the left when given. */
function unsignedBytes(value: bigint, length?: number): Uint8Array {
  const bytes: number[] = [];
  let n = value;
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  if (bytes.length === 0) bytes.push(0);
  if (length !== undefined) {
    while (bytes.length < length) bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function randomBigInt(bytes: number): bigint {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return bytesToBigInt(buffer);
}

function randomBelow(limit: bigint, bytes: number): bigint {
  for (;;) {
    const value = randomBigInt(bytes);
    if (value < limit) return value;
  }
}

/** Generate the private key exactly the way OpenSSL does for this state. */
function generatePrivate(state: DhState): bigint {
  const groupBits = state.groupName !== undefined
    ? GROUP_PRIVATE_BITS[state.groupName]
    : matchPrivateBits(state.prime);
  if (groupBits !== undefined && groupBits > 0) {
    const topOne = state.groupName !== undefined;
    const bytes = Math.ceil(groupBits / 8);
    let value = randomBigInt(bytes);
    // Trim to `groupBits` bits, then (for named groups) force the top bit.
    const mask = (1n << BigInt(groupBits)) - 1n;
    value &= mask;
    if (topOne) value |= 1n << BigInt(groupBits - 1);
    if (value > 1n) return value;
  }
  // Default: uniform in [2, p - 2].
  const limit = state.prime - 3n;
  return randomBelow(limit, state.primeLength) + 2n;
}

/** OpenSSL applies the group's exponent size when the prime *is* a group. */
function matchPrivateBits(prime: bigint): number | undefined {
  for (const name of modpGroupNames()) {
    const group = modpGroup(name);
    if (!group) continue;
    if (bytesToBigInt(hexToBytes(group.primeHex)) === prime) return GROUP_PRIVATE_BITS[name];
  }
  return undefined;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : '0' + hex;
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function publicFromPrivate(state: DhState, privateKey: bigint): Uint8Array {
  return unsignedBytes(modPow(state.generator, privateKey, state.prime));
}

// -- method bodies -----------------------------------------------------------

function dhGenerateKeys(receiver: unknown, encoding?: unknown): Uint8Array | string {
  const state = stateOf(receiver);
  const privateKey = generatePrivate(state);
  state.privateKey = unsignedBytes(privateKey);
  state.publicKey = publicFromPrivate(state, privateKey);
  return outputBytes(receiver, state.publicKey, encoding, encodeOutput);
}

function dhComputeSecret(receiver: unknown, otherPublicKey: unknown, inputEncoding?: unknown, outputEncoding?: unknown): Uint8Array | string {
  const state = stateOf(receiver);
  const peerBytes = toBytes(otherPublicKey, inputEncoding);
  const peer = bytesToBigInt(peerBytes);
  if (peer <= 1n) {
    throw coded('RangeError', 'ERR_CRYPTO_INVALID_KEYLEN', 'Supplied key is too small');
  }
  if (peer >= state.prime - 1n) {
    throw coded('RangeError', 'ERR_CRYPTO_INVALID_KEYLEN', 'Supplied key is too large');
  }
  if (state.privateKey === undefined) {
    throw coded('Error', 'ERR_CRYPTO_OPERATION_FAILED', 'Failed to compute shared secret');
  }
  const secret = modPow(peer, bytesToBigInt(state.privateKey), state.prime);
  const padded = unsignedBytes(secret, state.primeLength);
  return outputBytes(receiver, padded, outputEncoding, encodeOutput);
}

function dhGetPrime(receiver: unknown, encoding?: unknown): Uint8Array | string {
  const state = stateOf(receiver);
  return outputBytes(receiver, unsignedBytes(state.prime), encoding, encodeOutput);
}

function dhGetGenerator(receiver: unknown, encoding?: unknown): Uint8Array | string {
  const state = stateOf(receiver);
  return outputBytes(receiver, unsignedBytes(state.generator), encoding, encodeOutput);
}

function dhGetPublicKey(receiver: unknown, encoding?: unknown): Uint8Array | string {
  const state = stateOf(receiver);
  if (state.publicKey === undefined) {
    throw coded('Error', 'ERR_CRYPTO_INVALID_STATE', 'No public key - did you forget to generate one?');
  }
  return outputBytes(receiver, state.publicKey, encoding, encodeOutput);
}

function dhGetPrivateKey(receiver: unknown, encoding?: unknown): Uint8Array | string {
  const state = stateOf(receiver);
  if (state.privateKey === undefined) {
    throw coded('Error', 'ERR_CRYPTO_INVALID_STATE', 'No private key - did you forget to generate one?');
  }
  return outputBytes(receiver, state.privateKey, encoding, encodeOutput);
}

function dhSetPublicKey(receiver: unknown, key: unknown, encoding?: unknown): unknown {
  const state = stateOf(receiver);
  state.publicKey = unsignedBytes(bytesToBigInt(toBytes(key, encoding)));
  return receiver;
}

function dhSetPrivateKey(receiver: unknown, key: unknown, encoding?: unknown): unknown {
  const state = stateOf(receiver);
  // Node stores the private key as-is; the public key is left untouched.
  state.privateKey = unsignedBytes(bytesToBigInt(toBytes(key, encoding)));
  return receiver;
}

export class DiffieHellman {
  constructor(sizeOrKey: unknown, keyEncoding?: unknown, generator?: unknown, genEncoding?: unknown) {
    STATES.set(this, newState(sizeOrKey, keyEncoding, generator, genEncoding));
    Object.defineProperty(this, 'verifyError', { value: 0, enumerable: true, writable: false });
  }

  generateKeys(encoding?: unknown): Uint8Array | string {
    return dhGenerateKeys(this, encoding);
  }

  computeSecret(otherPublicKey: unknown, inputEncoding?: unknown, outputEncoding?: unknown): Uint8Array | string {
    return dhComputeSecret(this, otherPublicKey, inputEncoding, outputEncoding);
  }

  getPrime(encoding?: unknown): Uint8Array | string {
    return dhGetPrime(this, encoding);
  }

  getGenerator(encoding?: unknown): Uint8Array | string {
    return dhGetGenerator(this, encoding);
  }

  getPublicKey(encoding?: unknown): Uint8Array | string {
    return dhGetPublicKey(this, encoding);
  }

  getPrivateKey(encoding?: unknown): Uint8Array | string {
    return dhGetPrivateKey(this, encoding);
  }

  setPublicKey(key: unknown, encoding?: unknown): this {
    dhSetPublicKey(this, key, encoding);
    return this;
  }

  setPrivateKey(key: unknown, encoding?: unknown): this {
    dhSetPrivateKey(this, key, encoding);
    return this;
  }
}

export class DiffieHellmanGroup {
  constructor(name: unknown) {
    if (typeof name !== 'string') {
      throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', 'The "Group name" argument must be of type string');
    }
    const group = modpGroup(name);
    if (!group) {
      throw coded('Error', 'ERR_CRYPTO_UNKNOWN_DH_GROUP', 'Unknown DH group');
    }
    STATES.set(this, {
      prime: bytesToBigInt(hexToBytes(group.primeHex)),
      primeLength: hexToBytes(group.primeHex).length,
      generator: bytesToBigInt(hexToBytes(group.generatorHex)),
      generatorLength: hexToBytes(group.generatorHex).length,
      groupName: group.name,
    });
    Object.defineProperty(this, 'verifyError', { value: 0, enumerable: true, writable: false });
  }
}

// DiffieHellmanGroup shares the read-only/generate methods, but (like Node) has
// no `setPublicKey` / `setPrivateKey`.
Object.assign(DiffieHellmanGroup.prototype, {
  generateKeys: DiffieHellman.prototype.generateKeys,
  computeSecret: DiffieHellman.prototype.computeSecret,
  getPrime: DiffieHellman.prototype.getPrime,
  getGenerator: DiffieHellman.prototype.getGenerator,
  getPublicKey: DiffieHellman.prototype.getPublicKey,
  getPrivateKey: DiffieHellman.prototype.getPrivateKey,
});

/** True for a valid Node buffer/password encoding (used by the ctor shuffle). */
function isEncoding(value: unknown): boolean {
  return typeof value === 'string' && ENCODINGS.has(value.toLowerCase());
}

function newState(sizeOrKey: unknown, keyEncoding: unknown, generator: unknown, genEncoding: unknown): DhState {
  if (typeof sizeOrKey !== 'number' && typeof sizeOrKey !== 'string'
    && !(sizeOrKey instanceof Uint8Array) && !(sizeOrKey instanceof ArrayBuffer)
    && !ArrayBuffer.isView(sizeOrKey)) {
    throw coded('TypeError', 'ERR_INVALID_ARG_TYPE',
      'The "sizeOrKey" argument must be one of type number or string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received '
      + describe(sizeOrKey));
  }

  let encoding = keyEncoding;
  let gen = generator;
  let genEnc = genEncoding;
  // Node's argument shuffle: a truthy non-encoding second argument is really the
  // generator, and the third becomes the generator encoding.
  if (encoding && !isEncoding(encoding) && encoding !== 'buffer') {
    genEnc = gen;
    gen = encoding;
    encoding = false;
  }

  let prime: bigint;
  let primeLength: number;
  if (typeof sizeOrKey === 'number') {
    if (!Number.isInteger(sizeOrKey) || sizeOrKey < -0x80000000 || sizeOrKey > 0x7fffffff) {
      throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "sizeOrKey" is out of range. It must be an integer. Received ${sizeOrKey}`);
    }
    if (sizeOrKey < 2) {
      throw coded('Error', 'ERR_OSSL_BN_BITS_TOO_SMALL', 'Invalid prime length');
    }
    if (sizeOrKey < 512) {
      throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', 'Invalid DH parameters');
    }
    prime = generatePrime(sizeOrKey);
    primeLength = Math.ceil(sizeOrKey / 8);
  } else {
    const bytes = typeof sizeOrKey === 'number' ? undefined : toBytes(sizeOrKey, encoding === false ? undefined : encoding);
    prime = bytesToBigInt(bytes!);
    primeLength = bytes!.length;
  }

  let g: bigint;
  if (gen === undefined || gen === null || gen === false || gen === 0) {
    g = 2n;
  } else if (typeof gen === 'number') {
    if (!Number.isInteger(gen)) {
      throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "generator" is out of range. It must be an integer. Received ${gen}`);
    }
    g = BigInt(gen);
  } else {
    g = bytesToBigInt(toBytes(gen, genEnc));
  }
  if (g < 2n) {
    throw coded('Error', 'ERR_OSSL_DH_BAD_GENERATOR', 'error:02800065:Diffie-Hellman routines::bad generator');
  }

  return {
    prime,
    primeLength,
    generator: g,
    generatorLength: bigIntLength(g),
  };
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return `${typeof value} ${String(value)}`;
}

/** Generate a probable prime of `bits` bits for the `(bits, generator)` form. */
function generatePrime(bits: number): bigint {
  const bytes = Math.ceil(bits / 8);
  const buffer = new Uint8Array(bytes);
  for (;;) {
    globalThis.crypto.getRandomValues(buffer);
    buffer[0] |= 0x80;
    buffer[bytes - 1] |= 1;
    const candidate = bytesToBigInt(buffer);
    if (candidate.toString(2).length !== bits) continue;
    if (candidate % 3n === 0n || candidate % 5n === 0n || candidate % 7n === 0n) continue;
    if (isProbablePrime(candidate)) return candidate;
  }
}

function modPowBase(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/** A cheap sieve plus Miller-Rabin (enough for DH parameter generation). */
function isProbablePrime(value: bigint): boolean {
  if (value < 2n) return false;
  for (let i = 2n; i < 60000n && i * i <= value; i++) {
    if (value % i === 0n) return false;
  }
  let d = value - 1n;
  let s = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    s += 1n;
  }
  const bytes = Math.ceil(value.toString(2).length / 8);
  for (let round = 0; round < 8; round++) {
    const a = randomBelow(value - 3n, bytes) + 2n;
    let x = modPowBase(a, d, value);
    if (x === 1n || x === value - 1n) continue;
    let composite = true;
    for (let r = 1n; r < s; r++) {
      x = (x * x) % value;
      if (x === value - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

export function createDiffieHellman(
  sizeOrKey: unknown,
  keyEncoding?: unknown,
  generator?: unknown,
  genEncoding?: unknown,
): DiffieHellman {
  return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
}

export function getDiffieHellman(name: string): DiffieHellmanGroup {
  return new DiffieHellmanGroup(name);
}

export { kByteFactory };
