/**
 * `zlib` binding —— native → WASM（M116）。
 *
 * 背后是**真 `deps/zlib`**（zlib 1.3.2.1-motley，Node 上游同一份源码）用 wasi-sdk
 * 编出的 wasm 模块（`native/src/wn_zlib.c` + `native/build.mjs`）。取巧之处为零：
 * deflate/gzip/inflate 的每一个字节都由上游 C 产生。
 *
 * 这一层的职责是把 C 的流式 API 封成一个 JS 好用的 **codec**：
 *
 *   const codec = new ZlibCodec({ mode, level, windowBits, memLevel, strategy, dictionary });
 *   const out = codec.push(chunk, flush);   // 返回本次产生的字节
 *   codec.reset(); codec.setParams(level, strategy); codec.close();
 *
 * 语义（mode → windowBits 映射、预设字典的装载时机、错误消息/码、gzip 多成员、
 * Z_NEED_DICT 重试）逐条对齐 `src/node_zlib.cc` 的 `ZlibContext`，所以上层
 * `builtins/zlib.ts` 的行为能与真 Node 逐字节一致。
 *
 * 缓冲区由 wasm 侧持有（`wn_zlib_ensure` 按需 realloc），因此宿主永不把自己的
 * TypedArray 指针传进 wasm —— 也就绕开了「wasm 内存 grow 会 detach 已有视图」这个坑。
 * 每次都从 `memory.buffer` 重新取视图。
 */
import type { BindingContext } from './context';
import { wasmModule } from '../wasm/registry';
import type { WasmExports } from '../wasm/loader';

/** Node 的 `enum node_zlib_mode`（与 `lib/zlib.js` 里的同名常量同值）。 */
export const ZLIB_MODE = {
  DEFLATE: 1,
  INFLATE: 2,
  GZIP: 3,
  GUNZIP: 4,
  DEFLATERAW: 5,
  INFLATERAW: 6,
  UNZIP: 7,
} as const;

/** zlib 返回码与 flush 值（`zlib.h`）。 */
export const Z = {
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
} as const;

/** 对齐 `node_zlib.cc` 的 `ZlibStrerror`：返回码 → `Z_*` 名字。 */
export function zlibStrerror(code: number): string {
  for (const [name, value] of Object.entries(Z)) {
    if (value === code && name.startsWith('Z_') && !name.endsWith('FLUSH')) return name;
  }
  return 'Z_UNKNOWN_ERROR';
}

/**
 * `ERR_TRAILING_JUNK_AFTER_STREAM_END`：与 `internal/errors` 里同码同形（`TypeError`
 * 基底、无 `errno`）。绑定层不依赖 `internal/errors`（那是 builtin 的地盘），所以就地构造；
 * 该码已进 `internal/errors` 的码表，供 `lib/` 侧源码使用。
 */
function trailingJunkError(): Error {
  const err = new TypeError(
    'Trailing junk found after the end of the compressed stream',
  ) as Error & { code?: string };
  err.code = 'ERR_TRAILING_JUNK_AFTER_STREAM_END';
  return err;
}

function ex(name: string = 'wn_zlib'): WasmExports {
  return wasmModule(name);
}

function memory(name: string = 'wn_zlib'): WebAssembly.Memory {
  return ex(name).memory as WebAssembly.Memory;
}

/** 读 wasm 线性内存里以 NUL 结尾的字符串。 */
function readCString(ptr: number, name: string = 'wn_zlib'): string {
  const bytes = new Uint8Array(memory(name).buffer);
  let end = ptr;
  while (bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(ptr, end));
}

export interface ZlibOptions {
  mode: number;
  level: number;
  windowBits: number;
  memLevel: number;
  strategy: number;
  dictionary?: Uint8Array | null;
  /** 对齐 Node：`Z_STREAM_END` 之后还有多余输入就报错（默认放行）。 */
  rejectGarbageAfterEnd?: boolean;
}

/**
 * 一个 zlib 流。所有 deflate/inflate 状态都在 wasm 侧，这里只负责搬运字节。
 */
export class ZlibCodec {
  readonly mode: number;
  readonly outCap: number;
  #h: number;
  #dict: Uint8Array | null;
  #rejectGarbage: boolean;
  #closed = false;
  #finished = false;
  /** 上一次 `push` 之后还剩在输入缓冲里的字节（尾随垃圾）。 */
  #lastInputLeft = 0;

  constructor(opts: ZlibOptions, outCap = 16384) {
    const e = ex();
    const h = (e.wn_zlib_new as (m: number, l: number, w: number, ml: number, s: number) => number)(
      opts.mode,
      opts.level,
      opts.windowBits,
      opts.memLevel,
      opts.strategy,
    );
    if (!h) throw new Error('zlib: failed to allocate stream');
    this.#h = h;
    this.mode = opts.mode;
    this.outCap = outCap;
    this.#dict = opts.dictionary && opts.dictionary.byteLength > 0 ? opts.dictionary : null;
    this.#rejectGarbage = opts.rejectGarbageAfterEnd === true;
    if (this.#rejectGarbage) {
      (e.wn_zlib_set_reject_garbage as (h: number, reject: number) => void)(h, 1);
    }
    // 有预设字典：装进流（DEFLATE/DEFLATERAW 立即生效，INFLATERAW 立即生效，
    // 其余 inflate 侧等 Z_NEED_DICT —— 与 `ZlibContext::SetDictionary` 一致）。
    if (this.#dict) {
      this.#ensure(0, 0, this.#dict.byteLength);
      const dictPtr = (e.wn_zlib_dict_ptr as (h: number) => number)(this.#h);
      new Uint8Array(memory().buffer, dictPtr, this.#dict.byteLength).set(this.#dict);
      (e.wn_zlib_set_dict_len as (h: number, len: number) => void)(this.#h, this.#dict.byteLength);
      const ret = (e.wn_zlib_apply_dict as (h: number) => number)(this.#h);
      if (ret !== Z.Z_OK) throw this.#error('Failed to set dictionary', ret);
    }
  }

  #ensure(inCap: number, outCap: number, dictCap: number): void {
    const ret = (ex().wn_zlib_ensure as (h: number, i: number, o: number, d: number) => number)(
      this.#h,
      inCap,
      outCap,
      dictCap,
    );
    if (ret !== 0) throw new Error('zlib: out of memory');
  }

  /** 返回码 → Node 形状的错误（`Error` + `code` = `Z_*` + `errno`）。 */
  #error(fallback: string, ret: number): Error {
    const msgPtr = (ex().wn_zlib_msg as (h: number) => number)(this.#h);
    const message = msgPtr ? readCString(msgPtr) : fallback;
    const err = new Error(message) as Error & { code?: string; errno?: number };
    err.code = zlibStrerror(ret);
    err.errno = ret;
    return err;
  }

  /**
   * 把 `chunk` 喂给流，返回本次产生的字节（可能为空）。
   *
   * 循环条件对齐 `lib/zlib.js` 的 `processChunkSync`：输出缓冲被填满就再来一轮，
   * 否则输入已消费完、收工。致命的返回码在这里抛成 Node 形状的错误。
   */
  push(chunk: Uint8Array, flush: number): Uint8Array {
    if (this.#closed) throw new Error('zlib binding closed');
    const e = ex();
    this.#ensure(chunk.byteLength, this.outCap, 0);
    const inPtr = (e.wn_zlib_in_ptr as (h: number) => number)(this.#h);
    if (chunk.byteLength > 0) {
      new Uint8Array(memory().buffer, inPtr, chunk.byteLength).set(chunk);
    }
    const outPtr = (e.wn_zlib_out_ptr as (h: number) => number)(this.#h);
    const write = e.wn_zlib_write as (h: number, io: number, il: number, ol: number, f: number) => number;
    const availIn = e.wn_zlib_avail_in as (h: number) => number;
    const availOut = e.wn_zlib_avail_out as (h: number) => number;

    const parts: Uint8Array[] = [];
    let total = 0;
    let inOff = 0;
    let remaining = chunk.byteLength;
    let ret: number = Z.Z_OK;
    let outLeft: number = this.outCap;

    for (;;) {
      ret = write(this.#h, inOff, remaining, this.outCap, flush);
      outLeft = availOut(this.#h);
      const inLeft = availIn(this.#h);
      this.#lastInputLeft = inLeft;
      const have = this.outCap - outLeft;
      if (have > 0) {
        parts.push(new Uint8Array(memory().buffer, outPtr, have).slice());
        total += have;
      }
      if (ret === Z.Z_STREAM_END) {
        this.#finished = true;
        break;
      }
      if (ret !== Z.Z_OK && ret !== Z.Z_BUF_ERROR) break;
      if (outLeft !== 0) break;
      inOff += remaining - inLeft;
      remaining = inLeft;
    }

    // 致命判定对齐 `ZlibContext::GetErrorInfo`。
    if (ret === Z.Z_OK || ret === Z.Z_BUF_ERROR) {
      if (outLeft !== 0 && flush === Z.Z_FINISH) {
        throw this.#error('unexpected end of file', ret);
      }
    } else if (ret === Z.Z_STREAM_END) {
      const inLeft = availIn(this.#h);
      if (this.#rejectGarbage && inLeft > 0) {
        throw trailingJunkError();
      }
    } else if (ret === Z.Z_NEED_DICT) {
      throw this.#error(this.#dict ? 'Bad dictionary' : 'Missing dictionary', ret);
    } else {
      throw this.#error('Zlib error', ret);
    }

    if (total === 0) return EMPTY;
    if (parts.length === 1) return parts[0];
    const joined = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.byteLength;
    }
    return joined;
  }

  /** 对齐 `ZlibContext::ResetStream`。 */
  reset(): void {
    if (this.#closed) throw new Error('zlib binding closed');
    const ret = (ex().wn_zlib_reset as (h: number) => number)(this.#h);
    if (ret !== Z.Z_OK) throw this.#error('Failed to reset stream', ret);
    this.#finished = false;
  }

  /** 对齐 `ZlibContext::SetParams`（底层是 `deflateParams`）。 */
  setParams(level: number, strategy: number): void {
    if (this.#closed) throw new Error('zlib binding closed');
    const ret = (ex().wn_zlib_set_params as (h: number, l: number, s: number) => number)(
      this.#h,
      level,
      strategy,
    );
    if (ret !== Z.Z_OK && ret !== Z.Z_BUF_ERROR) {
      throw this.#error('Failed to set parameters', ret);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    (ex().wn_zlib_end as (h: number) => number)(this.#h);
    this.#h = 0;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** 上一次 `push` 后未消费的输入字节数。 */
  get lastInputLeft(): number {
    return this.#lastInputLeft;
  }

  /** 是否已到达流的结尾（`Z_STREAM_END`）。 */
  get finished(): boolean {
    return this.#finished;
  }
}

const EMPTY = new Uint8Array(0);

/** 对齐 Node 的 `zlib.crc32(data, value = 0)`。 */
export function crc32(data: Uint8Array | string, value = 0): number {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const e = ex();
  const p = (e.wn_zlib_alloc as (n: number) => number)(bytes.byteLength || 1);
  try {
    if (bytes.byteLength > 0) new Uint8Array(memory().buffer, p, bytes.byteLength).set(bytes);
    return (e.wn_zlib_crc32 as (v: number, p: number, n: number) => number)(value >>> 0, p, bytes.byteLength);
  } finally {
    (e.wn_zlib_free as (p: number) => void)(p);
  }
}

export function adler32(data: Uint8Array, value = 1): number {
  const e = ex();
  const p = (e.wn_zlib_alloc as (n: number) => number)(data.byteLength || 1);
  try {
    if (data.byteLength > 0) new Uint8Array(memory().buffer, p, data.byteLength).set(data);
    return (e.wn_zlib_adler32 as (v: number, p: number, n: number) => number)(value >>> 0, p, data.byteLength);
  } finally {
    (e.wn_zlib_free as (p: number) => void)(p);
  }
}

export function zlibVersion(): string {
  return readCString((ex().wn_zlib_version as () => number)());
}

export function compressBound(srcLen: number): number {
  return Number((ex().wn_zlib_compress_bound as (n: number) => number | bigint)(srcLen));
}

/**
 * `internalBinding('zlib')` 的表面。
 *
 * 我们的 `builtins/zlib.ts` 直接用这些原语；把它挂进 REGISTRY 也让**将来 vendor
 * 真 `lib/zlib.js`**（它同样写 `internalBinding('zlib')`）能直接复用这一层。
 */
// ---------------------------------------------------------------------------
// Raw native-handle ABI (mirrors `src/node_zlib.cc`'s `CompressionStream`).
//
// vendored `lib/internal/streams/iter/transform.js` (used by `lib/zlib/iter.js`)
// constructs bare handles and drives them directly:
//
//   const h = new binding.Zlib(mode);
//   h.onerror = onError;
//   h.init(windowBits, level, memLevel, strategy, writeState, processCallback, dictionary);
//   h.write(flush, input, inOffset, inLen, out, outOffset, outLen);   // async
//   h.writeSync(...);  h.reset();  h.params(level, strategy);  h.close();
//
// `writeState` is a caller-owned `Uint32Array(2)` the native side fills with
// `[availOut, availIn]` after every write; the JS loop re-issues `write()` while
// `availOut === 0` (the output buffer was exhausted). Compression here runs in
// wasm, so this presents exactly that surface on top of the codecs above.
// ---------------------------------------------------------------------------

type RawHandleProcessCallback = () => void;
type RawHandleOnError = (message: string, errno: number, code: string) => void;

interface RawCodec {
  push(chunk: Uint8Array, flush: number): Uint8Array;
  reset(): void;
  setParams(level: number, strategy: number): void;
  close(): void;
  readonly closed: boolean;
  readonly finished: boolean;
  readonly lastInputLeft: number;
}

/** Shared driving logic for the `binding.Zlib` / `binding.BrotliEncoder` / … handles. */
class RawHandle {
  #make: (() => RawCodec) | null = null;
  #codec: RawCodec | null = null;
  #writeState: Uint32Array | null = null;
  #processCallback: RawHandleProcessCallback | null = null;
  #pending: Uint8Array | null = null;
  #pendingOff = 0;
  #availIn = 0;
  #writeInProgress = false;
  #pendingClose = false;
  #closed = false;

  /** `onerror(message, errno, code)` — set by the caller; invoked *instead of* the write callback. */
  onerror: RawHandleOnError | null = null;
  /** Node keeps a reference to the in-flight input buffer here; mirror the slot. */
  buffer: unknown = null;

  /** Register the codec factory. Called from a subclass' `init`. */
  protected _setup(make: () => RawCodec): void {
    this.#make = make;
  }

  protected _install(writeState: Uint32Array, processCallback: RawHandleProcessCallback): void {
    this.#writeState = writeState;
    this.#processCallback = processCallback;
  }

  #ensureCodec(): RawCodec {
    let codec = this.#codec;
    if (!codec) {
      if (!this.#make) throw new Error('zlib: handle used before init');
      codec = this.#codec = this.#make();
    }
    return codec;
  }

  #emitError(err: unknown): void {
    const e = err as { message?: string; errno?: number; code?: string } | null;
    const message = e && typeof e.message === 'string' ? e.message : String(err);
    const errno = e && typeof e.errno === 'number' ? e.errno : -1;
    const code = e && typeof e.code === 'string' ? e.code : 'ERR_ZLIB_INITIALIZATION_FAILED';
    this.#writeInProgress = false;
    this.onerror?.(message, errno, code);
    if (this.#pendingClose) this.close();
  }

  #pump(
    input: Uint8Array | null,
    inOff: number,
    inLen: number,
    out: Uint8Array,
    outOff: number,
    outLen: number,
    flush: number,
  ): void {
    const codec = this.#ensureCodec();
    // Feed the codec when there is input, or when a flush/finish was requested and
    // the stream has not already reached its end. Drain-only re-entries from the
    // caller's loop arrive with `inLen === 0`.
    if (this.#pending === null && (inLen > 0 || (flush !== 0 && !codec.finished))) {
      const chunk = input && inLen > 0 ? input.subarray(inOff, inOff + inLen) : EMPTY;
      const produced = codec.push(chunk, flush);
      this.#availIn = codec.lastInputLeft;
      if (produced.byteLength > 0) {
        this.#pending = produced;
        this.#pendingOff = 0;
      }
    }
    // Deliver as much as fits into the caller's output buffer.
    let copied = 0;
    while (copied < outLen && this.#pending !== null) {
      const available = this.#pending.byteLength - this.#pendingOff;
      const n = available < outLen - copied ? available : outLen - copied;
      out.set(this.#pending.subarray(this.#pendingOff, this.#pendingOff + n), outOff + copied);
      this.#pendingOff += n;
      copied += n;
      if (this.#pendingOff >= this.#pending.byteLength) {
        this.#pending = null;
        this.#pendingOff = 0;
      }
    }
    const ws = this.#writeState;
    if (ws) {
      ws[0] = outLen - copied;
      ws[1] = this.#availIn;
    }
  }

  write(
    flush: number,
    input: Uint8Array | null,
    inOff: number,
    inLen: number,
    out: Uint8Array,
    outOff: number,
    outLen: number,
  ): void {
    if (this.#closed) throw new Error('zlib binding closed');
    this.#writeInProgress = true;
    try {
      this.#pump(input, inOff, inLen, out, outOff, outLen, flush);
    } catch (err) {
      this.#emitError(err);
      return;
    }
    // Compression is synchronous in wasm; the callback still fires asynchronously
    // so the caller's `await` behaves like Node's threadpool completion.
    queueMicrotask(() => {
      this.#writeInProgress = false;
      this.#processCallback?.();
      if (this.#pendingClose) this.close();
    });
  }

  writeSync(
    flush: number,
    input: Uint8Array | null,
    inOff: number,
    inLen: number,
    out: Uint8Array,
    outOff: number,
    outLen: number,
  ): void {
    if (this.#closed) throw new Error('zlib binding closed');
    try {
      this.#pump(input, inOff, inLen, out, outOff, outLen, flush);
    } catch (err) {
      // Node reports sync failures through `onerror` (and leaves `writeState` stale).
      this.#emitError(err);
    }
  }

  reset(): void {
    if (this.#writeInProgress) {
      throw new Error('Cannot reset zlib stream while a write is in progress');
    }
    try {
      this.#codec?.reset();
    } catch (err) {
      this.#emitError(err);
    }
  }

  params(level: number, strategy: number): void {
    try {
      this.#codec?.setParams(level, strategy);
    } catch (err) {
      this.#emitError(err);
    }
  }

  close(): void {
    if (this.#writeInProgress) {
      this.#pendingClose = true;
      return;
    }
    if (this.#closed) return;
    this.#closed = true;
    this.#codec?.close();
  }
}

/** `new binding.Zlib(mode)` — bare deflate/inflate/gzip/gunzip handle. */
class ZlibStreamHandle extends RawHandle {
  readonly #mode: number;
  constructor(mode: number) {
    super();
    this.#mode = mode;
  }

  init(
    windowBits: number,
    level: number,
    memLevel: number,
    strategy: number,
    writeState: Uint32Array,
    processCallback: RawHandleProcessCallback,
    dictionary?: Uint8Array | null,
    rejectGarbageAfterEnd?: boolean,
  ): void {
    const mode = this.#mode;
    const reject = rejectGarbageAfterEnd === true;
    const dict = dictionary ?? null;
    this._setup(() => new ZlibCodec({ mode, level, windowBits, memLevel, strategy, dictionary: dict, rejectGarbageAfterEnd: reject }));
    this._install(writeState, processCallback);
  }
}

/** `new binding.BrotliEncoder(mode)` / `binding.BrotliDecoder(mode)`. */
function makeBrotliHandleCtor(mode: number): new (mode?: number) => RawHandle {
  return class extends RawHandle {
    init(
      paramsArray: Uint32Array,
      writeState: Uint32Array,
      processCallback: RawHandleProcessCallback,
      dictionary?: Uint8Array | null,
    ): void {
      const params = paramsArray ? new Int32Array(paramsArray) : undefined;
      const dict = dictionary ?? null;
      this._setup(() => new BrotliCodec({ mode, params, dictionary: dict }));
      this._install(writeState, processCallback);
    }
  };
}

/** `new binding.ZstdCompress()` / `binding.ZstdDecompress()`. */
function makeZstdHandleCtor(mode: number): new () => RawHandle {
  return class extends RawHandle {
    init(
      paramsArray: Uint32Array,
      pledgedSrcSize: number | undefined,
      writeState: Uint32Array,
      processCallback: RawHandleProcessCallback,
      dictionary?: Uint8Array | null,
    ): void {
      const params = paramsArray ? new Int32Array(paramsArray) : undefined;
      const dict = dictionary ?? null;
      this._setup(() => new ZstdCodec({ mode, params, dictionary: dict, pledgedSrcSize }));
      this._install(writeState, processCallback);
    }
  };
}

export function zlibBinding(_ctx: BindingContext): Record<string, unknown> {
  return {
    // Raw native-handle surface (what vendored Node `lib/` code expects).
    Zlib: ZlibStreamHandle,
    BrotliEncoder: makeBrotliHandleCtor(BROTLI_MODE.ENCODE),
    BrotliDecoder: makeBrotliHandleCtor(BROTLI_MODE.DECODE),
    ZstdCompress: makeZstdHandleCtor(ZSTD_MODE.COMPRESS),
    ZstdDecompress: makeZstdHandleCtor(ZSTD_MODE.DECOMPRESS),
    // High-level codecs — used by our hand-ported `builtins/zlib.ts`.
    ZlibCodec,
    BrotliEncoderCodec: makeBrotliCtor(BROTLI_MODE.ENCODE),
    BrotliDecoderCodec: makeBrotliCtor(BROTLI_MODE.DECODE),
    ZstdCompressCodec: makeZstdCtor(ZSTD_MODE.COMPRESS),
    ZstdDecompressCodec: makeZstdCtor(ZSTD_MODE.DECOMPRESS),
    crc32,
    adler32,
    zlibVersion,
    compressBound,
    modes: { ...ZLIB_MODE, ...BROTLI_MODE, ...ZSTD_MODE },
    codes: Z,
  };
}

// ---------------------------------------------------------------------------
// brotli / zstd（M118）—— 与 ZlibCodec 同形的 codec（`push(chunk, flush)`）
// ---------------------------------------------------------------------------

/** `enum node_zlib_mode` 里 brotli/zstd 的取值。 */
export const BROTLI_MODE = { ENCODE: 8, DECODE: 9 } as const;
export const ZSTD_MODE = { COMPRESS: 10, DECOMPRESS: 11 } as const;

/** brotli 的 operation（`encode.h`）与 zstd 的 end directive（`zstd.h`）。 */
const BROTLI_OPERATION_PROCESS = 0;
const BROTLI_OPERATION_FINISH = 2;
const ZSTD_E_CONTINUE = 0;
const ZSTD_E_END = 2;

/** brotli 解码结果（`decode.h`）。 */
const BROTLI_DECODER_RESULT_SUCCESS = 1;
const BROTLI_DECODER_RESULT_ERROR = 0;
const BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT = 2;

/** 把原生错误码包装成 Node 形状的错误（`Error` + `code` + `errno`）。 */
function codecError(message: string, code: string, errno: number): Error {
  const err = new Error(message) as Error & { code?: string; errno?: number };
  err.code = code;
  err.errno = errno;
  return err;
}

/**
 * 一套可增长的 wasm 内存缓冲（输入/输出各一），供 brotli/zstd codec 搬运字节。
 * 缓冲区由 wasm 侧 `malloc`，所以 JS 只持有偏移，每次读都重取视图。
 */
class CodecBuffers {
  inPtr = 0;
  inCap = 0;
  outPtr = 0;
  outCap = 0;

  constructor(private readonly alloc: (n: number) => number, private readonly dealloc: (p: number) => void, private readonly memory: () => WebAssembly.Memory) {}

  ensureIn(size: number): number {
    if (size <= this.inCap && this.inPtr !== 0) return this.inPtr;
    if (this.inPtr !== 0) this.dealloc(this.inPtr);
    this.inCap = Math.max(size, 1024);
    this.inPtr = this.alloc(this.inCap);
    if (this.inPtr === 0) throw new Error('zlib: out of memory');
    return this.inPtr;
  }

  ensureOut(size: number): number {
    if (size <= this.outCap && this.outPtr !== 0) return this.outPtr;
    if (this.outPtr !== 0) this.dealloc(this.outPtr);
    this.outCap = Math.max(size, 16384);
    this.outPtr = this.alloc(this.outCap);
    if (this.outPtr === 0) throw new Error('zlib: out of memory');
    return this.outPtr;
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.memory().buffer);
  }

  free(): void {
    if (this.inPtr !== 0) this.dealloc(this.inPtr);
    if (this.outPtr !== 0) this.dealloc(this.outPtr);
    this.inPtr = this.outPtr = 0;
    this.inCap = this.outCap = 0;
  }
}

export interface BrotliCodecOptions {
  mode: number; // 8 = encode, 9 = decode
  /** 索引 → 参数值；`-1` 表示未设置（与 `lib/zlib.js` 的数组一致）。 */
  params?: Int32Array;
  dictionary?: Uint8Array | null;
}

/** brotli 流（编码或解码）。逐条对齐 `BrotliEncoderContext` / `BrotliDecoderContext`。 */
export class BrotliCodec {
  #h = 0;
  #encode: boolean;
  #buf: CodecBuffers;
  #closed = false;
  #finished = false;
  #lastInputLeft = 0;

  constructor(opts: BrotliCodecOptions, outCap = 16384) {
    const e = ex('wn_brotli');
    const mem = (): WebAssembly.Memory => memory('wn_brotli');
    this.#buf = new CodecBuffers(
      (n) => (e.wn_alloc as (n: number) => number)(n),
      (p) => (e.wn_dealloc as (p: number) => void)(p),
      mem,
    );
    this.#encode = opts.mode === BROTLI_MODE.ENCODE;
    this.#h = (this.#encode
      ? (e.wn_brotli_enc_new as () => number)()
      : (e.wn_brotli_dec_new as () => number)()) as number;
    if (!this.#h) throw new Error('zlib: failed to allocate brotli stream');

    // 字典先装（Node 在 `Init` 里做，且必须在参数之前/之后都无副作用）。
    const dict = opts.dictionary && opts.dictionary.byteLength > 0 ? opts.dictionary : null;
    if (dict) {
      const p = this.#buf.ensureIn(dict.byteLength);
      this.#buf.bytes().set(dict, p);
      const ok = this.#encode
        ? (e.wn_brotli_enc_set_dict as (h: number, p: number, n: number) => number)(this.#h, p, dict.byteLength)
        : (e.wn_brotli_dec_set_dict as (h: number, p: number, n: number) => number)(this.#h, p, dict.byteLength);
      if (!ok) throw codecError('Failed to attach brotli dictionary', 'ERR_ZLIB_DICTIONARY_LOAD_FAILED', -1);
    }

    const params = opts.params;
    if (params) {
      for (let key = 0; key < params.length; key++) {
        const value = params[key];
        if (value === -1) continue;
        const ok = this.#encode
          ? (e.wn_brotli_enc_set_param as (h: number, k: number, v: number) => number)(this.#h, key, value)
          : (e.wn_brotli_dec_set_param as (h: number, k: number, v: number) => number)(this.#h, key, value);
        if (!ok) {
          throw codecError(
            this.#encode ? 'Initialization failed' : 'Initialization failed',
            'ERR_ZLIB_INITIALIZATION_FAILED',
            -1,
          );
        }
      }
    }
  }

  setParams(): void {
    // 对齐 Node：brotli 的 `params()` 目前是 no-op。
  }

  push(chunk: Uint8Array, flush: number): Uint8Array {
    if (this.#closed) throw new Error('zlib binding closed');
    const e = ex('wn_brotli');
    const outCap = this.#buf.ensureOut(Math.max(this.#buf.outCap, 16384));
    const inPtr = this.#buf.ensureIn(chunk.byteLength);
    if (chunk.byteLength > 0) this.#buf.bytes().set(chunk, inPtr);

    const write = this.#encode
      ? (e.wn_brotli_enc_write as (h: number, ip: number, il: number, op: number, ol: number, f: number) => number)
      : (e.wn_brotli_dec_write as (h: number, ip: number, il: number, op: number, ol: number, f: number) => number);
    const availInOf = this.#encode
      ? (e.wn_brotli_enc_avail_in as (h: number) => number)
      : (e.wn_brotli_dec_avail_in as (h: number) => number);
    const availOutOf = this.#encode
      ? (e.wn_brotli_enc_avail_out as (h: number) => number)
      : (e.wn_brotli_dec_avail_out as (h: number) => number);

    const parts: Uint8Array[] = [];
    let total = 0;
    let inOff = 0;
    let inLen = chunk.byteLength;
    let availInAfter = 0;
    let lastOk = 1;

    for (;;) {
      lastOk = write(this.#h, inPtr + inOff, inLen, outCap, this.#buf.outCap, flush);
      const availOut = availOutOf(this.#h);
      availInAfter = availInOf(this.#h);
      this.#lastInputLeft = availInAfter;
      const have = this.#buf.outCap - availOut;
      if (have > 0) {
        parts.push(this.#buf.bytes().slice(outCap, outCap + have));
        total += have;
      }
      if (availOut === 0) {
        inOff += inLen - availInAfter;
        inLen = availInAfter;
        continue;
      }
      break;
    }

    if (this.#encode) {
      this.#finished = (e.wn_brotli_enc_is_finished as (h: number) => number)(this.#h) === 1;
      // `BrotliEncoderContext::GetErrorInfo`：`last_result_ === false` 即失败。
      if (lastOk === 0) {
        throw codecError('Compression failed', 'ERR_BROTLI_COMPRESSION_FAILED', -1);
      }
    } else {
      const result = (e.wn_brotli_dec_result as (h: number) => number)(this.#h);
      if (result === BROTLI_DECODER_RESULT_SUCCESS) {
        this.#finished = true;
      } else if (result === BROTLI_DECODER_RESULT_ERROR) {
        const code = (e.wn_brotli_dec_error_code as (h: number) => number)(this.#h);
        const ptr = (e.wn_brotli_dec_error_string as (h: number) => number)(this.#h);
        throw codecError('Decompression failed', 'ERR_' + readCString(ptr, 'wn_brotli'), code);
      } else if (flush === BROTLI_OPERATION_FINISH && result === BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT) {
        // 与 Node 一致：brotli 自己没有这个码，借用 zlib 的 `Z_BUF_ERROR`。
        throw codecError('unexpected end of file', 'Z_BUF_ERROR', Z.Z_BUF_ERROR);
      }
    }

    if (total === 0) return EMPTY;
    if (parts.length === 1) return parts[0];
    const joined = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.byteLength;
    }
    return joined;
  }

  reset(): void {
    if (this.#closed) throw new Error('zlib binding closed');
    const e = ex('wn_brotli');
    const ok = this.#encode
      ? (e.wn_brotli_enc_reset as (h: number) => number)(this.#h)
      : (e.wn_brotli_dec_reset as (h: number) => number)(this.#h);
    if (!ok) throw codecError('Initialization failed', 'ERR_ZLIB_INITIALIZATION_FAILED', -1);
    this.#finished = false;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const e = ex('wn_brotli');
    if (this.#encode) (e.wn_brotli_enc_free as (h: number) => void)(this.#h);
    else (e.wn_brotli_dec_free as (h: number) => void)(this.#h);
    this.#h = 0;
    this.#buf.free();
  }

  get closed(): boolean {
    return this.#closed;
  }
  get finished(): boolean {
    return this.#finished;
  }
  get lastInputLeft(): number {
    return this.#lastInputLeft;
  }
}

/** brotli 的 `new binding.BrotliEncoder(mode)` / `new binding.BrotliDecoder(mode)` 形状。 */
function makeBrotliCtor(mode: number): new (mode?: number, opts?: Omit<BrotliCodecOptions, 'mode'>) => BrotliCodec {
  return class extends BrotliCodec {
    constructor(_mode?: number, opts: Omit<BrotliCodecOptions, 'mode'> = {}) {
      super({ mode, ...opts });
    }
  } as unknown as new (mode?: number, opts?: Omit<BrotliCodecOptions, 'mode'>) => BrotliCodec;
}

export interface ZstdCodecOptions {
  mode: number; // 10 = compress, 11 = decompress
  params?: Int32Array;
  dictionary?: Uint8Array | null;
  pledgedSrcSize?: number | bigint;
}

/** zstd 流（压缩或解压）。逐条对齐 `ZstdCompressContext` / `ZstdDecompressContext`。 */
export class ZstdCodec {
  #h = 0;
  #compress: boolean;
  #buf: CodecBuffers;
  #closed = false;
  #finished = false;
  #lastInputLeft = 0;
  #pledgedKnown = false;
  #pledged = 0;

  constructor(opts: ZstdCodecOptions, outCap = 16384) {
    const e = ex('wn_zstd');
    const mem = (): WebAssembly.Memory => memory('wn_zstd');
    this.#buf = new CodecBuffers(
      (n) => (e.wn_alloc as (n: number) => number)(n),
      (p) => (e.wn_dealloc as (p: number) => void)(p),
      mem,
    );
    this.#compress = opts.mode === ZSTD_MODE.COMPRESS;
    this.#h = (this.#compress
      ? (e.wn_zstd_c_new as () => number)()
      : (e.wn_zstd_d_new as () => number)()) as number;
    if (!this.#h) throw new Error('zlib: failed to allocate zstd stream');

    if (this.#compress) {
      const pledged = opts.pledgedSrcSize;
      if (pledged === undefined) {
        (e.wn_zstd_c_set_pledged as (h: number, u: number, lo: number, hi: number) => number)(this.#h, 1, 0, 0);
      } else {
        const value = BigInt(pledged as number);
        const lo = Number(value & 0xffffffffn) >>> 0;
        const hi = Number((value >> 32n) & 0xffffffffn) >>> 0;
        this.#pledgedKnown = true;
        this.#pledged = Number(value);
        (e.wn_zstd_c_set_pledged as (h: number, u: number, lo: number, hi: number) => number)(this.#h, 0, lo, hi);
      }
      const ok = (e.wn_zstd_c_reset as (h: number) => number)(this.#h);
      if (!ok) throw codecError('Could not initialize zstd instance', 'ERR_ZLIB_INITIALIZATION_FAILED', -1);
      if (this.#pledgedKnown) {
        // `reset()` 会重置 pledged，这里恢复用户的设置。
        const value = BigInt(this.#pledged);
        (e.wn_zstd_c_set_pledged as (h: number, u: number, lo: number, hi: number) => number)(
          this.#h,
          0,
          Number(value & 0xffffffffn) >>> 0,
          Number((value >> 32n) & 0xffffffffn) >>> 0,
        );
        (e.wn_zstd_c_reset as (h: number) => number)(this.#h);
      }
    }

    const dict = opts.dictionary && opts.dictionary.byteLength > 0 ? opts.dictionary : null;
    if (dict) {
      const p = this.#buf.ensureIn(dict.byteLength);
      this.#buf.bytes().set(dict, p);
      const ok = this.#compress
        ? (e.wn_zstd_c_set_dict as (h: number, p: number, n: number) => number)(this.#h, p, dict.byteLength)
        : (e.wn_zstd_d_set_dict as (h: number, p: number, n: number) => number)(this.#h, p, dict.byteLength);
      if (!ok) throw codecError('Failed to load zstd dictionary', 'ERR_ZLIB_DICTIONARY_LOAD_FAILED', -1);
    }

    const params = opts.params;
    if (params) {
      for (let key = 0; key < params.length; key++) {
        const value = params[key];
        if (value === -1) continue;
        const ok = this.#compress
          ? (e.wn_zstd_c_set_param as (h: number, k: number, v: number) => number)(this.#h, key, value)
          : (e.wn_zstd_d_set_param as (h: number, k: number, v: number) => number)(this.#h, key, value);
        if (!ok) throw codecError('Setting parameter failed', 'ERR_ZSTD_PARAM_SET_FAILED', -1);
      }
    }
  }

  setParams(): void {
    // 对齐 Node：zstd 的 `params()` 目前是 no-op。
  }

  push(chunk: Uint8Array, flush: number): Uint8Array {
    if (this.#closed) throw new Error('zlib binding closed');
    const e = ex('wn_zstd');
    const outCap = this.#buf.ensureOut(Math.max(this.#buf.outCap, 16384));
    const inPtr = this.#buf.ensureIn(chunk.byteLength);
    if (chunk.byteLength > 0) this.#buf.bytes().set(chunk, inPtr);

    const write = this.#compress
      ? (e.wn_zstd_c_write as (h: number, ip: number, il: number, op: number, ol: number, f: number) => number)
      : (e.wn_zstd_d_write as (h: number, ip: number, il: number, op: number, ol: number, f: number) => number);
    const availInOf = this.#compress
      ? (e.wn_zstd_c_avail_in as (h: number) => number)
      : (e.wn_zstd_d_avail_in as (h: number) => number);
    const availOutOf = this.#compress
      ? (e.wn_zstd_c_avail_out as (h: number) => number)
      : (e.wn_zstd_d_avail_out as (h: number) => number);

    const parts: Uint8Array[] = [];
    let total = 0;
    let inOff = 0;
    let inLen = chunk.byteLength;
    let availInAfter = 0;
    let availOutAfter = 0;

    for (;;) {
      write(this.#h, inPtr + inOff, inLen, outCap, this.#buf.outCap, flush);
      const availOut = availOutOf(this.#h);
      availInAfter = availInOf(this.#h);
      this.#lastInputLeft = availInAfter;
      const have = this.#buf.outCap - availOut;
      if (have > 0) {
        parts.push(this.#buf.bytes().slice(outCap, outCap + have));
        total += have;
      }
      availOutAfter = availOut;
      if (availOut === 0) {
        inOff += inLen - availInAfter;
        inLen = availInAfter;
        continue;
      }
      break;
    }

    const errorCode = this.#compress
      ? (e.wn_zstd_c_error_code as (h: number) => number)(this.#h)
      : (e.wn_zstd_d_error_code as (h: number) => number)(this.#h);
    if (errorCode !== 0) {
      const msgPtr = this.#compress
        ? (e.wn_zstd_c_error_string as (h: number) => number)(this.#h)
        : (e.wn_zstd_d_error_string as (h: number) => number)(this.#h);
      const namePtr = this.#compress
        ? (e.wn_zstd_c_error_name as (h: number) => number)(this.#h)
        : (e.wn_zstd_d_error_name as (h: number) => number)(this.#h);
      throw codecError(readCString(msgPtr, 'wn_zstd'), readCString(namePtr, 'wn_zstd'), errorCode);
    }

    if (!this.#compress) {
      const complete = (e.wn_zstd_d_frame_complete as (h: number) => number)(this.#h) === 1;
      this.#finished = complete;
      // `ZstdDecompressContext::GetErrorInfo` 的兜底：声明结束时输入已尽、输出还有余量，
      // 却没走完一帧 → 借 zlib 的 `Z_BUF_ERROR`。
      if (flush === ZSTD_E_END && !complete && availInAfter === 0 && availOutAfter > 0) {
        throw codecError('unexpected end of file', 'Z_BUF_ERROR', Z.Z_BUF_ERROR);
      }
    } else {
      this.#finished = flush === ZSTD_E_END && availInAfter === 0 && total > 0;
    }

    if (total === 0) return EMPTY;
    if (parts.length === 1) return parts[0];
    const joined = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.byteLength;
    }
    return joined;
  }

  reset(): void {
    if (this.#closed) throw new Error('zlib binding closed');
    const e = ex('wn_zstd');
    const ok = this.#compress
      ? (e.wn_zstd_c_reset as (h: number) => number)(this.#h)
      : (e.wn_zstd_d_reset as (h: number) => number)(this.#h);
    if (!ok) throw codecError('Could not initialize zstd instance', 'ERR_ZLIB_INITIALIZATION_FAILED', -1);
    this.#finished = false;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const e = ex('wn_zstd');
    if (this.#compress) (e.wn_zstd_c_free as (h: number) => void)(this.#h);
    else (e.wn_zstd_d_free as (h: number) => void)(this.#h);
    this.#h = 0;
    this.#buf.free();
  }

  get closed(): boolean {
    return this.#closed;
  }
  get finished(): boolean {
    return this.#finished;
  }
  get lastInputLeft(): number {
    return this.#lastInputLeft;
  }
}

function makeZstdCtor(mode: number): new (opts?: Omit<ZstdCodecOptions, 'mode'>) => ZstdCodec {
  return class extends ZstdCodec {
    constructor(opts: Omit<ZstdCodecOptions, 'mode'> = {}) {
      super({ mode, ...opts });
    }
  } as unknown as new (opts?: Omit<ZstdCodecOptions, 'mode'>) => ZstdCodec;
}
