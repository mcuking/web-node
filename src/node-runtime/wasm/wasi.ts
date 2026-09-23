/**
 * 最小 WASI 宿主（`wasi_snapshot_preview1`）—— native → WASM（M117）。
 *
 * 用 wasi-sdk 编出的模块会带上几个 WASI 导入：C++ 运行时会挂 `clock_time_get`
 * （`std::chrono`）、`random_get`（`std::random_device`），libc 的 stdio/文件
 * 例程会挂 `fd_write`/`fd_seek`/`fd_close`（`hdr_histogram.c` 的
 * `hdr_percentiles_print` 就用了 `fprintf`，即使我们从不调用它，符号也在）。
 *
 * 纯计算模块本可以不导入任何东西（`wn_zlib` 就是），但只要是 C++ 或碰过 stdio
 * 的就会带上——所以这里给一个**最小的、诚实的**实现：能用宿主能力满足的用宿主
 * 能力（时钟 → `performance.now()`，随机 → `crypto.getRandomValues`），
 * 没有对应物的（往 fd 里写）默认**丢弃**（只有显式开 `debug` 才打到控制台），
 * 绝不伪造成功也绝不假装有文件系统。
 */

const ESUCCESS = 0;
const EBADF = 8;
const ENOENT = 44;
const ENOTSUP = 58;

/** iovec 数组元素大小（ptr u32 + len u32）。 */
const IOVEC_SIZE = 8;

export interface WasiStubOptions {
  /** 把 fd 1/2 的写入打到宿主控制台（默认丢弃）。 */
  debug?: boolean;
}

export interface WasiStub {
  imports: Record<string, (...args: never[]) => unknown>;
  /** 实例化之后把模块的线性内存接上（导入函数要读写它）。 */
  attach(memory: WebAssembly.Memory | undefined): void;
}

function nowNanos(): bigint {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  const ms = perf ? perf.now() : Date.now();
  return BigInt(Math.round(ms * 1e6));
}

/**
 * 造一套 WASI 导入。实例化前先拿到它，实例化后调用 `attach(exports.memory)`。
 */
export function createWasiStub(options: WasiStubOptions = {}): WasiStub {
  let memory: WebAssembly.Memory | undefined;

  const view = (): DataView => new DataView((memory as WebAssembly.Memory).buffer);
  const bytes = (): Uint8Array => new Uint8Array((memory as WebAssembly.Memory).buffer);

  const ok = (): number => ESUCCESS;

  /** Zero-fill a `filestat` (64 bytes): dev/ino/nlink/size/atim/mtim/ctim. */
  const applyFilestat = (ptr: number, filetype: number, size: number): void => {
    const dv = view();
    for (let i = 0; i < 64; i++) dv.setUint8(ptr + i, 0);
    dv.setUint8(ptr + 16, filetype);
    dv.setBigUint64(ptr + 32, BigInt(size), true);
  };

  return {
    imports: {
      // 往 fd 写字节。默认丢弃（没有文件系统可写）；debug 时打到控制台。
      fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number): number => {
        const dv = view();
        const mem = bytes();
        let total = 0;
        const decoder = new TextDecoder();
        for (let i = 0; i < iovsLen; i++) {
          const base = iovs + i * IOVEC_SIZE;
          const ptr = dv.getUint32(base, true);
          const len = dv.getUint32(base + 4, true);
          if (options.debug && (fd === 1 || fd === 2)) {
            const text = decoder.decode(mem.subarray(ptr, ptr + len));
            (fd === 1 ? console.log : console.error)(text.replace(/\n$/, ''));
          }
          total += len;
        }
        dv.setUint32(nwritten, total, true);
        return ok();
      },
      fd_seek: (_fd: number, _offset: bigint, _whence: number, newOffset: number): number => {
        view().setBigUint64(newOffset, 0n, true);
        return ok();
      },
      fd_close: (_fd: number): number => ok(),
      // File-descriptor flags (O_APPEND etc.) have no meaning for the sinks we
      // expose, so report them as unsupported rather than silently accepting.
      fd_fdstat_set_flags: (_fd: number, _flags: number): number => ENOTSUP,
      // There is no real filesystem behind these descriptors.
      fd_read: (_fd: number, _iovs: number, _iovsLen: number, _nread: number): number => EBADF,
      fd_readdir: (
        _fd: number,
        _buf: number,
        _bufLen: number,
        _cookie: bigint,
        outUsed: number,
      ): number => {
        view().setUint32(outUsed, 0, true);
        return EBADF;
      },
      fd_filestat_get: (fd: number, ptr: number): number => {
        applyFilestat(ptr, fd <= 2 ? 2 : 4, 0);
        return ok();
      },
      path_open: (
        _fd: number,
        _dirflags: number,
        _path: number,
        _pathLen: number,
        _oflags: number,
        _fsRightsBase: bigint,
        _fsRightsInheriting: bigint,
        _fdflags: number,
        outFd: number,
      ): number => {
        view().setUint32(outFd, 0, true);
        return ENOENT;
      },
      path_filestat_get: (
        _fd: number,
        _flags: number,
        _path: number,
        _pathLen: number,
        outPtr: number,
      ): number => {
        applyFilestat(outPtr, 0, 0);
        return ENOENT;
      },
      fd_fdstat_get: (fd: number, ptr: number): number => {
        // fdstat：只要 filestat 是零填的，libc 就当成一个普通字符设备/文件。
        const dv = view();
        for (let i = 0; i < 24; i++) dv.setUint8(ptr + i, 0);
        dv.setUint8(ptr, fd <= 2 ? 2 : 4); // filetype: character_device | regular_file
        return ok();
      },
      fd_prestat_get: (_fd: number, _ptr: number): number => EBADF,
      fd_prestat_dir_name: (_fd: number, _ptr: number, _len: number): number => EBADF,
      // 时钟：给宿主单调时钟（纳秒）。
      clock_time_get: (_id: number, _precision: bigint, out: number): number => {
        view().setBigUint64(out, nowNanos(), true);
        return ok();
      },
      clock_res_get: (_id: number, out: number): number => {
        view().setBigUint64(out, 1000n, true);
        return ok();
      },
      // 随机：走宿主 WebCrypto（与 runtime 的 `randomFill` 同源）。
      random_get: (buf: number, len: number): number => {
        (globalThis.crypto as Crypto).getRandomValues(bytes().subarray(buf, buf + len));
        return ok();
      },
      // 环境/参数：宿主这边是空的（runtime 自己管 `process.env`/`argv`）。
      environ_sizes_get: (countPtr: number, sizePtr: number): number => {
        const dv = view();
        dv.setUint32(countPtr, 0, true);
        dv.setUint32(sizePtr, 0, true);
        return ok();
      },
      environ_get: (): number => ok(),
      args_sizes_get: (countPtr: number, sizePtr: number): number => {
        const dv = view();
        dv.setUint32(countPtr, 0, true);
        dv.setUint32(sizePtr, 0, true);
        return ok();
      },
      args_get: (): number => ok(),
      sched_yield: (): number => ok(),
      proc_exit: (code: number): never => {
        throw new Error(`WASI proc_exit(${code})`);
      },
    },
    attach(next: WebAssembly.Memory | undefined): void {
      memory = next;
    },
  };
}
