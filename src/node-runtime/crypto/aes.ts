/**
 * The AES block cipher (FIPS-197): GF(2^8) arithmetic, the S-box, the key
 * expansion and the round transforms. Extracted from `cipher.ts` so that the
 * CCM implementation (`ccm.ts`) can share the same core without a cycle.
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

export class AesKey {
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

