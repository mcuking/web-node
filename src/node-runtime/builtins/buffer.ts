import type { BuiltinSpec, BuiltinInitContext } from './types';

/**
 * `buffer` builtin — Buffer as a genuine Uint8Array subclass.
 *
 * This is our own implementation (roadmap: vendor lib/internal/buffer.js once
 * the internal/errors + internal/validators + util/types shim layer grows).
 * `slice`/`subarray` and `from(arrayBuffer)` alias the backing store, as in
 * Node; `from(string|Buffer|TypedArray)` copies.
 */
const MAX_LENGTH = 0x7fffffff;

function isAnyArrayBuffer(v: unknown): boolean {
  return v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer);
}

function fromString(str: string, encoding: string): Uint8Array {
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return new TextEncoder().encode(str);
    case 'ascii':
    case 'latin1':
    case 'binary': {
      const out = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
      return out;
    }
    case 'base64':
    case 'base64url': {
      const normalized = str
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .replace(/[^A-Za-z0-9+/=]/g, '');
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
      const bin = atob(padded);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    case 'hex': {
      const clean = str.length % 2 === 0 ? str : str.slice(0, str.length - 1);
      if (!/^[0-9a-fA-F]*$/.test(clean)) throw new TypeError('Invalid hex string');
      const out = new Uint8Array(clean.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
      return out;
    }
    case 'utf16le':
    case 'utf-16le':
    case 'ucs2':
    case 'ucs-2': {
      const out = new Uint8Array(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        out[i * 2] = code & 0xff;
        out[i * 2 + 1] = code >> 8;
      }
      return out;
    }
    default:
      throw new TypeError(`Unknown encoding: ${encoding}`);
  }
}

function hexSliceFn(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let s = '';
  for (let i = start; i < end; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function toStringFn(bytes: Uint8Array, encoding = 'utf8', start = 0, end = bytes.length): string {
  const slice = bytes.subarray(start, end);
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return new TextDecoder('utf-8').decode(slice);
    case 'ascii':
    case 'latin1':
    case 'binary': {
      let s = '';
      for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]);
      return s;
    }
    case 'base64':
    case 'base64url': {
      let bin = '';
      for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]);
      const b64 = btoa(bin);
      return encoding === 'base64url' ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
    }
    case 'hex': {
      let s = '';
      for (let i = 0; i < slice.length; i++) s += slice[i].toString(16).padStart(2, '0');
      return s;
    }
    case 'utf16le':
    case 'utf-16le':
    case 'ucs2':
    case 'ucs-2': {
      let s = '';
      for (let i = 0; i + 1 < slice.length; i += 2) s += String.fromCharCode(slice[i] | (slice[i + 1] << 8));
      return s;
    }
    default:
      throw new TypeError(`Unknown encoding: ${encoding}`);
  }
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, offset: number): number {
  if (needle.length === 0) return Math.min(Math.max(0, offset), haystack.length);
  for (let i = Math.max(0, offset); i <= haystack.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function lastIndexOfBytes(haystack: Uint8Array, needle: Uint8Array, offset: number): number {
  for (let i = Math.min(offset, haystack.length - needle.length); i >= 0; i--) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

export const bufferSpec: BuiltinSpec = {
  id: 'buffer',
  aliases: ['node:buffer'],
  origin: 'web-node',
  init: (ctx: BuiltinInitContext) => {
    const customInspectSymbol = (ctx.require('internal/util') as { customInspectSymbol: symbol })
      .customInspectSymbol;
    const utilBinding = ctx.internalBinding('util') as {
      constants: { ALL_PROPERTIES: number; ONLY_ENUMERABLE: number };
      getOwnNonIndexProperties: (obj: object, filter?: number) => (string | symbol)[];
    };

    class Buffer extends Uint8Array {
      static poolSize = 8192;

      static #copyFrom(bytes: Uint8Array): Buffer {
        const out = new Buffer(bytes.byteLength);
        out.set(bytes);
        return out;
      }

      // A Buffer that aliases `bytes`' memory. Node's slice/subarray and
      // from(ArrayBuffer) all return views, so writes on either side are seen
      // by the other.
      static #viewOver(bytes: Uint8Array): Buffer {
        return new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
      }

      static from(value: unknown, encodingOrOffset?: unknown, length?: unknown): Buffer {
        if (typeof value === 'string') {
          return Buffer.#copyFrom(fromString(value, typeof encodingOrOffset === 'string' ? encodingOrOffset : 'utf8'));
        }
        if (isAnyArrayBuffer(value)) {
          const offset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
          const len = typeof length === 'number' ? length : (value as ArrayBuffer).byteLength - offset;
          // Node shares the ArrayBuffer here rather than copying it.
          return new Buffer(value as ArrayBuffer, offset, len);
        }
        if (ArrayBuffer.isView(value) || Array.isArray(value)) {
          return Buffer.#copyFrom(Uint8Array.from(value as ArrayLike<number>));
        }
        if (value !== null && typeof value === 'object' && typeof (value as { length?: number }).length === 'number') {
          return Buffer.#copyFrom(Uint8Array.from(Array.from(value as ArrayLike<number>)));
        }
        throw new TypeError(
          'The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array',
        );
      }

      static alloc(size: number, fill?: unknown, encoding?: string): Buffer {
        const buf = new Buffer(size);
        if (fill !== undefined) buf.fill(fill as never, 0, size, encoding);
        return buf;
      }

      static allocUnsafe(size: number): Buffer {
        return new Buffer(size);
      }

      static allocUnsafeSlow(size: number): Buffer {
        return new Buffer(size);
      }

      static isBuffer(v: unknown): v is Buffer {
        return v instanceof Buffer;
      }

      static isEncoding(enc: unknown): boolean {
        return (
          typeof enc === 'string' &&
          ['utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'utf16le', 'ucs2'].includes(
            enc.toLowerCase(),
          )
        );
      }

      static byteLength(str: string | ArrayBufferView | ArrayBuffer, encoding = 'utf8'): number {
        if (typeof str === 'string') return fromString(str, encoding).byteLength;
        if (ArrayBuffer.isView(str)) return str.byteLength;
        if (isAnyArrayBuffer(str)) return (str as ArrayBuffer).byteLength;
        throw new TypeError('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array');
      }

      static concat(list: readonly Uint8Array[], totalLength?: number): Buffer {
        if (!Array.isArray(list)) throw new TypeError('The "list" argument must be an instance of Array');
        const total = totalLength ?? list.reduce((n, b) => n + b.length, 0);
        const out = new Buffer(total);
        let offset = 0;
        for (const b of list) {
          if (offset + b.length > total) {
            out.set(b.subarray(0, total - offset), offset);
            break;
          }
          out.set(b, offset);
          offset += b.length;
        }
        return out;
      }

      static compare(a: Uint8Array, b: Uint8Array): number {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
          if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
        }
        if (a.length === b.length) return 0;
        return a.length < b.length ? -1 : 1;
      }

      toString(encodingOrOpts?: string | { encoding?: string; start?: number; end?: number }, start?: number, end?: number): string {
        let enc = 'utf8';
        let s = 0;
        let e = this.length;
        if (typeof encodingOrOpts === 'string') {
          enc = encodingOrOpts;
          s = start ?? 0;
          e = end ?? this.length;
        } else if (encodingOrOpts && typeof encodingOrOpts === 'object') {
          enc = encodingOrOpts.encoding ?? 'utf8';
          s = encodingOrOpts.start ?? 0;
          e = encodingOrOpts.end ?? this.length;
        }
        return toStringFn(this, enc, s, e);
      }

      toJSON(): { type: 'Buffer'; data: number[] } {
        return { type: 'Buffer', data: Array.from(this) };
      }

      // Hex dump of a byte range. The vendored `internal/util/inspect.js`
      // reaches for this to render `[Uint8Contents]` for ArrayBuffers.
      hexSlice(start = 0, end = this.length): string {
        return hexSliceFn(this, start, end);
      }

      equals(other: Uint8Array): boolean {
        return Buffer.compare(this, other) === 0;
      }

      compare(other: Uint8Array): number {
        return Buffer.compare(this, other);
      }

      copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
        const count = Math.min(sourceEnd - sourceStart, target.length - targetStart, this.length - sourceStart);
        target.set(this.subarray(sourceStart, sourceStart + count), targetStart);
        return count;
      }

      write(string: string, offset = 0, length?: number | string, encoding = 'utf8'): number {
        let len = length;
        let enc = encoding;
        if (typeof len === 'string') {
          enc = len;
          len = undefined;
        }
        const bytes = fromString(string, enc);
        const n = Math.min(len ?? this.length - offset, bytes.length, this.length - offset);
        this.set(bytes.subarray(0, n), offset);
        return n;
      }

      fill(value: number | string | Uint8Array, offset = 0, end = this.length, encoding = 'utf8'): this {
        if (typeof value === 'string') {
          const bytes = fromString(value, encoding);
          for (let i = offset; i < end; i++) this[i] = bytes[(i - offset) % bytes.length];
        } else if (typeof value === 'number') {
          Uint8Array.prototype.fill.call(this, value & 0xff, offset, end);
        } else {
          for (let i = offset; i < end; i++) this[i] = value[(i - offset) % value.length];
        }
        return this;
      }

      indexOf(value: string | number | Uint8Array, byteOffset = 0, encoding = 'utf8'): number {
        const needle =
          typeof value === 'number'
            ? Uint8Array.of(value & 0xff)
            : typeof value === 'string'
              ? fromString(value, encoding)
              : value;
        return indexOfBytes(this, needle, byteOffset);
      }

      lastIndexOf(value: string | number | Uint8Array, byteOffset = this.length, encoding = 'utf8'): number {
        const needle =
          typeof value === 'number'
            ? Uint8Array.of(value & 0xff)
            : typeof value === 'string'
              ? fromString(value, encoding)
              : value;
        return lastIndexOfBytes(this, needle, byteOffset);
      }

      includes(value: string | number | Uint8Array, byteOffset = 0, encoding = 'utf8'): boolean {
        return this.indexOf(value, byteOffset, encoding) !== -1;
      }

      slice(start?: number, end?: number): Buffer {
        return Buffer.#viewOver(Uint8Array.prototype.subarray.call(this, start, end) as Uint8Array);
      }

      subarray(start?: number, end?: number): Buffer {
        return Buffer.#viewOver(Uint8Array.prototype.subarray.call(this, start, end) as Uint8Array);
      }

      readUInt8(offset = 0): number {
        return this[offset];
      }
      readUInt16LE(offset = 0): number {
        return this[offset] | (this[offset + 1] << 8);
      }
      readUInt16BE(offset = 0): number {
        return (this[offset] << 8) | this[offset + 1];
      }
      readUInt32LE(offset = 0): number {
        return (this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] * 0x1000000)) >>> 0;
      }
      readUInt32BE(offset = 0): number {
        return (this[offset] * 0x1000000 + ((this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3])) >>> 0;
      }
      readInt8(offset = 0): number {
        return (this[offset] << 24) >> 24;
      }
      readInt16LE(offset = 0): number {
        return ((this[offset] | (this[offset + 1] << 8)) << 16) >> 16;
      }
      readInt16BE(offset = 0): number {
        return (((this[offset] << 8) | this[offset + 1]) << 16) >> 16;
      }
      readInt32LE(offset = 0): number {
        return this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24);
      }
      readInt32BE(offset = 0): number {
        return (this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3];
      }
      readBigInt64LE(offset = 0): bigint {
        return new DataView(this.buffer, this.byteOffset + offset, 8).getBigInt64(0, true);
      }
      readBigUInt64LE(offset = 0): bigint {
        return new DataView(this.buffer, this.byteOffset + offset, 8).getBigUint64(0, true);
      }
      readFloatLE(offset = 0): number {
        return new DataView(this.buffer, this.byteOffset + offset, 4).getFloat32(0, true);
      }
      readFloatBE(offset = 0): number {
        return new DataView(this.buffer, this.byteOffset + offset, 4).getFloat32(0, false);
      }
      readDoubleLE(offset = 0): number {
        return new DataView(this.buffer, this.byteOffset + offset, 8).getFloat64(0, true);
      }
      readDoubleBE(offset = 0): number {
        return new DataView(this.buffer, this.byteOffset + offset, 8).getFloat64(0, false);
      }

      writeUInt8(value: number, offset = 0): number {
        this[offset] = value & 0xff;
        return offset + 1;
      }
      writeUInt16LE(value: number, offset = 0): number {
        this[offset] = value & 0xff;
        this[offset + 1] = (value >>> 8) & 0xff;
        return offset + 2;
      }
      writeUInt16BE(value: number, offset = 0): number {
        this[offset] = (value >>> 8) & 0xff;
        this[offset + 1] = value & 0xff;
        return offset + 2;
      }
      writeUInt32LE(value: number, offset = 0): number {
        this[offset] = value & 0xff;
        this[offset + 1] = (value >>> 8) & 0xff;
        this[offset + 2] = (value >>> 16) & 0xff;
        this[offset + 3] = (value >>> 24) & 0xff;
        return offset + 4;
      }
      writeUInt32BE(value: number, offset = 0): number {
        this[offset] = (value >>> 24) & 0xff;
        this[offset + 1] = (value >>> 16) & 0xff;
        this[offset + 2] = (value >>> 8) & 0xff;
        this[offset + 3] = value & 0xff;
        return offset + 4;
      }
      writeInt8(value: number, offset = 0): number {
        this[offset] = value & 0xff;
        return offset + 1;
      }
      writeInt16LE(value: number, offset = 0): number {
        this[offset] = value & 0xff;
        this[offset + 1] = (value >> 8) & 0xff;
        return offset + 2;
      }
      writeInt16BE(value: number, offset = 0): number {
        this[offset] = (value >> 8) & 0xff;
        this[offset + 1] = value & 0xff;
        return offset + 2;
      }
      writeInt32LE(value: number, offset = 0): number {
        this[offset] = value & 0xff;
        this[offset + 1] = (value >> 8) & 0xff;
        this[offset + 2] = (value >> 16) & 0xff;
        this[offset + 3] = (value >> 24) & 0xff;
        return offset + 4;
      }
      writeInt32BE(value: number, offset = 0): number {
        this[offset] = (value >> 24) & 0xff;
        this[offset + 1] = (value >> 16) & 0xff;
        this[offset + 2] = (value >> 8) & 0xff;
        this[offset + 3] = value & 0xff;
        return offset + 4;
      }
      writeBigInt64LE(value: bigint, offset = 0): number {
        new DataView(this.buffer, this.byteOffset + offset, 8).setBigInt64(0, value, true);
        return offset + 8;
      }
      writeBigUInt64LE(value: bigint, offset = 0): number {
        new DataView(this.buffer, this.byteOffset + offset, 8).setBigUint64(0, value, true);
        return offset + 8;
      }
      writeFloatLE(value: number, offset = 0): number {
        new DataView(this.buffer, this.byteOffset + offset, 4).setFloat32(0, value, true);
        return offset + 4;
      }
      writeFloatBE(value: number, offset = 0): number {
        new DataView(this.buffer, this.byteOffset + offset, 4).setFloat32(0, value, false);
        return offset + 4;
      }
      writeDoubleLE(value: number, offset = 0): number {
        new DataView(this.buffer, this.byteOffset + offset, 8).setFloat64(0, value, true);
        return offset + 8;
      }
      writeDoubleBE(value: number, offset = 0): number {
        new DataView(this.buffer, this.byteOffset + offset, 8).setFloat64(0, value, false);
        return offset + 8;
      }

      swap16(): this {
        for (let i = 0; i < this.length; i += 2) {
          const t = this[i];
          this[i] = this[i + 1];
          this[i + 1] = t;
        }
        return this;
      }
      swap32(): this {
        for (let i = 0; i < this.length; i += 4) {
          const t = this[i];
          this[i] = this[i + 3];
          this[i + 3] = t;
          const u = this[i + 1];
          this[i + 1] = this[i + 2];
          this[i + 2] = u;
        }
        return this;
      }
    }

    // Override how buffers are presented by util.inspect(), mirroring
    // `lib/buffer.js`: `<Buffer 01 02>` (50 bytes max by default).
    //
    // The name is pinned explicitly: the inspect hook reads
    // `constructor.name`, and a minified production bundle would otherwise
    // rename the class (e.g. `<r 01 02>`). Subclasses keep their own name.
    Object.defineProperty(Buffer, 'name', { value: 'Buffer', configurable: true });
    let INSPECT_MAX_BYTES = 50;
    (Buffer.prototype as unknown as Record<symbol, unknown>)[customInspectSymbol] = function inspect(
      this: Uint8Array,
      _recurseTimes: number,
      inspectCtx?: { showHidden?: boolean },
    ): string {
      const max = INSPECT_MAX_BYTES;
      const actualMax = Math.min(max, this.length);
      const remaining = this.length - max;
      let str = hexSliceFn(this, 0, actualMax).replace(/(.{2})/g, '$1 ').trim();
      if (remaining > 0) str += ` ... ${remaining} more byte${remaining > 1 ? 's' : ''}`;
      if (inspectCtx) {
        const filter = inspectCtx.showHidden
          ? utilBinding.constants.ALL_PROPERTIES
          : utilBinding.constants.ONLY_ENUMERABLE;
        const obj: Record<string | symbol, unknown> = { __proto__: null } as unknown as Record<string | symbol, unknown>;
        let extras = false;
        for (const key of utilBinding.getOwnNonIndexProperties(this, filter)) {
          extras = true;
          obj[key] = (this as unknown as Record<string | symbol, unknown>)[key];
        }
        if (extras) {
          if (this.length !== 0) str += ', ';
          const utilInspect = (ctx.require('internal/util/inspect') as {
            inspect: (v: unknown, o?: unknown) => string;
          }).inspect;
          // '[Object: null prototype] {'.length === 26; slice off the braces.
          str += utilInspect(obj, { ...inspectCtx, breakLength: Infinity, compact: true }).slice(27, -2);
        }
      }
      let constructorName = 'Buffer';
      try {
        const { constructor } = this as { constructor?: { name?: string } };
        if (constructor && Object.prototype.hasOwnProperty.call(constructor, 'name')) {
          constructorName = constructor.name ?? 'Buffer';
        }
      } catch {
        /* keep the default name */
      }
      return `<${constructorName} ${str}>`;
    };
    (Buffer.prototype as unknown as Record<string, unknown>).inspect = (
      Buffer.prototype as unknown as Record<symbol, unknown>
    )[customInspectSymbol];

    const SlowBuffer = (size: number): Buffer => Buffer.alloc(size);

    // `buffer.Blob` / `buffer.File` / `buffer.resolveObjectURL` are Node's real
    // vendored classes. They have to be lazy: `internal/blob` pulls in
    // `internal/util/inspect`, which requires `buffer` back, so requiring them
    // while `buffer` itself is initializing would hand `inspect` a half-built
    // exports object. Node does the same with `defineLazyProperties`.
    const exports: Record<string, unknown> = {
      Buffer,
      SlowBuffer,
      atob: (s: string) => atob(s),
      btoa: (s: string) => btoa(s),
      kMaxLength: MAX_LENGTH,
      kStringMaxLength: 0x1fffffe8,
      constants: { MAX_LENGTH, MAX_STRING_LENGTH: 0x1fffffe8 },
      transcode: () => {
        throw new Error('buffer.transcode is not supported in web-node');
      },
      isUtf8: (buf: Uint8Array) => {
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(buf);
          return true;
        } catch {
          return false;
        }
      },
      isAscii: (buf: Uint8Array) => {
        for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) return false;
        return true;
      },
    };
    let lazyBlob: { Blob?: unknown; resolveObjectURL?: unknown } | undefined;
    const loadBlob = () =>
      (lazyBlob ??= ctx.require('internal/blob') as {
        Blob?: unknown;
        resolveObjectURL?: unknown;
      });
    let lazyFile: { File?: unknown } | undefined;
    const loadFile = () => (lazyFile ??= ctx.require('internal/file') as { File?: unknown });
    for (const [key, get] of [
      ['Blob', () => loadBlob().Blob],
      ['File', () => loadFile().File],
      ['resolveObjectURL', () => loadBlob().resolveObjectURL],
    ] as const) {
      Object.defineProperty(exports, key, {
        enumerable: true,
        configurable: true,
        get,
      });
    }
    return exports;
  },
};
