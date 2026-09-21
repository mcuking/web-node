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

    const createHashState = (algo: HashAlgo) => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      let finalized = false;
      const api = {
        update(data: unknown, encoding?: string) {
          if (finalized) throw coded('Error', 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
          const bytes = toBytes(data, encoding);
          chunks.push(bytes);
          total += bytes.length;
          return api;
        },
        digest(encoding?: string): unknown {
          if (finalized) throw coded('Error', 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
          finalized = true;
          const result = algo.hash(concatBytes(chunks, total));
          return encodeOutput(asBuffer(result), encoding);
        },
        copy() {
          const clone = createHashState(algo);
          for (const chunk of chunks) clone.update(chunk);
          return clone;
        },
      };
      return api;
    };

    const createHash = (algorithm: string) => {
      const algo = resolveHash(algorithm);
      if (!algo) throw new Error('Digest method not supported');
      return createHashState(algo);
    };

    const createHmac = (algorithm: string, key: unknown) => {
      const algo = resolveHash(algorithm);
      if (!algo) throw invalidDigest(algorithm);
      const keyBytes = toBytes(key);
      const chunks: Uint8Array[] = [];
      let total = 0;
      let finalized = false;
      const api = {
        update(data: unknown, encoding?: string) {
          if (finalized) throw coded('Error', 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
          const bytes = toBytes(data, encoding);
          chunks.push(bytes);
          total += bytes.length;
          return api;
        },
        digest(encoding?: string): unknown {
          if (finalized) throw coded('Error', 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
          finalized = true;
          const result = hmac(algo, keyBytes, concatBytes(chunks, total));
          return encodeOutput(asBuffer(result), encoding);
        },
      };
      return api;
    };

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

    const makeCipher = (
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

    const createCipheriv = (algorithm: unknown, key: unknown, iv?: unknown, options?: unknown) =>
      makeCipher(algorithm, key, iv, options, true);
    const createDecipheriv = (algorithm: unknown, key: unknown, iv?: unknown, options?: unknown) =>
      makeCipher(algorithm, key, iv, options, false);
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
    };

    const randomUUID = (): string => webcrypto.randomUUID();

    return {
      createHash,
      createHmac,
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
      getRandomValues: (buffer: Uint8Array) => webcrypto.getRandomValues(buffer),
      timingSafeEqual,
      pbkdf2: pbkdf2Async,
      pbkdf2Sync,
      hkdf: hkdfAsync,
      hkdfSync,
      scrypt: scryptAsync,
      scryptSync,
      webcrypto,
      crypto: webcrypto,
      constants: {},
      ...unsupportedApis,
      default: { createHash, createHmac, randomBytes, randomUUID, webcrypto },
    };
  },
};
