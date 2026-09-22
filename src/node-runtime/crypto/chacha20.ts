// ChaCha20 (RFC 8439 §2.3–2.4) and ChaCha20-Poly1305 AEAD (§2.6–2.8) — pure JS.
//
// Two shapes are needed, and they differ only in how the four state words that
// follow the key are filled (OpenSSL's `cipher_chacha20_hw.c` reads the whole IV
// into those words, and `ChaCha20_ctr32` then treats the low pair as the counter
// and the high pair as the nonce):
//
//  * `chacha20` — the 16-byte IV is copied verbatim into state[12..15], so the
//    low 8 bytes are a 64-bit counter and the high 8 the nonce.
//  * `chacha20-poly1305` — a 12-byte nonce; state[12] is a 32-bit counter that
//    starts at 0 (block 0 keys Poly1305) and at 1 for the message.
import { poly1305 } from './poly1305';

const CHACHA_CONSTANTS = Uint32Array.from([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function quarterRound(state: Uint32Array, a: number, b: number, c: number, d: number): void {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotl(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotl(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotl(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotl(state[b] ^ state[c], 7);
}

function readLE32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/** The base state: the constants and the eight key words. */
function initialState(key: Uint8Array): Uint32Array {
  const state = new Uint32Array(16);
  state.set(CHACHA_CONSTANTS, 0);
  for (let i = 0; i < 8; i++) state[4 + i] = readLE32(key, i * 4);
  return state;
}

/** One 64-byte ChaCha20 keystream block for the given working state. */
function chachaBlock(initial: Uint32Array, state: Uint32Array): Uint8Array {
  for (let i = 0; i < 16; i++) state[i] = initial[i];
  for (let round = 0; round < 10; round++) {
    quarterRound(state, 0, 4, 8, 12);
    quarterRound(state, 1, 5, 9, 13);
    quarterRound(state, 2, 6, 10, 14);
    quarterRound(state, 3, 7, 11, 15);
    quarterRound(state, 0, 5, 10, 15);
    quarterRound(state, 1, 6, 11, 12);
    quarterRound(state, 2, 7, 8, 13);
    quarterRound(state, 3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const word = (state[i] + initial[i]) >>> 0;
    out[i * 4] = word & 0xff;
    out[i * 4 + 1] = (word >>> 8) & 0xff;
    out[i * 4 + 2] = (word >>> 16) & 0xff;
    out[i * 4 + 3] = (word >>> 24) & 0xff;
  }
  return out;
}

/**
 * A streaming ChaCha20 keystream over a mutable state. `wide` selects the
 * counter width: the raw cipher carries across the low two words (64-bit), the
 * AEAD only ever moves the 32-bit word 0.
 */
class ChaChaKeystream {
  #counter: Uint32Array;
  #work: Uint32Array;
  #block: Uint8Array = new Uint8Array(64);
  #pos = 64;

  constructor(key: Uint8Array, words: Uint32Array, private readonly wide: boolean) {
    this.#counter = initialState(key);
    this.#counter.set(words, 12);
    this.#work = new Uint32Array(16);
  }

  /** XOR `input` with the next keystream bytes, advancing the counter. */
  xor(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      if (this.#pos === 64) {
        this.#block = chachaBlock(this.#counter, this.#work);
        this.#counter[12] = (this.#counter[12] + 1) >>> 0;
        if (this.wide && this.#counter[12] === 0) this.#counter[13] = (this.#counter[13] + 1) >>> 0;
        this.#pos = 0;
      }
      out[i] = input[i] ^ this.#block[this.#pos++];
    }
    return out;
  }
}

/** The Poly1305 one-time key: the first 32 bytes of block 0. */
function polyKeyFromNonce(key: Uint8Array, nonce: Uint8Array): Uint8Array {
  const state = initialState(key);
  state[12] = 0;
  state[13] = readLE32(nonce, 0);
  state[14] = readLE32(nonce, 4);
  state[15] = readLE32(nonce, 8);
  const block = chachaBlock(state, new Uint32Array(16));
  return block.subarray(0, 32);
}

function codedError(name: 'Error' | 'TypeError', code: string, message: string): Error {
  const error = new (name === 'TypeError' ? TypeError : Error)(message);
  (error as { code?: string }).code = code;
  return error;
}

function invalidState(operation: string): Error {
  return codedError('Error', 'ERR_CRYPTO_INVALID_STATE', `Invalid state for operation ${operation}`);
}

/** Node's AEAD failure: a plain `Error` with no `code`. */
function authError(): Error {
  return new Error('Unsupported state or unable to authenticate data');
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function zeroPad16(data: Uint8Array): Uint8Array {
  const rem = data.length % 16;
  return rem === 0 ? new Uint8Array(0) : new Uint8Array(16 - rem);
}

function writeLE64(target: Uint8Array, offset: number, value: number): void {
  let v = value;
  for (let i = 0; i < 8; i++) {
    target[offset + i] = v & 0xff;
    v = Math.floor(v / 256);
  }
}

/** The interface the builtin drives for a synchronous cipher. */
export interface SyncCipher {
  update(input: Uint8Array): Uint8Array;
  final(): Uint8Array;
  setAutoPadding(autoPadding?: boolean): void;
  setAAD(aad: Uint8Array, options?: { plaintextLength?: number }): void;
  getAuthTag(): Uint8Array;
  setAuthTag(tag: Uint8Array): void;
}

/** `chacha20`: a bare stream cipher over a 16-byte IV. */
export class ChaCha20Cipher implements SyncCipher {
  #stream: ChaChaKeystream;
  #finalized = false;

  constructor(key: Uint8Array, iv: Uint8Array) {
    const words = new Uint32Array(4);
    for (let i = 0; i < 4; i++) words[i] = readLE32(iv, i * 4);
    this.#stream = new ChaChaKeystream(key, words, true);
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#finalized) throw new Error('Trying to add data in unsupported state');
    return this.#stream.xor(input);
  }

  final(): Uint8Array {
    this.#finalized = true;
    return new Uint8Array(0);
  }

  setAutoPadding(): void {
    // Stream ciphers have no padding; Node accepts and ignores the call.
  }

  setAAD(): void {
    throw invalidState('setAAD');
  }

  getAuthTag(): Uint8Array {
    throw invalidState('getAuthTag');
  }

  setAuthTag(): void {
    throw invalidState('setAuthTag');
  }
}

/**
 * `chacha20-poly1305`: the RFC 8439 AEAD, mirroring the `Cipheriv` surface the
 * builtin drives.
 */
export class ChaCha20Poly1305 implements SyncCipher {
  #stream: ChaChaKeystream;
  #polyKey: Uint8Array;
  #encrypt: boolean;
  #tagLength: number;
  #finalized = false;
  #aad: Uint8Array[] = [];
  #aadLength = 0;
  #text: Uint8Array[] = [];
  #textLength = 0;
  #authTag: Uint8Array | null = null;
  #expectedTag: Uint8Array | null = null;

  constructor(key: Uint8Array, iv: Uint8Array, encrypt: boolean, tagLength = 16) {
    const words = new Uint32Array(4);
    words[0] = 1; // block 0 keys Poly1305; the message starts at counter 1
    words[1] = readLE32(iv, 0);
    words[2] = readLE32(iv, 4);
    words[3] = readLE32(iv, 8);
    this.#polyKey = polyKeyFromNonce(key, iv);
    this.#stream = new ChaChaKeystream(key, words, false);
    this.#encrypt = encrypt;
    this.#tagLength = tagLength;
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#finalized) throw new Error('Trying to add data in unsupported state');
    const out = this.#stream.xor(input);
    // Poly1305 authenticates the ciphertext, which is the output when
    // encrypting and the input when decrypting — the same bytes either way.
    const ciphertext = this.#encrypt ? out : input;
    if (ciphertext.length > 0) {
      this.#text.push(ciphertext);
      this.#textLength += ciphertext.length;
    }
    return out;
  }

  final(): Uint8Array {
    if (this.#finalized) throw new Error('Invalid state');
    this.#finalized = true;
    const tag = this.#computeTag();
    if (this.#encrypt) {
      this.#authTag = tag.subarray(0, this.#tagLength).slice();
      return new Uint8Array(0);
    }
    if (this.#expectedTag === null) throw authError();
    let diff = 0;
    for (let i = 0; i < this.#expectedTag.length; i++) diff |= tag[i] ^ this.#expectedTag[i];
    if (diff !== 0) throw authError();
    return new Uint8Array(0);
  }

  #computeTag(): Uint8Array {
    const aad = concat(this.#aad);
    const text = concat(this.#text);
    const mac = new Uint8Array(
      this.#aadLength + zeroPad16(aad).length + this.#textLength + zeroPad16(text).length + 16,
    );
    let offset = 0;
    if (aad.length > 0) {
      mac.set(aad, offset);
      offset += aad.length + zeroPad16(aad).length;
    }
    if (text.length > 0) {
      mac.set(text, offset);
      offset += text.length + zeroPad16(text).length;
    }
    writeLE64(mac, offset, this.#aadLength);
    writeLE64(mac, offset + 8, this.#textLength);
    return poly1305(this.#polyKey, mac.subarray(0, offset + 16));
  }

  setAutoPadding(): void {
    // The AEAD has no padding; Node accepts and ignores the call.
  }

  setAAD(aad: Uint8Array): void {
    if (this.#finalized || this.#textLength > 0 || this.#aad.length > 0) {
      throw invalidState('setAAD');
    }
    this.#aad.push(aad);
    this.#aadLength += aad.length;
  }

  getAuthTag(): Uint8Array {
    if (this.#authTag === null) throw invalidState('getAuthTag');
    return this.#authTag;
  }

  setAuthTag(tag: Uint8Array): void {
    if (this.#encrypt) throw invalidState('setAuthTag');
    if (tag.length !== this.#tagLength) {
      throw codedError('TypeError', 'ERR_CRYPTO_INVALID_AUTH_TAG', `Invalid authentication tag length: ${tag.length}`);
    }
    this.#expectedTag = tag.slice();
  }
}

/** Valid `authTagLength` values for each AEAD, as OpenSSL enforces them. */
export function isValidTagLength(mode: string, length: number): boolean {
  if (mode === 'gcm') return [4, 8, 12, 13, 14, 15, 16].includes(length);
  if (mode === 'chacha20-poly1305') return length >= 1 && length <= 16;
  if (mode === 'ccm') return [4, 6, 8, 10, 12, 14, 16].includes(length);
  if (mode === 'ocb') return length >= 0 && length <= 16;
  if (mode === 'siv') return length === 16;
  return true;
}
