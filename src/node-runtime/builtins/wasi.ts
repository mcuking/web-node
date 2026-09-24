import type { BuiltinSpec, BuiltinInitContext } from './types';

/**
 * `node:wasi` — a real `wasi_snapshot_preview1` host over the runtime's VFS.
 *
 * Node's `lib/wasi.js` is a thin wrapper over a native (`uvwasi`) binding:
 * a `WASI` class exposing `wasiImport` (the 46 preview1 entry points),
 * `start`/`initialize`/`getImportObject`/`finalizeBindings`. This module keeps
 * that surface exactly and implements the syscalls **in JS, on top of the
 * runtime's own `fs`** — so a WASI program sees the same virtual filesystem
 * that `fs` sees, with no mirroring.
 *
 * Why it exists: `@rspack/binding-wasm32-wasi`'s Node entry (`rspack.wasi.cjs`)
 * does `require('node:wasi')` + `require('node:worker_threads')` + reads its
 * wasm with `fs`. Its browser entry is a dead end for a synchronous `require`
 * (it has top-level `await fetch(wasm)`), so this is the enabler for rspack.
 *
 * Honesty rules (repo-wide): a syscall we cannot serve returns a real WASI
 * errno (`ENOTSUP`/`ENOSYS`/`EINVAL`) — never a fabricated success.
 */

/* ------------------------------------------------------------------ *
 * preview1 constants
 * ------------------------------------------------------------------ */

/** `__wasi_errno_t`. Only the values we can actually produce are named. */
const E = {
  SUCCESS: 0,
  ACCES: 2,
  AGAIN: 6,
  BADF: 8,
  BUSY: 10,
  EXIST: 20,
  FAULT: 21,
  FBIG: 22,
  INVAL: 28,
  IO: 29,
  ISDIR: 31,
  LOOP: 32,
  MFILE: 33,
  NAMETOOLONG: 37,
  NFILE: 41,
  NOENT: 44,
  NOSPC: 51,
  NOSYS: 52,
  NOTDIR: 54,
  NOTEMPTY: 55,
  NOTSUP: 58,
  OVERFLOW: 61,
  PIPE: 64,
  RANGE: 68,
  ROFS: 69,
  SPIPE: 70,
  XDEV: 75,
  NOTCAPABLE: 76,
} as const;

/** `__wasi_filetype_t`. */
const FT = {
  UNKNOWN: 0,
  CHARACTER_DEVICE: 2,
  DIRECTORY: 3,
  REGULAR_FILE: 4,
  SYMBOLIC_LINK: 7,
} as const;

const OFLAGS_CREAT = 1 << 0;
const OFLAGS_DIRECTORY = 1 << 1;
const OFLAGS_EXCL = 1 << 2;
const OFLAGS_TRUNC = 1 << 3;

const FDFLAGS_APPEND = 1 << 0;

const LOOKUP_SYMLINK_FOLLOW = 1 << 0;

const WHENCE_SET = 0;
const WHENCE_CUR = 1;
const WHENCE_END = 2;

const CLOCK_REALTIME = 0;
const CLOCK_MONOTONIC = 1;

const PREOPENTYPE_DIR = 0;

/** Rights bits we care about when mapping `path_open` to a node open mode. */
const RIGHT_FD_READ = 1n << 1n;
const RIGHT_FD_WRITE = 1n << 6n;
/** All rights set — what we grant (we do not enforce a rights model). */
const RIGHTS_ALL = 0xffffffffffffffffn;

const DIRENT_SIZE = 24; // d_next u64 + d_ino u64 + d_namlen u32 + d_type u8 (+3 pad)
const FILESTAT_SIZE = 64;
const FDSTAT_SIZE = 24;
const PRESTAT_SIZE = 8;
const IOVEC_SIZE = 8;

/* ------------------------------------------------------------------ *
 * `node:wasi`
 * ------------------------------------------------------------------ */

/** A recorded file descriptor. */
interface FdEntry {
  kind: 'stdin' | 'stdout' | 'stderr' | 'file' | 'dir';
  /** VFS path (files/dirs). */
  path?: string;
  /** Host `fs` fd for open files (absent for dirs / stdio). */
  host?: number;
  /** Logical stream position (WASI tracks it even for append fds). */
  offset: number;
  append: boolean;
  rightsBase: bigint;
  rightsInherit: bigint;
  /** Preopen name, when this fd is a preopened directory. */
  name?: string;
  /** `fs_flags` reported through `fd_fdstat_get`. */
  flags: number;
}

/** Thrown by `proc_exit`; caught by `start()` so it can return the exit code. */
const kProcExit = Symbol('web-node.wasi.proc-exit');

interface Stats {
  dev: number | bigint;
  ino: number | bigint;
  nlink: number | bigint;
  size: number | bigint;
  mode: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface DirEnt {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface FsLike {
  openSync(path: string, flags: string): number;
  closeSync(fd: number): void;
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null): number;
  writeSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null): number;
  fstatSync(fd: number): Stats;
  statSync(path: string): Stats;
  lstatSync(path: string): Stats;
  readdirSync(path: string, opts: { withFileTypes: true }): DirEnt[];
  mkdirSync(path: string): void;
  rmdirSync(path: string): void;
  unlinkSync(path: string): void;
  renameSync(from: string, to: string): void;
  symlinkSync(target: string, path: string): void;
  readlinkSync(path: string): string;
  linkSync(existing: string, path: string): void;
  ftruncateSync(fd: number, len: number): void;
  truncateSync(path: string, len: number): void;
  fsyncSync(fd: number): void;
  futimesSync(fd: number, atime: number, mtime: number): void;
  utimesSync(path: string, atime: number, mtime: number): void;
}

interface Validators {
  validateObject(v: unknown, name: string): void;
  validateString(v: unknown, name: string): void;
  validateArray(v: unknown, name: string): void;
  validateBoolean(v: unknown, name: string): void;
  validateInt32(v: unknown, name: string, min?: number, max?: number): void;
  validateFunction(v: unknown, name: string): void;
  validateUndefined(v: unknown, name: string): void;
}

interface ErrorCodes {
  ERR_INVALID_ARG_TYPE: new (name: string, expected: string | string[], actual: unknown) => Error;
  ERR_INVALID_ARG_VALUE: new (name: string, value: unknown, reason?: string) => Error;
  ERR_WASI_ALREADY_STARTED: new () => Error;
}

function nowNanos(): bigint {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  const ms = perf ? perf.now() : Date.now();
  return BigInt(Math.round(ms * 1e6));
}

/** Map a node `fs` error (`err.code`) to a WASI errno. */
function errnoOf(err: unknown): number {
  const code = (err as { code?: string } | undefined)?.code;
  switch (code) {
    case 'ENOENT': return E.NOENT;
    case 'EEXIST': return E.EXIST;
    case 'EACCES':
    case 'EPERM': return E.ACCES;
    case 'ENOTDIR': return E.NOTDIR;
    case 'EISDIR': return E.ISDIR;
    case 'ENOTEMPTY': return E.NOTEMPTY;
    case 'EBADF': return E.BADF;
    case 'EINVAL': return E.INVAL;
    case 'ELOOP': return E.LOOP;
    case 'ENAMETOOLONG': return E.NAMETOOLONG;
    case 'ENOSPC': return E.NOSPC;
    case 'EROFS': return E.ROFS;
    case 'ESPIPE': return E.SPIPE;
    case 'EBUSY': return E.BUSY;
    case 'EXDEV': return E.XDEV;
    case 'EMFILE':
    case 'ENFILE': return E.MFILE;
    case 'EPIPE': return E.PIPE;
    case 'ERANGE': return E.RANGE;
    case 'EFBIG': return E.FBIG;
    case 'ENOSYS': return E.NOSYS;
    default: return E.IO;
  }
}

export const wasiSpec: BuiltinSpec = {
  id: 'wasi',
  aliases: ['node:wasi'],
  origin: 'web-node',
  deps: ['internal/errors', 'internal/validators'],
  init: (ctx: BuiltinInitContext) => {
    const errors = ctx.require('internal/errors') as { codes: ErrorCodes };
    const v = ctx.require('internal/validators') as Validators;

    // `fs` is resolved lazily: requiring it at init time would run before the
    // module is materialized.
    let fsCache: FsLike | undefined;
    const fs = (): FsLike => (fsCache ??= ctx.require('fs') as FsLike);
    const p = ctx.require('path') as {
      join(...parts: string[]): string;
      normalize(path: string): string;
    };
    const process = ctx.require('process') as {
      stdout?: { write(chunk: string | Uint8Array): boolean };
      stderr?: { write(chunk: string | Uint8Array): boolean };
    };

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    class WASI {
      #bindingName = 'wasi_snapshot_preview1';
      #memory: WebAssembly.Memory | undefined;
      #started = false;
      #exitCode = 0;
      #instance: { exports: Record<string, unknown> } | undefined;
      #returnOnExit: boolean;
      #args: string[];
      #env: string[];
      #preopens: [string, string][];
      #fdTable = new Map<number, FdEntry>();
      #nextFd: number;
      wasiImport: Record<string, (...args: never[]) => unknown>;

      constructor(options: Record<string, unknown> = {}) {
        v.validateObject(options, 'options');
        v.validateString(options.version, 'options.version');
        switch (options.version) {
          case 'unstable':
            this.#bindingName = 'wasi_unstable';
            break;
          case 'preview1':
            this.#bindingName = 'wasi_snapshot_preview1';
            break;
          default:
            throw new errors.codes.ERR_INVALID_ARG_VALUE(
              'options.version',
              options.version,
              'unsupported WASI version',
            );
        }

        if (options.args !== undefined) v.validateArray(options.args, 'options.args');
        this.#args = ((options.args as unknown[] | undefined) ?? []).map((a) => String(a));

        const env: string[] = [];
        if (options.env !== undefined) {
          v.validateObject(options.env, 'options.env');
          for (const [key, value] of Object.entries(options.env as Record<string, unknown>)) {
            if (value !== undefined) env.push(`${key}=${value}`);
          }
        }
        this.#env = env;

        const preopens: [string, string][] = [];
        if (options.preopens !== undefined) {
          v.validateObject(options.preopens, 'options.preopens');
          for (const [key, value] of Object.entries(options.preopens as Record<string, unknown>)) {
            preopens.push([String(key), String(value)]);
          }
        }
        this.#preopens = preopens;

        const stdin = options.stdin ?? 0;
        const stdout = options.stdout ?? 1;
        const stderr = options.stderr ?? 2;
        v.validateInt32(stdin, 'options.stdin', 0);
        v.validateInt32(stdout, 'options.stdout', 0);
        v.validateInt32(stderr, 'options.stderr', 0);

        this.#returnOnExit = true;
        if (options.returnOnExit !== undefined) {
          v.validateBoolean(options.returnOnExit, 'options.returnOnExit');
          this.#returnOnExit = options.returnOnExit as boolean;
        }

        // fds 0/1/2 are stdio; preopens follow; opened files after them.
        this.#fdTable.set(stdin as number, { kind: 'stdin', offset: 0, append: false, rightsBase: RIGHTS_ALL, rightsInherit: RIGHTS_ALL, flags: 0 });
        this.#fdTable.set(stdout as number, { kind: 'stdout', offset: 0, append: false, rightsBase: RIGHTS_ALL, rightsInherit: RIGHTS_ALL, flags: 0 });
        this.#fdTable.set(stderr as number, { kind: 'stderr', offset: 0, append: false, rightsBase: RIGHTS_ALL, rightsInherit: RIGHTS_ALL, flags: 0 });
        let next = Math.max(stdin as number, stdout as number, stderr as number) + 1;
        for (const [guest, host] of preopens) {
          this.#fdTable.set(next++, {
            kind: 'dir',
            path: this.#normalizeRoot(host),
            offset: 0,
            append: false,
            rightsBase: RIGHTS_ALL,
            rightsInherit: RIGHTS_ALL,
            name: guest,
            flags: 0,
          });
        }
        this.#nextFd = next;

        this.wasiImport = this.#buildImports();
      }

      #normalizeRoot(path: string): string {
        const norm = p.normalize(path);
        return norm.length > 1 && norm.endsWith('/') ? norm.slice(0, -1) : norm;
      }

      /* memory helpers — views are recreated because wasm memory can grow */
      #dv(): DataView {
        return new DataView((this.#memory as WebAssembly.Memory).buffer);
      }
      #mem(): Uint8Array {
        return new Uint8Array((this.#memory as WebAssembly.Memory).buffer);
      }
      #str(ptr: number, len: number): string {
        return decoder.decode(this.#mem().subarray(ptr, ptr + len));
      }
      #put(ptr: number, bytes: Uint8Array): void {
        this.#mem().set(bytes, ptr);
      }

      #reserveFd(entry: FdEntry): number {
        while (this.#fdTable.has(this.#nextFd)) this.#nextFd++;
        const fd = this.#nextFd++;
        this.#fdTable.set(fd, entry);
        return fd;
      }

      /** Resolve a guest path against a (preopened) directory fd, contained. */
      #resolve(dirfd: number, rawPath: string): { path: string } | { errno: number } {
        const dir = this.#fdTable.get(dirfd);
        if (!dir || dir.kind !== 'dir' || dir.path === undefined) return { errno: E.NOTDIR };
        const root = dir.path;
        const joined = rawPath.startsWith('/') ? rawPath : p.join(root, rawPath);
        const norm = p.normalize(joined);
        const prefix = root.endsWith('/') ? root : `${root}/`;
        if (norm !== root && !norm.startsWith(prefix) && !(root === '/' && norm.startsWith('/'))) {
          return { errno: E.NOTCAPABLE };
        }
        return { path: norm };
      }

      #writeFilestat(ptr: number, st: Pick<Stats, 'dev' | 'ino' | 'nlink' | 'size' | 'atimeMs' | 'mtimeMs' | 'ctimeMs'> & { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): void {
        const dv = this.#dv();
        for (let i = 0; i < FILESTAT_SIZE; i++) dv.setUint8(ptr + i, 0);
        dv.setBigUint64(ptr + 0, BigInt(st.dev ?? 0), true);
        dv.setBigUint64(ptr + 8, BigInt(st.ino ?? 0), true);
        dv.setUint8(ptr + 16, filetypeOf(st));
        dv.setBigUint64(ptr + 24, BigInt(st.nlink ?? 1), true);
        dv.setBigUint64(ptr + 32, BigInt(st.size ?? 0), true);
        dv.setBigUint64(ptr + 40, BigInt(Math.round((st.atimeMs ?? 0) * 1e6)), true);
        dv.setBigUint64(ptr + 48, BigInt(Math.round((st.mtimeMs ?? 0) * 1e6)), true);
        dv.setBigUint64(ptr + 56, BigInt(Math.round((st.ctimeMs ?? 0) * 1e6)), true);
      }

      #writeU32(ptr: number, value: number): void {
        this.#dv().setUint32(ptr, value >>> 0, true);
      }
      #writeU64(ptr: number, value: bigint): void {
        this.#dv().setBigUint64(ptr, value, true);
      }

      /** Mirror an fdstat (filetype + flags + rights). */
      #writeFdstat(ptr: number, entry: FdEntry): void {
        const dv = this.#dv();
        for (let i = 0; i < FDSTAT_SIZE; i++) dv.setUint8(ptr + i, 0);
        dv.setUint8(ptr + 0, fdFiletype(entry));
        dv.setUint16(ptr + 2, entry.flags & 0xffff, true);
        dv.setBigUint64(ptr + 8, entry.rightsBase, true);
        dv.setBigUint64(ptr + 16, entry.rightsInherit, true);
      }

      #gather(iovs: number, iovsLen: number): Uint8Array {
        const dv = this.#dv();
        const mem = this.#mem();
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          total += dv.getUint32(iovs + i * IOVEC_SIZE + 4, true);
        }
        const out = new Uint8Array(total);
        let at = 0;
        for (let i = 0; i < iovsLen; i++) {
          const base = iovs + i * IOVEC_SIZE;
          const ptr = dv.getUint32(base, true);
          const len = dv.getUint32(base + 4, true);
          out.set(mem.subarray(ptr, ptr + len), at);
          at += len;
        }
        return out;
      }

      /** Scatter `bytes` into iovecs, returning bytes consumed. */
      #scatter(iovs: number, iovsLen: number, bytes: Uint8Array): number {
        const dv = this.#dv();
        const mem = this.#mem();
        let written = 0;
        for (let i = 0; i < iovsLen && written < bytes.length; i++) {
          const base = iovs + i * IOVEC_SIZE;
          const ptr = dv.getUint32(base, true);
          const len = dv.getUint32(base + 4, true);
          const take = Math.min(len, bytes.length - written);
          mem.set(bytes.subarray(written, written + take), ptr);
          written += take;
        }
        return written;
      }

      #writeStdio(entry: FdEntry, bytes: Uint8Array): void {
        const sink = entry.kind === 'stderr' ? process.stderr : process.stdout;
        const text = decoder.decode(bytes);
        if (sink && typeof sink.write === 'function') sink.write(text);
        else if (entry.kind === 'stderr') console.error(text.replace(/\n$/, ''));
        else console.log(text.replace(/\n$/, ''));
      }

      #buildImports(): Record<string, (...args: never[]) => unknown> {
        const self = this;
        return {
          // ---- stdio / fd io ----
          fd_write(fd: number, iovs: number, iovsLen: number, nwritten: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            const bytes = self.#gather(iovs, iovsLen);
            if (entry.kind === 'stdout' || entry.kind === 'stderr') {
              self.#writeStdio(entry, bytes);
              self.#writeU32(nwritten, bytes.length);
              return E.SUCCESS;
            }
            if (entry.kind !== 'file' || entry.host === undefined) return E.BADF;
            try {
              const written = fs().writeSync(entry.host, bytes, 0, bytes.length, entry.append ? null : entry.offset);
              entry.offset += written;
              self.#writeU32(nwritten, written);
              return E.SUCCESS;
            } catch (err) {
              return errnoOf(err);
            }
          },
          fd_read(fd: number, iovs: number, iovsLen: number, nread: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            if (entry.kind === 'stdin') {
              self.#writeU32(nread, 0); // EOF: no interactive stdin in the runtime
              return E.SUCCESS;
            }
            if (entry.kind !== 'file' || entry.host === undefined) return E.BADF;
            try {
              const dv = self.#dv();
              const mem = self.#mem();
              let total = 0;
              for (let i = 0; i < iovsLen; i++) {
                const base = iovs + i * IOVEC_SIZE;
                const ptr = dv.getUint32(base, true);
                const len = dv.getUint32(base + 4, true);
                if (len === 0) continue;
                const n = fs().readSync(entry.host, mem.subarray(ptr, ptr + len), 0, len, entry.offset);
                entry.offset += n;
                total += n;
                if (n < len) break;
              }
              self.#writeU32(nread, total);
              return E.SUCCESS;
            } catch (err) {
              return errnoOf(err);
            }
          },
          fd_seek(fd: number, offset: bigint, whence: number, newOffset: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            if (entry.kind !== 'file' || entry.host === undefined) return E.SPIPE;
            try {
              let next: bigint;
              if (whence === WHENCE_SET) next = offset;
              else if (whence === WHENCE_CUR) next = BigInt(entry.offset) + offset;
              else if (whence === WHENCE_END) next = BigInt(fs().fstatSync(entry.host).size) + offset;
              else return E.INVAL;
              if (next < 0n) return E.INVAL;
              entry.offset = Number(next);
              self.#writeU64(newOffset, BigInt(entry.offset));
              return E.SUCCESS;
            } catch (err) {
              return errnoOf(err);
            }
          },
          fd_tell(fd: number, offsetPtr: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            self.#writeU64(offsetPtr, BigInt(entry.offset));
            return E.SUCCESS;
          },
          fd_close(fd: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            if (entry.host !== undefined) {
              try { fs().closeSync(entry.host); } catch { /* already gone */ }
            }
            self.#fdTable.delete(fd);
            return E.SUCCESS;
          },
          fd_renumber(from: number, to: number): number {
            const entry = self.#fdTable.get(from);
            if (!entry) return E.BADF;
            const dest = self.#fdTable.get(to);
            if (dest?.host !== undefined) { try { fs().closeSync(dest.host); } catch { /* ignore */ } }
            self.#fdTable.set(to, entry);
            self.#fdTable.delete(from);
            return E.SUCCESS;
          },
          fd_sync(fd: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            if (entry.host === undefined) return E.SUCCESS;
            try { fs().fsyncSync(entry.host); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          fd_datasync(fd: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            if (entry.host === undefined) return E.SUCCESS;
            try { fs().fsyncSync(entry.host); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          fd_advise(_fd: number, _offset: bigint, _len: bigint, _advice: number): number { return E.SUCCESS; }, // advisory only
          fd_allocate(fd: number, offset: bigint, len: bigint): number {
            const entry = self.#fdTable.get(fd);
            if (!entry || entry.host === undefined) return E.BADF;
            try { fs().ftruncateSync(entry.host, Number(offset + len)); return E.SUCCESS; } catch { return E.NOTSUP; }
          },
          fd_fdstat_get(fd: number, ptr: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            self.#writeFdstat(ptr, entry);
            return E.SUCCESS;
          },
          fd_fdstat_set_flags(fd: number, flags: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            entry.flags = flags;
            entry.append = (flags & FDFLAGS_APPEND) !== 0;
            return E.SUCCESS;
          },
          fd_fdstat_set_rights(fd: number, base: bigint, inheriting: bigint): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            entry.rightsBase = base;
            entry.rightsInherit = inheriting;
            return E.SUCCESS;
          },
          fd_filestat_get(fd: number, ptr: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry) return E.BADF;
            if (entry.host === undefined) {
              self.#writeFilestat(ptr, { dev: 0, ino: fd, nlink: 1, size: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0, isDirectory: () => entry.kind === 'dir', isFile: () => false, isSymbolicLink: () => false });
              return E.SUCCESS;
            }
            try { self.#writeFilestat(ptr, fs().fstatSync(entry.host)); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          fd_filestat_set_size(fd: number, size: bigint): number {
            const entry = self.#fdTable.get(fd);
            if (!entry || entry.host === undefined) return E.BADF;
            try { fs().ftruncateSync(entry.host, Number(size)); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          fd_filestat_set_times(fd: number, atim: bigint, mtim: bigint, fstFlags: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry || entry.host === undefined) return E.BADF;
            const ATIM = 1 << 0, ATIM_NOW = 1 << 1, MTIM = 1 << 2, MTIM_NOW = 1 << 3;
            try {
              const now = Date.now() / 1000;
              const atime = (fstFlags & ATIM) ? Number(atim) / 1e9 : now;
              const mtime = (fstFlags & MTIM) ? Number(mtim) / 1e9 : now;
              void ATIM_NOW; void MTIM_NOW;
              fs().futimesSync(entry.host, atime, mtime);
              return E.SUCCESS;
            } catch (err) { return errnoOf(err); }
          },
          fd_pread(fd: number, iovs: number, iovsLen: number, offset: bigint, nread: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry || entry.host === undefined) return E.BADF;
            try {
              const dv = self.#dv();
              const mem = self.#mem();
              let pos = Number(offset);
              let total = 0;
              for (let i = 0; i < iovsLen; i++) {
                const base = iovs + i * IOVEC_SIZE;
                const ptr = dv.getUint32(base, true);
                const len = dv.getUint32(base + 4, true);
                if (len === 0) continue;
                const n = fs().readSync(entry.host, mem.subarray(ptr, ptr + len), 0, len, pos);
                pos += n;
                total += n;
                if (n < len) break;
              }
              self.#writeU32(nread, total);
              return E.SUCCESS;
            } catch (err) { return errnoOf(err); }
          },
          fd_pwrite(fd: number, iovs: number, iovsLen: number, offset: bigint, nwritten: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry || entry.host === undefined) return E.BADF;
            try {
              const bytes = self.#gather(iovs, iovsLen);
              const written = fs().writeSync(entry.host, bytes, 0, bytes.length, Number(offset));
              self.#writeU32(nwritten, written);
              return E.SUCCESS;
            } catch (err) { return errnoOf(err); }
          },
          fd_readdir(fd: number, buf: number, bufLen: number, cookie: bigint, bufused: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry || entry.kind !== 'dir' || entry.path === undefined) return E.BADF;
            try {
              const items = fs().readdirSync(entry.path, { withFileTypes: true });
              const start = Number(cookie);
              const dv = self.#dv();
              const mem = self.#mem();
              let written = 0;
              for (let i = start; i < items.length; i++) {
                const item = items[i];
                const nameBytes = encoder.encode(item.name);
                if (written + DIRENT_SIZE + nameBytes.length > bufLen) break;
                const at = buf + written;
                dv.setBigUint64(at + 0, BigInt(i + 1), true);
                dv.setBigUint64(at + 8, BigInt(i + 1), true);
                dv.setUint32(at + 16, nameBytes.length, true);
                const type = item.isDirectory() ? FT.DIRECTORY : item.isFile() ? FT.REGULAR_FILE : item.isSymbolicLink() ? FT.SYMBOLIC_LINK : FT.UNKNOWN;
                dv.setUint8(at + 20, type);
                mem.set(nameBytes, at + DIRENT_SIZE);
                written += DIRENT_SIZE + nameBytes.length;
              }
              self.#writeU32(bufused, written);
              return E.SUCCESS;
            } catch (err) { return errnoOf(err); }
          },
          fd_prestat_get(fd: number, ptr: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry || entry.name === undefined) return E.BADF;
            const dv = self.#dv();
            for (let i = 0; i < PRESTAT_SIZE; i++) dv.setUint8(ptr + i, 0);
            dv.setUint8(ptr + 0, PREOPENTYPE_DIR);
            dv.setUint32(ptr + 4, encoder.encode(entry.name).length, true);
            return E.SUCCESS;
          },
          fd_prestat_dir_name(fd: number, pathPtr: number, pathLen: number): number {
            const entry = self.#fdTable.get(fd);
            if (!entry || entry.name === undefined) return E.BADF;
            const bytes = encoder.encode(entry.name);
            self.#put(pathPtr, bytes.subarray(0, pathLen));
            return E.SUCCESS;
          },

          // ---- paths ----
          path_open(dirfd: number, dirflags: number, pathPtr: number, pathLen: number, oflags: number, rightsBase: bigint, rightsInherit: bigint, fdflags: number, outFd: number): number {
            void dirflags;
            const raw = self.#str(pathPtr, pathLen);
            const resolved = self.#resolve(dirfd, raw);
            if ('errno' in resolved) return resolved.errno;
            const target = resolved.path;
            try {
              if (oflags & OFLAGS_DIRECTORY) {
                const st = fs().statSync(target);
                if (!st.isDirectory()) return E.NOTDIR;
                const fd = self.#reserveFd({ kind: 'dir', path: target, offset: 0, append: false, rightsBase, rightsInherit, flags: fdflags });
                self.#writeU32(outFd, fd);
                return E.SUCCESS;
              }
              const wantRead = (rightsBase & RIGHT_FD_READ) !== 0n;
              const wantWrite = (rightsBase & RIGHT_FD_WRITE) !== 0n;
              let mode: string;
              if (oflags & OFLAGS_CREAT) {
                if (oflags & OFLAGS_EXCL) mode = 'wx';
                else if (oflags & OFLAGS_TRUNC) mode = 'w';
                else mode = 'a';
              } else if (oflags & OFLAGS_TRUNC) mode = 'w';
              else mode = 'r';
              if (mode === 'r' ? wantWrite : wantRead) mode += '+';
              const host = fs().openSync(target, mode);
              const st = fs().fstatSync(host);
              const kind = st.isDirectory() ? 'dir' : 'file';
              const fd = self.#reserveFd({ kind, path: target, host: kind === 'file' ? host : undefined, offset: 0, append: (fdflags & FDFLAGS_APPEND) !== 0, rightsBase, rightsInherit, flags: fdflags });
              if (kind === 'dir') { try { fs().closeSync(host); } catch { /* ignore */ } }
              self.#writeU32(outFd, fd);
              return E.SUCCESS;
            } catch (err) { return errnoOf(err); }
          },
          path_filestat_get(dirfd: number, flags: number, pathPtr: number, pathLen: number, outPtr: number): number {
            const resolved = self.#resolve(dirfd, self.#str(pathPtr, pathLen));
            if ('errno' in resolved) return resolved.errno;
            try {
              const st = (flags & LOOKUP_SYMLINK_FOLLOW) ? fs().statSync(resolved.path) : fs().lstatSync(resolved.path);
              self.#writeFilestat(outPtr, st);
              return E.SUCCESS;
            } catch (err) { return errnoOf(err); }
          },
          path_filestat_set_times(dirfd: number, flags: number, pathPtr: number, pathLen: number, atim: bigint, mtim: bigint, fstFlags: number): number {
            void flags;
            const resolved = self.#resolve(dirfd, self.#str(pathPtr, pathLen));
            if ('errno' in resolved) return resolved.errno;
            const ATIM = 1 << 0, MTIM = 1 << 2;
            try {
              const now = Date.now() / 1000;
              const atime = (fstFlags & ATIM) ? Number(atim) / 1e9 : now;
              const mtime = (fstFlags & MTIM) ? Number(mtim) / 1e9 : now;
              fs().utimesSync(resolved.path, atime, mtime);
              return E.SUCCESS;
            } catch (err) { return errnoOf(err); }
          },
          path_create_directory(dirfd: number, pathPtr: number, pathLen: number): number {
            const resolved = self.#resolve(dirfd, self.#str(pathPtr, pathLen));
            if ('errno' in resolved) return resolved.errno;
            try { fs().mkdirSync(resolved.path); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          path_remove_directory(dirfd: number, pathPtr: number, pathLen: number): number {
            const resolved = self.#resolve(dirfd, self.#str(pathPtr, pathLen));
            if ('errno' in resolved) return resolved.errno;
            try { fs().rmdirSync(resolved.path); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          path_unlink_file(dirfd: number, pathPtr: number, pathLen: number): number {
            const resolved = self.#resolve(dirfd, self.#str(pathPtr, pathLen));
            if ('errno' in resolved) return resolved.errno;
            try { fs().unlinkSync(resolved.path); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          path_rename(fd: number, oldPtr: number, oldLen: number, newFd: number, newPtr: number, newLen: number): number {
            const from = self.#resolve(fd, self.#str(oldPtr, oldLen));
            if ('errno' in from) return from.errno;
            const to = self.#resolve(newFd, self.#str(newPtr, newLen));
            if ('errno' in to) return to.errno;
            try { fs().renameSync(from.path, to.path); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          path_symlink(oldPtr: number, oldLen: number, fd: number, newPtr: number, newLen: number): number {
            const link = self.#str(oldPtr, oldLen);
            const target = self.#resolve(fd, self.#str(newPtr, newLen));
            if ('errno' in target) return target.errno;
            try { fs().symlinkSync(link, target.path); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },
          path_readlink(fd: number, pathPtr: number, pathLen: number, buf: number, bufLen: number, used: number): number {
            const resolved = self.#resolve(fd, self.#str(pathPtr, pathLen));
            if ('errno' in resolved) return resolved.errno;
            try {
              const link = encoder.encode(fs().readlinkSync(resolved.path));
              const take = Math.min(link.length, bufLen);
              self.#put(buf, link.subarray(0, take));
              self.#writeU32(used, take);
              return E.SUCCESS;
            } catch (err) { return errnoOf(err); }
          },
          path_link(oldFd: number, oldFlags: number, oldPtr: number, oldLen: number, newFd: number, newPtr: number, newLen: number): number {
            void oldFlags;
            const from = self.#resolve(oldFd, self.#str(oldPtr, oldLen));
            if ('errno' in from) return from.errno;
            const to = self.#resolve(newFd, self.#str(newPtr, newLen));
            if ('errno' in to) return to.errno;
            try { fs().linkSync(from.path, to.path); return E.SUCCESS; } catch (err) { return errnoOf(err); }
          },

          // ---- args / env ----
          args_sizes_get(countPtr: number, sizePtr: number): number {
            const encoded = self.#args.map((a) => encoder.encode(a + '\0'));
            self.#writeU32(countPtr, encoded.length);
            self.#writeU32(sizePtr, encoded.reduce((n, b) => n + b.length, 0));
            return E.SUCCESS;
          },
          args_get(argv: number, argvBuf: number): number {
            const dv = self.#dv();
            let at = argvBuf;
            self.#args.forEach((arg, i) => {
              const bytes = encoder.encode(arg + '\0');
              dv.setUint32(argv + i * 4, at, true);
              self.#put(at, bytes);
              at += bytes.length;
            });
            return E.SUCCESS;
          },
          environ_sizes_get(countPtr: number, sizePtr: number): number {
            const encoded = self.#env.map((e) => encoder.encode(e + '\0'));
            self.#writeU32(countPtr, encoded.length);
            self.#writeU32(sizePtr, encoded.reduce((n, b) => n + b.length, 0));
            return E.SUCCESS;
          },
          environ_get(envPtr: number, envBuf: number): number {
            const dv = self.#dv();
            let at = envBuf;
            self.#env.forEach((entry, i) => {
              const bytes = encoder.encode(entry + '\0');
              dv.setUint32(envPtr + i * 4, at, true);
              self.#put(at, bytes);
              at += bytes.length;
            });
            return E.SUCCESS;
          },

          // ---- clocks / random / misc ----
          clock_time_get(id: number, precision: bigint, out: number): number {
            void precision;
            const nanos = id === CLOCK_REALTIME ? BigInt(Date.now()) * 1_000_000n : nowNanos();
            self.#writeU64(out, nanos);
            return E.SUCCESS;
          },
          clock_res_get(id: number, out: number): number {
            void id;
            self.#writeU64(out, 1_000_000n);
            return E.SUCCESS;
          },
          random_get(buf: number, len: number): number {
            // The wasm memory is a SharedArrayBuffer, and `crypto.getRandomValues`
            // rejects a view over shared memory (per spec). Fill a fresh buffer
            // and copy in.
            const tmp = new Uint8Array(len);
            (globalThis.crypto as Crypto).getRandomValues(tmp);
            self.#mem().set(tmp, buf);
            return E.SUCCESS;
          },
          sched_yield(): number { return E.SUCCESS; },
          proc_raise(_sig: number): number { return E.NOTSUP; },
          proc_exit(code: number): never {
            self.#exitCode = code >>> 0;
            throw kProcExit;
          },
          poll_oneoff(_in: number, out: number, nsubscriptions: number, nevents: number): number {
            if (nsubscriptions !== 1) return E.INVAL;
            // Single clock subscription: signal immediately as timed out.
            const dv = self.#dv();
            const sub = _in;
            const userdata = dv.getBigUint64(sub, true);
            const clockId = dv.getUint32(sub + 16, true);
            void clockId;
            dv.setBigUint64(out + 0, userdata, true);
            dv.setUint16(out + 8, E.SUCCESS, true);
            dv.setUint8(out + 10, 0); // eventtype: clock
            self.#writeU32(nevents, 1);
            return E.SUCCESS;
          },

          // ---- sockets: no browser counterpart ----
          sock_accept(_fd: number, _flags: number, _outFd: number): number { return E.NOTSUP; },
          sock_recv(_fd: number, _rio: number, _rioLen: number, _flags: number, _roDataLen: number, _roFlags: number): number { return E.NOTSUP; },
          sock_send(_fd: number, _siov: number, _siovLen: number, _flags: number, _nwritten: number): number { return E.NOTSUP; },
          sock_shutdown(_fd: number, _how: number): number { return E.NOTSUP; },
        } as unknown as Record<string, (...args: never[]) => unknown>;
      }

      finalizeBindings(instance: { exports: Record<string, unknown> }, options: { memory?: WebAssembly.Memory } = {}): void {
        const memory = options.memory ?? (instance?.exports?.memory as WebAssembly.Memory | undefined);
        if (this.#started) throw new errors.codes.ERR_WASI_ALREADY_STARTED();
        v.validateObject(instance, 'instance');
        v.validateObject(instance.exports, 'instance.exports');
        if (!(memory instanceof WebAssembly.Memory)) {
          throw new errors.codes.ERR_INVALID_ARG_TYPE('instance.exports.memory', 'WebAssembly.Memory', memory);
        }
        this.#memory = memory;
        this.#instance = instance;
        this.#started = true;
      }

      start(instance: { exports: Record<string, unknown> }): number {
        this.finalizeBindings(instance);
        const { _start, _initialize } = instance.exports as { _start?: () => void; _initialize?: () => void };
        v.validateFunction(_start, 'instance.exports._start');
        v.validateUndefined(_initialize, 'instance.exports._initialize');
        try {
          (_start as () => void)();
        } catch (err) {
          if (err !== kProcExit) throw err;
        }
        return this.#exitCode;
      }

      initialize(instance: { exports: Record<string, unknown> }): void {
        this.finalizeBindings(instance);
        const { _start, _initialize } = instance.exports as { _start?: () => void; _initialize?: () => void };
        v.validateUndefined(_start, 'instance.exports._start');
        if (_initialize !== undefined) {
          v.validateFunction(_initialize, 'instance.exports._initialize');
          _initialize();
        }
      }

      getImportObject(): Record<string, unknown> {
        return { [this.#bindingName]: this.wasiImport };
      }
    }

    return { WASI };
  },
};

/** WASI filetype for a `Stats`-like object. */
function filetypeOf(st: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): number {
  if (st.isDirectory()) return FT.DIRECTORY;
  if (st.isFile()) return FT.REGULAR_FILE;
  if (st.isSymbolicLink()) return FT.SYMBOLIC_LINK;
  return FT.UNKNOWN;
}

/** WASI filetype for an fd entry. */
function fdFiletype(entry: { kind: string }): number {
  switch (entry.kind) {
    case 'dir': return FT.DIRECTORY;
    case 'file': return FT.REGULAR_FILE;
    case 'stdin':
    case 'stdout':
    case 'stderr': return FT.CHARACTER_DEVICE;
    default: return FT.UNKNOWN;
  }
}
