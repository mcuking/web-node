/**
 * AES-XTS (IEEE 1619), matching OpenSSL's `crypto/modes/xts128.c`.
 *
 * XTS is a length-preserving disk-encryption mode: a 16-byte tweak is derived by
 * encrypting the IV under the second half of the key, and it is doubled in
 * GF(2^128) for each successive block. The main body is processed in 16-byte
 * blocks; a trailing partial block is handled with ciphertext stealing.
 *
 * The key must be twice the AES key size and the two halves must differ
 * (OpenSSL rejects equal halves). Like key wrap, `update` is one-shot: an input
 * shorter than 16 bytes is rejected with Node's "unsupported state" error.
 */
import { AesKey } from './aes';

/**
 * Advances the XTS tweak: multiply by α in GF(2^128) modulo
 * x^128 + x^7 + x^2 + x + 1, with the tweak treated as a little-endian value
 * (so the carry flows from the last byte towards the first, unlike GCM/SIV).
 */
function tweakDbl(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  const carry = b[15] >> 7;
  for (let i = 15; i > 0; i--) out[i] = ((b[i] << 1) | (b[i - 1] >> 7)) & 0xff;
  out[0] = (b[0] << 1) & 0xff;
  if (carry) out[0] ^= 0x87;
  return out;
}

function unsupported(): Error {
  return new Error('Trying to add data in unsupported state');
}

function invalidState(operation: string): Error {
  const error = new Error(`Invalid state for operation ${operation}`);
  (error as { code?: string }).code = 'ERR_CRYPTO_INVALID_STATE';
  return error;
}

export class AesXts {
  #k1: AesKey;
  #k2: AesKey;
  #encrypt: boolean;
  #iv: Uint8Array;
  #done = false;

  constructor(key: Uint8Array, iv: Uint8Array, encrypt: boolean) {
    const half = key.length / 2;
    const key1 = key.subarray(0, half);
    const key2 = key.subarray(half);
    // OpenSSL refuses key halves that are equal (a known weak-key footgun).
    let same = true;
    for (let i = 0; i < half; i++) {
      if (key1[i] !== key2[i]) {
        same = false;
        break;
      }
    }
    if (same) {
      const error = new Error('error:1C800095:Provider routines::xts duplicated keys');
      (error as { code?: string }).code = 'ERR_OSSL_XTS_DUPLICATED_KEYS';
      throw error;
    }
    this.#k1 = new AesKey(key1);
    this.#k2 = new AesKey(key2);
    this.#encrypt = encrypt;
    this.#iv = new Uint8Array(iv.subarray(0, 16));
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#done) throw unsupported();
    this.#done = true;
    if (input.length < 16) throw unsupported();
    return this.#encrypt ? this.#encryptData(input) : this.#decryptData(input);
  }

  #encryptData(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    let tweak: Uint8Array = new Uint8Array(this.#iv);
    this.#k2.encryptBlock(tweak);
    const len = input.length;
    let offset = 0;
    // Whole blocks; the final whole block is kept in `scratch` for stealing.
    let scratch: Uint8Array | null = null;
    while (len - offset >= 16) {
      const block = new Uint8Array(16);
      for (let i = 0; i < 16; i++) block[i] = input[offset + i] ^ tweak[i];
      this.#k1.encryptBlock(block);
      for (let i = 0; i < 16; i++) block[i] ^= tweak[i];
      out.set(block, offset);
      scratch = block;
      offset += 16;
      if (offset === len) return out;
      tweak = tweakDbl(tweak);
    }
    // Ciphertext stealing: `offset` marks a trailing partial block (1..15).
    const r = len - offset;
    const partial = new Uint8Array(16);
    // `scratch` holds the ciphertext of the block just before the partial one.
    for (let i = 0; i < r; i++) {
      partial[i] = input[offset + i];
      out[offset + i] = scratch![i];
      scratch![i] = partial[i];
    }
    // Encrypt the (partial plaintext || ciphertext tail) block under the tweak.
    for (let i = 0; i < 16; i++) scratch![i] ^= tweak[i];
    this.#k1.encryptBlock(scratch!);
    for (let i = 0; i < 16; i++) scratch![i] ^= tweak[i];
    out.set(scratch!, offset - 16);
    return out;
  }

  #decryptData(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    let tweak: Uint8Array = new Uint8Array(this.#iv);
    this.#k2.encryptBlock(tweak);
    const len = input.length;
    const rem = len % 16;
    // With a trailing partial block, the final full block is peeled off and
    // handled by the stealing step, so the loop stops one block early.
    const mainBlocks = rem === 0 ? len / 16 : Math.floor(len / 16) - 1;
    let offset = 0;
    for (let i = 0; i < mainBlocks; i++) {
      const block = new Uint8Array(16);
      for (let j = 0; j < 16; j++) block[j] = input[offset + j] ^ tweak[j];
      this.#k1.decryptBlock(block);
      for (let j = 0; j < 16; j++) block[j] ^= tweak[j];
      out.set(block, offset);
      offset += 16;
      if (offset === len) return out;
      tweak = tweakDbl(tweak);
    }
    // `offset` is the start of the final full block; `tweak` is its
    // (T_{m-1}); the partial block sits at `offset + 16`.
    const tweak1 = tweakDbl(tweak);
    const block = new Uint8Array(16);
    for (let j = 0; j < 16; j++) block[j] = input[offset + j] ^ tweak1[j];
    this.#k1.decryptBlock(block);
    for (let j = 0; j < 16; j++) block[j] ^= tweak1[j];
    const r = len - (offset + 16);
    for (let j = 0; j < r; j++) {
      const c = input[offset + 16 + j];
      out[offset + 16 + j] = block[j];
      block[j] = c;
    }
    for (let j = 0; j < 16; j++) block[j] ^= tweak[j];
    this.#k1.decryptBlock(block);
    for (let j = 0; j < 16; j++) block[j] ^= tweak[j];
    out.set(block, offset);
    return out;
  }

  final(): Uint8Array {
    if (!this.#done) throw new Error('Unsupported state');
    return new Uint8Array(0);
  }

  setAutoPadding(): void {
    // XTS is length-preserving; there is no padding to toggle.
  }

  setAAD(): never {
    throw invalidState('setAAD');
  }

  getAuthTag(): never {
    throw invalidState('getAuthTag');
  }

  setAuthTag(): never {
    throw invalidState('setAuthTag');
  }
}
