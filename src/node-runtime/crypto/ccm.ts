// AES-CCM (SP 800-38C) — pure JS, over the shared AES block cipher.
//
// CCM is a two-pass AEAD: the CBC-MAC covers B0 and the (padded) AAD, while the
// payload is encrypted in counter mode. OpenSSL lets the message length be
// declared up front and then requires the whole payload in a single `update`,
// which is the behaviour mirrored here.
import { AesKey } from './aes';

function codedError(name: 'Error' | 'TypeError', code: string, message: string): Error {
  const error = new (name === 'TypeError' ? TypeError : Error)(message);
  (error as { code?: string }).code = code;
  return error;
}

/** Big-endian `q`-byte encoding of `value` (CCM uses this for lengths). */
function writeBE(target: Uint8Array, offset: number, value: number, length: number): void {
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    target[offset + i] = v & 0xff;
    v = Math.floor(v / 256);
  }
}

/** The AAD length prefix of SP 800-38C §A.2.2. */
function encodeAadLength(length: number): Uint8Array {
  if (length < 0xff00) {
    const out = new Uint8Array(2);
    writeBE(out, 0, length, 2);
    return out;
  }
  if (length <= 0xffffffff) {
    const out = new Uint8Array(6);
    out[0] = 0xff;
    out[1] = 0xfe;
    writeBE(out, 2, length, 4);
    return out;
  }
  const out = new Uint8Array(10);
  out[0] = 0xff;
  out[1] = 0xff;
  writeBE(out, 2, length, 8);
  return out;
}

/** The B0 block: flags, nonce, and the declared message length. */
function buildB0(nonce: Uint8Array, messageLength: number, tagLength: number, hasAad: boolean): Uint8Array {
  const q = 15 - nonce.length;
  const b0 = new Uint8Array(16);
  b0[0] = (hasAad ? 0x40 : 0) | (((tagLength - 2) / 2) << 3) | (q - 1);
  b0.set(nonce, 1);
  writeBE(b0, 16 - q, messageLength, q);
  return b0;
}

/** The `S_0` block: the counter-mode block with counter 0, used to mask the MAC. */
function buildCounter0(nonce: Uint8Array): Uint8Array {
  const q = 15 - nonce.length;
  const a0 = new Uint8Array(16);
  a0[0] = q - 1;
  a0.set(nonce, 1);
  return a0;
}

function xorBlock(a: Uint8Array, b: Uint8Array): void {
  for (let i = 0; i < 16; i++) a[i] ^= b[i];
}

/** CBC-MAC over the formatted input (B0, AAD blocks, payload blocks). */
function computeMac(aes: AesKey, blocks: Uint8Array[]): Uint8Array {
  const state = new Uint8Array(16);
  for (const block of blocks) {
    xorBlock(state, block);
    aes.encryptBlock(state);
  }
  return state;
}

/** Splits `data` into zero-padded 16-byte blocks. */
function paddedBlocks(data: Uint8Array): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = new Uint8Array(16);
    block.set(data.subarray(offset, Math.min(offset + 16, data.length)));
    blocks.push(block);
  }
  return blocks;
}

export interface CcmOptions {
  plaintextLength?: number;
}

export class AesCcm {
  #aes: AesKey;
  #nonce: Uint8Array;
  #tagLength: number;
  #encrypt: boolean;
  #aad: Uint8Array = new Uint8Array(0);
  #plaintextLength: number | undefined;
  #done = false;
  #finalized = false;
  #authTag: Uint8Array | null = null;
  #expectedTag: Uint8Array | null = null;
  #computedTag: Uint8Array | null = null;

  constructor(key: Uint8Array, iv: Uint8Array, encrypt: boolean, tagLength: number, plaintextLength?: number) {
    this.#aes = new AesKey(key);
    this.#nonce = iv.slice();
    this.#tagLength = tagLength;
    this.#encrypt = encrypt;
    this.#plaintextLength = plaintextLength;
  }

  /** The plaintext length this cipher was told to expect, if any. */
  get declaredLength(): number | undefined {
    return this.#plaintextLength;
  }

  #blocksFor(payload: Uint8Array): Uint8Array[] {
    const hasAad = this.#aad.length > 0;
    const blocks: Uint8Array[] = [buildB0(this.#nonce, payload.length, this.#tagLength, hasAad)];
    if (hasAad) {
      const prefix = encodeAadLength(this.#aad.length);
      const buffer = new Uint8Array(prefix.length + this.#aad.length);
      buffer.set(prefix, 0);
      buffer.set(this.#aad, prefix.length);
      blocks.push(...paddedBlocks(buffer));
    }
    blocks.push(...paddedBlocks(payload));
    return blocks;
  }

  #tagFor(payload: Uint8Array): Uint8Array {
    const mac = computeMac(this.#aes, this.#blocksFor(payload));
    const s0 = buildCounter0(this.#nonce);
    this.#aes.encryptBlock(s0);
    xorBlock(mac, s0);
    return mac.subarray(0, this.#tagLength).slice();
  }

  /** Counter-mode keystream starting at `A_1`. */
  #crypt(payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(payload.length);
    const q = 15 - this.#nonce.length;
    const counter = buildCounter0(this.#nonce);
    for (let offset = 0; offset < payload.length; offset += 16) {
      counter[0] = q - 1; // counter blocks reuse the nonce with a fresh counter
      writeBE(counter, 16 - q, offset / 16 + 1, q);
      const keystream = counter.slice();
      this.#aes.encryptBlock(keystream);
      const end = Math.min(offset + 16, payload.length);
      for (let i = offset; i < end; i++) out[i] = payload[i] ^ keystream[i - offset];
    }
    return out;
  }

  setAAD(aad: Uint8Array, options?: CcmOptions): void {
    if (this.#done || this.#aad.length > 0) {
      throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation setAAD');
    }
    if (options === undefined || options.plaintextLength === undefined) {
      throw codedError('TypeError', 'ERR_MISSING_ARGS', 'options.plaintextLength required for CCM mode with AAD');
    }
    this.#plaintextLength = options.plaintextLength;
    this.#aad = aad;
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#finalized || this.#done) throw new Error('Trying to add data in unsupported state');
    if (this.#plaintextLength !== undefined && input.length !== this.#plaintextLength) {
      throw new Error('Trying to add data in unsupported state');
    }
    this.#done = true;
    // The MAC always covers the *plaintext*; on the decrypt side that means
    // recovering it first.
    const payload = this.#encrypt ? input : this.#crypt(input);
    this.#computedTag = this.#tagFor(payload);
    if (this.#encrypt) return this.#crypt(input);
    return payload;
  }

  final(): Uint8Array {
    this.#finalized = true;
    if (this.#encrypt) {
      this.#authTag = this.#computedTag;
      return new Uint8Array(0);
    }
    if (this.#expectedTag === null || this.#computedTag === null) {
      throw new Error('Unsupported state or unable to authenticate data');
    }
    let diff = 0;
    for (let i = 0; i < this.#expectedTag.length; i++) diff |= this.#computedTag[i] ^ this.#expectedTag[i];
    if (diff !== 0) throw new Error('Unsupported state or unable to authenticate data');
    return new Uint8Array(0);
  }

  setAutoPadding(): void {
    // CCM has no padding; Node accepts and ignores the call.
  }

  getAuthTag(): Uint8Array {
    if (this.#authTag === null) {
      throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation getAuthTag');
    }
    return this.#authTag;
  }

  setAuthTag(tag: Uint8Array): void {
    if (this.#encrypt) {
      throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation setAuthTag');
    }
    if (tag.length !== this.#tagLength) {
      throw codedError('TypeError', 'ERR_CRYPTO_INVALID_AUTH_TAG', `Invalid authentication tag length: ${tag.length}`);
    }
    this.#expectedTag = tag.slice();
  }
}
