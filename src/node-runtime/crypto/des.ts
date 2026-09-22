// DES, two-key 3DES (`des-ede`) and three-key 3DES (`des-ede3`) — pure JS.
//
// OpenSSL 3 moved single DES into the legacy provider, so only the EDE forms are
// reachable: `des-ede` (16-byte key, K3 = K1) and `des-ede3` (24-byte key).
// Everything here works on 64-bit blocks and feeds the shared `SyncCipher`
// interface the cipher builtin drives.
import type { SyncCipher } from './chacha20';

// --- permutation tables (FIPS 46-3) -----------------------------------------
const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64,
  56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53,
  45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];
const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37,
  5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2,
  42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];
const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18,
  19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];
const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13,
  30, 6, 22, 11, 4, 25,
];
const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60,
  52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
  13, 5, 28, 20, 12, 4,
];
const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52,
  31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const SBOXES = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11,
    9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5,
    11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10,
    6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2,
    11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12,
    11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4,
    15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1,
    10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9,
    4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10,
    3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13,
    6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14,
    0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10,
    11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12,
    2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7,
    9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11,
    0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13,
    15, 12, 9, 0, 3, 5, 6, 11],
];

/** A 48-bit subkey, split across two 24-bit halves so it fits in safe ints. */
interface Subkey {
  hi: number;
  lo: number;
}

function permute(input: number[], table: number[]): number[] {
  const out = new Array<number>(table.length);
  for (let i = 0; i < table.length; i++) out[i] = input[table[i] - 1];
  return out;
}

function bytesToBits(bytes: Uint8Array, offset = 0, count = 8): number[] {
  const bits = new Array<number>(count * 8);
  for (let i = 0; i < count; i++) {
    const byte = bytes[offset + i];
    for (let j = 0; j < 8; j++) bits[i * 8 + j] = (byte >> (7 - j)) & 1;
  }
  return bits;
}

function bitsToBytes(bits: number[]): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
    out[i] = byte;
  }
  return out;
}

/** The 16 subkeys for one 64-bit DES key (parity bits are ignored by PC1). */
function keySchedule(key: Uint8Array, offset: number): Subkey[] {
  const keyBits = bytesToBits(key, offset);
  const permuted = permute(keyBits, PC1); // 56 bits: C(28) || D(28)
  let c = permuted.slice(0, 28);
  let d = permuted.slice(28);
  const subkeys: Subkey[] = [];
  for (let round = 0; round < 16; round++) {
    const shift = SHIFTS[round];
    c = c.slice(shift).concat(c.slice(0, shift));
    d = d.slice(shift).concat(d.slice(0, shift));
    const cd = c.concat(d);
    const bits = permute(cd, PC2); // 48 bits
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < 24; i++) hi = (hi << 1) | bits[i];
    for (let i = 24; i < 48; i++) lo = (lo << 1) | bits[i];
    subkeys.push({ hi, lo });
  }
  return subkeys;
}

/** The Feistel function `f(R, K)`. */
function feistel(right: number[], subkey: Subkey): number[] {
  const expanded = permute(right, E); // 48 bits
  const mixed = new Array<number>(48);
  for (let i = 0; i < 24; i++) mixed[i] = expanded[i] ^ ((subkey.hi >> (23 - i)) & 1);
  for (let i = 0; i < 24; i++) mixed[24 + i] = expanded[24 + i] ^ ((subkey.lo >> (23 - i)) & 1);
  const sboxOut = new Array<number>(32);
  for (let box = 0; box < 8; box++) {
    const chunk = mixed.slice(box * 6, box * 6 + 6);
    const row = (chunk[0] << 1) | chunk[5];
    const col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4];
    const value = SBOXES[box][row * 16 + col];
    for (let bit = 0; bit < 4; bit++) sboxOut[box * 4 + bit] = (value >> (3 - bit)) & 1;
  }
  return permute(sboxOut, P);
}

function desBlock(subkeys: Subkey[], block: Uint8Array, encrypt: boolean): Uint8Array {
  const bits = permute(bytesToBits(block), IP);
  let left = bits.slice(0, 32);
  let right = bits.slice(32);
  for (let round = 0; round < 16; round++) {
    const subkey = encrypt ? subkeys[round] : subkeys[15 - round];
    const f = feistel(right, subkey);
    const next = new Array<number>(32);
    for (let i = 0; i < 32; i++) next[i] = left[i] ^ f[i];
    left = right;
    right = next;
  }
  // The final swap is folded into the output permutation.
  return bitsToBytes(permute(right.concat(left), FP));
}

/** One DES key, able to encrypt or decrypt a single 8-byte block. */
class DesKey {
  #subkeys: Subkey[];

  constructor(key: Uint8Array, offset: number) {
    this.#subkeys = keySchedule(key, offset);
  }

  encrypt(block: Uint8Array): Uint8Array {
    return desBlock(this.#subkeys, block, true);
  }

  decrypt(block: Uint8Array): Uint8Array {
    return desBlock(this.#subkeys, block, false);
  }
}

/** EDE3 with a 24-byte key; EDE2 reuses K1 as K3 (16-byte key). */
export class DesEde {
  #k1: DesKey;
  #k2: DesKey;
  #k3: DesKey;

  constructor(key: Uint8Array) {
    const twoKey = key.length === 16;
    this.#k1 = new DesKey(key, 0);
    this.#k2 = new DesKey(key, 8);
    this.#k3 = twoKey ? this.#k1 : new DesKey(key, 16);
  }

  encrypt(block: Uint8Array): Uint8Array {
    return this.#k3.encrypt(this.#k2.decrypt(this.#k1.encrypt(block)));
  }

  decrypt(block: Uint8Array): Uint8Array {
    return this.#k1.decrypt(this.#k2.encrypt(this.#k3.decrypt(block)));
  }
}

/** The mode a DES spec uses. */
export type DesMode = 'ecb' | 'cbc' | 'cfb' | 'ofb';

function codedError(name: 'Error' | 'TypeError', code: string, message: string): Error {
  const error = new (name === 'TypeError' ? TypeError : Error)(message);
  (error as { code?: string }).code = code;
  return error;
}

/**
 * A synchronous DES/3DES cipher over an 8-byte block, mirroring the `Cipheriv`
 * surface the builtin drives.
 */
export class DesCipher implements SyncCipher {
  #ede: DesEde;
  #mode: DesMode;
  #encrypt: boolean;
  #autoPadding = true;
  #finalized = false;
  #buffer = new Uint8Array(0);
  #chain: Uint8Array = new Uint8Array(8); // CBC chaining value / CFB register
  #keystream: Uint8Array = new Uint8Array(8); // OFB register
  #keystreamPos = 8;
  #cfbRegister: Uint8Array = new Uint8Array(8);
  #cfbBlock = new Uint8Array(8);
  #cfbPos = 0;

  constructor(mode: DesMode, key: Uint8Array, iv: Uint8Array | null, encrypt: boolean) {
    this.#ede = new DesEde(key);
    this.#mode = mode;
    this.#encrypt = encrypt;
    if (iv) this.#chain.set(iv);
  }

  /** Encrypt or decrypt one whole 8-byte block in place (ECB/CBC). */
  #cryptBlock(block: Uint8Array): Uint8Array {
    return this.#encrypt ? this.#ede.encrypt(block) : this.#ede.decrypt(block);
  }

  #processBlocks(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    for (let offset = 0; offset < input.length; offset += 8) {
      const block = input.subarray(offset, offset + 8);
      if (this.#mode === 'cbc' && this.#encrypt) {
        const mixed = new Uint8Array(8);
        for (let i = 0; i < 8; i++) mixed[i] = block[i] ^ this.#chain[i];
        const encrypted = this.#ede.encrypt(mixed);
        this.#chain.set(encrypted);
        out.set(encrypted, offset);
      } else if (this.#mode === 'cbc') {
        const decrypted = this.#ede.decrypt(block);
        for (let i = 0; i < 8; i++) decrypted[i] ^= this.#chain[i];
        this.#chain.set(block);
        out.set(decrypted, offset);
      } else {
        out.set(this.#cryptBlock(block.slice()), offset);
      }
    }
    return out;
  }

  /** Byte-wise CFB-128 / OFB (block size reported as 1 by OpenSSL). */
  #processStream(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      if (this.#mode === 'ofb') {
        if (this.#keystreamPos === 8) {
          this.#keystream = this.#ede.encrypt(this.#keystream);
          this.#keystreamPos = 0;
        }
        out[i] = input[i] ^ this.#keystream[this.#keystreamPos++];
      } else {
        // CFB-128: the register advances a whole block at a time.
        if (this.#cfbPos === 0) this.#cfbRegister = this.#ede.encrypt(this.#cfbRegister);
        const byte = input[i] ^ this.#cfbRegister[this.#cfbPos];
        out[i] = byte;
        this.#cfbBlock[this.#cfbPos] = this.#encrypt ? byte : input[i];
        this.#cfbPos++;
        if (this.#cfbPos === 8) {
          this.#cfbRegister = this.#cfbBlock.slice();
          this.#cfbPos = 0;
        }
      }
    }
    return out;
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#finalized) throw new Error('Trying to add data in unsupported state');
    if (this.#mode === 'cfb' || this.#mode === 'ofb') return this.#processStream(input);
    const combined = new Uint8Array(this.#buffer.length + input.length);
    combined.set(this.#buffer, 0);
    combined.set(input, this.#buffer.length);
    const whole = combined.length - (combined.length % 8);
    const processable = this.#encrypt ? whole : Math.max(0, whole - 8);
    const out = this.#processBlocks(combined.subarray(0, processable));
    this.#buffer = combined.subarray(processable).slice();
    return out;
  }

  final(): Uint8Array {
    if (this.#finalized) throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state');
    this.#finalized = true;
    if (this.#mode === 'cfb' || this.#mode === 'ofb') return new Uint8Array(0);
    return this.#encrypt ? this.#finalBlockEncrypt() : this.#finalBlockDecrypt();
  }

  #finalBlockEncrypt(): Uint8Array {
    if (this.#buffer.length === 0 && !this.#autoPadding) return new Uint8Array(0);
    if (!this.#autoPadding && this.#buffer.length % 8 !== 0) {
      throw codedError('Error', 'ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH', 'error:1C80006B:Provider routines::wrong final block length');
    }
    let data = this.#buffer;
    if (this.#autoPadding) {
      const pad = 8 - (data.length % 8);
      const padded = new Uint8Array(data.length + pad);
      padded.set(data, 0);
      padded.fill(pad, data.length);
      data = padded;
    }
    return this.#processBlocks(data);
  }

  #finalBlockDecrypt(): Uint8Array {
    if (this.#buffer.length % 8 !== 0 || (this.#autoPadding && this.#buffer.length === 0)) {
      throw codedError('Error', 'ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH', 'error:1C80006B:Provider routines::wrong final block length');
    }
    const plain = this.#processBlocks(this.#buffer);
    if (!this.#autoPadding) return plain;
    const pad = plain[plain.length - 1];
    if (pad < 1 || pad > 8 || pad > plain.length) {
      throw codedError('Error', 'ERR_OSSL_BAD_DECRYPT', 'error:1C800064:Provider routines::bad decrypt');
    }
    for (let i = plain.length - pad; i < plain.length; i++) {
      if (plain[i] !== pad) {
        throw codedError('Error', 'ERR_OSSL_BAD_DECRYPT', 'error:1C800064:Provider routines::bad decrypt');
      }
    }
    return plain.subarray(0, plain.length - pad);
  }

  setAutoPadding(autoPadding?: boolean): void {
    this.#autoPadding = autoPadding === undefined ? true : Boolean(autoPadding);
  }

  setAAD(): void {
    throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation setAAD');
  }

  getAuthTag(): Uint8Array {
    throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation getAuthTag');
  }

  setAuthTag(): void {
    throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation setAuthTag');
  }
}
