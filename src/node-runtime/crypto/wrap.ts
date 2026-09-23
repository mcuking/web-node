/**
 * AES key wrap — RFC 3394 (`wrap`) and RFC 5649 (`wrap-pad`) — matching
 * OpenSSL's `wrap128.c`. Both are one-shot: `update` consumes all the input and
 * returns the whole result, and a second `update` is an error.
 */
import { AesKey } from './aes';

type BlockFn = (block: Uint8Array) => void;

function unsupported(): Error {
  return new Error('Trying to add data in unsupported state');
}

/** RFC 3394 §2.2.1 wrap (the input must be a whole number of 8-byte blocks, n >= 2). */
function wrap(block: BlockFn, iv: Uint8Array, input: Uint8Array): Uint8Array | null {
  if (input.length % 8 !== 0 || input.length < 16) return null;
  const n = input.length / 8;
  const output = new Uint8Array(input.length + 8);
  let a = new Uint8Array(16);
  a.set(iv, 0);
  const r = output.subarray(8);
  r.set(input);
  let t = 1;
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < n; i++) {
      const b = new Uint8Array(16);
      b.set(a.subarray(0, 8), 0);
      b.set(r.subarray(i * 8, i * 8 + 8), 8);
      block(b);
      a = b.subarray(0, 8);
      a[7] ^= t & 0xff;
      if (t > 0xff) {
        a[6] ^= (t >> 8) & 0xff;
        a[5] ^= (t >> 16) & 0xff;
        a[4] ^= (t >> 24) & 0xff;
      }
      r.set(b.subarray(8, 16), i * 8);
      t++;
    }
  }
  output.set(a.subarray(0, 8), 0);
  return output;
}

/** RFC 3394 §2.2.2 raw unwrap, returning `[iv, plaintext]` or null. */
function unwrapRaw(block: BlockFn, input: Uint8Array): [Uint8Array, Uint8Array] | null {
  const inlen = input.length - 8;
  if (inlen % 8 !== 0 || inlen < 16) return null;
  const n = inlen / 8;
  const output = new Uint8Array(inlen);
  // `Buffer.prototype.slice` shares memory in this runtime: copy explicitly.
  let a = new Uint8Array(input.subarray(0, 8));
  output.set(input.subarray(8));
  let t = 6 * n;
  for (let j = 0; j < 6; j++) {
    for (let i = n - 1; i >= 0; i--) {
      a = new Uint8Array(a);
      a[7] ^= t & 0xff;
      if (t > 0xff) {
        a[6] ^= (t >> 8) & 0xff;
        a[5] ^= (t >> 16) & 0xff;
        a[4] ^= (t >> 24) & 0xff;
      }
      const b = new Uint8Array(16);
      b.set(a, 0);
      b.set(output.subarray(i * 8, i * 8 + 8), 8);
      block(b);
      a = b.subarray(0, 8);
      output.set(b.subarray(8, 16), i * 8);
      t--;
    }
  }
  return [new Uint8Array(a), output];
}

function unwrap(block: BlockFn, iv: Uint8Array, input: Uint8Array): Uint8Array | null {
  const raw = unwrapRaw(block, input);
  if (raw === null) return null;
  const [gotIv, plaintext] = raw;
  for (let i = 0; i < 8; i++) {
    if (gotIv[i] !== iv[i]) return null;
  }
  return plaintext;
}

/** RFC 5649 §4.1 wrap-with-padding. */
function wrapPad(block: BlockFn, icv: Uint8Array, input: Uint8Array): Uint8Array | null {
  if (input.length === 0) return null;
  const paddedLength = (((input.length + 7) >> 3) << 3);
  const padding = paddedLength - input.length;
  const aiv = new Uint8Array(8);
  aiv.set(icv.subarray(0, 4), 0);
  aiv[4] = (input.length >>> 24) & 0xff;
  aiv[5] = (input.length >>> 16) & 0xff;
  aiv[6] = (input.length >>> 8) & 0xff;
  aiv[7] = input.length & 0xff;

  if (paddedLength === 8) {
    const out = new Uint8Array(16);
    out.set(aiv, 0);
    out.set(input, 8);
    block(out);
    return out;
  }
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  return wrap(block, aiv, padded);
}

/** RFC 5649 §4.2 unwrap-with-padding. */
function unwrapPad(block: BlockFn, icv: Uint8Array, input: Uint8Array): Uint8Array | null {
  if (input.length % 8 !== 0 || input.length < 16) return null;
  let aiv: Uint8Array;
  let padded: Uint8Array;
  if (input.length === 16) {
    const buff = new Uint8Array(input);
    block(buff);
    aiv = buff.subarray(0, 8);
    padded = buff.subarray(8);
  } else {
    const raw = unwrapRaw(block, input);
    if (raw === null) return null;
    aiv = raw[0];
    padded = raw[1];
  }
  if (aiv[0] !== icv[0] || aiv[1] !== icv[1] || aiv[2] !== icv[2] || aiv[3] !== icv[3]) return null;
  const length = ((aiv[4] << 24) | (aiv[5] << 16) | (aiv[6] << 8) | aiv[7]) >>> 0;
  const blocks = padded.length / 8;
  if (8 * (blocks - 1) >= length || length > 8 * blocks) return null;
  for (let i = length; i < padded.length; i++) {
    if (padded[i] !== 0) return null;
  }
  return new Uint8Array(padded.subarray(0, length));
}

export type WrapMode = 'wrap' | 'wrap-pad';

export class AesWrap {
  #key: AesKey;
  #iv: Uint8Array;
  #mode: WrapMode;
  #encrypt: boolean;
  /**
   * SP 800-38F designates the AES *inverse* cipher (AES decryption) as the
   * block function for the `*-wrap-inv` names: wrapping then uses
   * `decryptBlock` and unwrapping uses `encryptBlock`.
   */
  #inverse: boolean;
  #done = false;
  #output: Uint8Array | null = null;

  constructor(key: Uint8Array, iv: Uint8Array, encrypt: boolean, mode: WrapMode, inverse = false) {
    this.#key = new AesKey(key);
    this.#iv = new Uint8Array(iv);
    this.#mode = mode;
    this.#encrypt = encrypt;
    this.#inverse = inverse;
  }

  /** The direction of the AES block function for the current operation. */
  get #forward(): boolean {
    return this.#inverse ? !this.#encrypt : this.#encrypt;
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#done) throw unsupported();
    this.#done = true;
    // OpenSSL sets one designated block function for the instance from `enc`
    // and the inverse flag, then uses it for its single wrap/unwrap operation.
    const block: BlockFn = this.#forward
      ? (b) => this.#key.encryptBlock(b)
      : (b) => this.#key.decryptBlock(b);
    const result =
      this.#mode === 'wrap'
        ? this.#encrypt
          ? wrap(block, this.#iv, input)
          : unwrap(block, this.#iv, input)
        : this.#encrypt
          ? wrapPad(block, this.#iv, input)
          : unwrapPad(block, this.#iv, input);
    if (result === null) throw unsupported();
    this.#output = result;
    return result;
  }

  final(): Uint8Array {
    // A one-shot cipher that never ran `update` reports a plain state error.
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
