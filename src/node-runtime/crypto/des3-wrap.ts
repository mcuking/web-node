/**
 * DES-EDE3-CBC key wrap (RFC 3217 / CMS `id-smime-alg-cms3deswrap`) — matching
 * OpenSSL's `cipher_tdes_wrap.c`.
 *
 * Unlike the AES key-wrap modes this is *not* a NIST-style wrap: the payload is
 * prefixed with an 8-byte SHA-1 ICV and an 8-byte random IV, encrypted with
 * 3DES-CBC, then the whole buffer is reversed and CBC-encrypted again under the
 * fixed RFC 3217 IV. Because the IV is random the ciphertext is non-deterministic;
 * decryption (and hence the round-trip) is.
 *
 * The CBC state carries across the internal passes (they share one chaining
 * value), so this is implemented as a small stateful primitive rather than by
 * reusing `DesCipher` per call.
 */
import type { SyncCipher } from './chacha20';
import { DesEde } from './des';
import { resolveHash } from './hash';

/** RFC 3217 §3: the constant IV used for the outer CBC pass. */
const WRAP_IV = Uint8Array.from([0x4a, 0xdd, 0xa2, 0x2c, 0x79, 0xe8, 0x21, 0x05]);

function unsupported(): Error {
  return new Error('Trying to add data in unsupported state');
}

/**
 * Stateful 3DES-CBC over whole blocks. Each `crypt` call consumes the current
 * chaining value and leaves behind the last ciphertext block, exactly like the
 * OpenSSL EVP `ctx->iv` chaining across `EVP_CipherUpdate` calls.
 */
class Cbc3Des {
  #ede: DesEde;
  #encrypt: boolean;
  #iv: Uint8Array;

  constructor(key: Uint8Array, iv: Uint8Array, encrypt: boolean) {
    this.#ede = new DesEde(key);
    this.#encrypt = encrypt;
    this.#iv = new Uint8Array(iv);
  }

  /** Sets the chaining value before the next call. */
  setIv(iv: Uint8Array): void {
    this.#iv.set(iv.subarray(0, 8));
  }

  get iv(): Uint8Array {
    return new Uint8Array(this.#iv);
  }

  crypt(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    for (let off = 0; off < input.length; off += 8) {
      const block = input.subarray(off, off + 8);
      if (this.#encrypt) {
        const mixed = new Uint8Array(8);
        for (let i = 0; i < 8; i++) mixed[i] = block[i] ^ this.#iv[i];
        const enc = this.#ede.encrypt(mixed);
        out.set(enc, off);
        this.#iv = new Uint8Array(enc);
      } else {
        const dec = this.#ede.decrypt(block);
        for (let i = 0; i < 8; i++) out[off + i] = dec[i] ^ this.#iv[i];
        this.#iv = new Uint8Array(block);
      }
    }
    return out;
  }
}

function reverse(buf: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[buf.length - 1 - i];
  return out;
}

function sha1(bytes: Uint8Array): Uint8Array {
  const algo = resolveHash('sha1')!;
  return algo.hash(bytes);
}

/** RFC 3217 wrap. The IV is random: pass one in (tests use a fixed value). */
function wrap(key: Uint8Array, input: Uint8Array, iv: Uint8Array): Uint8Array | null {
  if (input.length % 8 !== 0) return null;
  const icv = sha1(input).subarray(0, 8);
  // P = [IV | payload | SHA-1(payload)[0:8]], inner-CBC-encrypted from block 1.
  const inner = new Uint8Array(16 + input.length);
  inner.set(iv.subarray(0, 8), 0);
  const innerEnc = new Cbc3Des(key, iv, true).crypt(concat(input, icv));
  inner.set(innerEnc, 8);
  // Reverse the whole buffer, then CBC-encrypt under the fixed RFC 3217 IV.
  return new Cbc3Des(key, WRAP_IV, true).crypt(reverse(inner));
}

/** RFC 3217 unwrap; returns the plaintext or null on an ICV mismatch. */
function unwrap(key: Uint8Array, input: Uint8Array): Uint8Array | null {
  if (input.length < 24) return null;
  // CBC-decrypt under the fixed IV, reverse, then inner-CBC-decrypt under the
  // recovered IV to expose [payload | ICV].
  const dec = new Cbc3Des(key, WRAP_IV, false).crypt(input);
  const full = reverse(dec);
  const iv = full.subarray(0, 8);
  const plain = new Cbc3Des(key, iv, false).crypt(full.subarray(8));
  const plaintext = plain.subarray(0, plain.length - 8);
  const icv = plain.subarray(plain.length - 8);
  const expected = sha1(plaintext).subarray(0, 8);
  for (let i = 0; i < 8; i++) if (expected[i] !== icv[i]) return null;
  return new Uint8Array(plaintext);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export class Des3Wrap implements SyncCipher {
  #key: Uint8Array;
  #encrypt: boolean;
  #done = false;
  #iv: Uint8Array | null;

  constructor(key: Uint8Array, encrypt: boolean, iv?: Uint8Array | null) {
    this.#key = new Uint8Array(key);
    this.#encrypt = encrypt;
    this.#iv = iv ?? null;
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#done) throw unsupported();
    this.#done = true;
    // OpenSSL's `tdes_wrap_update` is a no-op for an empty input.
    if (input.length === 0) return new Uint8Array(0);
    const result = this.#encrypt ? this.#wrap(input) : unwrap(this.#key, input);
    if (result === null) throw unsupported();
    return result;
  }

  #wrap(input: Uint8Array): Uint8Array | null {
    // Random IV: use the caller-supplied one when present (tests), else CSPRNG.
    const iv = this.#iv ?? randomBytes(8);
    return wrap(this.#key, input, iv);
  }

  final(): Uint8Array {
    if (!this.#done) throw new Error('Unsupported state');
    return new Uint8Array(0);
  }

  setAutoPadding(): void {
    // Key wrap has no padding to toggle.
  }

  setAAD(): never {
    throw new Error('Trying to add data in unsupported state');
  }

  getAuthTag(): never {
    const error = new Error('Invalid state for operation getAuthTag');
    (error as { code?: string }).code = 'ERR_CRYPTO_INVALID_STATE';
    throw error;
  }

  setAuthTag(): never {
    throw new Error('Trying to add data in unsupported state');
  }
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}
