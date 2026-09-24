// Argon2 (RFC 9106). Node's `crypto.argon2(Sync)` sits on the bundled
// OpenSSL Argon2; the wasi OpenSSL subset (M119) now provides that too, so
// `argon2()` prefers it and falls back to the pure-JS implementation below
// (byte-identical, so the choice is invisible). The fallback reproduces the
// algorithm directly: BLAKE2b for H0 / H', the BlaMka compression function,
// and the data-dependent (d) / data-independent (i) / hybrid (id) index
// generation.
//
// 64-bit words are held as BigInt. The block fills are the hot path, but the
// inputs a page can realistically hash in a browser stay well inside the range
// where this is fast enough, and it keeps the arithmetic obviously correct.

import { blake2b } from './blake2b';
import { opensslArgon2, opensslReady } from '../bindings/openssl';

const MASK64 = (1n << 64n) - 1n;

export const ARGON2_D = 0;
export const ARGON2_I = 1;
export const ARGON2_ID = 2;

const SYNC_POINTS = 4;
const ADDRESSES_IN_BLOCK = 128;
const VERSION = 0x13; // 19
const MIN_SEGMENT_SIZE = 2;
const BLOCK_WORDS = 128;

export interface Argon2Params {
  type: number;
  password: Uint8Array;
  salt: Uint8Array;
  secret: Uint8Array;
  associatedData: Uint8Array;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}

function le32(value: number): Uint8Array {
  const v = value >>> 0;
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function blamka(a: bigint, b: bigint): bigint {
  return (a + b + 2n * ((a & 0xffffffffn) * (b & 0xffffffffn))) & MASK64;
}

function blockToBytes(block: BigUint64Array, offset: number): Uint8Array {
  const out = new Uint8Array(1024);
  for (let i = 0; i < BLOCK_WORDS; i++) {
    let word = block[offset + i];
    for (let j = 0; j < 8; j++) {
      out[i * 8 + j] = Number(word & 0xffn);
      word >>= 8n;
    }
  }
  return out;
}

function bytesToBlock(bytes: Uint8Array, target: BigUint64Array, offset: number): void {
  for (let i = 0; i < BLOCK_WORDS; i++) {
    let word = 0n;
    for (let j = 7; j >= 0; j--) word = (word << 8n) | BigInt(bytes[i * 8 + j]);
    target[offset + i] = word;
  }
}

// BLAKE2b_long (`H'`): the variable-length hash Argon2 uses for block init and
// the final tag.
function hPrime(outLen: number, input: Uint8Array): Uint8Array {
  if (outLen <= 64) return blake2b(concat([le32(outLen), input]), outLen);
  const out = new Uint8Array(outLen);
  let v = blake2b(concat([le32(outLen), input]), 64);
  out.set(v.subarray(0, 32), 0);
  let produced = 32;
  let remaining = outLen - 32;
  while (remaining > 64) {
    v = blake2b(v, 64);
    out.set(v.subarray(0, 32), produced);
    produced += 32;
    remaining -= 32;
  }
  v = blake2b(v, remaining);
  out.set(v, produced);
  return out;
}

// The BlaMka G, no message words.
function gMix(v: BigUint64Array, a: number, b: number, c: number, d: number): void {
  v[a] = blamka(v[a], v[b]);
  v[d] = rotr64(v[d] ^ v[a], 32n);
  v[c] = blamka(v[c], v[d]);
  v[b] = rotr64(v[b] ^ v[c], 24n);
  v[a] = blamka(v[a], v[b]);
  v[d] = rotr64(v[d] ^ v[a], 16n);
  v[c] = blamka(v[c], v[d]);
  v[b] = rotr64(v[b] ^ v[c], 63n);
}

// BLAKE2_ROUND_NOMSG over 16 consecutive words starting at `base`.
function roundWords(v: BigUint64Array, base: number): void {
  gMix(v, base + 0, base + 4, base + 8, base + 12);
  gMix(v, base + 1, base + 5, base + 9, base + 13);
  gMix(v, base + 2, base + 6, base + 10, base + 14);
  gMix(v, base + 3, base + 7, base + 11, base + 15);
  gMix(v, base + 0, base + 5, base + 10, base + 15);
  gMix(v, base + 1, base + 6, base + 11, base + 12);
  gMix(v, base + 2, base + 7, base + 8, base + 13);
  gMix(v, base + 3, base + 4, base + 9, base + 14);
}

// BLAKE2_ROUND_NOMSG over the strided "row" pattern (2i, 2i+1, 2i+16, …).
function roundRows(v: BigUint64Array, i: number): void {
  const a = 2 * i;
  const b = 2 * i + 1;
  gMix(v, a, a + 32, a + 64, a + 96);
  gMix(v, b, b + 32, b + 64, b + 96);
  gMix(v, a + 16, a + 48, a + 80, a + 112);
  gMix(v, b + 16, b + 48, b + 80, b + 112);
  gMix(v, a, b + 32, a + 80, b + 112);
  gMix(v, b, a + 48, b + 80, a + 96);
  gMix(v, a + 16, b + 48, a + 64, b + 96);
  gMix(v, b + 16, a + 32, b + 64, a + 112);
}

// G(X, Y): R = X ^ Y; Z = R; permute R; out = Z ^ (R permuted), optionally XORed
// over the existing destination (second and later passes).
function fillBlock(
  prev: BigUint64Array,
  prevOffset: number,
  ref: BigUint64Array,
  refOffset: number,
  next: BigUint64Array,
  nextOffset: number,
  withXor: boolean,
): void {
  const r = new BigUint64Array(BLOCK_WORDS);
  for (let i = 0; i < BLOCK_WORDS; i++) r[i] = prev[prevOffset + i] ^ ref[refOffset + i];
  const z = r.slice();

  for (let i = 0; i < 8; i++) roundWords(r, i * 16);
  for (let i = 0; i < 8; i++) roundRows(r, i);

  for (let i = 0; i < BLOCK_WORDS; i++) {
    const value = z[i] ^ r[i];
    next[nextOffset + i] = withXor ? next[nextOffset + i] ^ value : value;
  }
}

function nextAddresses(
  addressBlock: BigUint64Array,
  inputBlock: BigUint64Array,
  zeroBlock: BigUint64Array,
): void {
  inputBlock[6] = inputBlock[6] + 1n;
  fillBlock(zeroBlock, 0, inputBlock, 0, addressBlock, 0, false);
  fillBlock(zeroBlock, 0, addressBlock, 0, addressBlock, 0, false);
}

interface Instance {
  type: number;
  passes: number;
  memoryBlocks: number;
  laneLength: number;
  segmentLength: number;
  lanes: number;
}

function indexAlpha(
  instance: Instance,
  pass: number,
  slice: number,
  index: number,
  pseudoRand: bigint,
  sameLane: boolean,
): number {
  let referenceAreaSize: number;
  if (pass === 0) {
    if (slice === 0) {
      referenceAreaSize = index - 1;
    } else if (sameLane) {
      referenceAreaSize = slice * instance.segmentLength + index - 1;
    } else {
      referenceAreaSize = slice * instance.segmentLength + (index === 0 ? -1 : 0);
    }
  } else if (sameLane) {
    referenceAreaSize = instance.laneLength - instance.segmentLength + index - 1;
  } else {
    referenceAreaSize = instance.laneLength - instance.segmentLength + (index === 0 ? -1 : 0);
  }

  // RFC 9106 §3.4.1.2: relative = area - 1 - (area * (pseudo^2 >> 32) >> 32).
  const area = BigInt(referenceAreaSize);
  let relativePosition = (pseudoRand * pseudoRand) >> 32n;
  relativePosition = area - 1n - ((area * relativePosition) >> 32n);

  let startPosition = 0;
  if (pass !== 0) {
    startPosition = slice === SYNC_POINTS - 1 ? 0 : (slice + 1) * instance.segmentLength;
  }

  return (startPosition + Number(relativePosition)) % instance.laneLength;
}

function fillSegment(memory: BigUint64Array, instance: Instance, pass: number, lane: number, slice: number): void {
  const dataIndependent =
    instance.type === ARGON2_I ||
    (instance.type === ARGON2_ID && pass === 0 && slice < SYNC_POINTS / 2);

  const addressBlock = new BigUint64Array(BLOCK_WORDS);
  const inputBlock = new BigUint64Array(BLOCK_WORDS);
  const zeroBlock = new BigUint64Array(BLOCK_WORDS);

  if (dataIndependent) {
    inputBlock[0] = BigInt(pass);
    inputBlock[1] = BigInt(lane);
    inputBlock[2] = BigInt(slice);
    inputBlock[3] = BigInt(instance.memoryBlocks);
    inputBlock[4] = BigInt(instance.passes);
    inputBlock[5] = BigInt(instance.type);
  }

  let startingIndex = 0;
  if (pass === 0 && slice === 0) {
    startingIndex = 2; // the first two blocks were seeded from H0
    if (dataIndependent) nextAddresses(addressBlock, inputBlock, zeroBlock);
  }

  const position = { pass, lane, slice, index: 0 };
  let currOffset = lane * instance.laneLength + slice * instance.segmentLength + startingIndex;
  let prevOffset =
    currOffset % instance.laneLength === 0
      ? currOffset + instance.laneLength - 1
      : currOffset - 1;

  for (let i = startingIndex; i < instance.segmentLength; i++, currOffset++, prevOffset++) {
    if (currOffset % instance.laneLength === 1) prevOffset = currOffset - 1;

    let pseudoRand: bigint;
    if (dataIndependent) {
      if (i % ADDRESSES_IN_BLOCK === 0) nextAddresses(addressBlock, inputBlock, zeroBlock);
      pseudoRand = addressBlock[i % ADDRESSES_IN_BLOCK];
    } else {
      pseudoRand = memory[prevOffset * BLOCK_WORDS];
    }

    let refLane = Number((pseudoRand >> 32n) % BigInt(instance.lanes));
    if (pass === 0 && slice === 0) refLane = lane;

    position.index = i;
    const refIndex = indexAlpha(instance, pass, slice, i, pseudoRand & 0xffffffffn, refLane === lane);
    const refOffset = instance.laneLength * refLane + refIndex;

    fillBlock(
      memory,
      prevOffset * BLOCK_WORDS,
      memory,
      refOffset * BLOCK_WORDS,
      memory,
      currOffset * BLOCK_WORDS,
      pass > 0,
    );
  }
}

const ARGON2_OPENSSL_NAMES: Record<number, 'ARGON2D' | 'ARGON2I' | 'ARGON2ID'> = {
  [ARGON2_D]: 'ARGON2D',
  [ARGON2_I]: 'ARGON2I',
  [ARGON2_ID]: 'ARGON2ID',
};

/** Which engine {@link argon2} would use right now (diagnostics/tests). */
export function argon2Engine(): 'openssl' | 'js' {
  return opensslReady() ? 'openssl' : 'js';
}

/**
 * RFC 9106 Argon2. Prefers the wasi OpenSSL subset once it has been
 * instantiated (M119) — it is the same code Node runs; the pure-JS fallback
 * below is byte-identical, so the swap is invisible to callers.
 */
export function argon2(params: Argon2Params): Uint8Array {
  const { type, password, salt, secret, associatedData, parallelism, tagLength, memory, passes } = params;
  if (opensslReady()) {
    const opensslName = ARGON2_OPENSSL_NAMES[type];
    if (opensslName !== undefined) {
      const viaOpenSsl = opensslArgon2(opensslName, {
        password,
        salt,
        secret,
        associatedData,
        lanes: parallelism,
        keylen: tagLength,
        memcost: memory,
        iterations: passes,
      });
      if (viaOpenSsl !== null) return viaOpenSsl;
    }
  }
  return argon2Js(params);
}

function argon2Js(params: Argon2Params): Uint8Array {
  const { type, password, salt, secret, associatedData, parallelism, tagLength, memory, passes } = params;
  const lanes = parallelism;

  // H0 = BLAKE2b-512(LE32(p) ‖ LE32(T) ‖ LE32(m) ‖ LE32(t) ‖ LE32(v) ‖ LE32(y) ‖ …)
  const h0 = blake2b(
    concat([
      le32(lanes),
      le32(tagLength),
      le32(memory),
      le32(passes),
      le32(VERSION),
      le32(type),
      le32(password.length),
      password,
      le32(salt.length),
      salt,
      le32(secret.length),
      secret,
      le32(associatedData.length),
      associatedData,
    ]),
    64,
  );

  const segmentLength = Math.max(Math.floor(memory / (SYNC_POINTS * lanes)), MIN_SEGMENT_SIZE);
  const laneLength = segmentLength * SYNC_POINTS;
  const memoryBlocks = laneLength * lanes;

  const store = new BigUint64Array(memoryBlocks * BLOCK_WORDS);

  for (let l = 0; l < lanes; l++) {
    for (let j = 0; j < 2; j++) {
      const blockBytes = hPrime(1024, concat([h0, le32(j), le32(l)]));
      bytesToBlock(blockBytes, store, (laneLength * l + j) * BLOCK_WORDS);
    }
  }

  const instance: Instance = { type, passes, memoryBlocks, laneLength, segmentLength, lanes };
  for (let pass = 0; pass < passes; pass++) {
    for (let slice = 0; slice < SYNC_POINTS; slice++) {
      for (let lane = 0; lane < lanes; lane++) {
        fillSegment(store, instance, pass, lane, slice);
      }
    }
  }

  const finalBlock = new BigUint64Array(BLOCK_WORDS);
  for (let l = 0; l < lanes; l++) {
    const offset = ((l + 1) * laneLength - 1) * BLOCK_WORDS;
    for (let i = 0; i < BLOCK_WORDS; i++) finalBlock[i] ^= store[offset + i];
  }

  return hPrime(tagLength, blockToBytes(finalBlock, 0));
}
