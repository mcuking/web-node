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
  getCipherInfo as lookupCipherInfo,
  isKnownCipherName,
  listCiphers,
  resolveCipher,
  type CipherSpec,
} from '../crypto/cipher';

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
    argon2: 3, argon2Sync: 2, createMac: 3, encapsulate: 2, decapsulate: 3, setFips: 1,
  },
  init: (ctx: BuiltinInitContext) => {
    const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
    if (!webcrypto) throw new Error('web-node: this host has no WebCrypto');

    // The runtime's own `Buffer`. Resolved lazily: `crypto` may materialise
    // before `buffer` does, and there is no reason to force the order.
    const asBuffer = (bytes: Uint8Array): Uint8Array =>
      (ctx.require('buffer') as { Buffer: { from(input: Uint8Array): Uint8Array } }).Buffer.from(bytes);

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

    // -- digests --------------------------------------------------------------

    /**
     * `crypto.Hash` — and the class `crypto.createHash()` returns. Node
     * deprecates `new Hash(...)` but it still works, so we support both.
     */
    class Hash {
      #name: string;
      #algo: HashAlgo;
      #chunks: Uint8Array[] = [];
      #total = 0;
      #finalized = false;

      constructor(algorithm: unknown) {
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
    }

    const createHash = (algorithm: string): Hash => new Hash(algorithm);

    /** `crypto.Hmac` — and the class `crypto.createHmac()` returns. */
    class Hmac {
      #algo: HashAlgo;
      #keyBytes: Uint8Array;
      #chunks: Uint8Array[] = [];
      #total = 0;
      #finalized = false;

      constructor(algorithm: unknown, key: unknown) {
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

    const buildCipher = (
      algorithm: unknown,
      key: unknown,
      iv: unknown,
      options: unknown,
      encrypt: boolean,
    ): Record<string, unknown> => {
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
      const inner = new AesCipheriv(spec, keyBytes, ivBytes, encrypt, authTagLength);

      const api: Record<string, unknown> = {
        update(data: unknown, inputEncoding?: string, outputEncoding?: string) {
          const out = inner.update(coerceCipherInput(data, inputEncoding));
          return encodeOutput(asBuffer(out), outputEncoding);
        },
        final(outputEncoding?: string) {
          return encodeOutput(asBuffer(inner.final()), outputEncoding);
        },
        setAutoPadding(autoPadding?: boolean) {
          inner.setAutoPadding(autoPadding);
          return api;
        },
        setAAD(aad: unknown) {
          inner.setAAD(coerceBytes(aad, 'aad'));
          return api;
        },
      };
      if (encrypt) {
        api.getAuthTag = () => asBuffer(inner.getAuthTag());
      } else {
        api.setAuthTag = (tag: unknown) => {
          inner.setAuthTag(coerceBytes(tag, 'tag'));
          return api;
        };
      }
      return api;
    };

    // `crypto.Cipheriv` / `crypto.Decipheriv` are the classes the factories
    // return; their constructors match `createCipheriv`/`createDecipheriv`
    // (Node deprecates `new`, but it still works). The instances are objects on
    // the class prototype, so `instanceof` behaves.
    class Cipheriv {
      constructor(algorithm: unknown, key: unknown, iv?: unknown, options?: unknown) {
        return Object.setPrototypeOf(
          buildCipher(algorithm, key, iv, options, true),
          Cipheriv.prototype,
        ) as unknown as Cipheriv;
      }
    }
    class Decipheriv {
      constructor(algorithm: unknown, key: unknown, iv?: unknown, options?: unknown) {
        return Object.setPrototypeOf(
          buildCipher(algorithm, key, iv, options, false),
          Decipheriv.prototype,
        ) as unknown as Decipheriv;
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
      createSign: unsupportedApi('createSign'),
      createVerify: unsupportedApi('createVerify'),
      sign: unsupportedApi('sign'),
      verify: unsupportedApi('verify'),
      generateKeyPair: unsupportedApi('generateKeyPair'),
      generateKeyPairSync: unsupportedApi('generateKeyPairSync'),
      generateKey: unsupportedApi('generateKey'),
      generateKeySync: unsupportedApi('generateKeySync'),
      createDiffieHellman: unsupportedApi('createDiffieHellman'),
      getDiffieHellman: unsupportedApi('getDiffieHellman'),
      createDiffieHellmanGroup: unsupportedApi('createDiffieHellmanGroup'),
      diffieHellman: unsupportedApi('diffieHellman'),
      createPrivateKey: unsupportedApi('createPrivateKey'),
      createPublicKey: unsupportedApi('createPublicKey'),
      createSecretKey: unsupportedApi('createSecretKey'),
      publicEncrypt: unsupportedApi('publicEncrypt'),
      publicDecrypt: unsupportedApi('publicDecrypt'),
      privateEncrypt: unsupportedApi('privateEncrypt'),
      privateDecrypt: unsupportedApi('privateDecrypt'),
      generatePrime: unsupportedApi('generatePrime'),
      generatePrimeSync: unsupportedApi('generatePrimeSync'),
      checkPrime: unsupportedApi('checkPrime'),
      checkPrimeSync: unsupportedApi('checkPrimeSync'),
      getCurves: unsupportedApi('getCurves'),
      getFips: unsupportedApi('getFips'),
      setFips: unsupportedApi('setFips'),
      X509Certificate: unsupportedApi('X509Certificate'),
      Certificate: unsupportedApi('Certificate'),
      createECDH: unsupportedApi('createECDH'),
      argon2: unsupportedApi('argon2'),
      argon2Sync: unsupportedApi('argon2Sync'),
      createMac: unsupportedApi('createMac'),
      getMacs: unsupportedApi('getMacs'),
      encapsulate: unsupportedApi('encapsulate'),
      decapsulate: unsupportedApi('decapsulate'),
    };

    // Asymmetric-key / engine classes Node exposes we have no backend for. They
    // are real constructors in Node, so we keep them callable and throw a typed
    // error the moment they are constructed.
    const unsupportedClass = (name: string): new (...args: unknown[]) => never => {
      const Ctor = class {
        constructor() {
          throw notImplemented('api', `crypto.${name}`);
        }
      };
      Object.defineProperty(Ctor, 'name', { value: name });
      return Ctor as unknown as new (...args: unknown[]) => never;
    };
    const Sign = unsupportedClass('Sign');
    const Verify = unsupportedClass('Verify');
    const KeyObject = unsupportedClass('KeyObject');
    const DiffieHellman = unsupportedClass('DiffieHellman');
    const DiffieHellmanGroup = unsupportedClass('DiffieHellmanGroup');
    const ECDH = unsupportedClass('ECDH');

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

    return {
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
      hash,
      getHashes: listHashes,
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
      constants: {},
      ...unsupportedApis,
      default: { createHash, createHmac, randomBytes, randomUUID, webcrypto },
    };
  },
};
