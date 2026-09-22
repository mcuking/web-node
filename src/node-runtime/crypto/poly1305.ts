// Poly1305 (RFC 8439 §2.5) — pure JS. One-shot over a 32-byte key.

const P = (1n << 130n) - 5n;
const MASK128 = (1n << 128n) - 1n;

function readLE(bytes: Uint8Array, offset: number, length: number): bigint {
  let value = 0n;
  for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value;
}

function writeLE(target: Uint8Array, offset: number, value: bigint, length: number): void {
  let v = value;
  for (let i = 0; i < length; i++) {
    target[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/**
 * Poly1305 MAC. The key must be 32 bytes: the low 16 form the clamped `r`, the
 * high 16 are the additive `s`. The tag is 16 bytes.
 */
export function poly1305(key: Uint8Array, message: Uint8Array): Uint8Array {
  const r = readLE(key, 0, 16) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = readLE(key, 16, 16);

  let acc = 0n;
  for (let offset = 0; offset < message.length; offset += 16) {
    const take = Math.min(16, message.length - offset);
    const block = readLE(message, offset, take) | (1n << BigInt(8 * take));
    acc = ((acc + block) * r) % P;
  }

  const out = new Uint8Array(16);
  writeLE(out, 0, (acc + s) & MASK128, 16);
  return out;
}
