import type { BindingFactory } from './context';

/**
 * `buffer` binding.
 *
 * The real `lib/buffer.js` + `lib/internal/buffer.js` are vendored on top of
 * this binding, so it has to provide the byte-level primitives Node keeps in
 * `src/node_buffer.cc` and `src/string_bytes.cc`: the per-encoding
 * slice/write codecs, `indexOf`, `compare`/`compareOffset`, `copy`, `fill`,
 * the byte swaps, and the unsafe-allocation helpers `internal/buffer.js` uses
 * to build the pool.
 *
 * Semantics are ported from those two C++ files and checked byte-for-byte
 * against the real Node build (see test/buffer.test.ts).
 */

// `buffer.kStringMaxLength` / `buffer.kMaxLength` on a 64-bit build.
const kMaxLength = Number.MAX_SAFE_INTEGER;
const kStringMaxLength = 536870888;

const kBase64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const kBase64Url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });
const UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

/** `StringBytes::Encode(..., ASCII)` masks every byte with 0x7f (ForceAscii). */
function forceAscii(code: number): number {
  return code & 0x7f;
}

function asBytes(view: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (ArrayBuffer.isView(view)) {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(view as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Slices: bytes -> string, one per encoding.
// ---------------------------------------------------------------------------

function sliceAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(forceAscii(bytes[i]));
  return out;
}

function sliceLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function sliceHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  }
  return out;
}

function sliceUcs2(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  }
  return out;
}

function sliceUtf8(bytes: Uint8Array): string {
  // V8's decoder keeps a leading BOM and substitutes U+FFFD for bad sequences,
  // which is exactly what WHATWG TextDecoder does with `ignoreBOM: true`.
  return UTF8_DECODER.decode(bytes);
}

function sliceBase64(bytes: Uint8Array, url: boolean): string {
  return encodeBase64(bytes, url);
}

function encodeBase64(bytes: Uint8Array, url: boolean): string {
  const alphabet = url ? kBase64Url : kBase64;
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      alphabet[(n >> 18) & 63] +
      alphabet[(n >> 12) & 63] +
      alphabet[(n >> 6) & 63] +
      alphabet[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    if (!url) out += '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63];
    if (!url) out += '=';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writes: (buf, string, offset, length) -> bytes written.
// ---------------------------------------------------------------------------

function keepInRange(offset: number, length: number, bufLength: number): [number, number] {
  const maxLength = offset < bufLength ? bufLength - offset : 0;
  let len = length;
  if (len === 0) len = maxLength;
  else if (len > maxLength) len = maxLength;
  return [offset, len];
}

function writeAscii(buf: Uint8Array, str: string, offset: number, length: number): number {
  // ASCII and LATIN1 share `StringBytes::Write`: each code unit is truncated to
  // 8 bits (asymmetrically, decode masks 0x7f).
  const n = Math.min(length, str.length);
  for (let i = 0; i < n; i++) buf[offset + i] = str.charCodeAt(i) & 0xff;
  return n;
}

/** UTF-8 encode, stopping before a character boundary if it would not fit. */
function utf8BytesTruncated(str: string, maxLen: number): Uint8Array {
  if (maxLen <= 0) return new Uint8Array(0);
  const out: number[] = [];
  let written = 0;
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    let size: number;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
        size = 4;
      } else {
        code = 0xfffd; // lone high surrogate -> replacement char
        size = 3;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd; // lone low surrogate
      size = 3;
    } else if (code < 0x80) {
      size = 1;
    } else if (code < 0x800) {
      size = 2;
    } else {
      size = 3;
    }
    if (written + size > maxLen) break;
    if (size === 1) {
      out.push(code);
    } else if (size === 2) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (size === 3) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
    written += size;
  }
  return Uint8Array.from(out);
}

function writeUtf8(buf: Uint8Array, str: string, offset: number, length: number): number {
  const bytes = utf8BytesTruncated(str, length);
  buf.set(bytes, offset);
  return bytes.length;
}

function writeUcs2(buf: Uint8Array, str: string, offset: number, length: number): number {
  const n = Math.min(Math.floor(length / 2), str.length);
  for (let i = 0; i < n; i++) {
    const code = str.charCodeAt(i);
    buf[offset + 2 * i] = code & 0xff;
    buf[offset + 2 * i + 1] = (code >> 8) & 0xff;
  }
  return n * 2;
}

function unhex(code: number): number {
  const c = code & 0xff;
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

function writeHex(buf: Uint8Array, str: string, offset: number, length: number): number {
  // `nbytes::HexDecode`: pairs of hex digits, stops at the first bad char.
  let i = 0;
  for (; i < length && i * 2 + 1 < str.length; i++) {
    const a = unhex(str.charCodeAt(i * 2));
    const b = unhex(str.charCodeAt(i * 2 + 1));
    if (a < 0 || b < 0) return i;
    buf[offset + i] = (a << 4) | b;
  }
  return i;
}

/**
 * WHATWG forgiving-base64 decode (`nbytes::Base64Decode`): characters outside
 * the alphabet are skipped until `=` or the end of input.
 */
function decodeBase64(str: string, url: boolean): Uint8Array {
  const alphabet = url ? kBase64Url : kBase64;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '=') break;
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    acc = (acc << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function writeBase64(
  buf: Uint8Array,
  str: string,
  offset: number,
  length: number,
  url: boolean,
): number {
  const decoded = decodeBase64(str, url);
  const n = Math.min(decoded.length, length);
  buf.set(decoded.subarray(0, n), offset);
  return n;
}

// ---------------------------------------------------------------------------
// Search.
// ---------------------------------------------------------------------------

/** `IndexOfOffset` (src/node_buffer.cc): resolve a possibly-negative offset. */
function indexOfOffset(length: number, offset: number, needleLength: number, forward: boolean): number {
  if (offset < 0) {
    if (offset + length >= 0) return length + offset;
    if (forward || needleLength === 0) return 0;
    return -1;
  }
  if (offset + needleLength <= length) return offset;
  if (needleLength === 0) return length;
  if (forward) return -1;
  return length - 1;
}

/** `nbytes::SearchString` over bytes (Uint16 code units share the algorithm). */
function searchBytes(haystack: Uint8Array, needle: Uint8Array, start: number, forward: boolean): number {
  return searchUnits(haystack, needle, start, forward);
}

/**
 * Numeric encoding codes the `string_decoder` binding registers; `lib/buffer.js`
 * passes these (via `encodingsMap`) to the indexOf functions.
 */
const ENC_ASCII = 0;
const ENC_UCS2 = 4;
const ENC_LATIN1 = 7;

function encodeNeedleForSearch(str: string, encoding: number): Uint8Array {
  if (encoding === ENC_UCS2) {
    const out = new Uint8Array(str.length * 2);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      out[2 * i] = code & 0xff;
      out[2 * i + 1] = (code >> 8) & 0xff;
    }
    return out;
  }
  if (encoding === ENC_LATIN1 || encoding === ENC_ASCII) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }
  return UTF8_ENCODER.encode(str);
}

function indexOfString(
  buf: Uint8Array,
  val: string,
  byteOffset: number,
  encoding: number,
  forward: boolean,
  end: number,
): number {
  const isUcs2 = encoding === ENC_UCS2;
  let searchEnd = Math.min(Math.max(end, 0), isUcs2 ? buf.length & ~1 : buf.length);
  if (isUcs2) searchEnd &= ~1;
  const needle = encodeNeedleForSearch(val, encoding);
  return runSearch(buf, needle, byteOffset, isUcs2, forward, searchEnd);
}

function indexOfBytes(
  buf: Uint8Array,
  needle: Uint8Array,
  byteOffset: number,
  encoding: number,
  forward: boolean,
  end: number,
): number {
  const isUcs2 = encoding === ENC_UCS2;
  let searchEnd = Math.min(Math.max(end, 0), isUcs2 ? buf.length & ~1 : buf.length);
  if (isUcs2) searchEnd &= ~1;
  return runSearch(buf, needle, byteOffset, isUcs2, forward, searchEnd);
}

/**
 * Shared body of `IndexOfString`/`IndexOfBuffer` (src/node_buffer.cc): resolve
 * the start offset, clamp it into the `[0, searchEnd)` window and search.
 */
function runSearch(
  buf: Uint8Array,
  needle: Uint8Array,
  byteOffset: number,
  isUcs2: boolean,
  forward: boolean,
  searchEnd: number,
): number {
  const haystackLength = isUcs2 ? buf.length & ~1 : buf.length;
  const needleLength = needle.length;
  const optOffset = indexOfOffset(haystackLength, byteOffset, needleLength, forward);
  if (needleLength === 0) return Math.min(optOffset, searchEnd);
  if (haystackLength === 0) return -1;
  if (optOffset <= -1) return -1;

  let offset = optOffset;
  if (!forward && offset >= searchEnd) {
    if (searchEnd === 0) return -1;
    offset = searchEnd - 1;
  } else if (forward && offset >= searchEnd) {
    return -1;
  }
  if ((forward && needleLength + offset > searchEnd) || needleLength > searchEnd) return -1;

  if (isUcs2) {
    if (searchEnd < 2 || needleLength < 2) return -1;
    const hayUnits = new Uint16Array(searchEnd >> 1);
    for (let i = 0; i < hayUnits.length; i++) hayUnits[i] = buf[2 * i] | (buf[2 * i + 1] << 8);
    const needleUnits = new Uint16Array(needleLength >> 1);
    for (let i = 0; i < needleUnits.length; i++) {
      needleUnits[i] = needle[2 * i] | (needle[2 * i + 1] << 8);
    }
    const result = searchUnits(hayUnits, needleUnits, offset >> 1, forward);
    const byteResult = result * 2;
    return byteResult >= searchEnd ? -1 : byteResult;
  }

  const result = searchBytes(
    new Uint8Array(buf.buffer, buf.byteOffset, searchEnd),
    needle,
    offset,
    forward,
  );
  return result >= searchEnd ? -1 : result;
}

function searchUnits<T extends Uint8Array | Uint16Array>(
  haystack: T,
  needle: T,
  start: number,
  forward: boolean,
): number {
  const haystackLength = haystack.length;
  const needleLength = needle.length;
  if (haystackLength < needleLength) return haystackLength;
  const matches = (i: number): boolean => {
    for (let j = 0; j < needleLength; j++) if (haystack[i + j] !== needle[j]) return false;
    return true;
  };
  if (forward) {
    for (let i = start; i + needleLength <= haystackLength; i++) if (matches(i)) return i;
    return haystackLength;
  }
  const last = Math.min(start, haystackLength - needleLength);
  for (let i = last; i >= 0; i--) if (matches(i)) return i;
  return haystackLength;
}

function indexOfNumber(
  buf: Uint8Array,
  needle: number,
  byteOffset: number,
  forward: boolean,
  end: number,
): number {
  const bufferLength = buf.length;
  const optOffset = indexOfOffset(bufferLength, byteOffset, 1, forward);
  if (optOffset <= -1 || bufferLength === 0) return -1;
  const offset = optOffset;
  const searchEnd = Math.min(Math.max(end, 0), bufferLength);
  if (forward) {
    if (offset >= searchEnd) return -1;
    for (let i = offset; i < searchEnd; i++) if (buf[i] === needle) return i;
    return -1;
  }
  const backwardEnd = Math.min(offset + 1, searchEnd);
  if (backwardEnd === 0) return -1;
  for (let i = backwardEnd - 1; i >= 0; i--) if (buf[i] === needle) return i;
  return -1;
}

// ---------------------------------------------------------------------------
// Compare / copy / fill / swap.
// ---------------------------------------------------------------------------

function normalizeCompareVal(val: number, aLength: number, bLength: number): number {
  if (val > 0) return 1;
  if (val < 0) return -1;
  if (aLength === bLength) return 0;
  return aLength < bLength ? -1 : 1;
}

function byteCompare(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function compareOffset(
  source: Uint8Array,
  target: Uint8Array,
  targetStart: number,
  sourceStart: number,
  targetEnd: number,
  sourceEnd: number,
): number {
  const sourceLength = source.length;
  const targetLength = target.length;
  if (sourceStart > sourceLength || targetStart > targetLength) return 0;
  const toCmp = Math.min(
    Math.min(sourceEnd - sourceStart, targetEnd - targetStart),
    sourceLength - sourceStart,
  );
  let val = 0;
  if (toCmp > 0) {
    for (let i = 0; i < toCmp; i++) {
      if (source[sourceStart + i] !== target[targetStart + i]) {
        val = source[sourceStart + i] < target[targetStart + i] ? -1 : 1;
        break;
      }
    }
  }
  return normalizeCompareVal(val, sourceEnd - sourceStart, targetEnd - targetStart);
}

function copyBytes(
  source: Uint8Array,
  target: Uint8Array,
  targetStart: number,
  sourceStart: number,
  nb: number,
): number {
  const targetLength = target.length;
  const sourceLength = source.length;
  if (targetStart >= targetLength || sourceStart >= sourceLength) return 0;
  let sourceEnd = sourceStart + nb;
  let targetEnd = targetStart + nb;
  if (sourceEnd > sourceLength) sourceEnd = sourceLength;
  if (targetEnd > targetLength) targetEnd = targetLength;
  const toCopy = Math.min(targetEnd - targetStart, sourceEnd - sourceStart);
  target.set(source.subarray(sourceStart, sourceStart + toCopy), targetStart);
  return toCopy;
}

function parseEncoding(encoding: string | undefined): string {
  if (encoding === undefined) return 'utf8';
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return 'utf8';
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return 'ucs2';
    case 'latin1':
    case 'binary':
      return 'latin1';
    case 'ascii':
      return 'ascii';
    case 'base64':
      return 'base64';
    case 'base64url':
      return 'base64url';
    case 'hex':
      return 'hex';
    default:
      return 'utf8';
  }
}

/** `bindingFill`: undefined on success, -1 invalid value, -2 out of bounds. */
function fillBuffer(
  buf: Uint8Array,
  value: Uint8Array | string,
  start: number,
  end: number,
  encoding: string | undefined,
): number | undefined {
  const bufLength = buf.length;
  const fillLength = end - start;
  if (start > end || fillLength + start > bufLength) return -2;

  let strLength: number;
  if (typeof value !== 'string') {
    strLength = value.length;
    buf.set(value.subarray(0, Math.min(strLength, fillLength)), start);
  } else {
    const enc = parseEncoding(encoding);
    if (enc === 'utf8') {
      const bytes = UTF8_ENCODER.encode(value);
      strLength = bytes.length;
      buf.set(bytes.subarray(0, Math.min(strLength, fillLength)), start);
    } else if (enc === 'ucs2') {
      const bytes = new Uint8Array(value.length * 2);
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        bytes[2 * i] = code & 0xff;
        bytes[2 * i + 1] = (code >> 8) & 0xff;
      }
      strLength = bytes.length;
      buf.set(bytes.subarray(0, Math.min(strLength, fillLength)), start);
    } else if (enc === 'hex') {
      strLength = writeHex(buf, value, start, fillLength);
    } else if (enc === 'base64') {
      strLength = writeBase64(buf, value, start, fillLength, false);
    } else if (enc === 'base64url') {
      strLength = writeBase64(buf, value, start, fillLength, true);
    } else {
      strLength = writeAscii(buf, value, start, fillLength);
    }
  }

  // `base_fill`: tile the written prefix across the range.
  if (strLength >= fillLength) return undefined;
  if (strLength === 0) return -1;
  let inThere = strLength;
  let ptr = start + strLength;
  while (inThere < fillLength - inThere) {
    buf.copyWithin(ptr, start, start + inThere);
    ptr += inThere;
    inThere *= 2;
  }
  if (inThere < fillLength) {
    buf.copyWithin(ptr, start, start + (fillLength - inThere));
  }
  return undefined;
}

function swapBytes(buf: Uint8Array, size: number): void {
  for (let i = 0; i + size <= buf.length; i += size) {
    for (let a = 0, b = size - 1; a < b; a++, b--) {
      const tmp = buf[i + a];
      buf[i + a] = buf[i + b];
      buf[i + b] = tmp;
    }
  }
}

export const bufferBinding: BindingFactory = () => ({
  kMaxLength,
  kStringMaxLength,

  byteLengthUtf8: (str: string): number => UTF8_ENCODER.encode(str).length,

  atob: (input: string): string | number => {
    // `src/node_buffer.cc` Atob: -2 illegal character, -1 bad length.
    let cleaned = '';
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      if (c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20) continue;
      cleaned += input[i];
    }
    if (/[^A-Za-z0-9+/=]/.test(cleaned)) return -2;
    if (/=/.test(cleaned) && !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) return -2;
    const n = cleaned.replace(/=+$/, '').length;
    if (n % 4 === 1) return -1;
    try {
      return atob(cleaned);
    } catch {
      return -2;
    }
  },
  btoa: (input: string): string | number => {
    for (let i = 0; i < input.length; i++) {
      if (input.charCodeAt(i) > 0xff) return -1;
    }
    return btoa(input);
  },

  copyArrayBuffer: (
    destination: ArrayBuffer,
    destinationOffset: number,
    source: ArrayBuffer,
    sourceOffset: number,
    byteCount: number,
  ): void => {
    if (destination === source) return;
    new Uint8Array(destination, destinationOffset, byteCount).set(
      new Uint8Array(source, sourceOffset, byteCount),
    );
  },

  isAscii: (buf: Uint8Array): boolean => {
    for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) return false;
    return true;
  },
  isUtf8: (buf: Uint8Array): boolean => {
    try {
      UTF8_FATAL_DECODER.decode(buf);
      return true;
    } catch {
      return false;
    }
  },

  compare: (a: ArrayBufferView | ArrayBuffer, b: ArrayBufferView | ArrayBuffer): number =>
    byteCompare(asBytes(a), asBytes(b)),
  compareOffset: (
    source: ArrayBufferView | ArrayBuffer,
    target: ArrayBufferView | ArrayBuffer,
    targetStart: number,
    sourceStart: number,
    targetEnd: number,
    sourceEnd: number,
  ): number =>
    compareOffset(
      asBytes(source),
      asBytes(target),
      targetStart,
      sourceStart,
      targetEnd,
      sourceEnd,
    ),
  copy: (
    source: ArrayBufferView | ArrayBuffer,
    target: ArrayBufferView | ArrayBuffer,
    targetStart: number,
    sourceStart: number,
    nb: number,
  ): number => copyBytes(asBytes(source), asBytes(target), targetStart, sourceStart, nb),
  fill: (
    buf: Uint8Array,
    value: Uint8Array | string,
    start: number,
    end: number,
    encoding: string | undefined,
  ): number | undefined => fillBuffer(buf, value, start, end, encoding),

  indexOfString,
  indexOfNumber,
  indexOfBuffer: indexOfBytes,

  swap16: (buf: Uint8Array): void => swapBytes(buf, 2),
  swap32: (buf: Uint8Array): void => swapBytes(buf, 4),
  swap64: (buf: Uint8Array): void => swapBytes(buf, 8),

  // (buf, start, end) codecs.
  asciiSlice: (buf: Uint8Array, start = 0, end = buf.length): string =>
    sliceAscii(view(buf, start, end)),
  latin1Slice: (buf: Uint8Array, start = 0, end = buf.length): string =>
    sliceLatin1(view(buf, start, end)),
  hexSlice: (buf: Uint8Array, start = 0, end = buf.length): string =>
    sliceHex(view(buf, start, end)),
  ucs2Slice: (buf: Uint8Array, start = 0, end = buf.length): string =>
    sliceUcs2(view(buf, start, end)),
  utf8Slice: (buf: Uint8Array, start = 0, end = buf.length): string =>
    sliceUtf8(view(buf, start, end)),
  base64Slice: (buf: Uint8Array, start = 0, end = buf.length): string =>
    sliceBase64(view(buf, start, end), false),
  base64urlSlice: (buf: Uint8Array, start = 0, end = buf.length): string =>
    sliceBase64(view(buf, start, end), true),

  // (buf, string, offset, length) writes.
  asciiWriteStatic: (buf: Uint8Array, str: string, offset: number, length: number): number =>
    writeAscii(buf, str, ...keepInRange(offset, length, buf.length)),
  latin1WriteStatic: (buf: Uint8Array, str: string, offset: number, length: number): number =>
    writeAscii(buf, str, ...keepInRange(offset, length, buf.length)),
  utf8WriteStatic: (buf: Uint8Array, str: string, offset: number, length: number): number =>
    writeUtf8(buf, str, ...keepInRange(offset, length, buf.length)),
  ucs2Write: (buf: Uint8Array, str: string, offset: number, length: number): number =>
    writeUcs2(buf, str, ...keepInRange(offset, length, buf.length)),
  hexWrite: (buf: Uint8Array, str: string, offset: number, length: number): number =>
    writeHex(buf, str, ...keepInRange(offset, length, buf.length)),
  base64Write: (buf: Uint8Array, str: string, offset: number, length: number): number =>
    writeBase64(buf, str, ...keepInRange(offset, length, buf.length), false),
  base64urlWrite: (buf: Uint8Array, str: string, offset: number, length: number): number =>
    writeBase64(buf, str, ...keepInRange(offset, length, buf.length), true),

  // `internal/buffer.js` unsafe-allocation helpers.
  setDetachKey: (): void => {
    /* ArrayBuffer detach keys are a V8 embedding feature we cannot reproduce. */
  },
  arrayBufferAlignedOffset: (): number => 0,
  createUnsafeArrayBuffer: (size: number): ArrayBuffer => new ArrayBuffer(size),
});

/** Clamp `[start, end)` to the buffer and return the sub-view the codecs read. */
function view(buf: Uint8Array, start: number, end: number): Uint8Array {
  const s = Math.min(Math.max(start, 0), buf.length);
  const e = Math.min(Math.max(end, 0), buf.length);
  if (e <= s) return new Uint8Array(0);
  return new Uint8Array(buf.buffer, buf.byteOffset + s, e - s);
}
