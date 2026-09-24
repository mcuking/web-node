/**
 * `wn_openssl` — thin binding over the wasi-built OpenSSL subset (M119).
 *
 * The module is **lazy**: it is not part of the startup `WASM_MODULES` set (it
 * is ~2.3 MB, which would undo M107's startup work). It is fetched in the
 * background after boot, and every caller must cope with it not being ready
 * yet — hence {@link opensslReady}. Callers fall back to the pure-JS
 * implementation until it lands, which is fine because both are byte-identical
 * to Node.
 *
 * Layout mirrors the other bindings: JS never hands a typed-array pointer to
 * wasm; it allocates inside wasm linear memory, writes the input, calls, and
 * reads the result back (re-taking the view each time, since memory can grow).
 */
import { wasmLoaded, wasmModule } from '../wasm/registry';
import type { WasmExports } from '../wasm/loader';

export const OPENSSL_MODULE = 'wn_openssl';

/**
 * Test-only escape hatch: when set to `false`, every `opensslReady()` check
 * fails and all callers take their pure-JS path. This is how the equivalence
 * tests exercise *both* engines in the same process (they must agree byte for
 * byte, so the toggle has to be observable). Nothing in production flips it.
 */
let enabled = true;
export function setOpensslEnabled(next: boolean): void {
  enabled = next;
}

/** Whether the OpenSSL module has been instantiated yet. */
export function opensslReady(): boolean {
  return enabled && wasmLoaded(OPENSSL_MODULE);
}

function ex(): WasmExports {
  return wasmModule(OPENSSL_MODULE);
}

function call<T>(name: string, ...args: number[]): T {
  const fn = ex()[name] as ((...a: number[]) => T) | undefined;
  if (typeof fn !== 'function') {
    throw new Error(`wn_openssl: missing export "${name}"`);
  }
  return fn(...args);
}

function memory(): WebAssembly.Memory {
  return ex().memory as WebAssembly.Memory;
}

function bytes(): Uint8Array {
  return new Uint8Array(memory().buffer);
}

/** OpenSSL version number (`0x30500080` for 3.5.8). */
export function opensslVersion(): number {
  return call<number>('wn_openssl_version');
}

/** The most recent OpenSSL error string, or `''`. */
export function opensslLastError(): string {
  const ptr = call<number>('wn_openssl_last_error');
  if (!ptr) return '';
  const mem = bytes();
  let end = ptr;
  while (end < mem.length && mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.subarray(ptr, end));
}

/** Copy a byte string into fresh wasm memory; returns `[ptr, len]`. */
function push(data: Uint8Array): [number, number] {
  const len = data.byteLength;
  const ptr = call<number>('wn_alloc', Math.max(len, 1));
  if (!ptr) throw new Error('wn_openssl: out of memory');
  if (len > 0) bytes().set(data, ptr);
  return [ptr, len];
}

function free(ptr: number): void {
  if (ptr) call<number>('wn_dealloc', ptr);
}

/**
 * Start a fallible operation: drop any stale OpenSSL error so the one a later
 * {@link opensslLastError} reads is guaranteed to come from this call.
 */
function begin(): void {
  call<number>('wn_openssl_clear_error');
}

/** Copy a NUL-free name into wasm memory (kept NUL-free; the C side copies). */
function pushName(name: string): [number, number] {
  return push(new TextEncoder().encode(name));
}

/**
 * Digest `data`, or `null` when OpenSSL does not know `opensslName`.
 * `outputLength` selects the XOF length (shake128/256).
 */
export function opensslDigest(
  opensslName: string,
  data: Uint8Array,
  outputLength?: number,
): Uint8Array | null {
  const [namePtr, nameLen] = pushName(opensslName);
  const [dataPtr, dataLen] = push(data);
  // 64 bytes is enough for every fixed digest we expose; XOFs ask separately.
  const capacity = outputLength ?? 64;
  const outPtr = call<number>('wn_alloc', capacity);
  try {
    const written =
      outputLength === undefined
        ? call<number>('wn_digest', namePtr, nameLen, dataPtr, dataLen, outPtr)
        : call<number>('wn_digest_xof', namePtr, nameLen, dataPtr, dataLen, outPtr, outputLength);
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(dataPtr);
    free(namePtr);
  }
}

/** Digest size in bytes for `opensslName`, or `-1` when unknown. */
export function opensslDigestSize(opensslName: string): number {
  const [namePtr, nameLen] = pushName(opensslName);
  try {
    return call<number>('wn_digest_size', namePtr, nameLen);
  } finally {
    free(namePtr);
  }
}

/** HMAC over `data` with `key`, or `null` when `opensslName` is unknown. */
export function opensslHmac(
  opensslName: string,
  key: Uint8Array,
  data: Uint8Array,
): Uint8Array | null {
  const [namePtr, nameLen] = pushName(opensslName);
  const [keyPtr, keyLen] = push(key);
  const [dataPtr, dataLen] = push(data);
  const outPtr = call<number>('wn_alloc', 64);
  try {
    const written = call<number>('wn_hmac', namePtr, nameLen, keyPtr, keyLen, dataPtr, dataLen, outPtr);
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(dataPtr);
    free(keyPtr);
    free(namePtr);
  }
}

/**
 * The OpenSSL error class of the most recent failure (see `wn_openssl.c`):
 * `0` none · `1` wrong final block length · `2` bad decrypt · `3` bad IV length
 * · `4` anything else. Lets callers rebuild Node's exact exception without
 * parsing English text.
 */
export function opensslErrorKind(): number {
  return call<number>('wn_openssl_error_kind');
}

/** `ERR_GET_LIB` of the most recent failure (0 when there was none). */
export function opensslErrorLib(): number {
  return call<number>('wn_openssl_error_lib');
}

/** `ERR_reason_error_string` of the most recent failure, or `''`. */
export function opensslErrorReason(): string {
  const ptr = call<number>('wn_openssl_error_reason');
  if (!ptr) return '';
  const mem = bytes();
  let end = ptr;
  while (end < mem.length && mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.subarray(ptr, end));
}

// --- ciphers ----------------------------------------------------------------

/** `EVP_CIPH_*_MODE` values, mirrored from OpenSSL's `evp.h`. */
export const CIPH_MODE = {
  STREAM: 0,
  ECB: 1,
  CBC: 2,
  CFB: 3,
  OFB: 4,
  CTR: 5,
  GCM: 6,
  CCM: 7,
  XTS: 0x10001,
  WRAP: 0x10002,
  OCB: 0x10003,
  SIV: 0x10004,
  GCM_SIV: 0x10005,
} as const;

/** `EVP_CIPH_FLAG_*` bits we care about. */
export const CIPH_FLAG = { CTS: 0x4000, AEAD: 0x200000, MAC: 0x2000000 } as const;

export interface OpenSslCipherInfo {
  keyLength: number;
  ivLength: number;
  blockSize: number;
  mode: number;
  flags: number;
}

/** Metadata for an OpenSSL cipher name, or `null` when it cannot be fetched. */
export function opensslCipherInfo(opensslName: string): OpenSslCipherInfo | null {
  const [namePtr, nameLen] = pushName(opensslName);
  const outPtr = call<number>('wn_alloc', 20);
  try {
    if (call<number>('wn_cipher_info', namePtr, nameLen, outPtr) < 0) return null;
    const view = new DataView(memory().buffer, outPtr, 20);
    return {
      keyLength: view.getInt32(0, true),
      ivLength: view.getInt32(4, true),
      blockSize: view.getInt32(8, true),
      mode: view.getInt32(12, true),
      flags: view.getInt32(16, true),
    };
  } finally {
    free(outPtr);
    free(namePtr);
  }
}

/**
 * Handles for the `wn_cipher_*` entry points, wrapped so a caller can drive an
 * `EVP_CIPHER_CTX` without touching wasm memory by hand. Every call re-takes
 * the memory view, because the context can grow the linear memory.
 */
export interface OpenSslCipherHandle {
  readonly encrypt: boolean;
  readonly blockSize: number;
  /** `EVP_CIPH_*_MODE` of the underlying cipher (see {@link CIPH_MODE}). */
  readonly mode: number;
  /** `EVP_CIPHER_get_flags` of the underlying cipher (see {@link CIPH_FLAG}). */
  readonly flags: number;
  /**
   * GCM/CCM/OCB/ChaCha20-Poly1305 need their IV length declared before the key.
   * Every setter returns `false` on failure (the reason then lives in
   * {@link opensslLastError}), so callers decide which exception to raise.
   */
  setIvLength(length: number): boolean;
  /** CCM/OCB (and ChaCha20-Poly1305) only: declare the tag length. */
  setTagLength(length: number): boolean;
  /** CCM only: declare the plaintext length up front. */
  setDataLength(length: number): boolean;
  setTag(tag: Uint8Array): boolean;
  setKeyIv(key: Uint8Array, iv: Uint8Array | null): boolean;
  setPadding(padding: boolean): boolean;
  aad(bytes: Uint8Array): boolean;
  update(input: Uint8Array): Uint8Array | null;
  final(): Uint8Array | null;
  getTag(length: number): Uint8Array | null;
  free(): void;
}

/** Create an `EVP_CIPHER_CTX` for `opensslName`, or `null` if unavailable. */
export function opensslCipherNew(
  opensslName: string,
  encrypt: boolean,
  info: OpenSslCipherInfo,
): OpenSslCipherHandle | null {
  const [namePtr, nameLen] = pushName(opensslName);
  let handle = 0;
  try {
    handle = call<number>('wn_cipher_new', namePtr, nameLen, encrypt ? 1 : 0);
  } finally {
    free(namePtr);
  }
  if (!handle) return null;
  const ctx = handle;

  /** `EVP_CIPHER_CTX_ctrl`-shaped calls: an int argument, no buffer. */
  const ctrl = (exportName: string, value: number): boolean => {
    begin();
    return call<number>(exportName, ctx, value) === 0;
  };

  /** Calls taking one byte string (tag, AAD). */
  const withBytes = (exportName: string, data: Uint8Array): boolean => {
    begin();
    const [ptr] = push(data);
    try {
      return call<number>(exportName, ctx, ptr, data.byteLength) === 0;
    } finally {
      free(ptr);
    }
  };

  /** EVP asks for room for a whole extra block on `update`/`final`. */
  const outCapacity = (inLength: number): number => inLength + info.blockSize + 16;

  return {
    encrypt,
    blockSize: info.blockSize,
    mode: info.mode,
    flags: info.flags,
    setIvLength: (length) => ctrl('wn_cipher_set_ivlen', length),
    setTagLength: (length) => ctrl('wn_cipher_set_tag_len', length),
    setDataLength: (length) => ctrl('wn_cipher_set_data_len', length),
    setTag: (tag) => withBytes('wn_cipher_set_tag', tag),
    setPadding: (padding) => ctrl('wn_cipher_set_padding', padding ? 1 : 0),
    aad: (data) => (data.byteLength === 0 ? true : withBytes('wn_cipher_aad', data)),
    setKeyIv(key, iv): boolean {
      begin();
      const [keyPtr] = push(key);
      const ivBytes = iv ?? new Uint8Array(0);
      const [ivPtr] = push(ivBytes);
      try {
        return (
          call<number>(
            'wn_cipher_set_key_iv',
            ctx,
            keyPtr,
            key.byteLength,
            ivPtr,
            iv === null ? 0 : iv.byteLength,
          ) === 0
        );
      } finally {
        free(ivPtr);
        free(keyPtr);
      }
    },
    update(input): Uint8Array | null {
      begin();
      const [inPtr] = push(input);
      const outPtr = call<number>('wn_alloc', Math.max(outCapacity(input.byteLength), 1));
      try {
        const written = call<number>('wn_cipher_update', ctx, inPtr, input.byteLength, outPtr);
        if (written < 0) return null;
        return new Uint8Array(memory().buffer).slice(outPtr, outPtr + written);
      } finally {
        free(outPtr);
        free(inPtr);
      }
    },
    final(): Uint8Array | null {
      begin();
      const outPtr = call<number>('wn_alloc', info.blockSize + 16);
      try {
        const written = call<number>('wn_cipher_final', ctx, outPtr);
        if (written < 0) return null;
        return new Uint8Array(memory().buffer).slice(outPtr, outPtr + written);
      } finally {
        free(outPtr);
      }
    },
    getTag(length): Uint8Array | null {
      begin();
      const outPtr = call<number>('wn_alloc', Math.max(length, 1));
      try {
        if (call<number>('wn_cipher_get_tag', ctx, outPtr, length) < 0) return null;
        return new Uint8Array(memory().buffer).slice(outPtr, outPtr + length);
      } finally {
        free(outPtr);
      }
    },
    free(): void {
      call<number>('wn_cipher_free', ctx);
    },
  };
}

// --- KDFs -------------------------------------------------------------------

/** RFC 8018 PBKDF2, or `null` when OpenSSL does not know the digest. */
export function opensslPbkdf2(
  opensslName: string,
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keylen: number,
): Uint8Array | null {
  const [namePtr, nameLen] = pushName(opensslName);
  const [pwPtr, pwLen] = push(password);
  const [saltPtr, saltLen] = push(salt);
  const outPtr = call<number>('wn_alloc', Math.max(keylen, 1));
  try {
    begin();
    const written = call<number>(
      'wn_pbkdf2', namePtr, nameLen, pwPtr, pwLen, saltPtr, saltLen, iterations, outPtr, keylen,
    );
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(saltPtr);
    free(pwPtr);
    free(namePtr);
  }
}

/** RFC 5869 HKDF, or `null` when OpenSSL does not know the digest. */
export function opensslHkdf(
  opensslName: string,
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  keylen: number,
): Uint8Array | null {
  const [namePtr, nameLen] = pushName(opensslName);
  const [ikmPtr, ikmLen] = push(ikm);
  const [saltPtr, saltLen] = push(salt);
  const [infoPtr, infoLen] = push(info);
  const outPtr = call<number>('wn_alloc', Math.max(keylen, 1));
  try {
    begin();
    const written = call<number>(
      'wn_hkdf', namePtr, nameLen, ikmPtr, ikmLen, saltPtr, saltLen, infoPtr, infoLen, outPtr, keylen,
    );
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(infoPtr);
    free(saltPtr);
    free(ikmPtr);
    free(namePtr);
  }
}

/** RFC 7914 scrypt, or `null` when OpenSSL rejects the parameters. */
export function opensslScrypt(
  password: Uint8Array,
  salt: Uint8Array,
  keylen: number,
  params: { N: number; r: number; p: number; maxmem: number },
): Uint8Array | null {
  const [pwPtr, pwLen] = push(password);
  const [saltPtr, saltLen] = push(salt);
  const outPtr = call<number>('wn_alloc', Math.max(keylen, 1));
  try {
    begin();
    const written = call<number>(
      'wn_scrypt', pwPtr, pwLen, saltPtr, saltLen,
      params.N, params.r, params.p, params.maxmem, outPtr, keylen,
    );
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(saltPtr);
    free(pwPtr);
  }
}

/** RFC 9106 Argon2, or `null` when OpenSSL rejects the parameters. */
export function opensslArgon2(
  algorithm: 'ARGON2D' | 'ARGON2I' | 'ARGON2ID',
  params: {
    password: Uint8Array;
    salt: Uint8Array;
    secret: Uint8Array;
    associatedData: Uint8Array;
    lanes: number;
    keylen: number;
    memcost: number;
    iterations: number;
  },
): Uint8Array | null {
  const [algoPtr, algoLen] = pushName(algorithm);
  const [pwPtr, pwLen] = push(params.password);
  const [saltPtr, saltLen] = push(params.salt);
  const [secretPtr, secretLen] = push(params.secret);
  const [adPtr, adLen] = push(params.associatedData);
  const outPtr = call<number>('wn_alloc', Math.max(params.keylen, 1));
  try {
    begin();
    const written = call<number>(
      'wn_argon2', algoPtr, algoLen, pwPtr, pwLen, saltPtr, saltLen,
      secretPtr, secretLen, adPtr, adLen,
      params.lanes, params.keylen, params.memcost, params.iterations, outPtr,
    );
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(adPtr);
    free(secretPtr);
    free(saltPtr);
    free(pwPtr);
    free(algoPtr);
  }
}

// --- public keys (EVP_PKEY) -------------------------------------------------

/**
 * A short-lived, opaque EVP_PKEY handle held in wasm memory. The caller owns
 * it and must {@link opensslPkeyFree} it.
 */
export type OpenSslPkey = number;

/** Node's `crypto.constants` padding numbers, passed straight through. */
export const PKEY_PADDING = {
  PKCS1: 1,
  NO_PADDING: 3,
  OAEP: 4,
  X931: 5,
  PSS: 6,
} as const;

/** Generate a key pair; returns a handle to the **private** key, or `0`. */
export function opensslPkeyKeygen(name: string, group?: string, bits?: number): OpenSslPkey {
  const [namePtr, nameLen] = pushName(name);
  const [groupPtr, groupLen] = group === undefined ? [0, 0] : pushName(group);
  try {
    begin();
    return call<number>('wn_pkey_keygen', namePtr, nameLen, groupPtr, groupLen, bits ?? 0);
  } finally {
    free(groupPtr);
    free(namePtr);
  }
}

/** Import a DER key (PKCS#8/PKCS#1/SEC1 when private; SPKI/PKCS#1 when not). */
export function opensslPkeyFromDer(der: Uint8Array, isPrivate: boolean): OpenSslPkey {
  const [derPtr, derLen] = push(der);
  try {
    begin();
    return call<number>('wn_pkey_from_der', derPtr, derLen, isPrivate ? 1 : 0);
  } finally {
    free(derPtr);
  }
}

/** Import a fixed-length raw key (Ed25519, X25519, ML-KEM, …). */
export function opensslPkeyFromRaw(name: string, raw: Uint8Array, isPrivate: boolean): OpenSslPkey {
  const [namePtr, nameLen] = pushName(name);
  const [rawPtr, rawLen] = push(raw);
  try {
    begin();
    return call<number>('wn_pkey_from_raw', namePtr, nameLen, rawPtr, rawLen, isPrivate ? 1 : 0);
  } finally {
    free(rawPtr);
    free(namePtr);
  }
}

/** Serialise a key as DER, or `null` when OpenSSL refuses. */
export function opensslPkeyToDer(handle: OpenSslPkey, isPrivate: boolean): Uint8Array | null {
  const size = call<number>('wn_pkey_der_size', handle, isPrivate ? 1 : 0);
  if (size <= 0) return null;
  const outPtr = call<number>('wn_alloc', size);
  try {
    const written = call<number>('wn_pkey_to_der', handle, isPrivate ? 1 : 0, outPtr, size);
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
  }
}

/** Serialise a key in its fixed-length raw form, or `null` when it has none. */
export function opensslPkeyToRaw(handle: OpenSslPkey, isPrivate: boolean): Uint8Array | null {
  const size = call<number>('wn_pkey_raw_size', handle, isPrivate ? 1 : 0);
  if (size <= 0) return null;
  const outPtr = call<number>('wn_alloc', size);
  try {
    const written = call<number>('wn_pkey_to_raw', handle, isPrivate ? 1 : 0, outPtr, size);
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
  }
}

/** `EVP_PKEY_get_size` — the key's maximum ciphertext/signature length. */
export function opensslPkeySize(handle: OpenSslPkey): number {
  return call<number>('wn_pkey_size', handle);
}

/** Release a key handle. Safe to call with `0`. */
export function opensslPkeyFree(handle: OpenSslPkey): void {
  if (handle) call<number>('wn_pkey_free', handle);
}

/**
 * Sign `data`. `md` is the OpenSSL digest name, or `''` to sign the message
 * directly (Ed25519). `padding`/`saltLength` are Node's constants; `0` leaves
 * OpenSSL's defaults. Returns `null` on failure.
 */
export function opensslPkeySign(
  handle: OpenSslPkey,
  md: string,
  padding: number,
  saltLength: number,
  data: Uint8Array,
): Uint8Array | null {
  const [mdPtr, mdLen] = pushName(md);
  const [dataPtr, dataLen] = push(data);
  const size = opensslPkeySize(handle);
  // EC/Ed25519 signatures can exceed the field size, so leave slack.
  const cap = Math.max(size > 0 ? size * 2 + 64 : 1024, 256);
  const outPtr = call<number>('wn_alloc', cap);
  try {
    begin();
    const written = call<number>(
      'wn_pkey_sign', handle, mdPtr, mdLen, padding, saltLength, dataPtr, dataLen, outPtr, cap,
    );
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(dataPtr);
    free(mdPtr);
  }
}

/**
 * Verify `signature`. Returns `true`/`false`, or `null` when the call itself
 * failed (so the caller can fall back rather than report a bogus `false`).
 */
export function opensslPkeyVerify(
  handle: OpenSslPkey,
  md: string,
  padding: number,
  saltLength: number,
  data: Uint8Array,
  signature: Uint8Array,
): boolean | null {
  const [mdPtr, mdLen] = pushName(md);
  const [dataPtr, dataLen] = push(data);
  const [sigPtr, sigLen] = push(signature);
  try {
    begin();
    const result = call<number>(
      'wn_pkey_verify', handle, mdPtr, mdLen, padding, saltLength, dataPtr, dataLen, sigPtr, sigLen,
    );
    if (result < 0) return null;
    return result === 1;
  } finally {
    free(sigPtr);
    free(dataPtr);
    free(mdPtr);
  }
}

function rsaEncryptOrDecrypt(
  entry: 'wn_pkey_encrypt' | 'wn_pkey_decrypt',
  handle: OpenSslPkey,
  padding: number,
  md: string,
  label: Uint8Array,
  data: Uint8Array,
): Uint8Array | null {
  const [mdPtr, mdLen] = pushName(md);
  const [labelPtr, labelLen] = push(label);
  const [dataPtr, dataLen] = push(data);
  const size = opensslPkeySize(handle);
  const cap = size > 0 ? size : Math.max(data.length, 1);
  const outPtr = call<number>('wn_alloc', Math.max(cap, 1));
  try {
    begin();
    const written = call<number>(
      entry, handle, padding, mdPtr, mdLen, labelPtr, labelLen, dataPtr, dataLen, outPtr, cap,
    );
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(dataPtr);
    free(labelPtr);
    free(mdPtr);
  }
}

/** RSA-encrypt (or any `EVP_PKEY_encrypt`-capable key). `null` on failure. */
export function opensslPkeyEncrypt(
  handle: OpenSslPkey,
  padding: number,
  md: string,
  label: Uint8Array,
  data: Uint8Array,
): Uint8Array | null {
  return rsaEncryptOrDecrypt('wn_pkey_encrypt', handle, padding, md, label, data);
}

/** RSA-decrypt. `null` on failure (including a padding-check failure). */
export function opensslPkeyDecrypt(
  handle: OpenSslPkey,
  padding: number,
  md: string,
  label: Uint8Array,
  data: Uint8Array,
): Uint8Array | null {
  return rsaEncryptOrDecrypt('wn_pkey_decrypt', handle, padding, md, label, data);
}

/** ECDH / DH shared secret between a private handle and a peer's public one. */
export function opensslPkeyDerive(handle: OpenSslPkey, peer: OpenSslPkey): Uint8Array | null {
  const size = opensslPkeySize(handle);
  const cap = size > 0 ? size : 1024;
  const outPtr = call<number>('wn_alloc', cap);
  try {
    begin();
    const written = call<number>('wn_pkey_derive', handle, peer, outPtr, cap);
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
  }
}

/** ML-KEM encapsulation: `{ ciphertext, sharedKey }`, or `null`. */
export function opensslPkeyEncapsulate(
  handle: OpenSslPkey,
): { ciphertext: Uint8Array; sharedKey: Uint8Array } | null {
  // ML-KEM ciphertexts top out at 1568 bytes and the shared secret is 32.
  const ctCap = 2048;
  const ssCap = 256;
  const ctPtr = call<number>('wn_alloc', ctCap);
  const ssPtr = call<number>('wn_alloc', ssCap);
  const lensPtr = call<number>('wn_alloc', 8);
  try {
    begin();
    if (call<number>('wn_pkey_encapsulate', handle, ctPtr, ctCap, ssPtr, ssCap, lensPtr) !== 0) {
      return null;
    }
    const lens = new DataView(memory().buffer, lensPtr, 8);
    const ctLen = lens.getInt32(0, true);
    const ssLen = lens.getInt32(4, true);
    return {
      ciphertext: bytes().slice(ctPtr, ctPtr + ctLen),
      sharedKey: bytes().slice(ssPtr, ssPtr + ssLen),
    };
  } finally {
    free(lensPtr);
    free(ssPtr);
    free(ctPtr);
  }
}

/** ML-KEM decapsulation: the shared secret, or `null`. */
export function opensslPkeyDecapsulate(
  handle: OpenSslPkey,
  ciphertext: Uint8Array,
): Uint8Array | null {
  const [ctPtr, ctLen] = push(ciphertext);
  const ssCap = 256;
  const ssPtr = call<number>('wn_alloc', ssCap);
  const lensPtr = call<number>('wn_alloc', 8);
  try {
    begin();
    if (call<number>('wn_pkey_decapsulate', handle, ctPtr, ctLen, ssPtr, ssCap, lensPtr) !== 0) {
      return null;
    }
    const ssLen = new DataView(memory().buffer, lensPtr, 8).getInt32(0, true);
    return bytes().slice(ssPtr, ssPtr + ssLen);
  } finally {
    free(lensPtr);
    free(ssPtr);
    free(ctPtr);
  }
}
