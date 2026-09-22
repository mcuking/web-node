// SipHash — pure JS, matching OpenSSL's provider MAC (which is what
// `crypto.createMac('siphash')` reaches). OpenSSL defaults to SipHash-2-4 with
// a *16-byte* output, the 128-bit variant from the SipHash paper (v1 and v2 are
// folded with 0xee); an 8-byte output selects the classic 64-bit variant.

const MASK64 = (1n << 64n) - 1n;

function readLE64(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value;
}

function writeLE64(target: Uint8Array, offset: number, value: bigint): void {
  let v = value;
  for (let i = 0; i < 8; i++) {
    target[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function rotl(x: bigint, n: bigint): bigint {
  return ((x << n) | (x >> (64n - n))) & MASK64;
}

function round(v: bigint[]): void {
  v[0] = (v[0] + v[1]) & MASK64;
  v[1] = rotl(v[1], 13n);
  v[1] ^= v[0];
  v[0] = rotl(v[0], 32n);
  v[2] = (v[2] + v[3]) & MASK64;
  v[3] = rotl(v[3], 16n);
  v[3] ^= v[2];
  v[0] = (v[0] + v[3]) & MASK64;
  v[3] = rotl(v[3], 21n);
  v[3] ^= v[0];
  v[2] = (v[2] + v[1]) & MASK64;
  v[1] = rotl(v[1], 17n);
  v[1] ^= v[2];
  v[2] = rotl(v[2], 32n);
}

/**
 * SipHash-2-4. `key` must be 16 bytes; `outLen` is 8 (64-bit, `v2 ^= 0xff`) or
 * 16 (128-bit, `v1 ^= 0xee` at init and `v2 ^= 0xee` at final).
 */
export function siphash(message: Uint8Array, key: Uint8Array, outLen = 16): Uint8Array {
  const k0 = readLE64(key, 0);
  const k1 = readLE64(key, 8);
  const long = outLen === 16;

  let v0 = 0x736f6d6570736575n ^ k0;
  let v1 = 0x646f72616e646f6dn ^ k1;
  let v2 = 0x6c7967656e657261n ^ k0;
  let v3 = 0x7465646279746573n ^ k1;
  if (long) v1 ^= 0xeen;

  const v = () => [v0, v1, v2, v3];
  const set = (next: bigint[]) => {
    v0 = next[0];
    v1 = next[1];
    v2 = next[2];
    v3 = next[3];
  };

  let offset = 0;
  while (message.length - offset >= 8) {
    const m = readLE64(message, offset);
    const s = v();
    s[3] ^= m;
    round(s);
    round(s);
    s[0] ^= m;
    set(s);
    offset += 8;
  }

  // Last block: remaining bytes with the message length in the top byte.
  let b = BigInt(message.length) << 56n;
  const rem = message.length - offset;
  for (let i = 0; i < rem; i++) b |= BigInt(message[offset + i]) << BigInt(8 * i);

  {
    const s = v();
    s[3] ^= b;
    round(s);
    round(s);
    s[0] ^= b;
    if (long) s[2] ^= 0xeen;
    else s[2] ^= 0xffn;
    round(s);
    round(s);
    round(s);
    round(s);
    v0 = s[0];
    v1 = s[1];
    v2 = s[2];
    v3 = s[3];
  }

  const out = new Uint8Array(outLen);
  let hash = v0 ^ v1 ^ v2 ^ v3;
  writeLE64(out, 0, hash);
  if (long) {
    v1 ^= 0xddn;
    const s = [v0, v1, v2, v3];
    round(s);
    round(s);
    round(s);
    round(s);
    hash = s[0] ^ s[1] ^ s[2] ^ s[3];
    writeLE64(out, 8, hash);
  }
  return out;
}
