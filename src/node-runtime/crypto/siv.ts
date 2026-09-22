/**
 * AES-SIV (RFC 5297), matching OpenSSL's `crypto/modes/siv128.c`.
 *
 * SIV is deterministic AEAD: the "IV" is the authentication tag itself. The key
 * is twice the AES key size — the first half keys CMAC (the S2V construction),
 * the second half keys AES-CTR. Like key wrap, `update` is one-shot: it consumes
 * all the input and returns the whole result.
 *
 * Node surfaces the S2V/CTR internals like OpenSSL does: no IV is allowed
 * (`createCipheriv(..., null)`), the tag length is fixed at 16, `setAAD` may be
 * called several times (each component is mixed in), and an authentication
 * failure is reported from `final()`, not `update()`.
 */
import { AesKey } from './aes';

/** Doubles a 128-bit value in GF(2^128) modulo x^128 + x^7 + x^2 + x + 1. */
function dbl(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  const carry = b[0] >> 7;
  for (let i = 0; i < 15; i++) out[i] = ((b[i] << 1) | (b[i + 1] >> 7)) & 0xff;
  out[15] = (b[15] << 1) & 0xff;
  if (carry) out[15] ^= 0x87;
  return out;
}

/** CMAC-AES over `data` (RFC 4493); 16-byte tag, 0x87 reduction. */
function cmac(key: Uint8Array, data: Uint8Array): Uint8Array {
  const aes = new AesKey(key);
  const l = new Uint8Array(16);
  aes.encryptBlock(l);
  const k1 = new Uint8Array(16);
  shiftLeft(l, k1);
  if (l[0] & 0x80) k1[15] ^= 0x87;
  const k2 = new Uint8Array(16);
  shiftLeft(k1, k2);
  if (k1[0] & 0x80) k2[15] ^= 0x87;

  const blockCount = Math.max(1, Math.ceil(data.length / 16));
  const lastComplete = data.length !== 0 && data.length % 16 === 0;
  const state = new Uint8Array(16);
  for (let i = 0; i < blockCount - 1; i++) {
    for (let j = 0; j < 16; j++) state[j] ^= data[i * 16 + j];
    aes.encryptBlock(state);
  }
  const last = new Uint8Array(16);
  if (lastComplete) {
    last.set(data.subarray((blockCount - 1) * 16));
    for (let j = 0; j < 16; j++) last[j] ^= k1[j];
  } else {
    const start = (blockCount - 1) * 16;
    const len = data.length - start;
    last.set(data.subarray(start, start + len));
    last[len] = 0x80;
    for (let j = 0; j < 16; j++) last[j] ^= k2[j];
  }
  for (let j = 0; j < 16; j++) state[j] ^= last[j];
  aes.encryptBlock(state);
  return state;
}

function shiftLeft(input: Uint8Array, out: Uint8Array): void {
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    out[i] = ((input[i] << 1) | carry) & 0xff;
    carry = (input[i] >> 7) & 1;
  }
}

/** AES-CTR with a 128-bit big-endian counter starting at `iv`. */
function ctrCrypt(key: AesKey, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  // Explicit copy: `iv` may alias caller memory whose `slice` does not copy.
  const counter = new Uint8Array(iv);
  const keystream = new Uint8Array(16);
  for (let offset = 0; offset < data.length; offset += 16) {
    keystream.set(counter);
    key.encryptBlock(keystream);
    const take = Math.min(16, data.length - offset);
    for (let i = 0; i < take; i++) out[offset + i] = data[offset + i] ^ keystream[i];
    for (let i = 15; i >= 0; i--) {
      counter[i] = (counter[i] + 1) & 0xff;
      if (counter[i] !== 0) break;
    }
  }
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

/** The payload step of S2V (`siv128_do_s2v_p`), given the running AAD state `d`. */
function s2vPayload(macKey: Uint8Array, d: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length >= 16) {
    const tail = data.subarray(data.length - 16);
    const mixed = new Uint8Array(16);
    for (let i = 0; i < 16; i++) mixed[i] = tail[i] ^ d[i];
    const input = new Uint8Array(data.length);
    input.set(data.subarray(0, data.length - 16));
    input.set(mixed, data.length - 16);
    return cmac(macKey, input);
  }
  const t = new Uint8Array(16);
  t.set(data);
  t[data.length] = 0x80;
  const dd = dbl(d);
  for (let i = 0; i < 16; i++) t[i] ^= dd[i];
  return cmac(macKey, t);
}

export class AesSiv {
  #macKey: Uint8Array;
  #ctrKey: AesKey;
  #encrypt: boolean;
  #d: Uint8Array;
  #done = false;
  #pendingAuthFailed = false;
  #tag: Uint8Array | null = null;
  #computedTag: Uint8Array | null = null;

  constructor(key: Uint8Array, encrypt: boolean) {
    const half = key.length / 2;
    this.#macKey = new Uint8Array(key.subarray(0, half));
    this.#ctrKey = new AesKey(key.subarray(half));
    this.#encrypt = encrypt;
    // d starts as CMAC(0^128) and folds in each AAD component.
    this.#d = cmac(this.#macKey, new Uint8Array(16));
  }

  setAAD(aad: Uint8Array): void {
    // AAD may not follow the (one-shot) payload step.
    if (this.#done) throw invalidState('setAAD');
    this.#d = dbl(this.#d);
    const mac = cmac(this.#macKey, aad);
    for (let i = 0; i < 16; i++) this.#d[i] ^= mac[i];
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#done) throw unsupported();
    this.#done = true;
    if (this.#encrypt) {
      const q = s2vPayload(this.#macKey, this.#d, input);
      this.#computedTag = q;
      const counter = new Uint8Array(q);
      counter[8] &= 0x7f;
      counter[12] &= 0x7f;
      return ctrCrypt(this.#ctrKey, counter, input);
    }
    if (this.#tag === null) {
      // No tag was set: the authentication cannot succeed, but the failure is
      // surfaced from final().
      this.#pendingAuthFailed = true;
      return new Uint8Array(0);
    }
    const counter = new Uint8Array(this.#tag);
    counter[8] &= 0x7f;
    counter[12] &= 0x7f;
    const plaintext = ctrCrypt(this.#ctrKey, counter, input);
    const t = s2vPayload(this.#macKey, this.#d, plaintext);
    let diff = 0;
    for (let i = 0; i < 16; i++) diff |= t[i] ^ this.#tag[i];
    if (diff !== 0) {
      this.#pendingAuthFailed = true;
      return new Uint8Array(0);
    }
    return plaintext;
  }

  final(): Uint8Array {
    // SIV is authenticated, so a missing one-shot update reports the auth error.
    if (!this.#done) throw new Error('Unsupported state or unable to authenticate data');
    if (this.#pendingAuthFailed) {
      throw new Error('Unsupported state or unable to authenticate data');
    }
    return new Uint8Array(0);
  }

  getAuthTag(): Uint8Array {
    if (this.#encrypt && this.#computedTag) return this.#computedTag.slice();
    throw invalidState('getAuthTag');
  }

  setAuthTag(tag: Uint8Array): void {
    // The tag may only be supplied before the one-shot payload step.
    if (!this.#encrypt && !this.#done && tag.length === 16) {
      // Copy: the caller's buffer may be mutated or aliased elsewhere.
      this.#tag = new Uint8Array(tag);
      return;
    }
    throw invalidState('setAuthTag');
  }

  setAutoPadding(): void {
    // SIV has no padding to toggle.
  }
}
