/**
 * Minimal ASN.1 DER reader/writer, enough for the key formats Node accepts and
 * emits (PKCS#1 / PKCS#8 / SPKI / SEC1) and X.509-adjacent structures.
 *
 * There is no ASN.1 library in the browser, and the whole point of this module
 * is to stay dependency-free, so this is a hand-rolled encoder/decoder over
 * `Uint8Array`. It handles the definite-length, constructed subset that keys
 * use — no indefinite lengths, no BER, no multi-byte tags (all of which keys
 * avoid).
 */

export interface DerNode {
  /** The raw identifier octet (e.g. 0x30 for SEQUENCE, 0x02 for INTEGER). */
  tag: number;
  /** The contents octets (value), excluding tag and length. */
  content: Uint8Array;
  /** Child nodes for constructed types, `null` for primitive ones. */
  children: DerNode[] | null;
}

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

function isConstructed(tag: number): boolean {
  return (tag & 0x20) !== 0;
}

function readLength(buf: Uint8Array, off: number): { length: number; next: number } {
  if (off >= buf.length) throw new Error('DER: truncated length');
  const first = buf[off];
  if (first < 0x80) return { length: first, next: off + 1 };
  const count = first & 0x7f;
  if (count === 0) throw new Error('DER: indefinite lengths are not supported');
  if (count > 4) throw new Error('DER: length too large');
  let length = 0;
  for (let i = 0; i < count; i++) {
    if (off + 1 + i >= buf.length) throw new Error('DER: truncated length');
    length = length * 256 + buf[off + 1 + i];
  }
  return { length, next: off + 1 + count };
}

function readNode(buf: Uint8Array, off: number): { node: DerNode; next: number } {
  if (off >= buf.length) throw new Error('DER: truncated tag');
  const tag = buf[off];
  const { length, next } = readLength(buf, off + 1);
  const end = next + length;
  if (end > buf.length) throw new Error('DER: truncated value');
  const content = buf.subarray(next, end);
  let children: DerNode[] | null = null;
  if (isConstructed(tag)) {
    children = [];
    let cursor = 0;
    while (cursor < content.length) {
      const child = readNode(content, cursor);
      children.push(child.node);
      cursor = child.next;
    }
  }
  return { node: { tag, content, children }, next: end };
}

/** Parse a single top-level DER value; trailing bytes are ignored. */
export function derParse(buf: Uint8Array): DerNode {
  return readNode(buf, 0).node;
}

/** Parse a sequence of DER values covering the whole buffer. */
export function derParseAll(buf: Uint8Array): DerNode[] {
  const nodes: DerNode[] = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const { node, next } = readNode(buf, cursor);
    nodes.push(node);
    cursor = next;
  }
  return nodes;
}

export function expectSeq(node: DerNode): DerNode[] {
  if (node.tag !== TAG.SEQUENCE || node.children === null) throw new Error('DER: expected SEQUENCE');
  return node.children;
}

/** DER INTEGER contents -> unsigned bigint (keys are never negative). */
export function derInt(node: DerNode): bigint {
  if (node.tag !== TAG.INTEGER) throw new Error('DER: expected INTEGER');
  return bytesToBigInt(node.content);
}

export function derOidHex(node: DerNode): string {
  if (node.tag !== TAG.OID) throw new Error('DER: expected OID');
  return toHex(node.content);
}

// --- encoding ---------------------------------------------------------------

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function derEncode(tag: number, content: Uint8Array): Uint8Array {
  const len = encodeLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function derSeq(...children: Uint8Array[]): Uint8Array {
  return derEncode(TAG.SEQUENCE, concatBytes(children));
}

export function derSet(...children: Uint8Array[]): Uint8Array {
  return derEncode(TAG.SET, concatBytes(children));
}

/** Encode an unsigned bigint as a DER INTEGER (minimal, non-negative). */
export function derIntValue(value: bigint): Uint8Array {
  return derEncode(TAG.INTEGER, bigIntToBytes(value));
}

export function derOctet(bytes: Uint8Array): Uint8Array {
  return derEncode(TAG.OCTET_STRING, bytes);
}

export function derBitString(bytes: Uint8Array): Uint8Array {
  return derEncode(TAG.BIT_STRING, concatBytes([Uint8Array.of(0), bytes]));
}

export function derNull(): Uint8Array {
  return Uint8Array.of(TAG.NULL, 0x00);
}

/** OID from its dotted decimal form (e.g. "1.2.840.113549.1.1.1"). */
export function derOid(dotted: string): Uint8Array {
  return derEncode(TAG.OID, oidToBytes(dotted));
}

// --- bigint helpers ---------------------------------------------------------

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const b of bytes) out = (out << 8n) | BigInt(b);
  return out;
}

/** Minimal big-endian bytes for a non-negative bigint (0 -> [0]). */
export function bigIntToBytes(value: bigint, length?: number): Uint8Array {
  if (value < 0n) throw new Error('bigIntToBytes: negative value');
  const bytes: number[] = [];
  let n = value;
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  if (bytes.length === 0) bytes.push(0);
  // DER INTEGER is signed: prepend 0x00 when the high bit is set.
  if ((bytes[0] & 0x80) !== 0) bytes.unshift(0);
  if (length !== undefined) {
    if (bytes.length > length) {
      // Trim a leading zero pad added for sign, if it fits.
      while (bytes.length > length && bytes[0] === 0) bytes.shift();
    }
    while (bytes.length < length) bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

// --- hex --------------------------------------------------------------------

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : '0' + hex;
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// --- OID --------------------------------------------------------------------

function oidToBytes(dotted: string): Uint8Array {
  const parts = dotted.split('.').map((p) => Number(p));
  const first = 40 * parts[0] + parts[1];
  const bytes: number[] = [first];
  for (let i = 2; i < parts.length; i++) {
    let value = parts[i];
    const chunk: number[] = [value & 0x7f];
    value = Math.floor(value / 128);
    while (value > 0) {
      chunk.unshift((value & 0x7f) | 0x80);
      value = Math.floor(value / 128);
    }
    bytes.push(...chunk);
  }
  return Uint8Array.from(bytes);
}

// --- PEM --------------------------------------------------------------------

export interface PemBlock {
  label: string;
  der: Uint8Array;
}

const PEM_RE = /-----BEGIN ([^-]+)-----([\s\S]*?)-----END \1-----/;

/** Decode the first PEM block in `text`, or `null` when there is none. */
export function pemDecode(text: string): PemBlock | null {
  const match = PEM_RE.exec(text);
  if (!match) return null;
  const label = match[1].trim();
  const body = match[2].replace(/[\s\r\n]+/g, '');
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return { label, der };
}

export function pemEncode(label: string, der: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...der));
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) lines.push(base64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}
