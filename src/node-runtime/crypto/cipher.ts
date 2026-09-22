/**
 * Pure-JS AES ciphers.
 *
 * Node's ciphers are OpenSSL bindings, and WebCrypto is *asynchronous* — but
 * `cipher.update()` / `cipher.final()` are synchronous and streaming, so a
 * promise-based backend cannot stand in for them. AES (ECB/CBC/CTR/CFB/OFB/GCM)
 * is therefore implemented here directly against FIPS-197 and NIST SP 800-38A/D,
 * and checked byte-for-byte against Node's OpenSSL output in `test/cipher.test.ts`.
 *
 * Everything OpenSSL exposes but this module does not implement (Camellia, ARIA,
 * SM4, DES/3DES, ChaCha20-Poly1305, CCM, OCB, SIV, XTS, the key-wrap modes, …) is
 * still a *known* cipher name, so it is rejected with a typed
 * `NotImplementedError` rather than being mislabelled unknown; a name OpenSSL
 * does not know raises `ERR_CRYPTO_UNKNOWN_CIPHER`, exactly like Node.
 */

// --- GF(2^8) and the AES S-box ----------------------------------------------

function gmul(a: number, b: number): number {
  let p = 0;
  let x = a & 0xff;
  let y = b & 0xff;
  for (let i = 0; i < 8; i++) {
    if (y & 1) p ^= x;
    const hi = x & 0x80;
    x = (x << 1) & 0xff;
    if (hi) x ^= 0x1b;
    y >>= 1;
  }
  return p & 0xff;
}

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
{
  const rotl = (v: number, n: number): number => ((v << n) | (v >>> (8 - n))) & 0xff;
  for (let i = 0; i < 256; i++) {
    // Multiplicative inverse in GF(2^8) (0 maps to 0 by construction).
    let inv = 0;
    for (let j = 1; j < 256; j++) {
      if (gmul(i, j) === 1) {
        inv = j;
        break;
      }
    }
    const s = inv ^ rotl(inv, 1) ^ rotl(inv, 2) ^ rotl(inv, 3) ^ rotl(inv, 4) ^ 0x63;
    SBOX[i] = s;
    INV_SBOX[s] = i;
  }
}

const MUL: Record<number, Uint8Array> = {};
for (const factor of [2, 3, 9, 11, 13, 14]) {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = gmul(i, factor);
  MUL[factor] = table;
}
const M2 = MUL[2];
const M3 = MUL[3];
const M9 = MUL[9];
const M11 = MUL[11];
const M13 = MUL[13];
const M14 = MUL[14];

const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);

// --- AES block cipher --------------------------------------------------------

class AesKey {
  readonly roundKeys: Uint8Array;
  readonly rounds: number;

  constructor(key: Uint8Array) {
    const nk = key.length >> 2; // 4 / 6 / 8
    this.rounds = nk + 6; // 10 / 12 / 14
    const total = 16 * (this.rounds + 1);
    const w = new Uint8Array(total);
    w.set(key, 0);
    let generated = key.length;
    let rcon = 0;
    const temp = new Uint8Array(4);
    while (generated < total) {
      for (let i = 0; i < 4; i++) temp[i] = w[generated - 4 + i];
      if (generated % key.length === 0) {
        const t = temp[0];
        temp[0] = SBOX[temp[1]];
        temp[1] = SBOX[temp[2]];
        temp[2] = SBOX[temp[3]];
        temp[3] = SBOX[t];
        temp[0] ^= RCON[rcon++];
      } else if (key.length === 32 && generated % key.length === 16) {
        for (let i = 0; i < 4; i++) temp[i] = SBOX[temp[i]];
      }
      for (let i = 0; i < 4; i++) {
        w[generated] = w[generated - key.length] ^ temp[i];
        generated++;
      }
    }
    this.roundKeys = w;
  }

  encryptBlock(block: Uint8Array): void {
    addRoundKey(block, this.roundKeys, 0);
    for (let r = 1; r < this.rounds; r++) {
      subBytes(block);
      shiftRows(block);
      mixColumns(block);
      addRoundKey(block, this.roundKeys, r * 16);
    }
    subBytes(block);
    shiftRows(block);
    addRoundKey(block, this.roundKeys, this.rounds * 16);
  }

  decryptBlock(block: Uint8Array): void {
    addRoundKey(block, this.roundKeys, this.rounds * 16);
    for (let r = this.rounds - 1; r >= 1; r--) {
      invShiftRows(block);
      invSubBytes(block);
      addRoundKey(block, this.roundKeys, r * 16);
      invMixColumns(block);
    }
    invShiftRows(block);
    invSubBytes(block);
    addRoundKey(block, this.roundKeys, 0);
  }
}

// The AES state is kept flat, column-major: `state[4*col + row]`.
function addRoundKey(state: Uint8Array, roundKeys: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i++) state[i] ^= roundKeys[offset + i];
}

function subBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
}

function invSubBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
}

function shiftRows(state: Uint8Array): void {
  let t = state[1];
  state[1] = state[5];
  state[5] = state[9];
  state[9] = state[13];
  state[13] = t;
  t = state[2];
  state[2] = state[10];
  state[10] = t;
  t = state[6];
  state[6] = state[14];
  state[14] = t;
  t = state[15];
  state[15] = state[11];
  state[11] = state[7];
  state[7] = state[3];
  state[3] = t;
}

function invShiftRows(state: Uint8Array): void {
  let t = state[13];
  state[13] = state[9];
  state[9] = state[5];
  state[5] = state[1];
  state[1] = t;
  t = state[2];
  state[2] = state[10];
  state[10] = t;
  t = state[6];
  state[6] = state[14];
  state[14] = t;
  t = state[3];
  state[3] = state[7];
  state[7] = state[11];
  state[11] = state[15];
  state[15] = t;
}

function mixColumns(state: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const a0 = state[i];
    const a1 = state[i + 1];
    const a2 = state[i + 2];
    const a3 = state[i + 3];
    state[i] = M2[a0] ^ M3[a1] ^ a2 ^ a3;
    state[i + 1] = a0 ^ M2[a1] ^ M3[a2] ^ a3;
    state[i + 2] = a0 ^ a1 ^ M2[a2] ^ M3[a3];
    state[i + 3] = M3[a0] ^ a1 ^ a2 ^ M2[a3];
  }
}

function invMixColumns(state: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const a0 = state[i];
    const a1 = state[i + 1];
    const a2 = state[i + 2];
    const a3 = state[i + 3];
    state[i] = M14[a0] ^ M11[a1] ^ M13[a2] ^ M9[a3];
    state[i + 1] = M9[a0] ^ M14[a1] ^ M11[a2] ^ M13[a3];
    state[i + 2] = M13[a0] ^ M9[a1] ^ M14[a2] ^ M11[a3];
    state[i + 3] = M11[a0] ^ M13[a1] ^ M9[a2] ^ M14[a3];
  }
}

// --- GCM (NIST SP 800-38D) --------------------------------------------------

/** Multiplication in GF(2^128) with the GCM reduction polynomial. */
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

/** Streaming GHASH: absorbs bytes in order, zero-padding the final block. */
class Ghash {
  #h: Uint8Array;
  #y: Uint8Array = new Uint8Array(16);
  #pending: Uint8Array = new Uint8Array(16);
  #pendingLen = 0;

  constructor(h: Uint8Array) {
    this.#h = h;
  }

  update(bytes: Uint8Array): void {
    let offset = 0;
    while (offset < bytes.length) {
      const take = Math.min(16 - this.#pendingLen, bytes.length - offset);
      this.#pending.set(bytes.subarray(offset, offset + take), this.#pendingLen);
      this.#pendingLen += take;
      offset += take;
      if (this.#pendingLen === 16) {
        this.#absorb(this.#pending);
        this.#pendingLen = 0;
      }
    }
  }

  #absorb(block: Uint8Array): void {
    for (let i = 0; i < 16; i++) this.#y[i] ^= block[i];
    this.#y = ghashMul(this.#y, this.#h);
  }

  /** Zero-pad the pending partial block up to a 16-byte boundary and absorb it.
   * A no-op when already aligned. GCM pads the AAD and the ciphertext each to a
   * block boundary *separately*, so this must be called between them. */
  padBlock(): void {
    if (this.#pendingLen === 0) return;
    const block = new Uint8Array(16);
    block.set(this.#pending.subarray(0, this.#pendingLen));
    this.#absorb(block);
    this.#pendingLen = 0;
  }

  digest(): Uint8Array {
    this.padBlock();
    return this.#y;
  }
}

function inc32(counter: Uint8Array): void {
  for (let i = 15; i >= 12; i--) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) return;
  }
}

// --- the cipher surface ------------------------------------------------------

import { ChaCha20Cipher, ChaCha20Poly1305, isValidTagLength, type SyncCipher } from './chacha20';

export type { SyncCipher };

export type CipherMode = 'ecb' | 'cbc' | 'ctr' | 'cfb' | 'ofb' | 'gcm' | 'chacha20' | 'chacha20-poly1305';

export interface CipherSpec {
  /** Canonical algorithm name as accepted by `createCipheriv`. */
  name: string;
  /** Name reported by `crypto.getCipherInfo()`. */
  infoName: string;
  mode: CipherMode;
  /** Overrides `mode` in `getCipherInfo()` (the ChaCha modes report `stream`). */
  infoMode?: string;
  nid: number;
  keyLength: number;
  /** Cipher block size in bytes (16 for ECB/CBC, 1 for the stream modes). */
  blockSize: number;
  /** Required IV length, or `null` for ECB (no IV). */
  ivLength: number | null;
  /** GCM keys this spec under this alias (used to key the lookup table). */
  alias?: true;
}

const SPECS: CipherSpec[] = [];
{
  const sizes: Array<[number, number, number]> = [
    // keyLength, ecb nid, cbc nid are per-size; the rest are laid out below.
    [16, 418, 419],
    [24, 422, 423],
    [32, 426, 427],
  ];
  const extra: Record<string, number[]> = {
    // Bits → [ecb, cbc, cfb, ofb, ctr, gcm]
    '16': [418, 419, 421, 420, 904, 895],
    '24': [422, 423, 425, 424, 905, 898],
    '32': [426, 427, 429, 428, 906, 901],
  };
  const modes: Array<{ mode: CipherMode; blockSize: number; ivLength: number | null }> = [
    { mode: 'ecb', blockSize: 16, ivLength: null },
    { mode: 'cbc', blockSize: 16, ivLength: 16 },
    { mode: 'cfb', blockSize: 1, ivLength: 16 },
    { mode: 'ofb', blockSize: 1, ivLength: 16 },
    { mode: 'ctr', blockSize: 1, ivLength: 16 },
    { mode: 'gcm', blockSize: 1, ivLength: 12 },
  ];
  for (const [keyLength] of sizes) {
    const nids = extra[String(keyLength)];
    modes.forEach((m, index) => {
      const name = `aes-${keyLength * 8}-${m.mode}`;
      const infoName = m.mode === 'gcm' ? `id-aes${keyLength * 8}-gcm` : name;
      SPECS.push({ name, infoName, mode: m.mode, nid: nids[index], keyLength, blockSize: m.blockSize, ivLength: m.ivLength });
    });
  }
  // OpenSSL aliases: the bare size means CBC, and GCM answers to `id-…-gcm`.
  for (const keyLength of [16, 24, 32] as const) {
    const bits = keyLength * 8;
    const cbc = SPECS.find((s) => s.name === `aes-${bits}-cbc`)!;
    SPECS.push({ ...cbc, name: `aes${bits}`, alias: true });
    const gcm = SPECS.find((s) => s.name === `aes-${bits}-gcm`)!;
    SPECS.push({ ...gcm, name: `id-aes${bits}-gcm`, alias: true });
  }
  // ChaCha20 and its AEAD (RFC 8439); OpenSSL reports both as mode `stream`.
  SPECS.push({ name: 'chacha20', infoName: 'chacha20', mode: 'chacha20', infoMode: 'stream', nid: 1019, keyLength: 32, blockSize: 1, ivLength: 16 });
  SPECS.push({ name: 'chacha20-poly1305', infoName: 'chacha20-poly1305', mode: 'chacha20-poly1305', infoMode: 'stream', nid: 1018, keyLength: 32, blockSize: 1, ivLength: 12 });
}

const LOOKUP = new Map<string, CipherSpec>(SPECS.map((s) => [s.name, s]));

/** The cipher names OpenSSL knows (Node v26.9.0), for classifying errors. */
const KNOWN_CIPHERS = new Set(
  (
    'aes-128-cbc aes-128-cbc-cts aes-128-ccm aes-128-cfb aes-128-cfb1 aes-128-cfb8 aes-128-ctr ' +
    'aes-128-ecb aes-128-gcm aes-128-gcm-siv aes-128-ocb aes-128-ofb aes-128-siv aes-128-wrap ' +
    'aes-128-wrap-inv aes-128-wrap-pad aes-128-wrap-pad-inv aes-128-xts aes-192-cbc aes-192-cbc-cts ' +
    'aes-192-ccm aes-192-cfb aes-192-cfb1 aes-192-cfb8 aes-192-ctr aes-192-ecb aes-192-gcm ' +
    'aes-192-gcm-siv aes-192-ocb aes-192-ofb aes-192-siv aes-192-wrap aes-192-wrap-inv ' +
    'aes-192-wrap-pad aes-192-wrap-pad-inv aes-256-cbc aes-256-cbc-cts aes-256-ccm aes-256-cfb ' +
    'aes-256-cfb1 aes-256-cfb8 aes-256-ctr aes-256-ecb aes-256-gcm aes-256-gcm-siv aes-256-ocb ' +
    'aes-256-ofb aes-256-siv aes-256-wrap aes-256-wrap-inv aes-256-wrap-pad aes-256-wrap-pad-inv ' +
    'aes-256-xts aes128 aes128-wrap aes128-wrap-inv aes128-wrap-pad aes128-wrap-pad-inv aes192 ' +
    'aes192-wrap aes192-wrap-inv aes192-wrap-pad aes192-wrap-pad-inv aes256 aes256-wrap ' +
    'aes256-wrap-inv aes256-wrap-pad aes256-wrap-pad-inv aria-128-cbc aria-128-ccm aria-128-cfb ' +
    'aria-128-cfb1 aria-128-cfb8 aria-128-ctr aria-128-ecb aria-128-gcm aria-128-ofb aria-192-cbc ' +
    'aria-192-ccm aria-192-cfb aria-192-cfb1 aria-192-cfb8 aria-192-ctr aria-192-ecb aria-192-gcm ' +
    'aria-192-ofb aria-256-cbc aria-256-ccm aria-256-cfb aria-256-cfb1 aria-256-cfb8 aria-256-ctr ' +
    'aria-256-ecb aria-256-gcm aria-256-ofb aria128 aria192 aria256 camellia-128-cbc ' +
    'camellia-128-cbc-cts camellia-128-cfb camellia-128-cfb1 camellia-128-cfb8 camellia-128-ctr ' +
    'camellia-128-ecb camellia-128-ofb camellia-192-cbc camellia-192-cbc-cts camellia-192-cfb ' +
    'camellia-192-cfb1 camellia-192-cfb8 camellia-192-ctr camellia-192-ecb camellia-192-ofb ' +
    'camellia-256-cbc camellia-256-cbc-cts camellia-256-cfb camellia-256-cfb1 camellia-256-cfb8 ' +
    'camellia-256-ctr camellia-256-ecb camellia-256-ofb camellia128 camellia192 camellia256 ' +
    'chacha20 chacha20-poly1305 des-ede des-ede-cbc des-ede-cfb des-ede-ecb des-ede-ofb des-ede3 ' +
    'des-ede3-cbc des-ede3-cfb des-ede3-cfb1 des-ede3-cfb8 des-ede3-ecb des-ede3-ofb des3 ' +
    'des3-wrap id-aes128-ccm id-aes128-gcm id-aes128-wrap id-aes128-wrap-pad id-aes192-ccm ' +
    'id-aes192-gcm id-aes192-wrap id-aes192-wrap-pad id-aes256-ccm id-aes256-gcm id-aes256-wrap ' +
    'id-aes256-wrap-pad id-smime-alg-cms3deswrap sm4 sm4-cbc sm4-ccm sm4-cfb sm4-cfb128 sm4-ctr ' +
    'sm4-ecb sm4-gcm sm4-ofb sm4-ofb128 sm4-xts'
  ).split(' '),
);

/** The ciphers this runtime actually implements, sorted like Node's list. */
export function listCiphers(): string[] {
  return [...LOOKUP.keys()].sort();
}

/** True when `name` is a cipher OpenSSL knows (implemented or not). */
export function isKnownCipherName(name: string): boolean {
  return KNOWN_CIPHERS.has(`${name}`.toLowerCase());
}

/** The spec for a supported cipher, or `undefined` when it is not implemented. */
export function resolveCipher(name: unknown): CipherSpec | undefined {
  return LOOKUP.get(`${name}`.toLowerCase());
}

export interface CipherInfo {
  mode: string;
  name: string;
  nid: number;
  keyLength: number;
  blockSize?: number;
  ivLength?: number;
}

/**
 * `crypto.getCipherInfo()`. Only the ciphers this runtime implements report
 * metadata — an unimplemented (or unknown) cipher yields `undefined`, the same
 * as an unknown name does in Node.
 */
export function getCipherInfo(nameOrNid: string | number): CipherInfo | undefined {
  const spec =
    typeof nameOrNid === 'number'
      ? SPECS.find((s) => s.nid === nameOrNid)
      : LOOKUP.get(`${nameOrNid}`.toLowerCase());
  if (!spec) return undefined;
  const info: CipherInfo = {
    mode: spec.infoMode ?? spec.mode,
    name: spec.infoName,
    nid: spec.nid,
    keyLength: spec.keyLength,
  };
  // OpenSSL reports no `blockSize` for the stream-mode ciphers (ChaCha20 and
  // its AEAD); the block modes (ECB/CBC) and the AES stream modes do have one.
  if (spec.infoMode !== 'stream') info.blockSize = spec.blockSize;
  if (spec.ivLength !== null) info.ivLength = spec.ivLength;
  return info;
}

/** True when `spec`'s `authTagLength` is one OpenSSL accepts at construction. */
export function cipherTagLengthIsValid(spec: CipherSpec, length: number): boolean {
  return isValidTagLength(spec.mode, length);
}

/**
 * Builds the synchronous cipher for `spec`. AES modes reuse `Cipheriv`; the
 * ChaCha20 family has its own implementations but presents the same surface.
 */
export function createCipher(
  spec: CipherSpec,
  key: Uint8Array,
  iv: Uint8Array | null,
  encrypt: boolean,
  authTagLength = 16,
): SyncCipher {
  if (spec.mode === 'chacha20') return new ChaCha20Cipher(key, iv as Uint8Array);
  if (spec.mode === 'chacha20-poly1305') {
    return new ChaCha20Poly1305(key, iv as Uint8Array, encrypt, authTagLength);
  }
  return new Cipheriv(spec, key, iv, encrypt, authTagLength);
}

/** PKCS#7 padding: always adds 1..blockSize bytes. */
function pkcs7Pad(data: Uint8Array): Uint8Array {
  const pad = 16 - (data.length % 16);
  const out = new Uint8Array(data.length + pad);
  out.set(data, 0);
  out.fill(pad, data.length);
  return out;
}

/**
 * A synchronous AES cipher, mirroring the shape of Node's `Cipheriv`. Inputs and
 * outputs are raw bytes; the builtin wraps them into `Buffer`s and applies the
 * string encodings.
 */
export class Cipheriv {
  readonly spec: CipherSpec;
  readonly encrypt: boolean;
  #aes: AesKey;
  #iv: Uint8Array;
  #autoPadding = true;
  #finalized = false;
  #tagLength: number;
  // Block modes hold a partial block across `update` calls.
  #buffer: Uint8Array = new Uint8Array(0);
  #chain: Uint8Array; // CBC chaining value
  #counter: Uint8Array; // CTR/GCM counter block
  #register: Uint8Array; // CFB/OFB feedback register
  #keystream: Uint8Array = new Uint8Array(16);
  #keystreamPos = 16;
  #cfbBlock: Uint8Array = new Uint8Array(16);
  #cfbPos = 0;
  // GCM
  #ghash: Ghash;
  #gcmJ0: Uint8Array = new Uint8Array(16);
  #aadLen = 0;
  #dataLen = 0;
  #aad: Uint8Array | null = null;
  #aadAbsorbed = false;
  #authTag: Uint8Array | null = null;
  #expectedTag: Uint8Array | null = null;

  constructor(spec: CipherSpec, key: Uint8Array, iv: Uint8Array | null, encrypt: boolean, authTagLength = 16) {
    this.spec = spec;
    this.encrypt = encrypt;
    this.#aes = new AesKey(key);
    this.#iv = iv ? iv.slice() : new Uint8Array(0);
    this.#tagLength = authTagLength;
    this.#chain = new Uint8Array(16);
    this.#counter = new Uint8Array(16);
    this.#register = new Uint8Array(16);
    this.#ghash = new Ghash(new Uint8Array(16));
    this.#initMode();
  }

  #initMode(): void {
    switch (this.spec.mode) {
      case 'cbc':
        this.#chain.set(this.#iv);
        break;
      case 'ctr':
        this.#counter.set(this.#iv);
        break;
      case 'cfb':
      case 'ofb':
        this.#register.set(this.#iv);
        break;
      case 'gcm': {
        // H = E(K, 0^128)
        const h = new Uint8Array(16);
        this.#aes.encryptBlock(h);
        this.#ghash = new Ghash(h);
        this.#gcmJ0 = computeJ0(this.#aes, this.#iv);
        this.#counter.set(this.#gcmJ0);
        inc32(this.#counter);
        break;
      }
      case 'ecb':
        break;
    }
  }

  #encryptInto(block: Uint8Array): void {
    if (this.encrypt || this.spec.mode === 'gcm') this.#aes.encryptBlock(block);
    else this.#aes.decryptBlock(block);
  }

  #generateKeystream(): void {
    switch (this.spec.mode) {
      case 'ctr':
        this.#keystream.set(this.#counter);
        this.#aes.encryptBlock(this.#keystream);
        incCounter128(this.#counter);
        break;
      case 'gcm':
        this.#keystream.set(this.#counter);
        this.#aes.encryptBlock(this.#keystream);
        inc32(this.#counter);
        break;
      case 'ofb':
        this.#keystream.set(this.#register);
        this.#aes.encryptBlock(this.#keystream);
        this.#register.set(this.#keystream);
        break;
      case 'cfb':
        this.#keystream.set(this.#register);
        this.#aes.encryptBlock(this.#keystream);
        break;
    }
    this.#keystreamPos = 0;
  }

  /** Byte-wise processing for the stream modes (blockSize 1). */
  #processStream(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    const mode = this.spec.mode;
    for (let i = 0; i < input.length; i++) {
      if (this.#keystreamPos === 16) this.#generateKeystream();
      const byte = input[i] ^ this.#keystream[this.#keystreamPos++];
      out[i] = byte;
      if (mode === 'cfb') {
        this.#cfbBlock[this.#cfbPos++] = this.encrypt ? byte : input[i];
        if (this.#cfbPos === 16) {
          this.#register.set(this.#cfbBlock);
          this.#cfbPos = 0;
        }
      }
    }
    if (mode === 'gcm') {
      this.#flushAad();
      this.#dataLen += input.length;
      // GHASH absorbs the *ciphertext*: the output when encrypting, the input
      // when decrypting — the same bytes either way.
      this.#ghash.update(this.encrypt ? out : input);
    }
    return out;
  }

  /** Process a whole number of 16-byte blocks in ECB/CBC mode. */
  #processBlocks(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    const block = new Uint8Array(16);
    for (let offset = 0; offset < input.length; offset += 16) {
      if (this.spec.mode === 'cbc' && this.encrypt) {
        for (let i = 0; i < 16; i++) block[i] = input[offset + i] ^ this.#chain[i];
        this.#aes.encryptBlock(block);
        this.#chain.set(block);
      } else if (this.spec.mode === 'cbc') {
        block.set(input.subarray(offset, offset + 16));
        this.#aes.decryptBlock(block);
        for (let i = 0; i < 16; i++) block[i] ^= this.#chain[i];
        this.#chain.set(input.subarray(offset, offset + 16));
      } else {
        block.set(input.subarray(offset, offset + 16));
        this.#encryptInto(block);
      }
      out.set(block, offset);
    }
    return out;
  }

  update(input: Uint8Array): Uint8Array {
    if (this.#finalized) throw new Error('Trying to add data in unsupported state');
    if (this.spec.blockSize === 1) return this.#processStream(input);
    // ECB/CBC buffer to a block boundary; on the way out, a decrypting cipher
    // holds one whole block back for `final` so padding can be stripped.
    const combined = new Uint8Array(this.#buffer.length + input.length);
    combined.set(this.#buffer, 0);
    combined.set(input, this.#buffer.length);
    // Whole blocks only; a decrypting cipher keeps its last whole block for
    // `final`, where the trailing padding is stripped.
    const whole = combined.length - (combined.length % 16);
    const processable = this.encrypt ? whole : Math.max(0, whole - 16);
    const out = this.#processBlocks(combined.subarray(0, processable));
    this.#buffer = combined.subarray(processable).slice();
    return out;
  }

  final(): Uint8Array {
    if (this.#finalized) throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state');
    this.#finalized = true;
    if (this.spec.mode === 'gcm') return this.#finalGcm();
    if (this.spec.blockSize === 1) return new Uint8Array(0);
    return this.encrypt ? this.#finalBlockEncrypt() : this.#finalBlockDecrypt();
  }

  #finalBlockEncrypt(): Uint8Array {
    if (this.#buffer.length === 0 && !this.#autoPadding) return new Uint8Array(0);
    if (!this.#autoPadding && this.#buffer.length % 16 !== 0) {
      throw codedError('Error', 'ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH', 'error:1C80006B:Provider routines::wrong final block length');
    }
    const data = this.#autoPadding ? pkcs7Pad(this.#buffer) : this.#buffer;
    return this.#processBlocks(data);
  }

  #finalBlockDecrypt(): Uint8Array {
    if (this.#buffer.length % 16 !== 0 || (this.#autoPadding && this.#buffer.length === 0)) {
      throw codedError('Error', 'ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH', 'error:1C80006B:Provider routines::wrong final block length');
    }
    const plain = this.#processBlocks(this.#buffer);
    if (!this.#autoPadding) return plain;
    const pad = plain[plain.length - 1];
    if (pad < 1 || pad > 16 || pad > plain.length) {
      throw badDecrypt();
    }
    for (let i = plain.length - pad; i < plain.length; i++) {
      if (plain[i] !== pad) throw badDecrypt();
    }
    return plain.subarray(0, plain.length - pad);
  }

  #finalGcm(): Uint8Array {
    this.#flushAad();
    this.#ghash.padBlock(); // pad the trailing ciphertext to a block boundary
    const lengths = new Uint8Array(16);
    writeUint64(lengths, 0, this.#aadLen * 8);
    writeUint64(lengths, 8, this.#dataLen * 8);
    this.#ghash.update(lengths);
    const s = this.#ghash.digest();
    const mask = this.#gcmJ0.slice();
    this.#aes.encryptBlock(mask);
    const tag = new Uint8Array(16);
    for (let i = 0; i < 16; i++) tag[i] = s[i] ^ mask[i];
    if (this.encrypt) {
      this.#authTag = tag.subarray(0, this.#tagLength).slice();
      return new Uint8Array(0);
    }
    if (this.#expectedTag === null) throw authFailed();
    let diff = 0;
    for (let i = 0; i < this.#expectedTag.length; i++) diff |= tag[i] ^ this.#expectedTag[i];
    if (diff !== 0) throw authFailed();
    return new Uint8Array(0);
  }

  setAutoPadding(autoPadding?: boolean): void {
    this.#autoPadding = autoPadding === undefined ? true : Boolean(autoPadding);
  }

  setAAD(aad: Uint8Array): void {
    if (this.spec.mode !== 'gcm') {
      throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation setAAD');
    }
    if (this.#finalized || this.#dataLen > 0 || this.#aadAbsorbed) {
      throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation setAAD');
    }
    // Accumulate; the block is padded and absorbed only once the ciphertext
    // starts (or at `final`), because GCM zero-pads the AAD to a whole block.
    const combined = new Uint8Array((this.#aad?.length ?? 0) + aad.length);
    if (this.#aad) combined.set(this.#aad, 0);
    combined.set(aad, this.#aad?.length ?? 0);
    this.#aad = combined;
    this.#aadLen += aad.length;
  }

  /** Absorb the accumulated AAD (zero-padded to a block) exactly once. */
  #flushAad(): void {
    if (this.#aadAbsorbed) return;
    this.#aadAbsorbed = true;
    if (this.#aad && this.#aad.length > 0) {
      this.#ghash.update(this.#aad);
      this.#ghash.padBlock();
    }
    this.#aad = null;
  }

  getAuthTag(): Uint8Array {
    if (this.spec.mode !== 'gcm' || this.#authTag === null) {
      throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation getAuthTag');
    }
    return this.#authTag;
  }

  setAuthTag(tag: Uint8Array): void {
    if (this.spec.mode !== 'gcm' || this.encrypt) {
      throw codedError('Error', 'ERR_CRYPTO_INVALID_STATE', 'Invalid state for operation setAuthTag');
    }
    if (tag.length !== this.#tagLength) {
      throw codedError('TypeError', 'ERR_CRYPTO_INVALID_AUTH_TAG', `Invalid authentication tag length: ${tag.length}`);
    }
    this.#expectedTag = tag.slice();
  }
}

// --- small helpers -----------------------------------------------------------

function computeJ0(aes: AesKey, iv: Uint8Array): Uint8Array {
  const j0 = new Uint8Array(16);
  if (iv.length === 12) {
    j0.set(iv, 0);
    j0[15] = 1;
    return j0;
  }
  const padded = new Uint8Array(Math.ceil(iv.length / 16) * 16 + 16);
  padded.set(iv, 0);
  writeUint64(padded, padded.length - 8, iv.length * 8);
  const h = new Uint8Array(16);
  aes.encryptBlock(h);
  const ghash = new Ghash(h);
  ghash.update(padded);
  return ghash.digest();
}

function incCounter128(counter: Uint8Array): void {
  for (let i = 15; i >= 0; i--) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) return;
  }
}

// --- CMAC / GMAC -------------------------------------------------------------

/** `x << 1` on a big-endian 128-bit block. */
function shiftLeftOne(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    const b = block[i];
    out[i] = ((b << 1) | carry) & 0xff;
    carry = (b >> 7) & 1;
  }
  return out;
}

/** AES-CMAC (NIST SP 800-38B) over a single AES key. Digests are 16 bytes. */
export function aesCmac(key: Uint8Array, data: Uint8Array): Uint8Array {
  const aes = new AesKey(key);
  const l = new Uint8Array(16);
  aes.encryptBlock(l);
  const k1 = shiftLeftOne(l);
  if (l[0] & 0x80) k1[15] ^= 0x87;
  const k2 = shiftLeftOne(k1);
  if (k1[0] & 0x80) k2[15] ^= 0x87;

  const blockCount = Math.max(1, Math.ceil(data.length / 16));
  const lastComplete = data.length !== 0 && data.length % 16 === 0;
  const chain = new Uint8Array(16);
  const block = new Uint8Array(16);
  for (let i = 0; i < blockCount - 1; i++) {
    block.set(data.subarray(i * 16, i * 16 + 16));
    for (let j = 0; j < 16; j++) block[j] ^= chain[j];
    aes.encryptBlock(block);
    chain.set(block);
  }
  const start = (blockCount - 1) * 16;
  block.fill(0);
  if (lastComplete) {
    block.set(data.subarray(start, start + 16));
    for (let j = 0; j < 16; j++) block[j] ^= k1[j];
  } else {
    const rem = data.length - start;
    block.set(data.subarray(start, start + rem));
    block[rem] = 0x80;
    for (let j = 0; j < 16; j++) block[j] ^= k2[j];
  }
  for (let j = 0; j < 16; j++) block[j] ^= chain[j];
  aes.encryptBlock(block);
  return block;
}

/** AES-GMAC (NIST SP 800-38D): the GCM tag of `data` used as associated data. */
export function aesGmac(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const aes = new AesKey(key);
  const h = new Uint8Array(16);
  aes.encryptBlock(h);
  const ghash = new Ghash(h);
  ghash.update(data);
  ghash.padBlock();
  const lengths = new Uint8Array(16);
  writeUint64(lengths, 0, data.length * 8);
  ghash.update(lengths);
  const tag = ghash.digest();
  const mask = computeJ0(aes, iv);
  aes.encryptBlock(mask);
  for (let i = 0; i < 16; i++) tag[i] ^= mask[i];
  return tag;
}

function writeUint64(target: Uint8Array, offset: number, value: number): void {
  let v = value;
  for (let i = 7; i >= 0; i--) {
    target[offset + i] = v & 0xff;
    v = Math.floor(v / 256);
  }
}

function codedError(name: 'Error' | 'TypeError', code: string, message: string): Error {
  const error = new (name === 'TypeError' ? TypeError : Error)(message);
  (error as { code?: string }).code = code;
  return error;
}

function badDecrypt(): Error {
  return codedError('Error', 'ERR_OSSL_BAD_DECRYPT', 'error:1C800064:Provider routines::bad decrypt');
}

function authFailed(): Error {
  return new Error('Unsupported state or unable to authenticate data');
}
