/**
 * AES-GCM-SIV (RFC 8452), matching OpenSSL's
 * `providers/implementations/ciphers/cipher_aes_gcm_siv{,_polyval,_hw}.c`.
 *
 * GCM-SIV is a nonce-misuse-resistant AEAD: the tag is derived first (a
 * POLYVAL universal hash over AAD, plaintext, and lengths, folded with the
 * nonce), and that tag seeds the AES-CTR keystream. Encryption and decryption
 * are therefore asymmetric in structure — decryption must run CTR before it can
 * recompute the tag over the recovered plaintext.
 *
 * Per-message keys are derived from the 96-bit nonce with AES-ECB:
 *   msg_auth_key = E(K, LE32(0)||N)[0..8] || E(K, LE32(1)||N)[0..8]
 *   msg_enc_key  = E(K, LE32(2)||N)[0..8] || E(K, LE32(3)||N)[0..8] || ...
 * (one 8-byte half per counter, continuing from 2 for the key length).
 *
 * OpenSSL treats this as one-shot: a single `update` carries the whole message
 * and a second one raises "Trying to add data in unsupported state".
 */
import { AesKey } from './aes';

function unsupported(): Error {
  return new Error('Trying to add data in unsupported state');
}

function invalidState(operation: string): Error {
  const error = new Error(`Invalid state for operation ${operation}`);
  (error as { code?: string }).code = 'ERR_CRYPTO_INVALID_STATE';
  return error;
}

function authFailure(): Error {
  return new Error('Unsupported state or unable to authenticate data');
}

function codedError(name: 'Error' | 'TypeError', code: string, message: string): Error {
  const error = new (name === 'TypeError' ? TypeError : Error)(message);
  (error as { code?: string }).code = code;
  return error;
}

function byteReverse(a: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = a[15 - i];
  return out;
}

/** Multiply-by-x in the GHASH field (right shift with the 0xe1 reduction). */
function mulxGhash(a: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  const carry = a[15] & 1;
  for (let i = 15; i > 0; i--) out[i] = ((a[i] >> 1) | ((a[i - 1] & 1) << 7)) & 0xff;
  out[0] = a[0] >> 1;
  if (carry) out[0] ^= 0xe1;
  return out;
}

/** One GHASH-field multiply: `x * h` (both 16 bytes, big-endian bit order). */
function ghashMul(x: Uint8Array, h: Uint8Array): Uint8Array {
  const z = new Uint8Array(16);
  const v = new Uint8Array(h);
  for (let i = 0; i < 128; i++) {
    if ((x[i >> 3] >> (7 - (i & 7))) & 1) {
      for (let j = 0; j < 16; j++) z[j] ^= v[j];
    }
    const lsb = v[15] & 1;
    for (let j = 15; j > 0; j--) v[j] = ((v[j] >> 1) | ((v[j - 1] & 1) << 7)) & 0xff;
    v[0] >>= 1;
    if (lsb) v[0] ^= 0xe1;
  }
  return z;
}

/**
 * POLYVAL. OpenSSL implements it through GHASH on byte-reversed operands: the
 * key is byte-reversed and scaled by x, each input block is byte-reversed, and
 * the running value is byte-reversed back at the end.
 */
function polyvalInit(msgAuthKey: Uint8Array): Uint8Array {
  return mulxGhash(byteReverse(msgAuthKey));
}

function polyvalAbsorb(state: Uint8Array, hTable: Uint8Array, block: Uint8Array): Uint8Array {
  const x = new Uint8Array(16);
  const rev = byteReverse(block);
  for (let i = 0; i < 16; i++) x[i] = state[i] ^ rev[i];
  return ghashMul(x, hTable);
}

export class AesGcmSiv {
  #key: Uint8Array;
  #nonce: Uint8Array;
  #encrypt: boolean;
  #authKey: Uint8Array;
  #encKey: Uint8Array;
  #aad: Uint8Array = new Uint8Array(0);
  #userTag: Uint8Array | null = null;
  #authTag: Uint8Array | null = null;
  #computedTag: Uint8Array | null = null;
  #used = false;
  #finalized = false;

  constructor(key: Uint8Array, nonce: Uint8Array, encrypt: boolean) {
    this.#key = new Uint8Array(key);
    this.#nonce = new Uint8Array(nonce);
    this.#encrypt = encrypt;
    const { authKey, encKey } = this.#deriveKeys();
    this.#authKey = authKey;
    this.#encKey = encKey;
  }

  #deriveKeys(): { authKey: Uint8Array; encKey: Uint8Array } {
    const ecb = new AesKey(this.#key);
    const block = new Uint8Array(16);
    block.set(this.#nonce, 4);
    const enc = (counter: number): Uint8Array => {
      block[0] = counter & 0xff;
      block[1] = (counter >> 8) & 0xff;
      block[2] = (counter >> 16) & 0xff;
      block[3] = (counter >> 24) & 0xff;
      const out = new Uint8Array(block);
      ecb.encryptBlock(out);
      return out;
    };
    const authKey = new Uint8Array(16);
    authKey.set(enc(0).subarray(0, 8), 0);
    authKey.set(enc(1).subarray(0, 8), 8);
    const encKey = new Uint8Array(this.#key.length);
    for (let i = 0, counter = 2; i < this.#key.length; i += 8, counter++) {
      encKey.set(enc(counter).subarray(0, 8), i);
    }
    return { authKey, encKey };
  }

  setAAD(aad: Uint8Array): void {
    if (this.#used || this.#finalized) throw invalidState('setAAD');
    this.#aad = new Uint8Array(aad);
  }

  #tagFor(plaintext: Uint8Array): Uint8Array {
    const hTable = polyvalInit(this.#authKey);
    // POLYVAL is Horner over AAD, plaintext, then the length block, from zero.
    let state: Uint8Array = new Uint8Array(16);
    const aadPad = new Uint8Array((this.#aad.length + 15) & ~15);
    aadPad.set(this.#aad);
    for (let o = 0; o < aadPad.length; o += 16) state = polyvalAbsorb(state, hTable, aadPad.subarray(o, o + 16));
    const down = plaintext.length & ~15;
    for (let o = 0; o < down; o += 16) state = polyvalAbsorb(state, hTable, plaintext.subarray(o, o + 16));
    if (plaintext.length & 15) {
      const pad = new Uint8Array(16);
      pad.set(plaintext.subarray(down));
      state = polyvalAbsorb(state, hTable, pad);
    }
    const lenBlock = new Uint8Array(16);
    const view = new DataView(lenBlock.buffer);
    view.setUint32(0, this.#aad.length * 8, true);
    view.setUint32(4, Math.floor((this.#aad.length * 8) / 0x100000000), true);
    view.setUint32(8, plaintext.length * 8, true);
    view.setUint32(12, Math.floor((plaintext.length * 8) / 0x100000000), true);
    state = polyvalAbsorb(state, hTable, lenBlock);
    const s = byteReverse(state);
    for (let i = 0; i < 12; i++) s[i] ^= this.#nonce[i];
    s[15] &= 0x7f;
    const tag = new Uint8Array(s);
    new AesKey(this.#encKey).encryptBlock(tag);
    return tag;
  }

  /** AES-CTR32 with the first four bytes as a little-endian counter. */
  #ctr(counterBlock: Uint8Array, input: Uint8Array): Uint8Array {
    const aes = new AesKey(this.#encKey);
    const out = new Uint8Array(input.length);
    const counter = new Uint8Array(counterBlock);
    for (let offset = 0; offset < input.length; offset += 16) {
      const keystream = new Uint8Array(counter);
      aes.encryptBlock(keystream);
      const end = Math.min(offset + 16, input.length);
      for (let i = offset; i < end; i++) out[i] = input[i] ^ keystream[i - offset];
      for (let i = 0; i < 4; i++) {
        counter[i] = (counter[i] + 1) & 0xff;
        if (counter[i] !== 0) break;
      }
    }
    return out;
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#used || this.#finalized) throw unsupported();
    this.#used = true;
    const data = new Uint8Array(input);
    if (this.#encrypt) {
      this.#computedTag = this.#tagFor(data);
      const counter = new Uint8Array(this.#computedTag);
      counter[15] |= 0x80;
      return this.#ctr(counter, data);
    }
    // Decryption runs CTR first (the tag seeds the keystream); the tag is then
    // recomputed over the recovered plaintext and checked in `final`. A missing
    // tag is tolerated here and surfaces as an auth failure at `final`.
    const counter = new Uint8Array(this.#userTag ?? new Uint8Array(16));
    counter[15] |= 0x80;
    const plaintext = this.#ctr(counter, data);
    this.#computedTag = this.#tagFor(plaintext);
    return plaintext;
  }

  final(): Uint8Array {
    if (this.#finalized) {
      const error = new Error('Invalid state');
      (error as { code?: string }).code = 'ERR_CRYPTO_INVALID_STATE';
      throw error;
    }
    this.#finalized = true;
    // GCM-SIV is one-shot: a `final` with no preceding `update` is rejected with
    // the AEAD state error (Node's `isGcmSivMode` check in `CipherBase::Final`).
    if (!this.#used) throw authFailure();
    if (this.#encrypt) {
      this.#authTag = this.#computedTag!;
      return new Uint8Array(0);
    }
    const tag = this.#computedTag!;
    const expected = this.#userTag;
    if (expected === null) throw authFailure();
    let diff = 0;
    for (let i = 0; i < tag.length; i++) diff |= tag[i] ^ expected[i];
    if (diff !== 0) throw authFailure();
    return new Uint8Array(0);
  }

  setAutoPadding(): void {
    // GCM-SIV is length-preserving; Node accepts and ignores the call.
  }

  getAuthTag(): Uint8Array {
    if (!this.#encrypt || this.#authTag === null) throw invalidState('getAuthTag');
    return this.#authTag;
  }

  setAuthTag(tag: Uint8Array): void {
    if (this.#encrypt) throw invalidState('setAuthTag');
    if (tag.length !== 16) {
      throw codedError('TypeError', 'ERR_CRYPTO_INVALID_AUTH_TAG', `Invalid authentication tag length: ${tag.length}`);
    }
    this.#userTag = new Uint8Array(tag);
  }
}
