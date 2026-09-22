import type { BuiltinInitContext, BuiltinSpec } from './types';
import { notImplemented } from '../errors';
import {
  concatBytes,
  hkdf,
  hmac,
  listHashes,
  pbkdf2,
  resolveHash,
  scrypt,
  type HashAlgo,
  type ScryptOptions,
} from '../crypto/hash';
import {
  Cipheriv as AesCipheriv,
  aesCmac,
  aesGmac,
  getCipherInfo as lookupCipherInfo,
  isKnownCipherName,
  listCiphers,
  resolveCipher,
  type CipherSpec,
} from '../crypto/cipher';
import {
  KeyObject as AsymKeyObject,
  RSA_NO_PADDING,
  RSA_PKCS1_OAEP_PADDING,
  RSA_PKCS1_PADDING,
  RSA_PKCS1_PSS_PADDING,
  RSA_PSS_SALTLEN_DIGEST,
  RSA_PSS_SALTLEN_MAX,
  RSA_PSS_SALTLEN_MAX_SIGN,
  RSA_X931_PADDING,
  createPrivateKey as asymCreatePrivateKey,
  createPublicKey as asymCreatePublicKey,
  createSecretKey as asymCreateSecretKey,
  generateKeyPairSync as asymGenerateKeyPairSync,
  listCurves,
  parseSignAlgorithm,
  privateDecrypt as asymPrivateDecrypt,
  privateEncrypt as asymPrivateEncrypt,
  publicDecrypt as asymPublicDecrypt,
  publicEncrypt as asymPublicEncrypt,
  sign as asymSign,
  verify as asymVerify,
  type EncryptOptions,
  type GenerateKeyPairOptions,
  type SignAlgorithm,
} from '../crypto/asym';
import { ECDH as RawECDH } from '../crypto/ecdh';
import { X509Certificate as RawX509Certificate } from '../crypto/x509';
import {
  DiffieHellman as RawDiffieHellman,
  DiffieHellmanGroup as RawDiffieHellmanGroup,
} from '../crypto/dh';
import { bufferedClass, kByteFactory } from '../crypto/byte-out';
import {
  generatePrimeBigInt,
  isPrime,
  primeBitLength,
  toUnsignedBigInt,
} from '../crypto/primes';
import { ARGON2_D, ARGON2_I, ARGON2_ID, argon2 as computeArgon2, type Argon2Params } from '../crypto/argon2';
import { blake2b } from '../crypto/blake2b';
import { kmac } from '../crypto/keccak';

/**
 * `crypto` — the subset tooling actually calls in a browser tab.
 *
 * Two very different sources feed this module:
 *
 *  - **Randomness** (`randomBytes`, `randomUUID`, `getRandomValues`, `randomInt`)
 *    rides on WebCrypto, which is exactly the primitive Node uses underneath.
 *  - **Digests / MACs / KDFs** (`createHash`, `createHmac`, `pbkdf2`, `scrypt`,
 *    `hkdf`) have to be computed synchronously, and WebCrypto cannot do that —
 *    `subtle.digest` is a promise. They are implemented directly in
 *    `src/node-runtime/crypto/hash.ts` against the published specs and checked
 *    against Node's OpenSSL output.
 *  - **Symmetric ciphers** (`createCipheriv`/`createDecipheriv`, AES in
 *    ECB/CBC/CTR/CFB/OFB/GCM) are likewise synchronous and streaming, so they
 *    are implemented in `src/node-runtime/crypto/cipher.ts` (FIPS-197 +
 *    SP 800-38A/D) rather than bridged to async WebCrypto.
 *
 * Everything outside that surface (signatures, key objects, Diffie-Hellman,
 * primes) throws a loud, typed error rather than returning garbage.
 */

// --- encoding helpers --------------------------------------------------------

function bytesFromString(input: string, encoding?: string): Uint8Array {
  const enc = (encoding ?? 'utf8').toLowerCase();
  switch (enc) {
    case 'hex': {
      const clean = input.length % 2 === 0 ? input : input.slice(0, -1);
      const out = new Uint8Array(clean.length >> 1);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
      return out;
    }
    case 'base64':
    case 'base64url': {
      const normalized = enc === 'base64url' ? input.replace(/-/g, '+').replace(/_/g, '/') : input;
      const binary = atob(normalized);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    case 'latin1':
    case 'binary': {
      const out = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 0xff;
      return out;
    }
    case 'utf16le':
    case 'utf-16le':
    case 'ucs2':
    case 'ucs-2': {
      const out = new Uint8Array(input.length * 2);
      for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        out[i * 2] = code & 0xff;
        out[i * 2 + 1] = code >> 8;
      }
      return out;
    }
    default:
      return new TextEncoder().encode(input);
  }
}

function toBytes(data: unknown, encoding?: string): Uint8Array {
  if (typeof data === 'string') return bytesFromString(data, encoding);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(0);
}

function encodeOutput(bytes: Uint8Array, encoding?: string): unknown {
  if (encoding === undefined || encoding === null) return bytes;
  const enc = `${encoding}`.toLowerCase();
  if (enc === 'hex') {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }
  if (enc === 'base64' || enc === 'base64url') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    return enc === 'base64url' ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
  }
  if (enc === 'latin1' || enc === 'binary') {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  // Node's only other output encoding here is utf8-ish ("buffer"); return bytes.
  return bytes;
}

// --- errors ------------------------------------------------------------------

function coded(name: string, code: string, message: string): Error {
  const error = new (name === 'TypeError' ? TypeError : name === 'RangeError' ? RangeError : Error)(message);
  (error as { code?: string }).code = code;
  return error;
}

function invalidDigest(algorithm: unknown): Error {
  return coded('TypeError', 'ERR_CRYPTO_INVALID_DIGEST', `Invalid digest: ${String(algorithm)}`);
}

function digestNotSupported(algorithm: unknown): Error {
  return new Error(`Digest method ${String(algorithm)} is not supported`);
}

// --- the module --------------------------------------------------------------

export const cryptoSpec: BuiltinSpec = {
  id: 'crypto',
  aliases: ['node:crypto'],
  origin: 'web-node',
  deps: ['stream'],
  // Node's `Function.length` for the crypto surface (observable-equivalent).
  arity: {
    Hash: 2, Hmac: 3, Sign: 2, Verify: 2, KeyObject: 2, DiffieHellman: 4, DiffieHellmanGroup: 1,
    ECDH: 1, X509Certificate: 1,
    createHash: 2, createHmac: 3, createSign: 2, createVerify: 2, createPrivateKey: 1,
    createPublicKey: 1, createSecretKey: 2, createECDH: 1, createDiffieHellman: 4,
    createDiffieHellmanGroup: 1, getDiffieHellman: 1, diffieHellman: 2,
    randomInt: 3, randomUUID: 1, scrypt: 4, scryptSync: 3, timingSafeEqual: 0,
    sign: 4, verify: 5, privateEncrypt: 2, privateDecrypt: 2, publicEncrypt: 2, publicDecrypt: 2,
    generateKey: 3, generateKeySync: 2, generateKeyPair: 3, generateKeyPairSync: 2,
    generatePrime: 3, generatePrimeSync: 1, checkPrime: 1, checkPrimeSync: 1,
    argon2: 3, argon2Sync: 2, createMac: 3, getMacs: 0, encapsulate: 2, decapsulate: 3, setFips: 1,
  },
  init: (ctx: BuiltinInitContext) => {
    const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
    if (!webcrypto) throw new Error('web-node: this host has no WebCrypto');

    // The runtime's own `Buffer`. Resolved lazily: `crypto` may materialise
    // before `buffer` does, and there is no reason to force the order.
    const asBuffer = (bytes: Uint8Array): Uint8Array =>
      (ctx.require('buffer') as { Buffer: { from(input: Uint8Array): Uint8Array } }).Buffer.from(bytes);

    // Stamp the byte factory onto a freshly built object. Every value `crypto`
    // hands back that Node returns as a `Buffer` goes through here.
    const withBytes = <T extends object>(value: T): T => {
      (value as { [kByteFactory]?: unknown })[kByteFactory] = asBuffer;
      return value;
    };
    const KeyObject = bufferedClass(AsymKeyObject, asBuffer, {
      from: (key: unknown) => withBytes(AsymKeyObject.from(key)),
    });

    // -- randomness -----------------------------------------------------------

    const randomBytes = (size: number, callback?: (err: Error | null, buf?: Uint8Array) => void): Uint8Array | void => {
      if (!Number.isSafeInteger(size) || size < 0 || size > 2 ** 31 - 1) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "size" is out of range. It must be >= 0 && <= ${2 ** 31 - 1}. Received ${size}`);
      }
      if (typeof callback === 'function') {
        queueMicrotask(() => {
          try {
            callback(null, asBuffer(randomBytes(size) as Uint8Array));
          } catch (error) {
            callback(error as Error);
          }
        });
        return undefined;
      }
      const out = new Uint8Array(size);
      webcrypto.getRandomValues(out);
      return asBuffer(out);
    };

    const randomFillSync = (buffer: Uint8Array, offset = 0, size?: number): Uint8Array => {
      if (!ArrayBuffer.isView(buffer)) {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', 'The "buf" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.');
      }
      const length = buffer.byteLength;
      const count = size ?? length - offset;
      if (offset < 0 || offset > length) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "offset" is out of range. It must be >= 0 && <= ${length}. Received ${offset}`);
      }
      if (count < 0 || offset + count > length) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "size" is out of range. It must be >= 0 && <= ${length - offset}. Received ${count}`);
      }
      const view = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, count);
      webcrypto.getRandomValues(view);
      return buffer;
    };

    const randomFill = (
      buffer: Uint8Array,
      offsetOrCb?: number | ((err: Error | null, buf?: Uint8Array) => void),
      sizeOrCb?: number | ((err: Error | null, buf?: Uint8Array) => void),
      maybeCb?: (err: Error | null, buf?: Uint8Array) => void,
    ): Uint8Array | void => {
      let offset = 0;
      let size: number | undefined;
      let cb: ((err: Error | null, buf?: Uint8Array) => void) | undefined;
      if (typeof offsetOrCb === 'function') {
        cb = offsetOrCb;
      } else {
        offset = offsetOrCb ?? 0;
        if (typeof sizeOrCb === 'function') cb = sizeOrCb;
        else {
          size = sizeOrCb;
          cb = maybeCb;
        }
      }
      if (typeof cb === 'function') {
        queueMicrotask(() => {
          try {
            cb!(null, randomFillSync(buffer, offset, size));
          } catch (error) {
            cb!(error as Error);
          }
        });
        return undefined;
      }
      return randomFillSync(buffer, offset, size);
    };

    const randomInt = (
      ...args: Array<number | ((err: Error | null, value?: number) => void)>
    ): number | void => {
      let cb: ((err: Error | null, value?: number) => void) | undefined;
      const nums = args.filter((arg): arg is number => {
        if (typeof arg === 'function') {
          cb = arg;
          return false;
        }
        return true;
      });
      let min = 0;
      let max: number;
      if (nums.length === 1) {
        max = nums[0];
      } else {
        min = nums[0];
        max = nums[1];
      }
      for (const [name, value] of [['min', min], ['max', max]] as Array<[string, number]>) {
        if (!Number.isSafeInteger(value)) {
          throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "${name}" argument must be a safe integer. Received type ${typeof value} (${value})`);
        }
      }
      const range = max - min;
      if (range <= 0 || range > 2 ** 48) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "max" is out of range. It must be greater than the value of "min" (${min}). Received ${max}`);
      }
      const sample = (): number => {
        const bytes = new Uint8Array(6);
        webcrypto.getRandomValues(bytes);
        let value = 0;
        for (let i = 0; i < 6; i++) value = value * 256 + bytes[i];
        return value;
      };
      const limit = Math.floor(2 ** 48 / range) * range;
      let value = sample();
      while (value >= limit) value = sample();
      const result = min + (value % range);
      if (typeof cb === 'function') {
        queueMicrotask(() => cb!(null, result));
        return undefined;
      }
      return result;
    };

    // Node's `Hash`/`Hmac`/`Cipheriv`/`Decipheriv` are `stream.Transform`
    // subclasses (`Sign`/`Verify` are `Writable`). We mirror that so the whole
    // stream surface — prototype members and statics — is present for feature
    // detection; hashing/ciphering stays our own implementation.
    interface StreamBase {
      push(chunk: unknown): boolean;
    }
    const streamBases = ctx.require('stream') as {
      Transform: new (opts?: Record<string, unknown>) => StreamBase;
      Writable: new (opts?: Record<string, unknown>) => StreamBase;
    };
    const TransformBase = streamBases.Transform;
    const WritableBase = streamBases.Writable;

    // Node's crypto streams extend `LazyTransform` (internal/streams/
    // lazy_transform.js): a Transform whose `_readableState`/`_writableState`
    // are prototype accessors that create the stream state on first access. We
    // reproduce it verbatim so both members live on the prototype exactly as in
    // Node, and hashing/ciphering stays lazy.
    const TransformCtor = TransformBase as unknown as {
      new (opts?: unknown): StreamBase;
      prototype: object;
      call(thisArg: unknown, opts?: unknown): void;
    };
    function LazyTransform(this: { _options?: unknown }, options?: unknown): void {
      this._options = options;
    }
    Object.setPrototypeOf(LazyTransform.prototype, TransformCtor.prototype);
    Object.setPrototypeOf(LazyTransform, TransformCtor as unknown as object);
    const makeStateGetter =
      (name: string) =>
      function (this: Record<string, unknown>): unknown {
        (TransformCtor as unknown as (this: unknown, opts?: unknown) => void).call(this, this._options);
        (this._writableState as { decodeStrings: boolean }).decodeStrings = false;
        return this[name];
      };
    const makeStateSetter =
      (name: string) =>
      function (this: Record<string, unknown>, value: unknown): void {
        Object.defineProperty(this, name, { value, enumerable: true, configurable: true, writable: true });
      };
    Object.defineProperties(LazyTransform.prototype, {
      _readableState: { get: makeStateGetter('_readableState'), set: makeStateSetter('_readableState'), configurable: true, enumerable: true },
      _writableState: { get: makeStateGetter('_writableState'), set: makeStateSetter('_writableState'), configurable: true, enumerable: true },
    });
    const LazyTransformBase = LazyTransform as unknown as new (opts?: Record<string, unknown>) => StreamBase;

    // -- digests --------------------------------------------------------------

    /**
     * `crypto.Hash` — and the class `crypto.createHash()` returns. Node
     * deprecates `new Hash(...)` but it still works, so we support both.
     */
    class Hash extends LazyTransformBase {
      #name: string;
      #algo: HashAlgo;
      #chunks: Uint8Array[] = [];
      #total = 0;
      #finalized = false;

      constructor(algorithm: unknown, options?: unknown) {
        super(options as Record<string, unknown> | undefined);
        if (typeof algorithm !== 'string') {
          throw coded(
            'TypeError',
            'ERR_INVALID_ARG_TYPE',
            `The "algorithm" argument must be of type string. Received ${describe(algorithm)}`,
          );
        }
        const algo = resolveHash(algorithm);
        if (!algo) throw new Error('Digest method not supported');
        this.#name = algorithm;
        this.#algo = algo;
      }

      update(data: unknown, encoding?: string): this {
        if (this.#finalized) throw coded('Error', 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
        const bytes = toBytes(data, encoding);
        this.#chunks.push(bytes);
        this.#total += bytes.length;
        return this;
      }

      digest(encoding?: string): unknown {
        if (this.#finalized) throw coded('Error', 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
        this.#finalized = true;
        const result = this.#algo.hash(concatBytes(this.#chunks, this.#total));
        return encodeOutput(asBuffer(result), encoding);
      }

      copy(): Hash {
        const clone = new Hash(this.#name);
        for (const chunk of this.#chunks) clone.update(chunk);
        return clone;
      }

      _transform(chunk: unknown, encoding: string, callback: (err?: Error | null) => void): void {
        try {
          this.update(chunk, encoding);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }

      _flush(callback: (err?: Error | null) => void): void {
        try {
          const digest = this.digest();
          if (digest) this.push(digest);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }
    }

    const createHash = (algorithm: string): Hash => new Hash(algorithm);

    /** `crypto.Hmac` — and the class `crypto.createHmac()` returns. */
    class Hmac extends LazyTransformBase {
      #algo: HashAlgo;
      #keyBytes: Uint8Array;
      #chunks: Uint8Array[] = [];
      #total = 0;
      #finalized = false;

      constructor(algorithm: unknown, key: unknown, options?: unknown) {
        super(options as Record<string, unknown> | undefined);
        if (typeof algorithm !== 'string') {
          throw coded(
            'TypeError',
            'ERR_INVALID_ARG_TYPE',
            `The "hmac" argument must be of type string. Received ${describe(algorithm)}`,
          );
        }
        const algo = resolveHash(algorithm);
        if (!algo) throw invalidDigest(algorithm);
        this.#algo = algo;
        this.#keyBytes = toBytes(key);
      }

      update(data: unknown, encoding?: string): this {
        if (this.#finalized) throw coded('Error', 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
        const bytes = toBytes(data, encoding);
        this.#chunks.push(bytes);
        this.#total += bytes.length;
        return this;
      }

      digest(encoding?: string): unknown {
        if (this.#finalized) throw coded('Error', 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
        this.#finalized = true;
        const result = hmac(this.#algo, this.#keyBytes, concatBytes(this.#chunks, this.#total));
        return encodeOutput(asBuffer(result), encoding);
      }

      _transform(chunk: unknown, encoding: string, callback: (err?: Error | null) => void): void {
        try {
          this.update(chunk, encoding);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }

      _flush(callback: (err?: Error | null) => void): void {
        try {
          const digest = this.digest();
          if (digest) this.push(digest);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }
    }

    const createHmac = (algorithm: string, key: unknown): Hmac => new Hmac(algorithm, key);

    const hash = (algorithm: string, data: unknown, outputEncoding?: string): unknown => {
      if (typeof data !== 'string' && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', 'The "data" argument must be an instance of ArrayBuffer, Buffer, TypedArray, DataView, or string.');
      }
      const algo = resolveHash(algorithm);
      if (!algo) throw digestNotSupported(algorithm);
      const result = algo.hash(toBytes(data));
      return encodeOutput(asBuffer(result), outputEncoding);
    };

    // -- key derivation -------------------------------------------------------

    const checkIterations = (iterations: number): void => {
      if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 2 ** 31 - 1) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "iterations" is out of range. It must be >= 1 && <= ${2 ** 31 - 1}. Received ${iterations}`);
      }
    };

    const checkDerivedKeyLength = (keylen: number): void => {
      // Node reports a zero/negative key length as a bare derivation failure
      // (no `code`); mirroring that keeps `err.code` checks behaving the same.
      if (!Number.isSafeInteger(keylen) || keylen < 1) throw new Error('PBKDF2 derivation failed');
    };

    const pbkdf2Sync = (
      password: unknown,
      salt: unknown,
      iterations: number,
      keylen: number,
      digest: string,
    ): Uint8Array => {
      const algo = resolveHash(digest);
      if (!algo) throw invalidDigest(digest);
      checkIterations(iterations);
      checkDerivedKeyLength(keylen);
      return asBuffer(pbkdf2(algo, toBytes(password), toBytes(salt), iterations, keylen));
    };

    const pbkdf2Async = (
      password: unknown,
      salt: unknown,
      iterations: number,
      keylen: number,
      digest: string,
      callback: (err: Error | null, derivedKey?: Uint8Array) => void,
    ): void => {
      queueMicrotask(() => {
        try {
          callback(null, pbkdf2Sync(password, salt, iterations, keylen, digest));
        } catch (error) {
          callback(error as Error);
        }
      });
    };

    const hkdfSync = (digest: string, ikm: unknown, salt: unknown, info: unknown, keylen: number): ArrayBuffer => {
      const algo = resolveHash(digest);
      if (!algo) throw invalidDigest(digest);
      // node:crypto returns an ArrayBuffer here, not a Buffer.
      return hkdf(algo, toBytes(ikm), toBytes(salt), toBytes(info), keylen).buffer as ArrayBuffer;
    };

    const hkdfAsync = (
      digest: string,
      ikm: unknown,
      salt: unknown,
      info: unknown,
      keylen: number,
      callback: (err: Error | null, derivedKey?: ArrayBuffer) => void,
    ): void => {
      queueMicrotask(() => {
        try {
          callback(null, hkdfSync(digest, ikm, salt, info, keylen));
        } catch (error) {
          callback(error as Error);
        }
      });
    };

    const scryptSync = (
      password: unknown,
      salt: unknown,
      keylen: number,
      options?: ScryptOptions,
    ): Uint8Array => asBuffer(scrypt(toBytes(password), toBytes(salt), keylen, options));

    const scryptAsync = (
      password: unknown,
      salt: unknown,
      keylen: number,
      optionsOrCb: ScryptOptions | ((err: Error | null, derivedKey?: Uint8Array) => void),
      maybeCb?: (err: Error | null, derivedKey?: Uint8Array) => void,
    ): void => {
      const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
      const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb!;
      queueMicrotask(() => {
        try {
          callback(null, scryptSync(password, salt, keylen, options));
        } catch (error) {
          callback(error as Error);
        }
      });
    };

    // -- constant-time comparison ---------------------------------------------

    const timingSafeEqual = (a: unknown, b: unknown): boolean => {
      if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', 'The "buf1" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.');
      }
      const left = toBytes(a);
      const right = toBytes(b);
      if (left.byteLength !== right.byteLength) {
        throw coded('RangeError', 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH', 'Input buffers must have the same byte length');
      }
      let mismatch = 0;
      for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
      return mismatch === 0;
    };

    // -- symmetric ciphers ---------------------------------------------------
    //
    // AES (ECB/CBC/CTR/CFB/OFB/GCM) is real, implemented in
    // `../crypto/cipher.ts` because Node's ciphers are synchronous and OpenSSL
    // bindings that WebCrypto's promise-based API cannot substitute for. Ciphers
    // OpenSSL knows but this runtime does not implement (Camellia, ARIA, SM4,
    // DES/3DES, ChaCha20-Poly1305, CCM, OCB, SIV, XTS, wrap, …) raise a typed
    // `NotImplementedError`; a name OpenSSL does not know raises
    // `ERR_CRYPTO_UNKNOWN_CIPHER`, just like Node.

    const describe = (value: unknown): string => {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'object') {
        if (Array.isArray(value)) return 'an instance of Array';
        const name = (value as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
        return `an instance of ${name}`;
      }
      if (typeof value === 'string') {
        return value.includes("'") ? `type string (${JSON.stringify(value)})` : `type string ('${value}')`;
      }
      return `type ${typeof value} (${String(value)})`;
    };

    const isRawBytes = (value: unknown): value is ArrayBuffer | SharedArrayBuffer =>
      value instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer);

    const coerceKey = (key: unknown): Uint8Array => {
      if (typeof key === 'string') return bytesFromString(key, 'utf8');
      if (key instanceof Uint8Array) return key;
      if (ArrayBuffer.isView(key)) return new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
      if (isRawBytes(key)) return new Uint8Array(key as ArrayBuffer);
      throw coded(
        'TypeError',
        'ERR_INVALID_ARG_TYPE',
        `The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey. Received ${describe(key)}`,
      );
    };

    const coerceIv = (iv: unknown, spec: CipherSpec): Uint8Array | null => {
      if (iv === undefined) {
        throw coded(
          'TypeError',
          'ERR_INVALID_ARG_TYPE',
          `The "iv" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received undefined`,
        );
      }
      let bytes: Uint8Array | null = null;
      if (iv === null) bytes = null;
      else if (typeof iv === 'string') bytes = bytesFromString(iv, 'utf8');
      else if (iv instanceof Uint8Array) bytes = iv;
      else if (ArrayBuffer.isView(iv)) bytes = new Uint8Array(iv.buffer, iv.byteOffset, iv.byteLength);
      else if (isRawBytes(iv)) bytes = new Uint8Array(iv as ArrayBuffer);
      else {
        throw coded(
          'TypeError',
          'ERR_INVALID_ARG_TYPE',
          `The "iv" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received ${describe(iv)}`,
        );
      }
      const invalid = (): never => {
        throw coded('TypeError', 'ERR_CRYPTO_INVALID_IV', 'Invalid initialization vector');
      };
      if (spec.ivLength === null) {
        // ECB takes no IV; anything non-empty is a mistake.
        if (bytes !== null && bytes.length > 0) invalid();
        return null;
      }
      if (bytes === null || bytes.length === 0) invalid();
      // GCM accepts any positive IV length (OpenSSL derives J0); the other modes
      // require exactly the block-sized IV.
      if (spec.mode === 'gcm' ? (bytes as Uint8Array).length < 1 : (bytes as Uint8Array).length !== spec.ivLength) invalid();
      return bytes;
    };

    const coerceCipherInput = (data: unknown, encoding?: string): Uint8Array => {
      if (typeof data === 'string') return bytesFromString(data, encoding);
      if (data instanceof Uint8Array) return data;
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (isRawBytes(data)) return new Uint8Array(data as ArrayBuffer);
      throw coded(
        'TypeError',
        'ERR_INVALID_ARG_TYPE',
        `The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ${describe(data)}`,
      );
    };

    const coerceBytes = (value: unknown, name: string): Uint8Array => {
      if (value instanceof Uint8Array) return value;
      if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (isRawBytes(value)) return new Uint8Array(value as ArrayBuffer);
      throw coded(
        'TypeError',
        'ERR_INVALID_ARG_TYPE',
        `The "${name}" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received ${describe(value)}`,
      );
    };

    /** Validate cipher arguments and build the shared AES state. */
    const createCipherState = (
      algorithm: unknown,
      key: unknown,
      iv: unknown,
      options: unknown,
      encrypt: boolean,
    ): AesCipheriv => {
      const spec = resolveCipher(algorithm);
      if (!spec) {
        const name = `${algorithm}`;
        if (isKnownCipherName(name)) throw notImplemented('api', `crypto cipher "${name}"`);
        throw coded('Error', 'ERR_CRYPTO_UNKNOWN_CIPHER', 'Unknown cipher');
      }
      const keyBytes = coerceKey(key);
      if (keyBytes.length !== spec.keyLength) {
        throw coded('RangeError', 'ERR_CRYPTO_INVALID_KEYLEN', 'Invalid key length');
      }
      const ivBytes = coerceIv(iv, spec);
      const authTagLength =
        (options as { authTagLength?: number } | undefined)?.authTagLength ?? 16;
      return new AesCipheriv(spec, keyBytes, ivBytes, encrypt, authTagLength);
    };

    // `crypto.Cipheriv` / `crypto.Decipheriv` are `stream.Transform` subclasses
    // in Node; constructors match `createCipheriv`/`createDecipheriv`. The real
    // AES state lives in a private field and the methods sit on the prototype,
    // so `instanceof`, `.pipe()` and the whole stream surface behave.
    class Cipheriv extends LazyTransformBase {
      #inner: AesCipheriv;

      constructor(algorithm: unknown, key: unknown, iv?: unknown, options?: unknown) {
        super(options as Record<string, unknown> | undefined);
        this.#inner = createCipherState(algorithm, key, iv, options, true);
      }

      update(data: unknown, inputEncoding?: string, outputEncoding?: string): unknown {
        return encodeOutput(asBuffer(this.#inner.update(coerceCipherInput(data, inputEncoding))), outputEncoding);
      }

      final(outputEncoding?: string): unknown {
        return encodeOutput(asBuffer(this.#inner.final()), outputEncoding);
      }

      setAutoPadding(autoPadding?: boolean): this {
        this.#inner.setAutoPadding(autoPadding);
        return this;
      }

      setAAD(aad: unknown): this {
        this.#inner.setAAD(coerceBytes(aad, 'aad'));
        return this;
      }

      getAuthTag(): unknown {
        return asBuffer(this.#inner.getAuthTag());
      }

      _transform(chunk: unknown, encoding: string, callback: (err?: Error | null) => void): void {
        try {
          const out = this.#inner.update(coerceCipherInput(chunk, encoding));
          if (out.length) this.push(out);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }

      _flush(callback: (err?: Error | null) => void): void {
        try {
          const out = this.#inner.final();
          if (out.length) this.push(out);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }
    }

    class Decipheriv extends LazyTransformBase {
      #inner: AesCipheriv;

      constructor(algorithm: unknown, key: unknown, iv?: unknown, options?: unknown) {
        super(options as Record<string, unknown> | undefined);
        this.#inner = createCipherState(algorithm, key, iv, options, false);
      }

      update(data: unknown, inputEncoding?: string, outputEncoding?: string): unknown {
        return encodeOutput(asBuffer(this.#inner.update(coerceCipherInput(data, inputEncoding))), outputEncoding);
      }

      final(outputEncoding?: string): unknown {
        return encodeOutput(asBuffer(this.#inner.final()), outputEncoding);
      }

      setAutoPadding(autoPadding?: boolean): this {
        this.#inner.setAutoPadding(autoPadding);
        return this;
      }

      setAAD(aad: unknown): this {
        this.#inner.setAAD(coerceBytes(aad, 'aad'));
        return this;
      }

      setAuthTag(tag: unknown): this {
        this.#inner.setAuthTag(coerceBytes(tag, 'tag'));
        return this;
      }

      _transform(chunk: unknown, encoding: string, callback: (err?: Error | null) => void): void {
        try {
          const out = this.#inner.update(coerceCipherInput(chunk, encoding));
          if (out.length) this.push(out);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }

      _flush(callback: (err?: Error | null) => void): void {
        try {
          const out = this.#inner.final();
          if (out.length) this.push(out);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }
    }

    const createCipheriv = (algorithm: unknown, key: unknown, iv?: unknown, options?: unknown) =>
      new Cipheriv(algorithm, key, iv, options) as unknown as Record<string, unknown>;
    const createDecipheriv = (algorithm: unknown, key: unknown, iv?: unknown, options?: unknown) =>
      new Decipheriv(algorithm, key, iv, options) as unknown as Record<string, unknown>;
    const getCipherInfo = (nameOrNid: string | number) => lookupCipherInfo(nameOrNid);

    // -- explicitly unsupported ----------------------------------------------
    //
    // These need real crypto primitives (ciphers, signatures, asymmetric keys,
    // primes) or a native key store. They throw `NotImplementedError` rather
    // than returning `undefined`, so a caller that reaches one finds out.

    const unsupportedApi = (name: string): (() => never) => () => {
      throw notImplemented('api', `crypto.${name}`);
    };
    const unsupportedApis = {
      diffieHellman: unsupportedApi('diffieHellman'),
      encapsulate: unsupportedApi('encapsulate'),
      decapsulate: unsupportedApi('decapsulate'),
    };

    // -- symmetric key generation ------------------------------------------
    //
    // `generateKey`/`generateKeySync` only know `'hmac'` and `'aes'` — Node
    // rejects every other type — and both hand back a `secret` KeyObject.

    const inspectArg = (value: unknown): string => {
      if (typeof value === 'string') return `'${value}'`;
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'object') return describe(value);
      return String(value);
    };

    const secretKeyLength = (type: unknown, options: unknown): number => {
      if (typeof type !== 'string') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "type" argument must be of type string. Received ${describe(type)}`);
      }
      if (options === null || typeof options !== 'object') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "options" argument must be of type object. Received ${describe(options)}`);
      }
      const length = (options as { length?: unknown }).length;
      if (type === 'hmac') {
        if (typeof length !== 'number') {
          throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "options.length" property must be of type number. Received ${describe(length)}`);
        }
        if (!Number.isInteger(length) || length < 8 || length > 2 ** 31 - 1) {
          throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "options.length" is out of range. It must be >= 8 && <= ${2 ** 31 - 1}. Received ${length}`);
        }
        return length;
      }
      if (type === 'aes') {
        if (length !== 128 && length !== 192 && length !== 256) {
          throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The property 'options.length' must be one of: 128, 192, 256. Received ${inspectArg(length)}`);
        }
        return length;
      }
      throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The argument 'type' must be a supported key type. Received '${type}'`);
    };

    const generateKeySync = (type: unknown, options: unknown): AsymKeyObject => {
      const length = secretKeyLength(type, options);
      return createSecretKey(randomBytes(Math.floor(length / 8)) as Uint8Array);
    };

    const generateKey = (type: unknown, options: unknown, callback?: unknown): void => {
      let cb = callback;
      let opts = options;
      if (typeof options === 'function') {
        cb = options;
        opts = undefined;
      }
      if (typeof cb !== 'function') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "callback" argument must be of type function. Received ${describe(cb)}`);
      }
      const key = generateKeySync(type, opts);
      queueMicrotask(() => (cb as (error: Error | null, key: unknown) => void)(null, key));
    };

    // FIPS is a build-time property of Node's OpenSSL; here it is simply off.
    const getFips = (): number => 0;
    const setFips = (_value: unknown): void => {};

    // -- prime generation and primality testing -----------------------------
    //
    // Backed by `../crypto/primes` (BigInt Miller-Rabin plus the candidate
    // shapes `BN_generate_prime_ex2` produces). The validation below mirrors
    // Node's `internal/crypto/random.js` so the error surface is identical.

    const INTEGER_MAX = 2 ** 31 - 1;
    const argWord = (name: string): string => (name.includes('.') ? 'property' : 'argument');

    const validateInt32 = (value: unknown, name: string, min: number): number => {
      if (typeof value !== 'number') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "${name}" ${argWord(name)} must be of type number. Received ${describe(value)}`);
      }
      if (!Number.isInteger(value)) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "${name}" is out of range. It must be an integer. Received ${value}`);
      }
      if (value < min || value > INTEGER_MAX) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "${name}" is out of range. It must be >= ${min} && <= ${INTEGER_MAX}. Received ${value}`);
      }
      return value;
    };

    const validateObjectArg = (value: unknown, name: string): void => {
      if (value === null || typeof value !== 'object') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "${name}" ${argWord(name)} must be of type object. Received ${describe(value)}`);
      }
    };

    const validateBooleanProp = (value: unknown, name: string): void => {
      if (typeof value !== 'boolean') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "${name}" property must be of type boolean. Received ${describe(value)}`);
      }
    };

    // `unsignedBigIntToBuffer` + the C++ `BignumPointer` ingest, collapsed to
    // the resulting value: negative bigints are rejected, byte sources are read
    // big-endian, anything else raises the Node invalid-argument error.
    const toNonNegativeBigInt = (value: unknown, name: string): bigint => {
      if (typeof value === 'bigint') {
        if (value < 0n) {
          throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "${name}" is out of range. It must be >= 0. Received ${value}n`);
        }
        return value;
      }
      if (!isRawBytes(value) && !ArrayBuffer.isView(value)) {
        throw coded(
          'TypeError',
          'ERR_INVALID_ARG_TYPE',
          `The "${name}" ${argWord(name)} must be of type bigint or an instance of ArrayBuffer, TypedArray, Buffer, or DataView. Received ${describe(value)}`,
        );
      }
      return toUnsignedBigInt(toBytes(value));
    };

    const bigIntToArrayBuffer = (value: bigint): ArrayBuffer => {
      const bytes: number[] = [];
      let rest = value;
      while (rest > 0n) {
        bytes.unshift(Number(rest & 0xffn));
        rest >>= 8n;
      }
      return Uint8Array.from(bytes).buffer;
    };

    interface PrimeRequest {
      safe: boolean;
      bigint: boolean;
      add?: bigint;
      rem?: bigint;
    }

    const parsePrimeOptions = (options: unknown): PrimeRequest => {
      const opts = (options === undefined ? {} : options) as Record<string, unknown>;
      validateObjectArg(opts, 'options');
      const safe = opts.safe ?? false;
      const bigint = opts.bigint ?? false;
      validateBooleanProp(safe, 'options.safe');
      validateBooleanProp(bigint, 'options.bigint');
      const add = opts.add === undefined ? undefined : toNonNegativeBigInt(opts.add, 'options.add');
      const rem = opts.rem === undefined ? undefined : toNonNegativeBigInt(opts.rem, 'options.rem');
      return { safe: safe as boolean, bigint: bigint as boolean, add, rem };
    };

    // `RandomPrimeConfig::AdditionalConfig`, then OpenSSL's own guard against
    // generating anything below two bits.
    const runGeneratePrime = (bits: number, request: PrimeRequest): ArrayBuffer | bigint => {
      const { safe, bigint, add, rem } = request;
      if (add !== undefined) {
        if (primeBitLength(add) > bits) {
          throw coded('RangeError', 'ERR_OUT_OF_RANGE', 'invalid options.add');
        }
        if (rem !== undefined && add <= rem) {
          throw coded('RangeError', 'ERR_OUT_OF_RANGE', 'invalid options.rem');
        }
      }
      if (bits <= 1) {
        // `BN_R_BITS_TOO_SMALL`, surfaced as Node surfaces it.
        throw coded('Error', 'ERR_OSSL_BN_BITS_TOO_SMALL', 'error:01800076:bignum routines::bits too small');
      }
      const prime = generatePrimeBigInt(bits, { safe, add, rem });
      return bigint ? prime : bigIntToArrayBuffer(prime);
    };

    const normalizeCandidate = (candidate: unknown): bigint =>
      toNonNegativeBigInt(candidate, 'candidate');

    const generatePrimeSync = (size: unknown, options?: unknown): ArrayBuffer | bigint => {
      const bits = validateInt32(size, 'size', 1);
      return runGeneratePrime(bits, parsePrimeOptions(options));
    };

    const generatePrime = (size: unknown, options?: unknown, callback?: unknown): void => {
      const bits = validateInt32(size, 'size', 1);
      let cb = callback;
      let opts = options;
      if (typeof options === 'function') {
        cb = options;
        opts = undefined;
      }
      if (typeof cb !== 'function') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "callback" argument must be of type function. Received ${describe(cb)}`);
      }
      const request = parsePrimeOptions(opts);
      let result: ArrayBuffer | bigint;
      try {
        result = runGeneratePrime(bits, request);
      } catch (error) {
        queueMicrotask(() => (cb as (e: unknown) => void)(error));
        return;
      }
      queueMicrotask(() => (cb as (e: Error | null, prime: unknown) => void)(null, result));
    };

    const checkPrimeSync = (candidate: unknown, options?: unknown): boolean => {
      const value = normalizeCandidate(candidate);
      const opts = (options === undefined ? {} : options) as Record<string, unknown>;
      validateObjectArg(opts, 'options');
      const checks = opts.checks ?? 0;
      validateInt32(checks, 'options.checks', 0);
      return isPrime(value);
    };

    const checkPrime = (candidate: unknown, options?: unknown, callback?: unknown): void => {
      const value = normalizeCandidate(candidate);
      let cb = callback;
      let opts = options;
      if (typeof options === 'function') {
        cb = options;
        opts = undefined;
      }
      if (typeof cb !== 'function') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "callback" argument must be of type function. Received ${describe(cb)}`);
      }
      const obj = (opts === undefined ? {} : opts) as Record<string, unknown>;
      validateObjectArg(obj, 'options');
      const checks = obj.checks ?? 0;
      validateInt32(checks, 'options.checks', 0);
      const result = isPrime(value);
      queueMicrotask(() => (cb as (e: Error | null, isPrimeResult: boolean) => void)(null, result));
    };

    // -- Argon2 -------------------------------------------------------------
    //
    // `../crypto/argon2` implements RFC 9106; the validation below mirrors
    // Node's `internal/crypto/argon2.js` `check()` so the surface matches.

    const MAX_UINT32 = 2 ** 32 - 1;
    const argon2Types = new Map<string, number>([
      ['argon2d', ARGON2_D],
      ['argon2i', ARGON2_I],
      ['argon2id', ARGON2_ID],
    ]);

    const validateIntegerBounds = (value: unknown, name: string, min: number, max: number): number => {
      if (typeof value !== 'number') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "${name}" ${argWord(name)} must be of type number. Received ${describe(value)}`);
      }
      if (!Number.isInteger(value)) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "${name}" is out of range. It must be an integer. Received ${value}`);
      }
      if (value < min || value > max) {
        throw coded('RangeError', 'ERR_OUT_OF_RANGE', `The value of "${name}" is out of range. It must be >= ${min} && <= ${max}. Received ${value}`);
      }
      return value;
    };

    // `getArrayBufferOrView`: strings become their UTF-8 bytes.
    const coerceBytesOrString = (value: unknown, name: string): Uint8Array => {
      if (typeof value === 'string') return bytesFromString(value, undefined);
      if (value instanceof Uint8Array) return value;
      if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (isRawBytes(value)) return new Uint8Array(value as ArrayBuffer);
      throw coded(
        'TypeError',
        'ERR_INVALID_ARG_TYPE',
        `The "${name}" property must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received ${describe(value)}`,
      );
    };

    const checkArgon2 = (algorithm: unknown, parameters: unknown): Argon2Params => {
      if (typeof algorithm !== 'string') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "algorithm" argument must be of type string. Received ${describe(algorithm)}`);
      }
      const type = argon2Types.get(algorithm);
      if (type === undefined) {
        throw coded(
          'TypeError',
          'ERR_INVALID_ARG_VALUE',
          `The argument 'algorithm' must be one of: 'argon2d', 'argon2i', 'argon2id'. Received '${algorithm}'`,
        );
      }
      validateObjectArg(parameters, 'parameters');
      const params = parameters as Record<string, unknown>;
      const { parallelism, tagLength, memory, passes } = params;

      const password = coerceBytesOrString(params.message, 'parameters.message');
      validateIntegerBounds(password.length, 'parameters.message.byteLength', 0, MAX_UINT32);

      const salt = coerceBytesOrString(params.nonce, 'parameters.nonce');
      validateIntegerBounds(salt.length, 'parameters.nonce.byteLength', 8, MAX_UINT32);

      validateIntegerBounds(parallelism, 'parameters.parallelism', 1, 2 ** 24 - 1);
      validateIntegerBounds(tagLength, 'parameters.tagLength', 4, MAX_UINT32);
      validateIntegerBounds(memory, 'parameters.memory', 8 * (parallelism as number), MAX_UINT32);
      validateIntegerBounds(passes, 'parameters.passes', 1, MAX_UINT32);

      let secret: Uint8Array = new Uint8Array(0);
      if (params.secret !== undefined) {
        secret = coerceBytesOrString(params.secret, 'parameters.secret');
        validateIntegerBounds(secret.length, 'parameters.secret.byteLength', 0, MAX_UINT32);
      }

      let associatedData: Uint8Array = new Uint8Array(0);
      if (params.associatedData !== undefined) {
        associatedData = coerceBytesOrString(params.associatedData, 'parameters.associatedData');
        validateIntegerBounds(associatedData.length, 'parameters.associatedData.byteLength', 0, MAX_UINT32);
      }

      return {
        type,
        password,
        salt,
        secret,
        associatedData,
        parallelism: parallelism as number,
        tagLength: tagLength as number,
        memory: memory as number,
        passes: passes as number,
      };
    };

    const argon2Sync = (algorithm: unknown, parameters: unknown): Uint8Array =>
      asBuffer(computeArgon2(checkArgon2(algorithm, parameters)));

    const argon2 = (algorithm: unknown, parameters: unknown, callback?: unknown): void => {
      const request = checkArgon2(algorithm, parameters);
      if (typeof callback !== 'function') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "callback" argument must be of type function. Received ${describe(callback)}`);
      }
      let result: Uint8Array;
      try {
        result = computeArgon2(request);
      } catch (error) {
        queueMicrotask(() => (callback as (e: unknown) => void)(error));
        return;
      }
      const buffer = asBuffer(result);
      queueMicrotask(() => (callback as (e: Error | null, out: Uint8Array) => void)(null, buffer));
    };

    // -- MAC (OpenSSL provider MACs) -----------------------------------------
    //
    // `crypto.createMac` / `crypto.getMacs`. Node routes these to OpenSSL's
    // provider MACs; a page has none, so HMAC and BLAKE2b MAC are computed here
    // in JS and the remaining providers raise NotImplementedError until their
    // milestones land (M90.2-M90.4). Validation mirrors
    // `internal/crypto/provider_mac.js` so the error surface is identical.

    const MAC_NAMES = [
      'blake2bmac', 'blake2smac', 'cmac', 'gmac', 'hmac',
      'kmac-128', 'kmac-256', 'kmac128', 'kmac256', 'poly1305', 'siphash',
    ];
    const macAliases = new Map<string, string>([
      ['blake2bmac', 'blake2bmac'],
      ['blake2smac', 'blake2smac'],
      ['cmac', 'cmac'],
      ['gmac', 'gmac'],
      ['hmac', 'hmac'],
      ['kmac-128', 'kmac-128'],
      ['kmac-256', 'kmac-256'],
      ['kmac128', 'kmac-128'],
      ['kmac256', 'kmac-256'],
      ['poly1305', 'poly1305'],
      ['siphash', 'siphash'],
    ]);

    const getMacs = (): string[] => MAC_NAMES.slice();

    const BUFFER_ENCODINGS = new Map<string, string>([
      ['utf8', 'utf8'], ['utf-8', 'utf8'],
      ['hex', 'hex'],
      ['base64', 'base64'], ['base64url', 'base64url'],
      ['latin1', 'latin1'], ['binary', 'latin1'],
      ['ascii', 'ascii'],
      ['ucs2', 'utf16le'], ['ucs-2', 'utf16le'], ['utf16le', 'utf16le'], ['utf-16le', 'utf16le'],
    ]);
    const normalizeBufferEncoding = (encoding: string): string | undefined =>
      BUFFER_ENCODINGS.get(encoding.toLowerCase());

    const inspectMacString = (value: string): string => {
      let out = "'";
      for (const ch of value) {
        const code = ch.codePointAt(0)!;
        if (ch === "'" || ch === '\\') out += '\\' + ch;
        else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0');
        else out += ch;
      }
      return out + "'";
    };

    const validateMacName = (value: unknown, name: string, word: string): string => {
      if (typeof value !== 'string') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "${name}" ${word} must be of type string. Received ${describe(value)}`);
      }
      if (value.length === 0 || value.includes('\0')) {
        throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The ${word} '${name}' must be non-empty and contain no NUL bytes. Received ${inspectMacString(value)}`);
      }
      return value;
    };

    const normalizeMacBytes = (value: unknown, name: string): Uint8Array => {
      if (!ArrayBuffer.isView(value) && !isRawBytes(value)) {
        throw coded(
          'TypeError',
          'ERR_INVALID_ARG_TYPE',
          `The "${name}" property must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received ${describe(value)}`,
        );
      }
      return toBytes(value);
    };

    const normalizeMacKey = (key: unknown): Uint8Array => {
      if (key instanceof KeyObject) {
        const type = (key as AsymKeyObject).type;
        if (type !== 'secret') {
          const name = type === 'public' ? 'PublicKeyObject' : 'PrivateKeyObject';
          throw coded(
            'TypeError',
            'ERR_INVALID_ARG_TYPE',
            `The "key" argument must be an instance of ArrayBuffer, Buffer, TypedArray, DataView, or KeyObject. Received an instance of ${name}`,
          );
        }
        return (key as unknown as { export(): Uint8Array }).export();
      }
      if (!ArrayBuffer.isView(key) && !isRawBytes(key)) {
        throw coded(
          'TypeError',
          'ERR_INVALID_ARG_TYPE',
          `The "key" argument must be an instance of ArrayBuffer, Buffer, TypedArray, DataView, or KeyObject. Received ${describe(key)}`,
        );
      }
      return toBytes(key);
    };

    type MacAlgorithm =
      | 'blake2bmac' | 'blake2smac' | 'cmac' | 'gmac' | 'hmac'
      | 'kmac-128' | 'kmac-256' | 'poly1305' | 'siphash';

    class Mac extends LazyTransformBase {
      #algorithm: MacAlgorithm;
      #key: Uint8Array;
      #digest: HashAlgo | undefined;
      #customization: Uint8Array = new Uint8Array(0);
      #iv: Uint8Array = new Uint8Array(0);
      #outputLength: number;
      #chunks: Uint8Array[] = [];
      #total = 0;
      #finalized = false;

      constructor(algorithm: unknown, key: unknown, options?: unknown) {
        super(options as Record<string, unknown> | undefined);
        const name = validateMacName(algorithm, 'algorithm', 'argument');
        let digest: string | undefined;
        let cipher: string | undefined;
        let ivBytes: Uint8Array | undefined;
        let customBytes: Uint8Array | undefined;
        let saltBytes: Uint8Array | undefined;
        let outputLength: number | undefined;
        if (options !== undefined) {
          validateObjectArg(options, 'options');
          const opts = options as Record<string, unknown>;
          if (opts.digest !== undefined) digest = validateMacName(opts.digest, 'options.digest', 'property');
          if (opts.cipher !== undefined) cipher = validateMacName(opts.cipher, 'options.cipher', 'property');
          if (opts.iv !== undefined) ivBytes = normalizeMacBytes(opts.iv, 'options.iv');
          if (opts.customization !== undefined) customBytes = normalizeMacBytes(opts.customization, 'options.customization');
          if (opts.salt !== undefined) saltBytes = normalizeMacBytes(opts.salt, 'options.salt');
          if (opts.outputLength !== undefined) {
            outputLength = validateIntegerBounds(opts.outputLength, 'options.outputLength', 0, MAX_UINT32);
          }
        }
        const keyBytes = normalizeMacKey(key);
        const canonical = macAliases.get(name.toLowerCase()) as MacAlgorithm | undefined;
        if (canonical === undefined) {
          throw coded('TypeError', 'ERR_CRYPTO_INVALID_MAC', `Invalid MAC: ${name}`);
        }

        const unsupportedOption = (option: string): never => {
          throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The property 'options.${option}' is not supported by MAC ${name}`);
        };
        // Maps an OpenSSL cipher name onto a usable AES key length, reprinting
        // the provider errors Node raises for a wrong mode or an unknown name.
        const selectCipher = (want: 'cbc' | 'gcm'): number => {
          const spec = resolveCipher(cipher!);
          if (spec !== undefined) {
            if (spec.mode !== want) {
              throw coded('Error', 'ERR_OSSL_INVALID_MODE', 'error:1C80007D:Provider routines::invalid mode');
            }
            return spec.keyLength;
          }
          const lower = cipher!.toLowerCase();
          if (isKnownCipherName(lower)) {
            const rightMode = want === 'cbc' ? /-cbc(-cts)?$/.test(lower) : /-gcm$/.test(lower);
            // Non-AES block ciphers (DES, Camellia, ARIA, ...) reach here.
            if (rightMode) throw notImplemented('api', `crypto.createMac (${cipher})`);
            throw coded('Error', 'ERR_OSSL_INVALID_MODE', 'error:1C80007D:Provider routines::invalid mode');
          }
          throw coded('Error', 'ERR_OSSL_EVP_UNSUPPORTED', 'error:0308010C:digital envelope routines::unsupported');
        };

        this.#algorithm = canonical;
        this.#key = keyBytes;
        this.#digest = undefined;
        this.#outputLength = outputLength ?? 0;

        if (canonical === 'hmac') {
          if (digest === undefined) {
            throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', "The property 'options.digest' is required for HMAC");
          }
          const algo = resolveHash(digest);
          if (!algo) {
            throw coded('Error', 'ERR_OSSL_EVP_UNSUPPORTED', 'error:0308010C:digital envelope routines::unsupported');
          }
          this.#digest = algo;
        } else if (canonical === 'blake2bmac') {
          if (digest !== undefined) unsupportedOption('digest');
          if (keyBytes.length < 1 || keyBytes.length > 64) {
            throw coded('Error', 'ERR_OSSL_INVALID_KEY_LENGTH', 'error:1C800069:Provider routines::invalid key length');
          }
          const outLen = outputLength === undefined ? 64 : outputLength;
          if (outLen < 1 || outLen > 64) {
            throw coded('Error', 'ERR_OSSL_NOT_XOF_OR_INVALID_LENGTH', 'error:1C800071:Provider routines::not xof or invalid length');
          }
          this.#outputLength = outLen;
        } else if (canonical === 'kmac-128' || canonical === 'kmac-256') {
          if (digest !== undefined) unsupportedOption('digest');
          if (keyBytes.length < 4) {
            throw coded('Error', 'ERR_OSSL_INVALID_KEY_LENGTH', 'error:1C800069:Provider routines::invalid key length');
          }
          this.#outputLength = outputLength ?? (canonical === 'kmac-128' ? 32 : 64);
          this.#customization = customBytes ?? new Uint8Array(0);
        } else if (canonical === 'cmac') {
          if (cipher === undefined) {
            throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', "The property 'options.cipher' is required for CMAC");
          }
          // OpenSSL's CMAC takes no IV/customization/salt and a fixed digest.
          if (ivBytes !== undefined) unsupportedOption('iv');
          if (customBytes !== undefined) unsupportedOption('customization');
          if (saltBytes !== undefined) unsupportedOption('salt');
          if (outputLength !== undefined) unsupportedOption('outputLength');
          const keyLength = selectCipher('cbc');
          if (keyBytes.length !== keyLength) {
            throw coded('Error', 'ERR_OSSL_EVP_INVALID_KEY_LENGTH', 'error:03000082:digital envelope routines::invalid key length');
          }
          this.#outputLength = 16;
        } else if (canonical === 'gmac') {
          if (cipher === undefined) {
            throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', "The property 'options.cipher' is required for GMAC");
          }
          if (ivBytes === undefined || ivBytes.length === 0) {
            throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', "The property 'options.iv' must be non-empty for GMAC");
          }
          if (customBytes !== undefined) unsupportedOption('customization');
          if (saltBytes !== undefined) unsupportedOption('salt');
          if (outputLength !== undefined) unsupportedOption('outputLength');
          const keyLength = selectCipher('gcm');
          if (keyBytes.length !== keyLength) {
            throw coded('Error', 'ERR_OSSL_INVALID_KEY_LENGTH', 'error:1C800069:Provider routines::invalid key length');
          }
          this.#iv = ivBytes;
          this.#outputLength = 16;
        } else {
          throw notImplemented('api', `crypto.createMac (${canonical})`);
        }
      }

      #compute(): Uint8Array {
        const data = concatBytes(this.#chunks, this.#total);
        if (this.#algorithm === 'blake2bmac') {
          return blake2b(data, this.#outputLength, this.#key);
        }
        if (this.#algorithm === 'kmac-128' || this.#algorithm === 'kmac-256') {
          const bits = this.#algorithm === 'kmac-128' ? 128 : 256;
          return kmac(bits, this.#key, data, this.#outputLength, this.#customization);
        }
        if (this.#algorithm === 'cmac') return aesCmac(this.#key, data);
        if (this.#algorithm === 'gmac') return aesGmac(this.#key, this.#iv, data);
        return hmac(this.#digest!, this.#key, data);
      }

      update(data: unknown, encoding?: string): this {
        if (this.#finalized) throw coded('Error', 'ERR_CRYPTO_MAC_FINALIZED', 'MAC already finalized');
        let bytes: Uint8Array;
        if (typeof data === 'string') {
          bytes = bytesFromString(data, normalizeMacInputEncoding(encoding));
        } else if (ArrayBuffer.isView(data)) {
          bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else {
          throw coded(
            'TypeError',
            'ERR_INVALID_ARG_TYPE',
            `The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ${describe(data)}`,
          );
        }
        this.#chunks.push(bytes);
        this.#total += bytes.length;
        return this;
      }

      final(outputEncoding?: string): unknown {
        if (this.#finalized) throw coded('Error', 'ERR_CRYPTO_MAC_FINALIZED', 'MAC already finalized');
        this.#finalized = true;
        const result = asBuffer(this.#compute());
        const target = normalizeMacOutputEncoding(outputEncoding);
        if (target === 'buffer') return result;
        return encodeOutput(result, target);
      }

      _transform(chunk: unknown, _encoding: string, callback: (err?: Error | null) => void): void {
        if (this.#finalized) {
          callback(coded('Error', 'ERR_CRYPTO_MAC_FINALIZED', 'MAC already finalized'));
          return;
        }
        try {
          this.update(chunk);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }

      _flush(callback: (err?: Error | null) => void): void {
        if (this.#finalized) {
          callback(coded('Error', 'ERR_CRYPTO_MAC_FINALIZED', 'MAC already finalized'));
          return;
        }
        try {
          const result = this.final();
          if ((result as Uint8Array).length !== 0) this.push(result);
        } catch (error) {
          callback(error as Error);
          return;
        }
        callback();
      }
    }

    function normalizeMacOutputEncoding(outputEncoding: unknown): string {
      if (outputEncoding === undefined) return 'buffer';
      if (typeof outputEncoding !== 'string') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "outputEncoding" argument must be of type string. Received ${describe(outputEncoding)}`);
      }
      if (outputEncoding.toLowerCase() === 'buffer') return 'buffer';
      const normalized = normalizeBufferEncoding(outputEncoding);
      if (normalized === undefined) {
        throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The argument 'outputEncoding' is invalid. Received ${inspectMacString(outputEncoding)}`);
      }
      return normalized;
    }

    function normalizeMacInputEncoding(inputEncoding: unknown): string | undefined {
      if (inputEncoding === undefined) return undefined;
      if (typeof inputEncoding !== 'string') {
        throw coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "inputEncoding" argument must be of type string. Received ${describe(inputEncoding)}`);
      }
      const normalized = normalizeBufferEncoding(inputEncoding);
      if (normalized === undefined) {
        throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The argument 'inputEncoding' is invalid. Received ${inspectMacString(inputEncoding)}`);
      }
      return normalized;
    }

    const createMac = (algorithm: unknown, key: unknown, options?: unknown): Mac =>
      new Mac(algorithm, key, options);

    // -- asymmetric keys and signatures --------------------------------------
    //
    // Implemented synchronously in `../crypto/asym` (ASN.1 + curve maths), so
    // these behave like Node even though WebCrypto is async-only.

    const createSign = (algorithm: unknown, options?: unknown) => new Sign(algorithm, options);
    const createVerify = (algorithm: unknown, options?: unknown) => new Verify(algorithm, options);
    const sign = (algorithm: unknown, data: unknown, key: unknown): Uint8Array =>
      asBuffer(asymSign(parseSignAlgorithm(algorithm), toBytes(data), key));
    const verify = (algorithm: unknown, data: unknown, key: unknown, signature: unknown): boolean =>
      asymVerify(
        parseSignAlgorithm(algorithm),
        toBytes(data),
        key,
        toBytes(signature, undefined),
      );
    const createPrivateKey = (key: unknown): AsymKeyObject => withBytes(asymCreatePrivateKey(key));
    const createPublicKey = (key: unknown): AsymKeyObject => withBytes(asymCreatePublicKey(key));
    const createSecretKey = (key: unknown, encoding?: unknown): AsymKeyObject =>
      withBytes(asymCreateSecretKey(key, encoding));
    const generateKeyPairSync = (type: string, options?: GenerateKeyPairOptions): unknown =>
      asymGenerateKeyPairSync(type, options ?? {});
    const generateKeyPair = (type: string, options: unknown, callback?: unknown): void => {
      let cb: unknown = callback;
      let opts: GenerateKeyPairOptions = {};
      if (typeof options === 'function') cb = options;
      else if (options && typeof options === 'object') opts = options as GenerateKeyPairOptions;
      const result = asymGenerateKeyPairSync(type, opts);
      if (typeof cb === 'function') {
        queueMicrotask(() => (cb as (e: Error | null, pub: unknown, priv: unknown) => void)(null, result.publicKey, result.privateKey));
        return;
      }
      return result as unknown as void;
    };
    const getCurves = (): string[] => listCurves();

    // -- asymmetric encryption and key agreement ----------------------------

    const publicEncrypt = (key: unknown, buffer: unknown, options?: EncryptOptions): Uint8Array =>
      asBuffer(asymPublicEncrypt(key, toBytes(buffer), options));
    const privateDecrypt = (key: unknown, buffer: unknown, options?: EncryptOptions): Uint8Array =>
      asBuffer(asymPrivateDecrypt(key, toBytes(buffer), options));
    const privateEncrypt = (key: unknown, buffer: unknown): Uint8Array =>
      asBuffer(asymPrivateEncrypt(key, toBytes(buffer)));
    const publicDecrypt = (key: unknown, buffer: unknown): Uint8Array =>
      asBuffer(asymPublicDecrypt(key, toBytes(buffer)));
    const createECDH = (curve: unknown): InstanceType<typeof ECDH> => new ECDH(curve);

    // Asymmetric-key / engine / X.509 classes. Node exposes them as real
    // classes with a rich prototype; we have no backend, so each stays present
    // and shaped like Node (right base class, right members) but every entry
    // point throws a typed error instead of fabricating a result. This keeps
    // feature detection (`instanceof`, `'sign' in x`, `typeof x.foo`) honest.
    const stubMethod =
      (name: string): ((...args: unknown[]) => never) =>
      () => {
        throw notImplemented('api', `crypto.${name}`);
      };
    const defineStubs = (proto: object, names: readonly string[]): void => {
      for (const name of names) {
        Object.defineProperty(proto, name, {
          value: stubMethod(name),
          writable: true,
          configurable: true,
        });
      }
    };
    const defineStaticStubs = (Ctor: object, names: readonly string[]): void => {
      for (const name of names) {
        Object.defineProperty(Ctor, name, {
          value: stubMethod(name),
          writable: true,
          configurable: true,
        });
      }
    };
    const namedClass = <T extends new (...args: any[]) => any>(name: string, Ctor: T): T => {
      Object.defineProperty(Ctor, 'name', { value: name, configurable: true });
      return Ctor;
    };

    // `Sign`/`Verify` are `stream.Writable` subclasses in Node. The digest /
    // signature work is synchronous (see `../crypto/asym`), so they behave like
    // Node's: `update()` accumulates, `sign()`/`verify()` finish.
    const joinChunks = (chunks: Uint8Array[]): Uint8Array => {
      let total = 0;
      for (const chunk of chunks) total += chunk.length;
      const out = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
      }
      return out;
    };
    const Sign = namedClass(
      'Sign',
      class extends WritableBase {
        #algorithm: SignAlgorithm;
        #chunks: Uint8Array[] = [];

        constructor(algorithm: unknown, options?: unknown) {
          super(options as Record<string, unknown> | undefined);
          if (typeof algorithm !== 'string') {
            throw coded(
              'TypeError',
              'ERR_INVALID_ARG_TYPE',
              `The "algorithm" argument must be of type string. Received ${describe(algorithm)}`,
            );
          }
          this.#algorithm = parseSignAlgorithm(algorithm);
        }

        update(data: unknown, encoding?: unknown): this {
          this.#chunks.push(toBytes(data, typeof encoding === 'string' ? encoding : undefined));
          return this;
        }

        sign(key: unknown, encoding?: unknown): unknown {
          if (key !== null && typeof key === 'object' && !(key instanceof AsymKeyObject) && 'key' in (key as object)) {
            const options = key as { key: unknown; encoding?: unknown; padding?: unknown; saltLength?: unknown; dsaEncoding?: unknown };
            encoding = options.encoding ?? encoding;
            this.#algorithm = {
              ...this.#algorithm,
              padding: typeof options.padding === 'number' ? options.padding : this.#algorithm.padding,
              saltLength: typeof options.saltLength === 'number' ? options.saltLength : this.#algorithm.saltLength,
              dsaEncoding: options.dsaEncoding === 'ieee-p1363' ? 'ieee-p1363' : this.#algorithm.dsaEncoding,
            };
            key = options.key;
          }
          const signature = asymSign(this.#algorithm, joinChunks(this.#chunks), key);
          return encodeOutput(signature, typeof encoding === 'string' ? encoding : undefined);
        }
      },
    );

    const Verify = namedClass(
      'Verify',
      class extends WritableBase {
        #algorithm: SignAlgorithm;
        #chunks: Uint8Array[] = [];

        constructor(algorithm: unknown, options?: unknown) {
          super(options as Record<string, unknown> | undefined);
          if (typeof algorithm !== 'string') {
            throw coded(
              'TypeError',
              'ERR_INVALID_ARG_TYPE',
              `The "algorithm" argument must be of type string. Received ${describe(algorithm)}`,
            );
          }
          this.#algorithm = parseSignAlgorithm(algorithm);
        }

        update(data: unknown, encoding?: unknown): this {
          this.#chunks.push(toBytes(data, typeof encoding === 'string' ? encoding : undefined));
          return this;
        }

        verify(key: unknown, signature: unknown, encoding?: unknown): boolean {
          const bytes = toBytes(signature, typeof encoding === 'string' ? encoding : undefined);
          return asymVerify(this.#algorithm, joinChunks(this.#chunks), key, bytes);
        }
      },
    );

    // `KeyObject` is the buffered proxy declared near the top of `init`.

    // `X509Certificate` is a real DER/PEM parser (see `../crypto/x509`). Node
    // returns Buffers from `raw`, so it goes through the byte factory too.
    const X509Certificate = namedClass(
      'X509Certificate',
      bufferedClass(RawX509Certificate, asBuffer),
    );

    // `DiffieHellman` / `DiffieHellmanGroup` are the real pure-JS classes. The
    // byte-output factory turns their `Uint8Array`s into runtime `Buffer`s (Node
    // always returns Buffers). `getDiffieHellman` and `createDiffieHellmanGroup`
    // are the same function object in Node.
    const ECDH = bufferedClass(RawECDH, asBuffer);
    const DiffieHellman = bufferedClass(RawDiffieHellman, asBuffer);
    const DiffieHellmanGroup = bufferedClass(RawDiffieHellmanGroup, asBuffer);
    const createDiffieHellman = (sizeOrKey: unknown, keyEncoding?: unknown, generator?: unknown, genEncoding?: unknown): InstanceType<typeof DiffieHellman> =>
      new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
    const getDiffieHellman = (name: unknown): InstanceType<typeof DiffieHellmanGroup> =>
      new DiffieHellmanGroup(name);
    const createDiffieHellmanGroup = getDiffieHellman;

    // `Certificate` is a legacy class with the same three methods as statics.
    const Certificate = namedClass(
      'Certificate',
      class {
        constructor() {
          throw notImplemented('api', 'crypto.Certificate');
        }
      },
    );
    defineStubs(Certificate.prototype, ['exportChallenge', 'exportPublicKey', 'verifySpkac']);
    defineStaticStubs(Certificate, ['exportChallenge', 'exportPublicKey', 'verifySpkac']);

    const randomUUID = (): string => webcrypto.randomUUID();

    /** `crypto.randomUUIDv7([options])` — RFC 9562 UUIDv7. */
    const randomUUIDv7 = (options?: unknown): string => {
      if (options !== undefined && (options === null || typeof options !== 'object')) {
        throw coded(
          'TypeError',
          'ERR_INVALID_ARG_TYPE',
          `The "options" argument must be of type object. Received ${describe(options)}`,
        );
      }
      const disableEntropyCache =
        (options as { disableEntropyCache?: unknown } | undefined)?.disableEntropyCache ?? false;
      if (typeof disableEntropyCache !== 'boolean') {
        throw coded(
          'TypeError',
          'ERR_INVALID_ARG_TYPE',
          `The "options.disableEntropyCache" argument must be of type boolean. Received ${describe(disableEntropyCache)}`,
        );
      }
      const bytes = new Uint8Array(16);
      webcrypto.getRandomValues(bytes);
      const ms = Date.now();
      for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
      bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
      let hex = '';
      for (const b of bytes) hex += b.toString(16).padStart(2, '0');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };

    // The secure heap is off unless started with `--secure-heap`; Node reports
    // zeros (with `min` reporting the configured minimum, whose default is 2).
    const secureHeapUsed = (): { total: number; used: number; utilization: number | null; min: number } => ({
      total: 0,
      used: 0,
      utilization: null,
      min: 2,
    });

    // `crypto.setEngine(id, flags)` loads an OpenSSL engine. We have no engines,
    // so every id is unknown — exactly what Node reports for a bad id.
    const setEngine = (id: unknown, _flags?: unknown): never => {
      throw coded('Error', 'ERR_CRYPTO_ENGINE_UNKNOWN', `Engine "${String(id)}" was not found`);
    };

    const api: Record<string, unknown> = {
      createHash,
      createHmac,
      Hash,
      Hmac,
      Cipheriv,
      Decipheriv,
      Sign,
      Verify,
      KeyObject,
      DiffieHellman,
      DiffieHellmanGroup,
      ECDH,
      X509Certificate,
      Certificate,
      hash,
      getHashes: listHashes,
      createSign,
      createVerify,
      sign,
      verify,
      createPrivateKey,
      createPublicKey,
      createSecretKey,
      generateKeyPair,
      generateKeyPairSync,
      getCurves,
      publicEncrypt,
      privateDecrypt,
      privateEncrypt,
      publicDecrypt,
      createECDH,
      createDiffieHellman,
      createDiffieHellmanGroup,
      getDiffieHellman,
      generateKey,
      generateKeySync,
      generatePrime,
      generatePrimeSync,
      checkPrime,
      checkPrimeSync,
      argon2,
      argon2Sync,
      createMac,
      getMacs,
      getFips,
      setFips,
      createCipheriv,
      createDecipheriv,
      getCiphers: listCiphers,
      getCipherInfo,
      randomBytes,
      randomFill,
      randomFillSync,
      randomInt,
      randomUUID,
      randomUUIDv7,
      getRandomValues: (buffer: Uint8Array) => webcrypto.getRandomValues(buffer),
      timingSafeEqual,
      pbkdf2: pbkdf2Async,
      pbkdf2Sync,
      hkdf: hkdfAsync,
      hkdfSync,
      scrypt: scryptAsync,
      scryptSync,
      subtle: webcrypto.subtle,
      secureHeapUsed,
      setEngine,
      webcrypto,
      crypto: webcrypto,
      constants: {
        RSA_PKCS1_PADDING,
        RSA_SSLV23_PADDING: 2,
        RSA_NO_PADDING,
        RSA_PKCS1_OAEP_PADDING,
        RSA_X931_PADDING,
        RSA_PKCS1_PSS_PADDING,
        RSA_PSS_SALTLEN_DIGEST,
        RSA_PSS_SALTLEN_MAX_SIGN,
        RSA_PSS_SALTLEN_AUTO: RSA_PSS_SALTLEN_MAX_SIGN,
        RSA_PSS_SALTLEN_MAX,
      },
      ...unsupportedApis,
      default: { createHash, createHmac, randomBytes, randomUUID, webcrypto },
    };
    // Node keeps `prng`/`pseudoRandomBytes`/`rng` as non-enumerable, lazily
    // created aliases of `randomBytes` (DEP0115).
    for (const key of ['prng', 'pseudoRandomBytes', 'rng'] as const) {
      Object.defineProperty(api, key, {
        value: randomBytes,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
    return api;
  },
};
