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

function ex(): WasmExports {
  return wasmModule('wn_zlib');
}

function memory(): WebAssembly.Memory {
  return ex().memory as WebAssembly.Memory;
}

/** 读 wasm 线性内存里以 NUL 结尾的字符串。 */
function readCString(ptr: number): string {
  const bytes = new Uint8Array(memory().buffer);
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
export function zlibBinding(_ctx: BindingContext): Record<string, unknown> {
  return {
    Zlib: ZlibCodec,
    crc32,
    adler32,
    zlibVersion,
    compressBound,
    modes: ZLIB_MODE,
    codes: Z,
  };
}
