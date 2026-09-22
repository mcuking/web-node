/**
 * AES-OCB (RFC 7253) — a pure JS implementation matching OpenSSL's `ocb128.c`
 * byte for byte, including its nonce construction (the tag length is mixed into
 * the top of the nonce block) and its trailing-partial-block buffering, so that
 * the per-`update` output boundaries line up with Node's.
 */
import { AesKey } from './aes';

function xorInto(target: Uint8Array, source: Uint8Array, length = 16): void {
  for (let i = 0; i < length; i++) target[i] ^= source[i];
}

/** `L_i = double(L_{i-1})` — shift left one bit, reducing with 0x87. */
function double(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  const reduce = (input[0] & 0x80) !== 0 ? 0x87 : 0;
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    const value = input[i];
    out[i] = ((value << 1) | carry) & 0xff;
    carry = value >> 7;
  }
  out[15] ^= reduce;
  return out;
}

function ntz(n: number): number {
  let count = 0;
  let value = n;
  while ((value & 1) === 0) {
    value >>= 1;
    count++;
  }
  return count;
}

export class AesOcb {
  #aes: AesKey;
  #encrypt: boolean;
  #tagLength: number;
  #iv: Uint8Array;
  #lStar: Uint8Array;
  #lDollar: Uint8Array;
  #l: Uint8Array[] = [];
  #offset: Uint8Array = new Uint8Array(16);
  #offsetAad: Uint8Array = new Uint8Array(16);
  #checksum: Uint8Array = new Uint8Array(16);
  #sum: Uint8Array = new Uint8Array(16);
  #dataBuf: Uint8Array = new Uint8Array(0);
  #aadBuf: Uint8Array = new Uint8Array(0);
  #blocksProcessed = 0;
  #blocksHashed = 0;
  #indexSet = false;
  #finished = false;
  #authTag: Uint8Array | null = null;
  #expectedTag: Uint8Array | null = null;

  constructor(key: Uint8Array, iv: Uint8Array, encrypt: boolean, tagLength: number) {
    this.#aes = new AesKey(key);
    this.#iv = iv.slice();
    this.#encrypt = encrypt;
    this.#tagLength = tagLength;
    this.#lStar = new Uint8Array(16);
    this.#aes.encryptBlock(this.#lStar);
    this.#lDollar = double(this.#lStar);
    this.#l = [double(this.#lDollar)];
    this.#setIv();
  }

  /** `CRYPTO_ocb128_setiv`: the tag length and IV packed into the nonce block. */
  #setIv(): void {
    const ivLength = this.#iv.length;
    const nonce = new Uint8Array(16);
    nonce[0] = ((this.#tagLength * 8) % 128) << 1;
    nonce.set(this.#iv, 16 - ivLength);
    nonce[15 - ivLength] |= 1;

    const ktop = new Uint8Array(16);
    ktop.set(nonce);
    ktop[15] &= 0xc0;
    this.#aes.encryptBlock(ktop);

    const stretch = new Uint8Array(24);
    stretch.set(ktop, 0);
    for (let i = 0; i < 8; i++) stretch[16 + i] = ktop[i] ^ ktop[i + 1];

    const bottom = nonce[15] & 0x3f;
    const byteOffset = bottom >> 3;
    const shift = bottom % 8;
    const offset = new Uint8Array(16);
    let carry = 0;
    for (let i = 15; i >= 0; i--) {
      const value = stretch[byteOffset + i];
      offset[i] = ((value << shift) | carry) & 0xff;
      carry = shift === 0 ? 0 : value >> (8 - shift);
    }
    if (shift !== 0) {
      const mask = (0xff << (8 - shift)) & 0xff;
      offset[15] |= ((stretch[byteOffset + 16] & mask) >> (8 - shift)) & 0xff;
    }
    this.#offset = offset;
    this.#indexSet = true;
  }

  #lookupL(index: number): Uint8Array {
    while (this.#l.length <= index) {
      this.#l.push(double(this.#l[this.#l.length - 1]));
    }
    return this.#l[index];
  }

  #processAad(): void {
    const lastLength = this.#aadBuf.length % 16;
    const full = this.#aadBuf.length - lastLength;
    const buffer = this.#aadBuf;
    for (let block = 0; block * 16 < full; block++) {
      const i = block + 1;
      xorInto(this.#offsetAad, this.#lookupL(ntz(i)));
      const tmp = new Uint8Array(16);
      tmp.set(buffer.subarray(block * 16, block * 16 + 16));
      xorInto(tmp, this.#offsetAad);
      this.#aes.encryptBlock(tmp);
      xorInto(this.#sum, tmp);
    }
    if (lastLength > 0) {
      xorInto(this.#offsetAad, this.#lStar);
      const tmp = new Uint8Array(16);
      tmp.set(buffer.subarray(full, full + lastLength));
      tmp[lastLength] = 0x80;
      xorInto(tmp, this.#offsetAad);
      this.#aes.encryptBlock(tmp);
      xorInto(this.#sum, tmp);
    }
    this.#blocksHashed += full / 16;
  }

  #cryptBlocks(input: Uint8Array): Uint8Array {
    const output = new Uint8Array(input.length);
    const full = input.length & ~15;
    for (let block = 0; block * 16 < full; block++) {
      const i = this.#blocksProcessed + block + 1;
      xorInto(this.#offset, this.#lookupL(ntz(i)));
      const tmp = new Uint8Array(16);
      tmp.set(input.subarray(block * 16, block * 16 + 16));
      if (this.#encrypt) {
        xorInto(this.#checksum, tmp);
        xorInto(tmp, this.#offset);
        this.#aes.encryptBlock(tmp);
        xorInto(tmp, this.#offset);
        output.set(tmp, block * 16);
      } else {
        xorInto(tmp, this.#offset);
        this.#aes.decryptBlock(tmp);
        xorInto(tmp, this.#offset);
        xorInto(this.#checksum, tmp);
        output.set(tmp, block * 16);
      }
    }
    this.#blocksProcessed += full / 16;

    const lastLength = input.length - full;
    if (lastLength > 0) {
      xorInto(this.#offset, this.#lStar);
      const pad = new Uint8Array(16);
      pad.set(this.#offset);
      this.#aes.encryptBlock(pad);
      if (this.#encrypt) {
        for (let i = 0; i < lastLength; i++) output[full + i] = input[full + i] ^ pad[i];
        const partial = new Uint8Array(16);
        partial.set(input.subarray(full, full + lastLength));
        partial[lastLength] = 0x80;
        xorInto(this.#checksum, partial);
      } else {
        for (let i = 0; i < lastLength; i++) output[full + i] = input[full + i] ^ pad[i];
        const partial = new Uint8Array(16);
        partial.set(output.subarray(full, full + lastLength));
        partial[lastLength] = 0x80;
        xorInto(this.#checksum, partial);
      }
    }
    return output;
  }

  /** Buffers a chunk, emitting only the full blocks (as the OpenSSL provider does). */
  #feed(chunk: Uint8Array, kind: 'data' | 'aad'): Uint8Array {
    const previous = kind === 'data' ? this.#dataBuf : this.#aadBuf;
    const combined = new Uint8Array(previous.length + chunk.length);
    combined.set(previous, 0);
    combined.set(chunk, previous.length);

    const lastLength = combined.length % 16;
    const fullLength = combined.length - lastLength;
    if (kind === 'data') {
      // Process complete blocks; keep the trailing partial block for final().
      this.#dataBuf = combined.slice(fullLength);
      if (fullLength === 0) return new Uint8Array(0);
      const output = this.#cryptBlocks(combined.subarray(0, fullLength));
      return output;
    }
    // AAD is accumulated and only folded into the tag at final().
    this.#aadBuf = combined;
    return new Uint8Array(0);
  }

  setAAD(aad: Uint8Array): void {
    // A zero-byte tag length is accepted at construction but leaves the context
    // unusable, exactly as OpenSSL's OCB does.
    if (this.#tagLength < 1) throw invalidState('setAAD');
    if (this.#finished || this.#blocksProcessed > 0 || this.#dataBuf.length > 0) {
      throw invalidState('setAAD');
    }
    this.#feed(aad, 'aad');
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#finished) throw invalidState('update');
    return this.#feed(input, 'data');
  }

  final(): Uint8Array {
    this.#finished = true;
    if (this.#dataBuf.length > 0) {
      const output = this.#cryptBlocks(this.#dataBuf);
      this.#dataBuf = new Uint8Array(0);
      if (this.#encrypt) {
        this.#authTag = this.#finishTag();
      } else {
        this.#verifyTag();
      }
      return output;
    }
    if (this.#encrypt) {
      this.#authTag = this.#finishTag();
    } else {
      this.#verifyTag();
    }
    return new Uint8Array(0);
  }

  #finishTag(): Uint8Array {
    if (this.#aadBuf.length > 0) this.#processAad();
    const tmp = new Uint8Array(16);
    tmp.set(this.#checksum);
    xorInto(tmp, this.#offset);
    xorInto(tmp, this.#lDollar);
    this.#aes.encryptBlock(tmp);
    xorInto(tmp, this.#sum);
    return tmp.subarray(0, this.#tagLength).slice();
  }

  #verifyTag(): void {
    if (this.#aadBuf.length > 0) this.#processAad();
    const tmp = new Uint8Array(16);
    tmp.set(this.#checksum);
    xorInto(tmp, this.#offset);
    xorInto(tmp, this.#lDollar);
    this.#aes.encryptBlock(tmp);
    xorInto(tmp, this.#sum);
    if (this.#expectedTag === null) {
      throw new Error('Unsupported state or unable to authenticate data');
    }
    let diff = 0;
    for (let i = 0; i < this.#tagLength; i++) diff |= tmp[i] ^ this.#expectedTag[i];
    if (diff !== 0) throw new Error('Unsupported state or unable to authenticate data');
  }

  setAutoPadding(): void {
    // OCB has no padding; Node accepts and ignores the call.
  }

  getAuthTag(): Uint8Array {
    if (this.#authTag === null) throw invalidState('getAuthTag');
    return this.#authTag;
  }

  setAuthTag(tag: Uint8Array): void {
    if (this.#encrypt) throw invalidState('setAuthTag');
    if (tag.length !== this.#tagLength) {
      const error = new TypeError(`Invalid authentication tag length: ${tag.length}`);
      (error as { code?: string }).code = 'ERR_CRYPTO_INVALID_AUTH_TAG';
      throw error;
    }
    this.#expectedTag = tag.slice();
  }
}

function invalidState(operation: string): Error {
  const error = new Error(`Invalid state for operation ${operation}`);
  (error as { code?: string }).code = 'ERR_CRYPTO_INVALID_STATE';
  return error;
}
