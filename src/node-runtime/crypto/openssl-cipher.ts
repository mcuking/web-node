/**
 * OpenSSL-backed symmetric ciphers — `wn_openssl` (M119).
 *
 * `crypto/cipher.ts` is a pure-JS implementation of everything Node's
 * `createCipheriv` exposes (AES/DES/Camellia/ARIA/SM4 in every mode, the AEADs,
 * the key-wrap forms). It exists because `cipher.update()` / `cipher.final()`
 * are synchronous *and* streaming, which a promise-only WebCrypto cannot do —
 * but a JS AES is still a JS AES. Now that the real OpenSSL subset is compiled
 * to wasm, the engine can be the very code Node itself runs: faster, and
 * identical by construction rather than by reverse-engineering.
 *
 * What lives here is the **state machine**, deliberately: Node's
 * `CipherBase::Update` / `CipherBase::Final` (`src/crypto/crypto_cipher.cc`)
 * make a handful of decisions *around* the EVP calls — the one-shot modes, the
 * deferred CCM/SIV authentication failure, and which message `final()` reports
 * for an authenticated mode — and reproducing those is what makes the
 * observable behaviour (chunk boundaries and error text included) line up.
 *
 * `createCipher()` prefers this engine whenever the module is loaded and the
 * name resolves; otherwise it keeps the pure-JS path. The two agree byte for
 * byte, so the swap is invisible — and a failed *setup* (a name OpenSSL will
 * not take, a key it rejects) also falls back, where the JS constructor
 * produces the very same error.
 */
import {
  CIPH_FLAG,
  CIPH_MODE,
  opensslCipherInfo,
  opensslCipherNew,
  opensslLastError,
  opensslReady,
  type OpenSslCipherHandle,
} from '../bindings/openssl';
import { opensslErrorCode } from './openssl-error';
import type { CipherSpec } from './cipher';
import type { SyncCipher } from './chacha20';

export interface OpenSslCipherOptions {
  /** AEAD tag length in bytes (`authTagLength`, already validated). */
  authTagLength: number;
  /** CCM's declared plaintext length, when `setAAD` supplied one. */
  plaintextLength?: number;
}

const AUTH_FAILED = 'Unsupported state or unable to authenticate data';
const UNSUPPORTED_STATE = 'Unsupported state';
const ADD_DATA_FAILED = 'Trying to add data in unsupported state';

function codedError(code: string, message: string, name = 'Error'): Error {
  const error = new Error(message) as Error & { code?: string };
  error.name = name;
  error.code = code;
  return error;
}

function invalidState(operation: string): Error {
  return codedError('ERR_CRYPTO_INVALID_STATE', `Invalid state for operation ${operation}`);
}

/**
 * Rebuild the exception Node raises for an OpenSSL failure (`ThrowCryptoError`
 * in `src/crypto/crypto_util.cc`): the message is the long `error:...` string
 * and the code is `ERR_OSSL_<LIBRARY>_<REASON>`. When OpenSSL queued *nothing*
 * — a GCM tag mismatch does exactly that — Node uses its own message and sets
 * no code at all.
 */
function throwOpenSslError(fallback: string): never {
  const detail = opensslLastError();
  const error = new Error(detail || fallback) as Error & { code?: string };
  const code = opensslErrorCode();
  if (code !== null) error.code = code;
  throw error;
}

/** OpenSSL spellings that differ from the spec's own name and info name. */
const OPENSSL_ALIASES: Record<string, string> = {
  'des3-wrap': 'DES3-WRAP',
  'id-smime-alg-cms3deswrap': 'DES3-WRAP',
};

const NAME_CACHE = new Map<string, string | null>();

/**
 * The name OpenSSL fetches for `spec`, or `null` when it has none. Cached
 * because the probe is an `EVP_CIPHER_fetch`, and the answer cannot change
 * while the module is loaded.
 */
export function opensslCipherName(spec: CipherSpec): string | null {
  const cached = NAME_CACHE.get(spec.name);
  if (cached !== undefined) return cached;
  const candidates: string[] = [];
  // Node fetches the name the caller actually passed, so prefer the spec's own
  // spelling over the canonical `id-*` alias when both resolve.
  if (OPENSSL_ALIASES[spec.name]) candidates.push(OPENSSL_ALIASES[spec.name]);
  candidates.push(spec.name.toUpperCase(), spec.infoName.toUpperCase());
  let found: string | null = null;
  for (const candidate of candidates) {
    if (opensslCipherInfo(candidate) !== null) {
      found = candidate;
      break;
    }
  }
  NAME_CACHE.set(spec.name, found);
  return found;
}

/** `EVP_CIPHER_CTX` driven as Node's `SyncCipher`, with Node's state checks. */
class OpenSslCipher implements SyncCipher {
  readonly #spec: CipherSpec;
  readonly #handle: OpenSslCipherHandle;
  readonly #encrypt: boolean;
  readonly #tagLength: number;
  /** AEAD modes that Node's `IsAuthenticatedMode()` reports (GCM/CCM/OCB/SIV/ChaCha20-Poly1305). */
  readonly #aead: boolean;
  readonly #ccm: boolean;
  /** SIV *and* GCM-SIV: fixed tag, no IV length to declare, one-shot. */
  readonly #siv: boolean;
  readonly #wrap: boolean;
  /** Modes whose `update()` accepts exactly one call (`is_one_shot_update_`). */
  readonly #oneShotUpdate: boolean;
  /** Modes whose `final()` requires that one call to have happened. */
  readonly #oneShotFinal: boolean;

  #oneShotDone = false;
  #pendingAuthFailed = false;
  #finalized = false;
  #autoPadding = true;
  #tagSet = false;
  #expectedTag: Uint8Array | null = null;
  #authTag: Uint8Array | null = null;
  #dataSeen = false;
  #plaintextLength: number | undefined;

  constructor(
    spec: CipherSpec,
    handle: OpenSslCipherHandle,
    encrypt: boolean,
    options: OpenSslCipherOptions,
  ) {
    this.#spec = spec;
    this.#handle = handle;
    this.#encrypt = encrypt;
    this.#tagLength = spec.mode === 'siv' || spec.mode === 'gcm-siv' ? 16 : options.authTagLength;
    this.#plaintextLength = options.plaintextLength;
    this.#aead = (handle.flags & CIPH_FLAG.AEAD) !== 0;
    this.#ccm = handle.mode === CIPH_MODE.CCM;
    this.#siv = handle.mode === CIPH_MODE.SIV || handle.mode === CIPH_MODE.GCM_SIV;
    this.#wrap = handle.mode === CIPH_MODE.WRAP;
    this.#oneShotUpdate =
      (this.#ccm && !encrypt) ||
      this.#siv ||
      handle.mode === CIPH_MODE.XTS ||
      spec.mode === 'cbc-cts' ||
      this.#wrap;
    // `CipherBase::Final`'s `is_one_shot` omits CCM (its `final` has its own
    // branch); everything else that is one-shot for `update` is one-shot here.
    this.#oneShotFinal = this.#siv || handle.mode === CIPH_MODE.XTS || spec.mode === 'cbc-cts' || this.#wrap;
  }

  #release(): void {
    this.#handle.free();
  }

  /**
   * Build and key a context. `null` means "OpenSSL will not do this one" — the
   * caller then keeps the pure-JS implementation, which raises the same error
   * for setup problems Node rejects (duplicated XTS keys, say).
   */
  static create(
    spec: CipherSpec,
    name: string,
    key: Uint8Array,
    iv: Uint8Array | null,
    encrypt: boolean,
    options: OpenSslCipherOptions,
  ): OpenSslCipher | null {
    const info = opensslCipherInfo(name);
    if (info === null) return null;
    const handle = opensslCipherNew(name, encrypt, info);
    if (handle === null) return null;
    const setup = (): boolean => {
      const aead = (info.flags & CIPH_FLAG.AEAD) !== 0;
      const siv = info.mode === CIPH_MODE.SIV || info.mode === CIPH_MODE.GCM_SIV;
      // Node declares the IV length for every AEAD mode except SIV/GCM-SIV,
      // whose nonce length is fixed.
      if (aead && !siv && !handle.setIvLength(iv ? iv.byteLength : 0)) return false;
      // CCM and OCB have no default tag length; ChaCha20-Poly1305's is fixed
      // but Node still declares it. GCM is validated on the JS side instead.
      const declaresTag =
        info.mode === CIPH_MODE.CCM || info.mode === CIPH_MODE.OCB || spec.mode === 'chacha20-poly1305';
      const tagLength = siv ? 16 : options.authTagLength;
      if (declaresTag && !handle.setTagLength(tagLength)) return false;
      return handle.setKeyIv(key, iv);
    };
    if (!setup()) {
      handle.free();
      return null;
    }
    return new OpenSslCipher(spec, handle, encrypt, options);
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#finalized || (this.#oneShotUpdate && this.#oneShotDone)) {
      throw new Error(ADD_DATA_FAILED);
    }
    this.#dataSeen = true;
    const out = this.#handle.update(input);
    const ok = out !== null;
    // Node marks the one-shot as spent after CCM decryption and every SIV call
    // unconditionally, but for CTS/XTS/wrap only when the call succeeded.
    if (this.#ccm && !this.#encrypt) this.#oneShotDone = true;
    if (this.#siv || ((this.#spec.mode === 'cbc-cts' || this.#handle.mode === CIPH_MODE.XTS || this.#wrap) && ok)) {
      this.#oneShotDone = true;
    }
    if (!ok) {
      // CCM and SIV report a bad tag at update time; Node defers the failure to
      // `final()` so the AEAD contract holds.
      if (!this.#encrypt && (this.#ccm || this.#siv)) {
        this.#pendingAuthFailed = true;
        return new Uint8Array(0);
      }
      // Node runs `update()` inside a `MarkPopErrorOnReturn`, so OpenSSL's own
      // error never reaches the caller: every update-time failure is this
      // message, without a code (`CipherBase::Update` → `kErrorState`).
      this.#release();
      this.#finalized = true;
      throw new Error(ADD_DATA_FAILED);
    }
    return out;
  }

  final(): Uint8Array {
    if (this.#finalized) throw codedError('ERR_CRYPTO_INVALID_STATE', 'Invalid state');
    this.#finalized = true;
    if (this.#oneShotFinal && !this.#oneShotDone) {
      this.#release();
      // Node resets the context without touching OpenSSL here, so the message
      // is its own — the authenticated variant for SIV, the plain one elsewhere.
      throw new Error(this.#aead ? AUTH_FAILED : UNSUPPORTED_STATE);
    }
    if (this.#ccm && !this.#encrypt) {
      // Node never calls `EVP_CipherFinal_ex` for CCM: `final()` only reports
      // whether `update()` authenticated.
      const ok = this.#tagSet && this.#oneShotDone && !this.#pendingAuthFailed;
      this.#release();
      if (!ok) throw new Error(AUTH_FAILED);
      return new Uint8Array(0);
    }
    const out = this.#handle.final();
    if (out === null) {
      this.#release();
      throwOpenSslError(this.#aead ? AUTH_FAILED : UNSUPPORTED_STATE);
    }
    if (this.#encrypt && this.#aead) {
      const tag = this.#handle.getTag(this.#tagLength);
      if (tag === null) {
        this.#release();
        throwOpenSslError(AUTH_FAILED);
      }
      this.#authTag = tag;
    }
    this.#release();
    return out;
  }

  setAutoPadding(autoPadding?: boolean): void {
    this.#autoPadding = autoPadding === undefined ? true : Boolean(autoPadding);
    // Node forwards this to EVP and ignores a failure (the caller may set it
    // after the data has been written, where OpenSSL refuses).
    this.#handle.setPadding(this.#autoPadding);
  }

  setAAD(aad: Uint8Array, options?: { plaintextLength?: number }): void {
    if (!this.#aead || this.#finalized || this.#dataSeen) {
      throw invalidState('setAAD');
    }
    if (this.#ccm) {
      // CCM needs the message length up front; Node requires the option here.
      const length = options?.plaintextLength;
      if (length === undefined) {
        throw codedError('ERR_MISSING_ARGS', 'options.plaintextLength required for CCM mode with AAD', 'TypeError');
      }
      this.#plaintextLength = length;
      if (!this.#handle.setDataLength(length)) throw invalidState('setAAD');
    }
    if (!this.#handle.aad(aad)) throw invalidState('setAAD');
  }

  getAuthTag(): Uint8Array {
    if (!this.#encrypt || this.#authTag === null) throw invalidState('getAuthTag');
    return this.#authTag;
  }

  setAuthTag(tag: Uint8Array): void {
    // Node rejects a second call (`auth_tag_state_ != kAuthTagUnknown` returns
    // false), and SIV/GCM-SIV reject any call once their one-shot update ran.
    if (!this.#aead || this.#encrypt || this.#tagSet || (this.#siv && this.#oneShotDone)) {
      throw invalidState('setAuthTag');
    }
    if (tag.length !== this.#tagLength) {
      throw codedError('ERR_CRYPTO_INVALID_AUTH_TAG', `Invalid authentication tag length: ${tag.length}`, 'TypeError');
    }
    this.#tagSet = true;
    this.#expectedTag = tag.slice();
    if (!this.#handle.setTag(tag)) throw invalidState('setAuthTag');
  }
}

/**
 * An OpenSSL-backed cipher for `spec`, or `null` when the module is not loaded,
 * the name is unknown to it, or it refuses the key/IV (in which case the JS
 * implementation raises Node's error anyway).
 */
export function createOpenSslCipher(
  spec: CipherSpec,
  key: Uint8Array,
  iv: Uint8Array | null,
  encrypt: boolean,
  options: OpenSslCipherOptions,
): SyncCipher | null {
  if (!opensslReady()) return null;
  const name = opensslCipherName(spec);
  if (name === null) return null;
  return OpenSslCipher.create(spec, name, key, iv, encrypt, options);
}
