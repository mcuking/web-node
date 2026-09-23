import type { BuiltinInitContext, BuiltinSpec } from './types';
import { ZLIB_CONSTANTS as constants } from '../zlib-constants';
import { notImplemented } from '../errors';

/**
 * `zlib` — deflate/gzip/inflate, backed by the **real zlib** (M116).
 *
 * Node's zlib is a native binding over the C zlib. Here the same upstream C source
 * (`deps/zlib`, zlib 1.3.2.1-motley) is compiled to WebAssembly with wasi-sdk and
 * reached through `internalBinding('zlib')` — so every byte of deflate/gzip output
 * is produced by the same codec Node uses, and, unlike the previous
 * `CompressionStream`-based shim, the **synchronous API and every codec parameter
 * are available**: `gzipSync`/`inflateSync`/…, and `level`/`windowBits`/`memLevel`/
 * `strategy`/`dictionary` are honored (verified byte-for-byte against v26.9.0).
 *
 * The JS layer below is a close port of Node's own `lib/zlib.js` (`ZlibBase` /
 * `Zlib` / `processChunk(Sync)` / the convenience helpers), driving the wasm codec
 * instead of a native handle. **Brotli** (M118) and **zstd** (M118) run on the real
 * `deps/brotli` / `deps/zstd` compiled to wasm, so `brotliCompressSync` /
 * `zstdCompressSync` and their streaming forms are live too; only the zip-archive
 * helpers (native-only in Node) still throw.
 */

// --- modes (mirror node_zlib_mode) ------------------------------------------

const DEFLATE = 1;
const INFLATE = 2;
const GZIP = 3;
const GUNZIP = 4;
const DEFLATERAW = 5;
const INFLATERAW = 6;
const UNZIP = 7;
const BROTLI_ENCODE = 8;
const BROTLI_DECODE = 9;
const ZSTD_COMPRESS = 10;
const ZSTD_DECOMPRESS = 11;

const Z_NO_FLUSH = 0;
const Z_PARTIAL_FLUSH = 1;
const Z_SYNC_FLUSH = 2;
const Z_FULL_FLUSH = 3;
const Z_FINISH = 4;
const Z_BLOCK = 5;

const Z_MIN_CHUNK = 64;
const Z_MAX_CHUNK = Infinity;
const Z_DEFAULT_CHUNK = 16384;
const Z_MIN_MEMLEVEL = 1;
const Z_MAX_MEMLEVEL = 9;
const Z_DEFAULT_MEMLEVEL = 8;
const Z_MIN_LEVEL = -1;
const Z_MAX_LEVEL = 9;
const Z_DEFAULT_COMPRESSION = -1;
const Z_DEFAULT_STRATEGY = 0;
const Z_DEFAULT_WINDOWBITS = 15;
const Z_MIN_WINDOWBITS = 8;
const Z_MAX_WINDOWBITS = 15;
const Z_FIXED = 4;

/** The `zlib` binding surface (real zlib compiled to wasm, see `bindings/zlib.ts`). */
interface ZlibCodecLike {
  push(chunk: Uint8Array, flush: number): Uint8Array;
  reset(): void;
  setParams(level: number, strategy: number): void;
  close(): void;
  readonly closed: boolean;
  readonly finished: boolean;
  /** Input bytes left unconsumed by the last `push` (trailing junk). */
  readonly lastInputLeft: number;
}interface ZlibBinding {
  ZlibCodec: new (opts: {
    mode: number;
    level: number;
    windowBits: number;
    memLevel: number;
    strategy: number;
    dictionary?: Uint8Array | null;
    rejectGarbageAfterEnd?: boolean;
  }) => ZlibCodecLike;
  BrotliEncoderCodec: new (mode: number, opts?: { params?: Int32Array; dictionary?: Uint8Array | null }) => ZlibCodecLike;
  BrotliDecoderCodec: new (mode: number, opts?: { params?: Int32Array; dictionary?: Uint8Array | null }) => ZlibCodecLike;
  ZstdCompressCodec: new (opts?: {
    params?: Int32Array;
    dictionary?: Uint8Array | null;
    pledgedSrcSize?: number | bigint;
  }) => ZlibCodecLike;
  ZstdDecompressCodec: new (opts?: {
    params?: Int32Array;
    dictionary?: Uint8Array | null;
    pledgedSrcSize?: number | bigint;
  }) => ZlibCodecLike;
  crc32(data: Uint8Array | string, value: number): number;
  zlibVersion(): string;
}


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

type BufferCtor = {
  from(input: string | ArrayBuffer | ArrayBufferView): Uint8Array;
  concat(list: readonly Uint8Array[], totalLength?: number): Uint8Array;
  alloc(size: number): Uint8Array;
  allocUnsafe(size: number): Uint8Array;
  isBuffer(value: unknown): boolean;
  byteLength(input: string, encoding?: string): number;
};

/** Structural shape of a Node `Transform` (kept local to avoid a cycle). */
type TransformCtor = new (opts?: Record<string, unknown>) => TransformLike;
interface TransformLike {
  push(chunk: Uint8Array): boolean;
  destroy(error?: Error): void;
  write(chunk: unknown, encoding?: unknown, cb?: unknown): boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  readonly writableFinished: boolean;
  readonly writableLength: number;
}

export const zlibSpec: BuiltinSpec = {
  id: 'zlib',
  aliases: ['node:zlib'],
  origin: 'web-node',
  arity: {
    BrotliCompress: 1, BrotliDecompress: 1, ZstdCompress: 1, ZstdDecompress: 1,
    ZipBuffer: 1, ZipEntry: 0, ZipFile: 0,
    brotliCompress: 3, brotliCompressSync: 2, brotliDecompress: 3, brotliDecompressSync: 2,
    createBrotliCompress: 1, createBrotliDecompress: 1,
    zstdCompress: 3, zstdCompressSync: 2, zstdDecompress: 3, zstdDecompressSync: 2,
    createZstdCompress: 1, createZstdDecompress: 1,
    deflateSync: 2, inflateSync: 2, deflateRawSync: 2, inflateRawSync: 2,
    gzipSync: 2, gunzipSync: 2, unzipSync: 2,
  },
  deps: ['stream', 'buffer'],
  init: (ctx: BuiltinInitContext): Record<string, unknown> => {
    const binding = ctx.internalBinding('zlib') as unknown as ZlibBinding;
    const { Transform, finished } = ctx.require('stream') as {
      Transform: TransformCtor;
      finished: (stream: unknown, cb: (err?: Error | null) => void) => void;
    };
    const TransformCall = Transform as unknown as {
      call: (thisArg: unknown, opts?: Record<string, unknown>) => void;
    };
    const { Buffer, kMaxLength } = ctx.require('buffer') as { Buffer: BufferCtor; kMaxLength: number };
    const errors = ctx.require('internal/errors') as {
      codes: Record<string, new (...args: any[]) => Error & { code?: string }>;
      genericNodeError: (message: string, props?: Record<string, unknown>) => Error;
    };
    const { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE, ERR_BUFFER_TOO_LARGE, ERR_BROTLI_INVALID_PARAM, ERR_ZSTD_INVALID_PARAM } = errors.codes;
    const validators = ctx.require('internal/validators') as {
      checkRangesOrGetDefault: (value: unknown, name: string, min: number, max: number, def?: number) => number;
      validateFunction: (value: unknown, name: string) => void;
      validateUint32: (value: unknown, name: string) => void;
      validateFiniteNumber: (value: unknown, name: string) => boolean;
      validateBoolean: (value: unknown, name: string) => void;
    };
    const types = ctx.require('internal/util/types') as {
      isArrayBufferView: (value: unknown) => value is ArrayBufferView;
      isUint8Array: (value: unknown) => value is Uint8Array;
    };
    const { checkRangesOrGetDefault, validateFunction, validateUint32, validateFiniteNumber, validateBoolean } =
      validators;
    const { isArrayBufferView } = types;
    const { deprecateInstantiation } = ctx.require('internal/util') as {
      deprecateInstantiation: (target: unknown, code: string, ...args: unknown[]) => never;
    };
    const nextTick = (fn: (...fnArgs: any[]) => void, ...fnArgs: any[]): void => ctx.binding.nextTick(fn as (...a: unknown[]) => void, ...fnArgs);

    const isAnyArrayBuffer = (value: unknown): value is ArrayBuffer =>
      value instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer);

    const genericNodeError = errors.genericNodeError;

    // --- the actual codec, behind internalBinding('zlib') --------------------

    function Zlib(this: ZlibInstance, opts: ZlibOptions | undefined, mode: number): void {
      let windowBits = Z_DEFAULT_WINDOWBITS;
      let level = Z_DEFAULT_COMPRESSION;
      let memLevel = Z_DEFAULT_MEMLEVEL;
      let strategy = Z_DEFAULT_STRATEGY;
      let dictionary: Uint8Array | ArrayBuffer | ArrayBufferView | undefined;
      let dict: Uint8Array | null = null;

      if (opts) {
        if (
          (opts.windowBits == null || opts.windowBits === 0) &&
          (mode === INFLATE || mode === GUNZIP || mode === UNZIP)
        ) {
          windowBits = 0;
        } else {
          const min = Z_MIN_WINDOWBITS + (mode === GZIP ? 1 : 0);
          windowBits = checkRangesOrGetDefault(opts.windowBits, 'options.windowBits', min, Z_MAX_WINDOWBITS, Z_DEFAULT_WINDOWBITS);
        }
        level = checkRangesOrGetDefault(opts.level, 'options.level', Z_MIN_LEVEL, Z_MAX_LEVEL, Z_DEFAULT_COMPRESSION);
        memLevel = checkRangesOrGetDefault(opts.memLevel, 'options.memLevel', Z_MIN_MEMLEVEL, Z_MAX_MEMLEVEL, Z_DEFAULT_MEMLEVEL);
        strategy = checkRangesOrGetDefault(opts.strategy, 'options.strategy', Z_DEFAULT_STRATEGY, Z_FIXED, Z_DEFAULT_STRATEGY);
        dictionary = opts.dictionary;
        if (dictionary !== undefined) {
          if (isArrayBufferView(dictionary)) {
            dict = dictionary instanceof Uint8Array
              ? dictionary
              : new Uint8Array((dictionary as ArrayBufferView).buffer, (dictionary as ArrayBufferView).byteOffset, (dictionary as ArrayBufferView).byteLength);
          } else if (isAnyArrayBuffer(dictionary)) {
            dict = new Uint8Array(dictionary);
          } else {
            throw new ERR_INVALID_ARG_TYPE('options.dictionary', ['Buffer', 'TypedArray', 'DataView', 'ArrayBuffer'], dictionary);
          }
        }
      }

      this._codec = new binding.ZlibCodec({
        mode,
        level,
        windowBits,
        memLevel,
        strategy,
        dictionary: dict,
        rejectGarbageAfterEnd: opts?.rejectGarbageAfterEnd === true,
      });
      ZlibBase.call(this, opts, mode, this._codec, zlibDefaultOpts);

      this._level = level;
      this._strategy = strategy;
      this._mode = mode;
    }
    Object.setPrototypeOf(Zlib.prototype, ZlibBase.prototype);
    Object.setPrototypeOf(Zlib, ZlibBase);

    const zlibDefaultOpts = { flush: Z_NO_FLUSH, finishFlush: Z_FINISH, fullFlush: Z_FULL_FLUSH };

    // --- ZlibBase -----------------------------------------------------------

    function ZlibBase(this: ZlibInstance, opts: ZlibOptions | undefined, mode: number, handle: unknown, defaults: { flush: number; finishFlush: number; fullFlush: number }): void {
      let chunkSize = Z_DEFAULT_CHUNK;
      let maxOutputLength = kMaxLength;
      let { flush, finishFlush, fullFlush } = defaults;

      if (opts) {
        const cs = opts.chunkSize;
        if (!validateFiniteNumber(cs, 'options.chunkSize')) {
          chunkSize = Z_DEFAULT_CHUNK;
        } else if ((cs as number) < Z_MIN_CHUNK) {
          throw new ERR_OUT_OF_RANGE('options.chunkSize', `>= ${Z_MIN_CHUNK}`, cs);
        }
        flush = checkRangesOrGetDefault(opts.flush, 'options.flush', Z_NO_FLUSH, Z_BLOCK, flush);
        finishFlush = checkRangesOrGetDefault(opts.finishFlush, 'options.finishFlush', Z_NO_FLUSH, Z_BLOCK, finishFlush);
        maxOutputLength = checkRangesOrGetDefault(opts.maxOutputLength, 'options.maxOutputLength', 1, kMaxLength, kMaxLength);
        if (opts.rejectGarbageAfterEnd !== undefined) {
          validateBoolean(opts.rejectGarbageAfterEnd, 'options.rejectGarbageAfterEnd');
        }
        if (opts.encoding || opts.objectMode || opts.writableObjectMode) {
          opts = { ...opts, encoding: null, objectMode: false, writableObjectMode: false } as ZlibOptions;
        }
      }

      TransformCall.call(this, { autoDestroy: true, ...(opts as Record<string, unknown>) });
      this.bytesWritten = 0;
      this._outBuffer = Buffer.allocUnsafe(chunkSize);
      this._outOffset = 0;
      this._chunkSize = chunkSize;
      this._defaultFlushFlag = flush;
      this._finishFlushFlag = finishFlush;
      this._defaultFullFlushFlag = fullFlush;
      this._info = opts?.info;
      this._maxOutputLength = maxOutputLength;
      this._rejectGarbageAfterEnd = opts?.rejectGarbageAfterEnd === true;
    }
    Object.setPrototypeOf(ZlibBase.prototype, Transform.prototype);
    Object.setPrototypeOf(ZlibBase, Transform);

    Object.defineProperty(ZlibBase.prototype, '_closed', {
      configurable: true,
      enumerable: true,
      get(this: ZlibInstance): boolean {
        return !this._codec || this._codec.closed;
      },
    });

    ZlibBase.prototype.reset = function reset(this: ZlibInstance): void {
      if (!this._codec || this._codec.closed) throw new Error('zlib binding closed');
      return this._codec.reset();
    };

    // Node keeps `_final` a no-op so the `prefinish` path drives `_flush`, but the
    // callback must still be invoked or the writable side never finishes.
    ZlibBase.prototype._flush = function _flush(this: ZlibInstance, callback: (error?: Error) => void): void {
      this._transform(Buffer.alloc(0), '', callback);
    };

    ZlibBase.prototype._final = function _final(callback: () => void): void {
      callback();
    };

    // `flush()` inserts a pseudo-buffer carrying the flush flag through `.write()`.
    const kFlushFlag = Symbol('kFlushFlag');
    const flushiness: number[] = [];
    const kFlushFlagList = [Z_NO_FLUSH, Z_BLOCK, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH];
    for (let i = 0; i < kFlushFlagList.length; i++) flushiness[kFlushFlagList[i]] = i;
    const maxFlush = (a: number, b: number): number => (flushiness[a] > flushiness[b] ? a : b);
    const kFlushBuffers: Uint8Array[] = [];
    {
      const dummy = new ArrayBuffer(0);
      for (const flushFlag of kFlushFlagList) {
        const buf = Buffer.from(dummy) as unknown as Record<symbol, number>;
        buf[kFlushFlag] = flushFlag;
        kFlushBuffers[flushFlag] = buf as unknown as Uint8Array;
      }
    }

    ZlibBase.prototype.flush = function flush(this: ZlibInstance, kind?: unknown, callback?: unknown): void {
      if (typeof kind === 'function' || (kind === undefined && !callback)) {
        callback = kind;
        kind = this._defaultFullFlushFlag;
      }
      const k = checkRangesOrGetDefault(kind, 'kind', Z_NO_FLUSH, Z_BLOCK, this._defaultFullFlushFlag);
      const cb = typeof callback === 'function' ? (callback as () => void) : undefined;
      if (this.writableFinished) {
        if (cb) nextTick(cb);
      } else if (this.writableEnded) {
        if (cb) this.once('end', cb);
      } else {
        this.write(kFlushBuffers[k], '', callback);
      }
    };

    ZlibBase.prototype.close = function close(this: ZlibInstance, callback?: (err?: Error | null) => void): void {      if (callback) finished(this, callback);
      this.destroy();
    };

    ZlibBase.prototype._destroy = function _destroy(this: ZlibInstance, err: Error | null, callback: (error: Error | null) => void): void {
      closeCodec(this);
      callback(err);
    };

    ZlibBase.prototype._transform = function _transform(this: ZlibInstance, chunk: Uint8Array, _encoding: string, cb: (error?: Error) => void): void {
      let flushFlag = this._defaultFlushFlag;
      const carried = (chunk as unknown as Record<symbol, number>)[kFlushFlag];
      if (typeof carried === 'number') flushFlag = carried;
      if (this.writableEnded && this.writableLength === chunk.byteLength) {
        flushFlag = maxFlush(flushFlag, this._finishFlushFlag);
      }
      processChunk(this, chunk, flushFlag, cb);
    };

    // Node keeps this on `ZlibBase.prototype` for backwards compatibility.
    ZlibBase.prototype._processChunk = function _processChunk(
      this: ZlibInstance,
      chunk: Uint8Array,
      flushFlag: number,
      cb?: (error?: Error) => void,
    ): Uint8Array | undefined {
      if (typeof cb === 'function') {
        processChunk(this, chunk, flushFlag, cb);
        return undefined;
      }
      return processChunkSync(this, chunk, flushFlag);
    };

    // --- processChunk / processChunkSync ------------------------------------

    function closeCodec(self: ZlibInstance): void {
      self._codec?.close();
      self._codec = undefined;
    }

    function onCodecError(self: ZlibInstance, err: Error): void {
      self.destroy(err);
    }

    function processChunk(self: ZlibInstance, chunk: Uint8Array, flushFlag: number, cb: (error?: Error) => void): void {
      const codec = self._codec;
      if (!codec) {
        nextTick(cb);
        return;
      }
      let out: Uint8Array;
      try {
        out = codec.push(chunk, flushFlag);
      } catch (err) {
        onCodecError(self, err as Error);
        return;
      }
      self.bytesWritten += chunk.byteLength - codec.lastInputLeft;
      if (out.byteLength > 0) self.push(Buffer.from(out));
      nextTick(cb);
    }

    function processChunkSync(self: ZlibInstance, chunk: Uint8Array, flushFlag: number): Uint8Array {
      const codec = self._codec;
      if (!codec) throw new Error('zlib binding closed');
      const out = codec.push(chunk, flushFlag);
      if (out.byteLength > self._maxOutputLength) {
        closeCodec(self);
        throw new ERR_BUFFER_TOO_LARGE(self._maxOutputLength);
      }
      self.bytesWritten = chunk.byteLength - codec.lastInputLeft;
      closeCodec(self);
      return Buffer.from(out);
    }

    /** `zlib.flush()`-driven parameter change (Node's `paramsAfterFlushCallback`). */
    function paramsAfterFlushCallback(this: ZlibInstance, level: number, strategy: number, callback?: () => void): void {
      if (!this._codec || this._codec.closed) throw new Error('zlib binding closed');
      this._codec.setParams(level, strategy);
      if (!this.destroyed) {
        this._level = level;
        this._strategy = strategy;
        if (callback) callback();
      }
    }

    (Zlib.prototype as ZlibInstance).params = function params(
      this: ZlibInstance,
      level: unknown,
      strategy: unknown,
      callback?: () => void,
    ): void {
      const l = checkRangesOrGetDefault(level, 'level', Z_MIN_LEVEL, Z_MAX_LEVEL);
      const s = checkRangesOrGetDefault(strategy, 'strategy', Z_DEFAULT_STRATEGY, Z_FIXED);
      if (this._level !== l || this._strategy !== s) {
        this.flush(Z_SYNC_FLUSH, paramsAfterFlushCallback.bind(this, l, s, callback));
      } else {
        nextTick(callback as (...a: unknown[]) => void);
      }
    };

    // --- brotli / zstd (M118) ----------------------------------------------

    const BROTLI_ENCODE = 8;
    const BROTLI_DECODE = 9;
    const ZSTD_COMPRESS = 10;
    const ZSTD_DECOMPRESS = 11;
    const BROTLI_OPERATION_PROCESS = 0;
    const BROTLI_OPERATION_FLUSH = 1;
    const BROTLI_OPERATION_FINISH = 2;
    const ZSTD_e_continue = 0;
    const ZSTD_e_flush = 1;
    const ZSTD_e_end = 2;

    const brotliDefaultOpts = {
      flush: BROTLI_OPERATION_PROCESS,
      finishFlush: BROTLI_OPERATION_FINISH,
      fullFlush: BROTLI_OPERATION_FLUSH,
    };
    const zstdDefaultOpts = { flush: ZSTD_e_continue, finishFlush: ZSTD_e_end, fullFlush: ZSTD_e_flush };

    const kMaxBrotliParam = Math.max(
      ...Object.entries(constants).map(([key, value]) => (key.startsWith('BROTLI_PARAM_') ? (value as number) : 0)),
    );
    const kMaxZstdCParam = Math.max(
      ...Object.entries(constants).map(([key, value]) => (key.startsWith('ZSTD_c_') ? (value as number) : 0)),
    );
    const kMaxZstdDParam = Math.max(
      ...Object.entries(constants).map(([key, value]) => (key.startsWith('ZSTD_d_') ? (value as number) : 0)),
    );

    /** `opts.params` → 「索引 → 值」数组（`-1` = 未设置），校验对齐 `lib/zlib.js`。 */
    function collectParams(
      opts: ZlibOptions | undefined,
      max: number,
      invalid: new (key: unknown) => Error,
    ): Int32Array {
      const arr = new Int32Array(max + 1).fill(-1);
      const params = opts?.params as Record<string, unknown> | undefined;
      if (params) {
        for (const origKey of Object.keys(params)) {
          const key = +origKey;
          if (Number.isNaN(key) || key < 0 || key > max || arr[key] !== -1) {
            throw new invalid(origKey);
          }
          const value = params[origKey];
          if (typeof value !== 'number' && typeof value !== 'boolean') {
            throw new ERR_INVALID_ARG_TYPE('options.params[key]', 'number', value);
          }
          arr[key] = value as number;
        }
      }
      return arr;
    }

    /** brotli 字典：非法类型直接报错（zstd 则静默忽略——与 Node 一致）。 */
    function brotliDictionary(opts: ZlibOptions | undefined): Uint8Array | null {
      const dictionary = opts?.dictionary;
      if (dictionary === undefined) return null;
      if (isArrayBufferView(dictionary)) return dictionary as Uint8Array;
      if (isAnyArrayBuffer(dictionary)) return new Uint8Array(dictionary as ArrayBuffer);
      throw new ERR_INVALID_ARG_TYPE(
        'options.dictionary',
        ['Buffer', 'TypedArray', 'DataView', 'ArrayBuffer'],
        dictionary,
      );
    }

    function zstdDictionary(opts: ZlibOptions | undefined): Uint8Array | null {
      const dictionary = opts?.dictionary;
      if (dictionary === undefined) return null;
      if (isArrayBufferView(dictionary)) return dictionary as Uint8Array;
      if (isAnyArrayBuffer(dictionary)) return new Uint8Array(dictionary as ArrayBuffer);
      return null;
    }

    function Brotli(this: ZlibInstance, opts: ZlibOptions | undefined, mode: number): void {
      const params = collectParams(opts, kMaxBrotliParam, ERR_BROTLI_INVALID_PARAM);
      const dictionary = brotliDictionary(opts);
      const handle =
        mode === BROTLI_DECODE
          ? new binding.BrotliDecoderCodec(mode, { params, dictionary })
          : new binding.BrotliEncoderCodec(mode, { params, dictionary });
      this._codec = handle;
      ZlibBase.call(this, opts, mode, handle, brotliDefaultOpts);
    }
    Object.setPrototypeOf(Brotli.prototype, Zlib.prototype);
    Object.setPrototypeOf(Brotli, Zlib);

    function BrotliCompressCtor(this: ZlibInstance, opts?: ZlibOptions): unknown {
      if (!(this instanceof (BrotliCompressCtor as unknown as new () => ZlibInstance))) {
        return deprecateInstantiation(BrotliCompressCtor, 'DEP0184', opts);
      }
      Brotli.call(this, opts, BROTLI_ENCODE);
    }
    Object.setPrototypeOf(BrotliCompressCtor.prototype, Brotli.prototype);
    Object.setPrototypeOf(BrotliCompressCtor, Brotli);
    Object.defineProperty(BrotliCompressCtor, 'name', { value: 'BrotliCompress', configurable: true });

    function BrotliDecompressCtor(this: ZlibInstance, opts?: ZlibOptions): unknown {
      if (!(this instanceof (BrotliDecompressCtor as unknown as new () => ZlibInstance))) {
        return deprecateInstantiation(BrotliDecompressCtor, 'DEP0184', opts);
      }
      Brotli.call(this, opts, BROTLI_DECODE);
    }
    Object.setPrototypeOf(BrotliDecompressCtor.prototype, Brotli.prototype);
    Object.setPrototypeOf(BrotliDecompressCtor, Brotli);
    Object.defineProperty(BrotliDecompressCtor, 'name', { value: 'BrotliDecompress', configurable: true });

    function Zstd(this: ZlibInstance, opts: ZlibOptions | undefined, mode: number, maxParam: number): void {
      const invalid = ERR_ZSTD_INVALID_PARAM;
      const params = collectParams(opts, maxParam, invalid);
      const dictionary = zstdDictionary(opts);
      const pledgedSrcSize = opts?.pledgedSrcSize as number | bigint | undefined;
      const handle =
        mode === ZSTD_COMPRESS
          ? new binding.ZstdCompressCodec({ params, dictionary, pledgedSrcSize })
          : new binding.ZstdDecompressCodec({ params, dictionary, pledgedSrcSize });
      this._codec = handle;
      ZlibBase.call(this, opts, mode, handle, zstdDefaultOpts);
    }

    function ZstdCompressCtor(this: ZlibInstance, opts?: ZlibOptions): unknown {
      if (!(this instanceof (ZstdCompressCtor as unknown as new () => ZlibInstance))) {
        return deprecateInstantiation(ZstdCompressCtor, 'DEP0184', opts);
      }
      Zstd.call(this, opts, ZSTD_COMPRESS, kMaxZstdCParam);
    }
    Object.setPrototypeOf(ZstdCompressCtor.prototype, ZlibBase.prototype);
    Object.setPrototypeOf(ZstdCompressCtor, ZlibBase);
    Object.defineProperty(ZstdCompressCtor, 'name', { value: 'ZstdCompress', configurable: true });

    function ZstdDecompressCtor(this: ZlibInstance, opts?: ZlibOptions): unknown {
      if (!(this instanceof (ZstdDecompressCtor as unknown as new () => ZlibInstance))) {
        return deprecateInstantiation(ZstdDecompressCtor, 'DEP0184', opts);
      }
      Zstd.call(this, opts, ZSTD_DECOMPRESS, kMaxZstdDParam);
    }
    Object.setPrototypeOf(ZstdDecompressCtor.prototype, ZlibBase.prototype);
    Object.setPrototypeOf(ZstdDecompressCtor, ZlibBase);
    Object.defineProperty(ZstdDecompressCtor, 'name', { value: 'ZstdDecompress', configurable: true });

    // --- one-shot helpers ---------------------------------------------------

    function zlibBufferSync(engine: ZlibInstance, buffer: unknown): Uint8Array | { buffer: Uint8Array; engine: ZlibInstance } {
      if (typeof buffer === 'string') {
        buffer = Buffer.from(buffer);
      } else if (!isArrayBufferView(buffer)) {
        if (isAnyArrayBuffer(buffer)) {
          buffer = Buffer.from(buffer);
        } else {
          throw new ERR_INVALID_ARG_TYPE('buffer', ['string', 'Buffer', 'TypedArray', 'DataView', 'ArrayBuffer'], buffer);
        }
      }
      const result = processChunkSync(engine, buffer as Uint8Array, engine._finishFlushFlag);
      if (engine._info) return { buffer: result, engine };
      return result;
    }

    function zlibBuffer(
      engine: ZlibInstance,
      buffer: unknown,
      callback: (error: Error | null, result?: Uint8Array) => void,
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
      engine.on('error', (error: unknown) => callback(error as Error));
      engine.on('end', () => callback(null, Buffer.concat(chunks ?? [], nread)));
      (engine as unknown as { end(chunk: unknown): void }).end(buffer);
    }

    // --- class wrappers -----------------------------------------------------

    function defineCtor(mode: number, className: string, preprocess?: (opts: ZlibOptions) => ZlibOptions): new (opts?: ZlibOptions) => ZlibInstance {
      function Ctor(this: ZlibInstance, opts?: ZlibOptions): unknown {
        if (!(this instanceof (Ctor as unknown as new () => ZlibInstance))) {
          return deprecateInstantiation(Ctor, 'DEP0184', opts);
        }
        if (preprocess && opts) opts = preprocess(opts);
        (Zlib as unknown as (this: ZlibInstance, o: ZlibOptions | undefined, m: number) => void).call(this, opts, mode);
      }
      Object.defineProperty(Ctor, 'name', { value: className, configurable: true });
      Object.setPrototypeOf(Ctor.prototype, Zlib.prototype);
      Object.setPrototypeOf(Ctor, Zlib);
      return Ctor as unknown as new (opts?: ZlibOptions) => ZlibInstance;
    }

    const Deflate = defineCtor(DEFLATE, 'Deflate');
    const Inflate = defineCtor(INFLATE, 'Inflate');
    const Gzip = defineCtor(GZIP, 'Gzip');
    const Gunzip = defineCtor(GUNZIP, 'Gunzip');
    const DeflateRaw = defineCtor(DEFLATERAW, 'DeflateRaw', (opts) => (opts.windowBits === 8 ? { ...opts, windowBits: 9 } : opts));
    const InflateRaw = defineCtor(INFLATERAW, 'InflateRaw');
    const Unzip = defineCtor(UNZIP, 'Unzip');

    const createProperty = (ctor: new (opts?: ZlibOptions) => ZlibInstance, name: string): { value: (options?: ZlibOptions) => ZlibInstance } => ({
      value: Object.defineProperty((options?: ZlibOptions): ZlibInstance => new ctor(options), 'name', { value: name }),
    });

    const createConvenienceMethod = (ctor: new (opts?: ZlibOptions) => ZlibInstance, sync: boolean) => {
      if (sync) {
        return function syncBufferWrapper(buffer: unknown, opts?: ZlibOptions): unknown {
          return zlibBufferSync(new ctor(opts), buffer);
        };
      }
      return function asyncBufferWrapper(
        buffer: unknown,
        opts?: ZlibOptions | ((error: Error | null, result?: Uint8Array) => void),
        callback?: (error: Error | null, result?: Uint8Array) => void,
      ): void {
        if (typeof opts === 'function') {
          callback = opts;
          opts = {};
        }
        return zlibBuffer(new ctor(opts as ZlibOptions), buffer, callback as (error: Error | null, result?: Uint8Array) => void);
      };
    };

    // --- stubs for what the host has no codec for ---------------------------

    const lose = (name: string, why: string) => (): never => {
      throw notImplemented('api', `zlib ${name}`, why);
    };
    const loseClass = (name: string, why: string, base?: TransformCtor) => {
      const Parent = (base ?? Object) as new (opts?: Record<string, unknown>) => object;
      const cls = class extends (Parent as new (opts?: Record<string, unknown>) => object) {
        constructor(_options?: unknown) {
          super();
          throw notImplemented('api', `zlib ${name}`, why);
        }
      };
      if (base) defineZlibBaseSurface(cls.prototype, why);
      Object.defineProperty(cls, 'name', { value: name, configurable: true });
      return cls as unknown as new (opts?: ZlibOptions) => never;
    };

    const defineZlibBaseSurface = (proto: object, why: string): void => {
      const loseMember = (member: string) => (): never => {
        throw notImplemented('api', `zlib ${member}`, why);
      };
      for (const member of ['_flush', '_processChunk', 'close', 'flush', 'params', 'reset']) {
        Object.defineProperty(proto, member, { value: loseMember(member), writable: true, configurable: true });
      }
      Object.defineProperty(proto, '_closed', {
        get: (): never => {
          throw notImplemented('api', 'zlib _closed', why);
        },
        configurable: true,
      });
    };

    const NO_ZIP = 'Zip archive support is not implemented.';

    const defineZipSurface = (
      ctor: unknown,
      methods: readonly string[],
      accessors: readonly string[],
      statics: readonly string[],
    ): void => {
      const proto = (ctor as { prototype: object }).prototype;
      for (const member of methods) {
        Object.defineProperty(proto, member, {
          value: (): never => {
            throw notImplemented('api', `zlib Zip ${member}`, NO_ZIP);
          },
          writable: true,
          configurable: true,
        });
      }
      for (const member of accessors) {
        Object.defineProperty(proto, member, {
          get: (): never => {
            throw notImplemented('api', `zlib Zip ${member}`, NO_ZIP);
          },
          configurable: true,
        });
      }
      for (const member of statics) {
        Object.defineProperty(ctor, member, {
          value: (): never => {
            throw notImplemented('api', `zlib Zip ${member}`, NO_ZIP);
          },
          writable: true,
          configurable: true,
        });
      }
    };

    const ZipBuffer = loseClass('ZipBuffer', NO_ZIP);
    const ZipEntry = loseClass('ZipEntry', NO_ZIP);
    const ZipFile = loseClass('ZipFile', NO_ZIP);
    defineZipSurface(
      ZipBuffer,
      ['add', 'addEntry', 'addSync', 'clear', 'delete', 'entries', 'forEach', 'get', 'has', 'keys', 'toBuffer', 'toBufferSync', 'values'],
      ['comment', 'size', 'writable'],
      [],
    );
    defineZipSurface(
      ZipEntry,
      ['contentIterator', 'contentSync', 'isDirectory', 'isFile', 'isSymlink'],
      ['comment', 'compressed', 'compressedSize', 'content', 'crc32', 'flags', 'method', 'mode', 'modified', 'name', 'nameBuffer', 'rawContent', 'size'],
      ['create', 'createStream', 'createSymlink', 'createSync', 'read'],
    );
    defineZipSurface(
      ZipFile,
      ['add', 'addEntry', 'addEntrySync', 'addSync', 'close', 'closeSync', 'compact', 'compactSync', 'delete', 'deleteSync', 'entries', 'entriesSync', 'forEach', 'forEachSync', 'get', 'getSync', 'has', 'keys', 'size', 'stream', 'values', 'valuesSync'],
      ['comment', 'writable'],
      ['open', 'openSync'],
    );

    // --- crc32 --------------------------------------------------------------

    function crc32(data: unknown, value: unknown = 0): number {
      if (typeof data !== 'string' && !isArrayBufferView(data)) {
        throw new ERR_INVALID_ARG_TYPE('data', ['Buffer', 'TypedArray', 'DataView', 'string'], data);
      }
      validateUint32(value, 'value');
      const v = (value as number) + 0; // coerce -0 to +0
      return binding.crc32(data as Uint8Array | string, v);
    }

    const api: Record<string, unknown> = {
      constants,
      codes,
      Deflate,
      Inflate,
      DeflateRaw,
      InflateRaw,
      Gzip,
      Gunzip,
      Unzip,
      deflate: createConvenienceMethod(Deflate, false),
      inflate: createConvenienceMethod(Inflate, false),
      deflateRaw: createConvenienceMethod(DeflateRaw, false),
      inflateRaw: createConvenienceMethod(InflateRaw, false),
      gzip: createConvenienceMethod(Gzip, false),
      gunzip: createConvenienceMethod(Gunzip, false),
      unzip: createConvenienceMethod(Unzip, false),
      deflateSync: createConvenienceMethod(Deflate, true),
      inflateSync: createConvenienceMethod(Inflate, true),
      deflateRawSync: createConvenienceMethod(DeflateRaw, true),
      inflateRawSync: createConvenienceMethod(InflateRaw, true),
      gzipSync: createConvenienceMethod(Gzip, true),
      gunzipSync: createConvenienceMethod(Gunzip, true),
      unzipSync: createConvenienceMethod(Unzip, true),
      crc32,
      // brotli / zstd: the real upstream codecs, compiled to wasm (M118).
      BrotliCompress: BrotliCompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance,
      BrotliDecompress: BrotliDecompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance,
      brotliCompress: createConvenienceMethod(BrotliCompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance, false),
      brotliCompressSync: createConvenienceMethod(BrotliCompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance, true),
      brotliDecompress: createConvenienceMethod(BrotliDecompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance, false),
      brotliDecompressSync: createConvenienceMethod(BrotliDecompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance, true),
      createBrotliCompress: ((options?: ZlibOptions): ZlibInstance => new (BrotliCompressCtor as unknown as new (o?: ZlibOptions) => ZlibInstance)(options)),
      createBrotliDecompress: ((options?: ZlibOptions): ZlibInstance => new (BrotliDecompressCtor as unknown as new (o?: ZlibOptions) => ZlibInstance)(options)),
      ZstdCompress: ZstdCompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance,
      ZstdDecompress: ZstdDecompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance,
      zstdCompress: createConvenienceMethod(ZstdCompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance, false),
      zstdCompressSync: createConvenienceMethod(ZstdCompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance, true),
      zstdDecompress: createConvenienceMethod(ZstdDecompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance, false),
      zstdDecompressSync: createConvenienceMethod(ZstdDecompressCtor as unknown as new (opts?: ZlibOptions) => ZlibInstance, true),
      createZstdCompress: ((options?: ZlibOptions): ZlibInstance => new (ZstdCompressCtor as unknown as new (o?: ZlibOptions) => ZlibInstance)(options)),
      createZstdDecompress: ((options?: ZlibOptions): ZlibInstance => new (ZstdDecompressCtor as unknown as new (o?: ZlibOptions) => ZlibInstance)(options)),
      createZipArchive: lose('createZipArchive', NO_ZIP),
      createZipArchiveSync: lose('createZipArchiveSync', NO_ZIP),
      zipFiles: lose('zipFiles', NO_ZIP),
      getMaxZipContentSize: lose('getMaxZipContentSize', NO_ZIP),
      setMaxZipContentSize: lose('setMaxZipContentSize', NO_ZIP),
      ZipBuffer,
      ZipEntry,
      ZipFile,
    };

    // `create*` are accessor-like read-only properties, as in Node.
    Object.defineProperties(api, {
      createDeflate: createProperty(Deflate, 'createDeflate'),
      createInflate: createProperty(Inflate, 'createInflate'),
      createDeflateRaw: createProperty(DeflateRaw, 'createDeflateRaw'),
      createInflateRaw: createProperty(InflateRaw, 'createInflateRaw'),
      createGzip: createProperty(Gzip, 'createGzip'),
      createGunzip: createProperty(Gunzip, 'createGunzip'),
      createUnzip: createProperty(Unzip, 'createUnzip'),
    });

    return api;
  },
};

/** Options accepted by the zlib streams (mirrors Node's). */
interface ZlibOptions {
  flush?: number;
  finishFlush?: number;
  chunkSize?: number;
  windowBits?: number;
  level?: number;
  memLevel?: number;
  strategy?: number;
  dictionary?: Uint8Array | ArrayBuffer | ArrayBufferView;
  info?: boolean;
  maxOutputLength?: number;
  rejectGarbageAfterEnd?: boolean;
  params?: Record<string | number, number | boolean>;
  pledgedSrcSize?: number | bigint;
  encoding?: string | null;
  objectMode?: boolean;
  writableObjectMode?: boolean;
  [key: string]: unknown;
}

/** The `Transform`-shaped stream Node's zlib classes are. */
interface ZlibInstance extends TransformLike {
  _codec?: ZlibCodecLike;
  _outBuffer: Uint8Array;
  _outOffset: number;
  _chunkSize: number;
  _defaultFlushFlag: number;
  _finishFlushFlag: number;
  _defaultFullFlushFlag: number;
  _maxOutputLength: number;
  _rejectGarbageAfterEnd: boolean;
  _info?: boolean;
  _level: number;
  _strategy: number;
  _mode: number;
  bytesWritten: number;
  reset(): void;
  flush(kind?: unknown, callback?: unknown): void;
  close(callback?: (err?: Error | null) => void): void;
  params(level: unknown, strategy: unknown, callback?: () => void): void;
  _transform(chunk: Uint8Array, encoding: string, cb: (error?: Error) => void): void;
  _flush(callback: (error?: Error) => void): void;
  _final(callback: () => void): void;
  _destroy(err: Error | null, callback: (error: Error | null) => void): void;
}

// The function constructors above are wired onto real `Transform` at init time.
