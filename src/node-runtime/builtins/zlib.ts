import type { BuiltinInitContext, BuiltinSpec } from './types';
import { notImplemented } from '../errors';

/**
 * `zlib` — deflate/gzip, backed by the platform's own codec.
 *
 * Node's zlib is a native binding over the C zlib. A browser has no such
 * binding, but it *does* ship the same codec behind the WHATWG Compression
 * Streams API (`CompressionStream` / `DecompressionStream`). So this module is
 * a thin, faithful adapter over those: the bytes are produced by the platform's
 * zlib/libdeflate, not by a reimplementation, and for the default options the
 * output is byte-identical to Node's (verified against v26.9.0 — gzip, zlib and
 * raw deflate all match).
 *
 * Two consequences of "the platform owns the codec" are worth stating plainly:
 *
 *  - The platform's stream is **async only**. Node's `gzipSync`/`inflateSync`
 *    family has no counterpart here, so those throw a typed error rather than
 *    block. The async, callback and stream forms — the ones tooling actually
 *    uses — are all present.
 *  - The platform exposes **no codec parameters**. Compressing with a specific
 *    `level`/`windowBits`/`memLevel`/`strategy`/`dictionary` cannot be honored,
 *    so asking for one throws instead of silently producing a differently-sized
 *    stream. `chunkSize`/`maxOutputLength` are structural, not codec parameters,
 *    and are honored.
 *
 * Brotli and zstd have no browser codec and throw on use, as does the `zlib`
 * binding itself (we never reach for it).
 *
 * This also puts the vendored `internal/webstreams/compression.js` back in
 * business: its `CompressionStream`/`DecompressionStream` reach for
 * `zlib.createDeflate()` & friends, which now exist.
 */

// --- modes (mirror node_zlib_mode) ------------------------------------------

const DEFLATE = 1;
const INFLATE = 2;
const GZIP = 3;
const GUNZIP = 4;
const DEFLATERAW = 5;
const INFLATERAW = 6;
const UNZIP = 7;

/** The zlib format string the platform codec expects for a mode. */
const FORMAT: Record<number, string> = {
  [DEFLATE]: 'deflate',
  [INFLATE]: 'deflate',
  [GZIP]: 'gzip',
  [GUNZIP]: 'gzip',
  [DEFLATERAW]: 'deflate-raw',
  [INFLATERAW]: 'deflate-raw',
};

const COMPRESS_MODES = new Set([DEFLATE, GZIP, DEFLATERAW]);

// --- constants (values from `zlib.constants`, minus the brotli/zstd sets) ----

const constants: Record<string, number> = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  ZLIB_VERNUM: 4897,
  DEFLATE: 1,
  INFLATE: 2,
  GZIP: 3,
  GUNZIP: 4,
  DEFLATERAW: 5,
  INFLATERAW: 6,
  UNZIP: 7,
  Z_MIN_WINDOWBITS: 8,
  Z_MAX_WINDOWBITS: 15,
  Z_DEFAULT_WINDOWBITS: 15,
  Z_MIN_CHUNK: 64,
  Z_MAX_CHUNK: Infinity,
  Z_DEFAULT_CHUNK: 16384,
  Z_MIN_MEMLEVEL: 1,
  Z_MAX_MEMLEVEL: 9,
  Z_DEFAULT_MEMLEVEL: 8,
  Z_MIN_LEVEL: -1,
  Z_MAX_LEVEL: 9,
  Z_DEFAULT_LEVEL: -1,
};

/** The zlib return codes Node exposes as `zlib.codes` (bidirectional). */
const codes: Record<string | number, string | number> = {
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
};
for (const key of Object.keys(codes)) codes[codes[key] as number] = key;

const ZLIB_ERRNO: Record<string, number> = {
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
};

/**
 * A zlib failure, shaped like Node's `genericNodeError(message, { errno, code })`
 * (`name` is plain `Error`, `code` is the `Z_*` string, `errno` its number).
 *
 * The message is best-effort: the platform codec is the only one that knows the
 * precise reason, so its message is preferred and a per-code default stands in
 * when it is empty (the platform often reports just the code).
 */
function zlibError(code: string, message?: string): Error {
  const err = new Error(message && message.length > 0 ? message : (ERROR_MESSAGE[code] ?? 'zlib error')) as Error & {
    code?: string;
    errno?: number;
  };
  err.code = code;
  err.errno = ZLIB_ERRNO[code] ?? ZLIB_ERRNO.Z_DATA_ERROR;
  return err;
}

const ERROR_MESSAGE: Record<string, string> = {
  Z_DATA_ERROR: 'incorrect header check',
  Z_BUF_ERROR: 'unexpected end of file',
  Z_MEM_ERROR: 'out of memory',
  Z_STREAM_ERROR: 'stream error',
};

/** Normalize whatever the platform threw into a Node-shaped zlib error. */
function asZlibError(cause: unknown): Error {
  if (cause instanceof Error) {
    const code = typeof (cause as unknown as { code?: unknown }).code === 'string'
      ? (cause as unknown as { code: string }).code
      : 'Z_DATA_ERROR';
    if (code.startsWith('Z_')) return zlibError(code, cause.message);
  }
  return zlibError('Z_DATA_ERROR', cause instanceof Error ? cause.message : undefined);
}

// --- option handling ---------------------------------------------------------

/**
 * Codec parameters the platform cannot honor. Any of these with a non-default
 * value is a hard error: silently ignoring `level` would hand back a stream of
 * the wrong size, which is worse than refusing.
 */
const CODEC_OPTIONS: Record<string, number> = {
  level: constants.Z_DEFAULT_COMPRESSION,
  windowBits: constants.Z_DEFAULT_WINDOWBITS,
  memLevel: constants.Z_DEFAULT_MEMLEVEL,
  strategy: constants.Z_DEFAULT_STRATEGY,
  flush: constants.Z_NO_FLUSH,
  finishFlush: constants.Z_FINISH,
};

function checkOptions(mode: number, opts: Record<string, unknown> | undefined | null): void {
  if (!opts) return;
  for (const [name, dflt] of Object.entries(CODEC_OPTIONS)) {
    const value = opts[name];
    if (value === undefined || value === dflt) continue;
    // `windowBits: 0` is the documented "read the window size from the stream"
    // sentinel on the inflate side, and is what Node itself defaults to there.
    if (name === 'windowBits' && value === 0 && !COMPRESS_MODES.has(mode)) continue;
    throw notImplemented(
      'api',
      `zlib ${name}`,
      `The platform's CompressionStream has no codec parameters, so \`${name}\` cannot be honored. Omit it for byte-identical default output.`,
    );
  }
  if (opts.dictionary !== undefined && opts.dictionary !== null) {
    throw notImplemented('api', 'zlib dictionary', 'A preset dictionary has no counterpart in the platform codec.');
  }
  if (opts.params !== undefined && opts.params !== null) {
    throw notImplemented('api', 'zlib params()', 'Adjusting codec parameters mid-stream is not supported.');
  }
  for (const name of ['portable', 'charf', 'func']) {
    if (opts[name] !== undefined) {
      throw notImplemented('api', `zlib ${name}`, 'This option only exists on the native zlib binding.');
    }
  }
}

function maxOutputLengthOf(opts: Record<string, unknown> | undefined | null): number {
  const value = opts?.maxOutputLength;
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    const err = new RangeError(
      `The value of "options.maxOutputLength" is out of range. It must be a non-negative integer. Received ${String(value)}`,
    ) as RangeError & { code?: string };
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
  }
  return value;
}

function toBuffer(Buffer: BufferCtor, input: string | Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof input === 'string') return Buffer.from(input);
  if (ArrayBuffer.isView(input)) {
    if (input instanceof Uint8Array) return input;
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw Object.assign(
    new TypeError(
      `The "buffer" argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received ${describe(input)}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'object') return 'an instance of Object';
  if (type === 'number' || type === 'bigint' || type === 'boolean' || type === 'symbol' || type === 'function') {
    return `type ${type} (${String(value)})`;
  }
  return `type ${type}`;
}

function validateFunction(fn: unknown, name: string): void {
  if (typeof fn !== 'function') {
    throw Object.assign(
      new TypeError(`The "${name}" argument must be of type function. Received ${describe(fn)}`),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
}

// --- host codec --------------------------------------------------------------

interface HostPair {
  writable: { getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort?(reason?: unknown): Promise<void> } };
  readable: { getReader(): { read(): Promise<{ value?: Uint8Array; done: boolean }>; cancel(reason?: unknown): Promise<void> } };
}

type FormatCtor = new (format: string) => HostPair;

function platformCtor(compress: boolean): FormatCtor | undefined {
  const g = globalThis as unknown as Record<string, unknown>;
  const ctor = compress ? g.CompressionStream : g.DecompressionStream;
  return typeof ctor === 'function' ? (ctor as FormatCtor) : undefined;
}

function requirePlatform(compress: boolean, mode: number): FormatCtor {
  const ctor = platformCtor(compress);
  if (!ctor) {
    throw notImplemented(
      'api',
      `zlib ${compress ? 'compression' : 'decompression'}`,
      `The host has no ${compress ? 'CompressionStream' : 'DecompressionStream'}; zlib needs it as its codec.`,
    );
  }
  if (!FORMAT[mode] && mode !== UNZIP) throw notImplemented('api', 'zlib mode');
  return ctor;
}

type BufferCtor = {
  from(input: string | ArrayBuffer | ArrayBufferView): Uint8Array;
  concat(list: readonly Uint8Array[], totalLength?: number): Uint8Array;
};

// --- the stream --------------------------------------------------------------

interface StreamOpts extends Record<string, unknown> {
  /** Node-only: reject data after the compressed stream ends. */
  rejectGarbageAfterEnd?: boolean;
}

/**
 * The shape of a Node `Transform` we build on. Kept structural so this file does
 * not have to import the vendored `stream` types.
 */
interface TransformLike {
  push(chunk: Uint8Array): boolean;
  destroy(error?: Error): void;
  readonly destroyed: boolean;
}
type TransformCtor = new (opts?: Record<string, unknown>) => TransformLike & {
  on(event: string, listener: (...args: unknown[]) => void): void;
  _transform(chunk: Uint8Array, encoding: string, callback: (error?: Error) => void): void;
  _flush(callback: (error?: Error) => void): void;
  _destroy(error: Error | null, callback: (error: Error | null) => void): void;
};

function makeZlibClass(
  Base: TransformCtor,
  mode: number,
  Buffer: BufferCtor,
  className: string,
): new (opts?: StreamOpts) => unknown {
  class WebNodeZlib extends Base {
    #writer: ReturnType<HostPair['writable']['getWriter']> | undefined;
    #reader: ReturnType<HostPair['readable']['getReader']> | undefined;
    #drain: Promise<void> | undefined;
    #failure: Error | undefined;
    #started = false;
    #pending: Uint8Array[] = [];
    #nread = 0;
    #maxOutputLength: number;
    #buffer: BufferCtor;

    constructor(opts?: StreamOpts) {
      super(opts as Record<string, unknown> | undefined);
      checkOptions(mode, opts ?? undefined);
      this.#maxOutputLength = maxOutputLengthOf(opts ?? undefined);
      this.#buffer = Buffer;
      // UNZIP cannot choose a codec until it has sniffed the header; every other
      // mode knows its format up front.
      if (mode !== UNZIP) this.#open(FORMAT[mode]);
    }

    #open(format: string): void {
      const compress = COMPRESS_MODES.has(mode);
      const ctor = requirePlatform(compress, mode);
      const pair = new ctor(format);
      this.#writer = pair.writable.getWriter();
      const reader = pair.readable.getReader();
      this.#reader = reader;
      this.#started = true;
      this.#drain = (async (): Promise<void> => {
        for (;;) {
          let chunk: { value?: Uint8Array; done: boolean };
          try {
            chunk = await reader.read();
          } catch (cause) {
            this.#fail(asZlibError(cause));
            return;
          }
          if (chunk.done) return;
          if (this.destroyed) return;
          if (chunk.value && chunk.value.byteLength > 0) {
            this.#nread += chunk.value.byteLength;
            if (this.#nread > this.#maxOutputLength) {
              this.#fail(
                Object.assign(new Error(`Cannot create a Buffer larger than ${this.#maxOutputLength} bytes`), {
                  code: 'ERR_BUFFER_TOO_LARGE',
                }),
              );
              return;
            }
            this.push(this.#buffer.from(chunk.value));
          }
        }
      })();
    }

    #fail(error: Error): void {
      if (this.#failure) return;
      this.#failure = error;
      this.destroy(error);
    }

    /** Sniff gzip vs zlib the way Node's UNZIP mode does. */
    #sniff(parts: Uint8Array[]): void {
      let b0: number | undefined;
      let b1: number | undefined;
      for (const part of parts) {
        for (let i = 0; i < part.byteLength; i++) {
          if (b0 === undefined) b0 = part[i];
          else {
            b1 = part[i];
            break;
          }
        }
        if (b1 !== undefined) break;
      }
      const gzip = b0 === 0x1f && b1 === 0x8b;
      this.#open(gzip ? 'gzip' : 'deflate');
    }

    _transform(chunk: Uint8Array, _encoding: string, callback: (error?: Error) => void): void {
      if (chunk.byteLength === 0) {
        callback();
        return;
      }
      if (this.#started) {
        this.#writeAll([chunk], callback);
        return;
      }
      // UNZIP holds the first bytes back until the header can be sniffed.
      if (this.#pending.length === 0 && chunk.byteLength < 2) {
        this.#pending.push(chunk);
        callback();
        return;
      }
      const parts = [...this.#pending, chunk];
      this.#pending = [];
      this.#sniff(parts);
      this.#writeAll(parts, callback);
    }

    #writeAll(chunks: Uint8Array[], callback: (error?: Error) => void): void {
      const writer = this.#writer;
      if (!writer) {
        callback();
        return;
      }
      const write = async (): Promise<void> => {
        for (const chunk of chunks) {
          if (chunk.byteLength > 0) await writer.write(chunk);
        }
      };
      write().then(
        () => callback(),
        (cause) => {
          const error = asZlibError(cause);
          this.#failure = error;
          callback(error);
        },
      );
    }

    _flush(callback: (error?: Error) => void): void {
      if (!this.#started) {
        // No input at all: still spin up a decoder so it errors like Node does.
        this.#open('deflate');
      }
      const writer = this.#writer;
      const drain = this.#drain;
      if (!writer) {
        callback(this.#failure);
        return;
      }
      writer.close().then(
        async () => {
          await drain;
          callback(this.#failure);
        },
        (cause) => {
          this.#failure ??= asZlibError(cause);
          callback(this.#failure);
        },
      );
    }

    _destroy(error: Error | null, callback: (error: Error | null) => void): void {
      const writer = this.#writer;
      const reader = this.#reader;
      this.#writer = undefined;
      this.#reader = undefined;
      try {
        // Tear the host codec down so its machinery stops holding onto memory.
        if (writer) void Promise.resolve(writer.abort?.(error ?? undefined)).catch(() => {});
        if (reader) void Promise.resolve(reader.cancel(error ?? undefined)).catch(() => {});
      } catch {
        /* the stream is going away regardless */
      }
      callback(error ?? this.#failure ?? null);
    }

  }
  Object.defineProperty(WebNodeZlib, 'name', { value: className });
  return WebNodeZlib as unknown as new (opts?: StreamOpts) => unknown;
}

// --- one-shot helpers --------------------------------------------------------

interface ZlibStreamLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  end(chunk?: unknown): void;
  close(): void;
}

function zlibBuffer(
  engine: ZlibStreamLike,
  buffer: unknown,
  callback: (error: Error | null, result?: Uint8Array) => void,
  Buffer: BufferCtor,
): void {
  validateFunction(callback, 'callback');
  let chunks: Uint8Array[] | null = null;
  let nread = 0;
  engine.on('data', (chunk: unknown) => {
    const bytes = chunk as Uint8Array;
    if (!chunks) chunks = [bytes];
    else chunks.push(bytes);
    nread += bytes.byteLength;
  });
  engine.on('error', (error: unknown) => callback(asZlibError(error)));
  engine.on('end', () => callback(null, Buffer.concat(chunks ?? [], nread)));
  engine.end(buffer);
}

// --- module ------------------------------------------------------------------

export const zlibSpec: BuiltinSpec = {
  id: 'zlib',
  aliases: ['node:zlib'],
  origin: 'web-node',
  deps: ['stream', 'buffer'],
  init: (ctx: BuiltinInitContext): Record<string, unknown> => {
    const { Transform } = ctx.require('stream') as { Transform: TransformCtor };
    const { Buffer } = ctx.require('buffer') as { Buffer: BufferCtor };
    const stringArg = (value: string | Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array => toBuffer(Buffer, value);

    // Node's async one-shot helpers only rewrap views/ArrayBuffers; anything
    // else (a string, or an invalid type) is handed straight to the stream,
    // which is what raises the `chunk` TypeError a caller actually sees.
    const coerceInput = (input: unknown): unknown => {
      if (ArrayBuffer.isView(input)) {
        if (input instanceof Uint8Array) return input;
        return Buffer.from(
          new Uint8Array(input.buffer as ArrayBuffer, input.byteOffset, input.byteLength),
        );
      }
      if (input instanceof ArrayBuffer) return Buffer.from(input);
      return input;
    };

    const CLASSES: Record<number, string> = {
      [DEFLATE]: 'Deflate',
      [INFLATE]: 'Inflate',
      [GZIP]: 'Gzip',
      [GUNZIP]: 'Gunzip',
      [DEFLATERAW]: 'DeflateRaw',
      [INFLATERAW]: 'InflateRaw',
      [UNZIP]: 'Unzip',
    };

    const ctorFor: Record<number, new (opts?: StreamOpts) => unknown> = {};
    for (const [modeStr, className] of Object.entries(CLASSES)) {
      ctorFor[Number(modeStr)] = makeZlibClass(Transform, Number(modeStr), Buffer, className);
    }

    // `zlib.gzip(buf, cb)` style helpers: validate the callback first (Node
    // does), then run the stream and collect its output.
    const convenience = (mode: number, sync: boolean) => {
      if (sync) {
        return (): never => {
          throw notImplemented(
            'api',
            'zlib sync API',
            'The platform codec is asynchronous; use the callback or stream form instead.',
          );
        };
      }
      return (
        buffer: string | Uint8Array | ArrayBuffer | ArrayBufferView,
        opts: StreamOpts | ((error: Error | null, result?: Uint8Array) => void),
        callback?: (error: Error | null, result?: Uint8Array) => void,
      ): undefined => {
        if (typeof opts === 'function') {
          callback = opts;
          opts = {};
        }
        const done = callback;
        validateFunction(done, 'callback');
        const Ctor = ctorFor[mode];
        const engine = new Ctor(opts) as ZlibStreamLike;
        zlibBuffer(engine, coerceInput(buffer), done as (error: Error | null, result?: Uint8Array) => void, Buffer);
        return undefined;
      };
    };

    const make = (mode: number) => (opts?: StreamOpts): unknown => new (ctorFor[mode])(opts);

    const crc32 = (input: string | Uint8Array | ArrayBuffer | ArrayBufferView, value = 0): number => {
      const bytes = stringArg(input);
      let crc = (value ^ 0xffffffff) >>> 0;
      for (let i = 0; i < bytes.byteLength; i++) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    const lose = (name: string, why: string) => (): never => {
      throw notImplemented('api', `zlib ${name}`, why);
    };
    const loseClass = (name: string, why: string) =>
      class {
        constructor() {
          throw notImplemented('api', `zlib ${name}`, why);
        }
      };
    const NO_BROTLI = 'The host ships no brotli codec.';
    const NO_ZSTD = 'The host ships no zstd codec.';
    const NO_ZIP = 'Zip archive support is not implemented.';

    return {
      constants,
      codes,
      createDeflate: make(DEFLATE),
      createInflate: make(INFLATE),
      createDeflateRaw: make(DEFLATERAW),
      createInflateRaw: make(INFLATERAW),
      createGzip: make(GZIP),
      createGunzip: make(GUNZIP),
      createUnzip: make(UNZIP),
      Deflate: ctorFor[DEFLATE],
      Inflate: ctorFor[INFLATE],
      DeflateRaw: ctorFor[DEFLATERAW],
      InflateRaw: ctorFor[INFLATERAW],
      Gzip: ctorFor[GZIP],
      Gunzip: ctorFor[GUNZIP],
      Unzip: ctorFor[UNZIP],
      deflate: convenience(DEFLATE, false),
      inflate: convenience(INFLATE, false),
      deflateRaw: convenience(DEFLATERAW, false),
      inflateRaw: convenience(INFLATERAW, false),
      gzip: convenience(GZIP, false),
      gunzip: convenience(GUNZIP, false),
      unzip: convenience(UNZIP, false),
      deflateSync: convenience(DEFLATE, true),
      inflateSync: convenience(INFLATE, true),
      deflateRawSync: convenience(DEFLATERAW, true),
      inflateRawSync: convenience(INFLATERAW, true),
      gzipSync: convenience(GZIP, true),
      gunzipSync: convenience(GUNZIP, true),
      unzipSync: convenience(UNZIP, true),
      crc32,
      // No platform codec exists for these, and the zip helpers are native-only.
      createBrotliCompress: lose('createBrotliCompress', NO_BROTLI),
      createBrotliDecompress: lose('createBrotliDecompress', NO_BROTLI),
      brotliCompress: lose('brotliCompress', NO_BROTLI),
      brotliCompressSync: lose('brotliCompressSync', NO_BROTLI),
      brotliDecompress: lose('brotliDecompress', NO_BROTLI),
      brotliDecompressSync: lose('brotliDecompressSync', NO_BROTLI),
      BrotliCompress: loseClass('BrotliCompress', NO_BROTLI),
      BrotliDecompress: loseClass('BrotliDecompress', NO_BROTLI),
      createZstdCompress: lose('createZstdCompress', NO_ZSTD),
      createZstdDecompress: lose('createZstdDecompress', NO_ZSTD),
      zstdCompress: lose('zstdCompress', NO_ZSTD),
      zstdCompressSync: lose('zstdCompressSync', NO_ZSTD),
      zstdDecompress: lose('zstdDecompress', NO_ZSTD),
      zstdDecompressSync: lose('zstdDecompressSync', NO_ZSTD),
      ZstdCompress: loseClass('ZstdCompress', NO_ZSTD),
      ZstdDecompress: loseClass('ZstdDecompress', NO_ZSTD),
      createZipArchive: lose('createZipArchive', NO_ZIP),
      createZipArchiveSync: lose('createZipArchiveSync', NO_ZIP),
      zipFiles: lose('zipFiles', NO_ZIP),
      getMaxZipContentSize: lose('getMaxZipContentSize', NO_ZIP),
      setMaxZipContentSize: lose('setMaxZipContentSize', NO_ZIP),
      ZipBuffer: loseClass('ZipBuffer', NO_ZIP),
      ZipEntry: loseClass('ZipEntry', NO_ZIP),
      ZipFile: loseClass('ZipFile', NO_ZIP),
    };
  },
};

/** CRC-32 (IEEE 802.3) lookup table, built once. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
