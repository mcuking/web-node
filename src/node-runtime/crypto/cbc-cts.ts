/**
 * CBC with ciphertext stealing (CTS), matching OpenSSL's *NIST* CTS variant
 * (`CRYPTO_nistcts128_encrypt` / `_decrypt` in `crypto/modes/cts128.c`).
 *
 * NIST CTS differs from the RFC 2040/3962 flavour in two ways: it accepts an
 * input that is an exact multiple of the block size, and it does **not** swap
 * the order of the last two blocks. The final (short) plaintext fragment is
 * encrypted against the previous ciphertext block and the resulting block is
 * written starting `residue` bytes into the previous block — that overlapped
 * write *is* the theft.
 *
 * OpenSSL treats this mode as one-shot: a single `update` (of at least one
 * block) consumes the whole message and emits the result; a second `update`
 * fails, and `final` just closes the operation. Inputs shorter than a block,
 * or a `final` before any `update`, raise "unsupported state".
 */
import type { SyncCipher } from './chacha20';

/** Minimal block-cipher surface CBC-CTS needs (AES, Camellia, ...). */
export interface CtsBlockCipher {
  encryptBlock(block: Uint8Array): void;
  decryptBlock(block: Uint8Array): void;
}

function unsupported(): Error {
  return new Error('Trying to add data in unsupported state');
}

function invalidState(message: string): Error {
  const error = new Error(message);
  (error as { code?: string }).code = 'ERR_CRYPTO_INVALID_STATE';
  return error;
}

export class CbcCts implements SyncCipher {
  #block: CtsBlockCipher;
  #iv: Uint8Array;
  #encrypt: boolean;
  #updated = false;
  #finalized = false;

  constructor(block: CtsBlockCipher, iv: Uint8Array, encrypt: boolean) {
    this.#block = block;
    this.#iv = new Uint8Array(iv);
    this.#encrypt = encrypt;
  }

  setAutoPadding(): void {
    // CTS is length-preserving; there is no padding to toggle.
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#updated || this.#finalized) throw unsupported();
    if (input.length < 16) throw unsupported();
    this.#updated = true;
    const data = new Uint8Array(input);
    const result = this.#encrypt ? this.#encryptCts(data) : this.#decryptCts(data);
    if (result === null) throw unsupported();
    return result;
  }

  final(): Uint8Array {
    if (!this.#updated) throw new Error('Unsupported state');
    if (this.#finalized) throw invalidState('Invalid state');
    this.#finalized = true;
    return new Uint8Array(0);
  }

  #encryptCts(data: Uint8Array): Uint8Array | null {
    const len = data.length;
    const residue = len % 16;
    const fullLen = len - residue;
    const out = new Uint8Array(len);
    const iv = this.#iv;
    for (let offset = 0; offset < fullLen; offset += 16) {
      const block = data.subarray(offset, offset + 16);
      for (let i = 0; i < 16; i++) out[offset + i] = block[i] ^ iv[i];
      const enc = out.subarray(offset, offset + 16);
      this.#block.encryptBlock(enc);
      iv.set(enc);
    }
    if (residue === 0) return out;
    // Steal: XOR the short fragment onto the last ciphertext block's copy and
    // write the result `residue` bytes into it.
    const tail = new Uint8Array(16);
    tail.set(iv); // iv == last ciphertext block
    for (let i = 0; i < residue; i++) tail[i] ^= data[fullLen + i];
    this.#block.encryptBlock(tail);
    out.set(tail, fullLen - 16 + residue);
    return out;
  }

  #decryptCts(data: Uint8Array): Uint8Array | null {
    const len = data.length;
    const residue = len % 16;
    const out = new Uint8Array(len);
    const iv = this.#iv;
    if (residue === 0) {
      for (let offset = 0; offset < len; offset += 16) {
        const ct = data.subarray(offset, offset + 16);
        const dec = new Uint8Array(ct);
        this.#block.decryptBlock(dec);
        for (let i = 0; i < 16; i++) out[offset + i] = dec[i] ^ iv[i];
        iv.set(ct);
      }
      return out;
    }
    const fullLen = len - 16 - residue; // bytes handled by plain CBC
    for (let offset = 0; offset < fullLen; offset += 16) {
      const ct = data.subarray(offset, offset + 16);
      const dec = new Uint8Array(ct);
      this.#block.decryptBlock(dec);
      for (let i = 0; i < 16; i++) out[offset + i] = dec[i] ^ iv[i];
      iv.set(ct);
    }
    const base = fullLen;
    // C(n) is the final block, `residue` bytes past the start of the overlap.
    const decLast = new Uint8Array(data.subarray(base + residue, base + residue + 16));
    this.#block.decryptBlock(decLast);
    // Rebuild C(n-1) = partial || D(C(n))[residue..16] and decrypt it against
    // the running IV; the stolen fragment falls out of D(C(n)) XOR C(n-1)*.
    const tmp = new Uint8Array(16);
    tmp.set(decLast);
    tmp.set(data.subarray(base, base + residue), 0);
    this.#block.decryptBlock(tmp);
    const ct = new Uint8Array(data.subarray(base, base + 16));
    for (let n = 0; n < 16; n++) {
      out[base + n] = tmp[n] ^ iv[n];
      iv[n] = data[base + n + residue];
    }
    for (let n = 16; n < 16 + residue; n++) {
      out[base + n] = decLast[n - 16] ^ ct[n - 16];
    }
    return out;
  }

  setAAD(): never {
    throw unsupported();
  }

  getAuthTag(): never {
    throw invalidState('Invalid state for operation getAuthTag');
  }

  setAuthTag(): never {
    throw unsupported();
  }
}
