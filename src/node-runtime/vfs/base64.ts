/**
 * Minimal base64 — no Buffer, no atob — so the VFS layer stays dependency-free
 * and works identically in the browser worker and under Node.
 *
 * File contents in a snapshot must survive as *bytes*: a wasm binary or any
 * non-UTF-8 payload would be silently mangled (and inflated) by a UTF-8
 * round-trip, which is exactly the corruption this module exists to prevent.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

export function decodeBase64(text: string): Uint8Array {
  let clean = text.length;
  while (clean > 0 && text.charCodeAt(clean - 1) === 61 /* '=' */) clean--;
  const size = Math.floor((clean * 3) / 4);
  const out = new Uint8Array(size);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean; i++) {
    const v = LOOKUP[text.charCodeAt(i)];
    if (v < 0) continue; // skip whitespace / padding noise
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return o === size ? out : out.subarray(0, o);
}
