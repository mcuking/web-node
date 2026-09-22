import type { BindingContext, BindingFactory } from './context';
import { VfsError, ERRNO, type Stat } from '../vfs/types';
import { FS_OPEN_FLAGS } from './constants';

/**
 * `fs` binding.
 *
 * Contract: synchronous primitives over the VFS plus the async surface Node's
 * real `internal/fs/promises` drives (a trailing `kUsePromises` token returns a
 * Promise; a trailing function is callback style; neither is synchronous). An
 * fd table lives here so file descriptors behave like real ones (position,
 * append).
 */

/** The token `src/node_file.cc` uses to ask for a Promise. */
const USE_PROMISES: unique symbol = Symbol('kUsePromises');

interface FdEntry {
  path: string;
  flags: string;
  position: number;
  append: boolean;
}

const FLAG_TABLE: Record<string, { read: boolean; write: boolean; create: boolean; excl: boolean; trunc: boolean; append: boolean }> = {
  r: { read: true, write: false, create: false, excl: false, trunc: false, append: false },
  'r+': { read: true, write: true, create: false, excl: false, trunc: false, append: false },
  rs: { read: true, write: false, create: false, excl: false, trunc: false, append: false },
  'rs+': { read: true, write: true, create: false, excl: false, trunc: false, append: false },
  w: { read: false, write: true, create: true, excl: false, trunc: true, append: false },
  wx: { read: false, write: true, create: true, excl: true, trunc: true, append: false },
  'w+': { read: true, write: true, create: true, excl: false, trunc: true, append: false },
  'wx+': { read: true, write: true, create: true, excl: true, trunc: true, append: false },
  a: { read: false, write: true, create: true, excl: false, trunc: false, append: true },
  ax: { read: false, write: true, create: true, excl: true, trunc: false, append: true },
  'a+': { read: true, write: true, create: true, excl: false, trunc: false, append: true },
  'ax+': { read: true, write: true, create: true, excl: true, trunc: false, append: true },
};

export const fsBinding: BindingFactory = (ctx: BindingContext) => {
  const fds = new Map<number, FdEntry>();
  let nextFd = 10; // 0/1/2 reserved for stdio

  const vfs = ctx.vfs;

  function toStat(s: Stat): Record<string, unknown> {
    const isDir = s.type === 'dir';
    const isFile = s.type === 'file';
    return {
      dev: s.dev,
      mode: s.mode,
      nlink: s.nlink,
      uid: s.uid,
      gid: s.gid,
      rdev: s.rdev,
      blksize: s.blksize,
      ino: s.ino,
      size: s.size,
      blocks: s.blocks,
      atimeMs: s.atimeMs,
      mtimeMs: s.mtimeMs,
      ctimeMs: s.ctimeMs,
      birthtimeMs: s.birthtimeMs,
      atime: new Date(s.atimeMs),
      mtime: new Date(s.mtimeMs),
      ctime: new Date(s.ctimeMs),
      birthtime: new Date(s.birthtimeMs),
      isDirectory: () => isDir,
      isFile: () => isFile,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }

  function statSync(path: string): Record<string, unknown> {
    return toStat(vfs.stat(path));
  }

  /**
   * Node's *read* errors carry no `path`: `uv_fs_read` runs on an fd, so the
   * error context has no path (unlike `open`/`stat`). The VFS conflates
   * open+read in `readFile`, so the sync read call sites drop the path here.
   */
  function asReadError(err: unknown): never {
    if (err instanceof VfsError && err.code === 'EISDIR') throw new VfsError('EISDIR', 'read');
    throw err as Error;
  }

  function readFileSync(path: string): Uint8Array {
    try {
      return vfs.readFile(path);
    } catch (err) {
      return asReadError(err);
    }
  }

  function writeFileSync(path: string, data: Uint8Array, flag = 'w'): void {
    vfs.writeFile(path, data, { flag });
  }

  function openSync(path: string, flags = 'r', mode = 0o666): number {
    const f = FLAG_TABLE[flags];
    if (!f) throw new VfsError('EINVAL', 'open', path, `Unknown file open flag: ${flags}`);
    const exists = vfs.exists(path);
    if (!exists) {
      if (!f.create) throw new VfsError('ENOENT', 'open', path);
      if (f.excl) {
        // create+excl on a missing file is fine; on existing it errors (checked below)
      }
      vfs.writeFile(path, new Uint8Array(0), { mode });
    } else if (f.excl && f.create) {
      throw new VfsError('EEXIST', 'open', path);
    }
    if (f.trunc) vfs.writeFile(path, new Uint8Array(0), { mode });
    const fd = nextFd++;
    fds.set(fd, { path: vfs.resolve(path), flags, position: 0, append: f.append });
    return fd;
  }

  function closeSync(fd: number): void {
    if (!fds.delete(fd)) throw new VfsError('EBADF', 'close', String(fd));
  }

  function readSync(fd: number, buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset, position: number | null = null): number {
    if (fd === 0) return 0; // stdin: EOF in the browser
    const entry = fds.get(fd);
    if (!entry) throw new VfsError('EBADF', 'read', String(fd));
    let data: Uint8Array;
    try {
      data = vfs.readFile(entry.path);
    } catch (err) {
      return asReadError(err);
    }
    // `-1` means "current position" to `src/node_file.cc` (the readFile context
    // passes it); treat it like `null`.
    const atCurrent = position === null || position === -1;
    const pos = atCurrent ? entry.position : position;
    const available = Math.max(0, data.byteLength - pos);
    const n = Math.min(length, available);
    buffer.set(data.subarray(pos, pos + n), offset);
    if (atCurrent) entry.position = pos + n;
    return n;
  }

  function writeSync(fd: number, buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset, position: number | null = null): number {
    if (fd === 1) {
      ctx.writeStdout(new TextDecoder().decode(buffer.subarray(offset, offset + length)));
      return length;
    }
    if (fd === 2) {
      ctx.writeStderr(new TextDecoder().decode(buffer.subarray(offset, offset + length)));
      return length;
    }
    const entry = fds.get(fd);
    if (!entry) throw new VfsError('EBADF', 'write', String(fd));
    const chunk = buffer.subarray(offset, offset + length);
    const atCurrent = position === null || position === -1;
    if (entry.append) {
      vfs.appendFile(entry.path, chunk);
      entry.position = vfs.readFile(entry.path).byteLength;
    } else {
      const pos = atCurrent ? entry.position : position;
      const existing = vfs.readFile(entry.path);
      const needed = pos + chunk.byteLength;
      const merged = new Uint8Array(Math.max(existing.byteLength, needed));
      merged.set(existing, 0);
      merged.set(chunk, pos);
      vfs.writeFile(entry.path, merged);
      if (atCurrent) entry.position = needed;
    }
    return chunk.byteLength;
  }

  /**
   * `src/node_file.cc`'s `FSReqCallback`: the request object the callback API
   * stashes `oncomplete` (and a `context`) on, then hands to a binding method.
   * We run each operation synchronously and settle the request on the next tick,
   * invoking `oncomplete` with `this === req` — the shape `internal/fs/read/
   * context.js` relies on (`this.context`). `cancel()` is what an aborted
   * `signal` calls (`bindSignalToReq`).
   */
  class FSReqCallback {
    oncomplete: ((err: Error | null, result?: unknown) => void) | null = null;
    context: unknown = undefined;
    signal: unknown = undefined;
    useBigint = false;
    cancelled = false;
    constructor(useBigint = false) {
      this.useBigint = !!useBigint;
    }
    cancel(): void {
      this.cancelled = true;
    }
  }

  /** Settle a request exactly like `FSReqCallback::Resolve`/`Reject`. */
  function settle(req: FSReqCallback, err: Error | null, result?: unknown): void {
    const cb = req.oncomplete;
    if (typeof cb !== 'function') return;
    if (err) (cb as (e: Error) => void).call(req, err);
    else if (result === undefined) (cb as (e: null) => void).call(req, null);
    else (cb as (e: null, r: unknown) => void).call(req, null, result);
  }

  function asyncCall<T>(fn: () => T, cb?: (err: Error | null, result?: T) => void, resultTransform?: (r: T) => unknown) {
    ctx.nextTick(() => {
      if (typeof cb !== 'function') return;
      try {
        const r = fn();
        cb(null, (resultTransform ? resultTransform(r) : r) as T);
      } catch (err) {
        cb(err as Error);
      }
    });
  }

  /**
   * Resolve Node's trailing "request wrap" argument: `kUsePromises` → a
   * Promise, an `FSReqCallback` → callback style, a bare function → callback
   * style, anything else → synchronous return. Mirrors how `src/node_file.cc`
   * discriminates the modes.
   */
  function wrap<T>(fn: () => T, token: unknown): T | Promise<unknown> | undefined {
    if (token === USE_PROMISES) return Promise.resolve().then(fn);
    if (token instanceof FSReqCallback) {
      ctx.nextTick(() => {
        if (token.cancelled) return;
        try {
          settle(token, null, fn() as unknown);
        } catch (err) {
          settle(token, err as Error);
        }
      });
      return undefined;
    }
    if (typeof token === 'function') {
      ctx.nextTick(() => {
        try {
          (token as (e: Error | null, r?: unknown) => void)(null, fn());
        } catch (err) {
          (token as (e: Error | null, r?: unknown) => void)(err as Error);
        }
      });
      return undefined;
    }
    return fn();
  }

  /**
   * `internal/fs/utils`'s `getStatsFromBinding` reads the binding's stat result
   * positionally: an 18-slot tuple `[dev, mode, nlink, uid, gid, rdev, blksize,
   * ino, size, blocks, atime_s, atime_ns, mtime_s, mtime_ns, ctime_s, ctime_ns,
   * birthtime_s, birthtime_ns]`. BigInt stats keep the same slots as BigInts.
   */
  function statSlots(st: Stat, bigint: boolean): Float64Array | BigInt64Array {
    const toSecNsec = (ms: number): [number, number] => {
      const sec = Math.floor(ms / 1000);
      return [sec, Math.round((ms - sec * 1000) * 1e6)];
    };
    const atime = toSecNsec(st.atimeMs);
    const mtime = toSecNsec(st.mtimeMs);
    const ctime = toSecNsec(st.ctimeMs);
    const birth = toSecNsec(st.birthtimeMs);
    if (bigint) {
      return BigInt64Array.from([
        BigInt(st.dev), BigInt(st.mode), BigInt(st.nlink), BigInt(st.uid), BigInt(st.gid),
        BigInt(st.rdev), BigInt(st.blksize), BigInt(st.ino), BigInt(st.size), BigInt(st.blocks),
        BigInt(atime[0]), BigInt(atime[1]), BigInt(mtime[0]), BigInt(mtime[1]),
        BigInt(ctime[0]), BigInt(ctime[1]), BigInt(birth[0]), BigInt(birth[1]),
      ]);
    }
    return Float64Array.from([
      st.dev, st.mode, st.nlink, st.uid, st.gid, st.rdev, st.blksize, st.ino, st.size, st.blocks,
      atime[0], atime[1], mtime[0], mtime[1], ctime[0], ctime[1], birth[0], birth[1],
    ]);
  }

  /** `stringToFlags` numbers → the fd-table's flag letter. */
  function flagsToMode(flags: number): string {
    const F = FS_OPEN_FLAGS;
    const acc = flags & 3;
    const create = !!(flags & F.O_CREAT);
    const excl = !!(flags & F.O_EXCL);
    const trunc = !!(flags & F.O_TRUNC);
    const append = !!(flags & F.O_APPEND);
    if (append) return excl ? (acc === 2 ? 'ax+' : 'ax') : acc === 2 ? 'a+' : 'a';
    if (trunc || create) {
      if (acc === 2) return excl ? 'wx+' : 'w+';
      return excl ? 'wx' : 'w';
    }
    return acc === 2 ? 'r+' : 'r';
  }

  function encodeResult(value: string, encoding: unknown): string | Uint8Array {
    return encoding === 'buffer' ? new TextEncoder().encode(value) : value;
  }

  /**
   * `binding.readdir(path, encoding, withFileTypes, token)`: withFileTypes
   * returns the `{0: names, 1: types}` split shaping `getDirents` expects;
   * otherwise a plain name array.
   */
  function readdirShape(path: string, withFileTypes: boolean): unknown {
    const entries = vfs.readdir(path);
    const names = entries.map((d) => d.name);
    if (!withFileTypes) return names;
    const types = entries.map((d) => direntTypeCode(d.type));
    return { 0: names, 1: types };
  }

  function mkdtempSync(prefix: string): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let suffix = '';
      for (let i = 0; i < 6; i += 1) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      const candidate = prefix + suffix;
      if (!vfs.exists(candidate)) {
        vfs.mkdir(candidate);
        return vfs.resolve(candidate);
      }
    }
    throw new VfsError('EEXIST', 'mkdtemp', prefix);
  }

  function readBuffersSync(fd: number, buffers: Uint8Array[], position: number | null): number {
    let total = 0;
    let pos = position;
    for (const buf of buffers) {
      const n = readSync(fd, buf, 0, buf.byteLength, pos);
      total += n;
      if (pos !== null) pos += n;
      if (n < buf.byteLength) break;
    }
    return total;
  }

  function writeBuffersSync(fd: number, buffers: Uint8Array[], position: number | null): number {
    let total = 0;
    let pos = position;
    for (const buf of buffers) {
      const n = writeSync(fd, buf, 0, buf.byteLength, pos);
      total += n;
      if (pos !== null) pos += n;
    }
    return total;
  }

  const direntTypeCode = (type: string): number => {
    switch (type) {
      case 'file': return 1; // UV_DIRENT_FILE
      case 'dir': return 2; // UV_DIRENT_DIR
      case 'symlink': return 3; // UV_DIRENT_LINK
      default: return 0; // UV_DIRENT_UNKNOWN
    }
  };

  const isEnoent = (err: unknown): boolean => (err as { code?: string } | null)?.code === 'ENOENT';

  /** fd → path, or throw `EBADF` like the native binding does. */
  function fdPath(fd: number): string {
    const entry = fds.get(fd);
    if (!entry) throw new VfsError('EBADF', 'fd', String(fd));
    return entry.path;
  }

  function ftruncateFd(fd: number, len: number): void {
    const data = vfs.readFile(fdPath(fd));
    const next = new Uint8Array(len);
    next.set(data.subarray(0, Math.min(len, data.byteLength)));
    vfs.writeFile(fdPath(fd), next);
  }

  /** `getStatFsFromBinding`: an 8-slot tuple `[type, bsize, blocks, bfree, bavail, files, ffree]`. */
  function statfsSlots(bigint: boolean): Float64Array | BigInt64Array {
    const slots = [0, 4096, 0, 0, 0, 0, 0, 0];
    return bigint ? BigInt64Array.from(slots.map((n) => BigInt(n))) : Float64Array.from(slots);
  }

  /** Encode a string with the encoding `string_bytes` would use. */
  function encodeWith(value: string, encoding: unknown): Uint8Array {
    const BufferCtor = (globalThis as { Buffer?: { from(s: string, e?: string): Uint8Array } }).Buffer;
    if (BufferCtor && typeof encoding === 'string') return BufferCtor.from(value, encoding);
    return new TextEncoder().encode(value);
  }

  /** `binding.FileHandle`: the fd wrapper `internal/fs/promises` extends. */
  class FileHandleBinding {
    fd: number;
    constructor(fd: number) {
      this.fd = fd;
    }
    getAsyncId(): number {
      return this.fd;
    }
    closeSync(): void {
      closeSync(this.fd);
    }
    close(): Promise<void> {
      return Promise.resolve().then(() => closeSync(this.fd));
    }
  }

  /** `binding.ReadFileJob`: open + fstat + read (+ close for small files) in one
   * go. Files up to `length` come back whole (`fd === -1`); bigger ones come
   * back as an open fd + size, read by `readFileHandle`. The buffer is a real
   * `Buffer` (the native job produces one). */
  class ReadFileJobBinding {
    ondone: ((err: Error | null, buffer?: Uint8Array, fd?: number, size?: number, closeErr?: Error | null) => void) | null = null;
    private readonly flags: number;
    private readonly length: number;
    constructor(_path: string, flags: number, length: number) {
      this.flags = flags;
      this.length = length;
    }
    run(path: string): Error | undefined {
      try {
        // `open` first: a missing file must fail with the `open` syscall, like
        // the native job does.
        const fd = openSync(path, flagsToMode(this.flags));
        const st = vfs.stat(path);
        if (st.size <= this.length) {
          const data = vfs.readFile(path);
          closeSync(fd);
          const BufferCtor = (globalThis as {
            Buffer?: { from(b: ArrayBuffer, o?: number, l?: number): Uint8Array };
          }).Buffer;
          const buffer =
            BufferCtor && data.byteLength > 0
              ? BufferCtor.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
              : data;
          this.ondone?.(null, buffer, -1, buffer.byteLength, null);
        } else {
          this.ondone?.(null, undefined, fd, st.size, null);
        }
        return undefined;
      } catch (err) {
        this.ondone?.(err as Error);
        return undefined;
      }
    }
  }

  /** `binding.WriteFileJob`: open + write + close in one go. */
  class WriteFileJobBinding {
    ondone: ((err: Error | null) => void) | null = null;
    private readonly flags: number;
    private readonly mode: number;
    private readonly data: Uint8Array;
    constructor(_path: string, flags: number, mode: number, data: Uint8Array) {
      this.flags = flags;
      this.mode = mode;
      this.data = data;
    }
    run(path: string): Error | undefined {
      let fd: number | undefined;
      try {
        fd = openSync(path, flagsToMode(this.flags), this.mode);
        writeSync(fd, this.data, 0, this.data.byteLength, 0);
        closeSync(fd);
        this.ondone?.(null);
        return undefined;
      } catch (err) {
        if (fd !== undefined) {
          try { closeSync(fd); } catch { /* already closed */ }
        }
        this.ondone?.(err as Error);
        return undefined;
      }
    }
  }

  /**
   * `binding.StatWatcher` (`src/node_stat_watcher.cc`): the poller behind
   * `fs.watchFile`. A browser tab has no `inotify`, but libuv's `uv_fs_poll` is
   * itself a stat poller, so this reproduces its exact observable protocol: the
   * first successful stat sets the baseline silently, a later stat that differs
   * calls `onchange(0, [curr…, prev…])`, and a vanished path calls
   * `onchange(<negative errno>, [zeroed…, lastGood…])`. `onchange` runs with
   * `this === handle`.
   */
  class StatWatcherBinding {
    onchange:
      | ((this: StatWatcherBinding, status: number, stats: Float64Array | BigInt64Array) => void)
      | null = null;
    #bigint: boolean;
    #timer: number | null = null;
    #path = '';
    #busyPolling = 0;
    #last: Float64Array | BigInt64Array | null = null;
    #asyncId = 1;

    constructor(bigint?: boolean) {
      this.#bigint = !!bigint;
    }

    #slots(): Float64Array | BigInt64Array | null {
      try {
        return statSlots(vfs.stat(this.#path), this.#bigint);
      } catch (err) {
        if (err instanceof VfsError && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
          return null;
        }
        throw err;
      }
    }

    #zero(): Float64Array | BigInt64Array {
      const n = 18;
      return this.#bigint
        ? BigInt64Array.from({ length: n }, () => 0n)
        : Float64Array.from({ length: n }, () => 0);
    }

    #equal(a: Float64Array | BigInt64Array, b: Float64Array | BigInt64Array): boolean {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
      return true;
    }

    #pair(curr: Float64Array | BigInt64Array | null): Float64Array | BigInt64Array {
      const prev = this.#last ?? this.#zero();
      const c = curr ?? this.#zero();
      if (this.#bigint) {
        const out = new BigInt64Array(36);
        out.set(c as BigInt64Array, 0);
        out.set(prev as BigInt64Array, 18);
        return out;
      }
      const out = new Float64Array(36);
      out.set(c as Float64Array, 0);
      out.set(prev as Float64Array, 18);
      return out;
    }

    #poll(): void {
      const current = this.#slots();
      if (current === null) {
        // `uv_fs_poll`'s error branch: report the last good stat against a
        // zeroed one, once per distinct errno.
        if (this.#busyPolling !== ERRNO.ENOENT) {
          this.onchange?.call(this, -ERRNO.ENOENT, this.#pair(null));
          this.#busyPolling = ERRNO.ENOENT;
        }
        return;
      }
      if (this.#busyPolling !== 0) {
        if (this.#busyPolling < 0 || !this.#last || !this.#equal(this.#last, current)) {
          this.onchange?.call(this, 0, this.#pair(current));
        }
      }
      this.#last = current;
      this.#busyPolling = 1;
    }

    start(path: string, interval: number): number {
      if (this.#timer !== null) return 0;
      this.#path = vfs.resolve(path);
      // First stat is baseline-only; `#busyPolling` starts at 0 so the initial
      // tick records it silently, exactly like `uv_fs_poll_start`.
      this.#poll();
      // A live `StatWatcher` keeps the run alive (it is a libuv handle), and the
      // runtime's `timers` surface is what participates in that decision.
      this.#timer = ctx.timers.setInterval(
        () => this.#poll(),
        interval > 0 ? interval : 5007,
      );
      return 0;
    }

    getAsyncId(): number {
      return this.#asyncId;
    }
    ref(): this {
      return this;
    }
    unref(): this {
      return this;
    }
    stop(): void {
      this.close();
    }
    close(): void {
      if (this.#timer !== null) {
        ctx.timers.clearInterval(this.#timer);
        this.#timer = null;
      }
      this.#asyncId += 1;
    }
  }

  /**
   * `binding.readFileUtf8(path|fd, flags)`: the fast whole-file read path
   * `fs.readFileSync(path, 'utf8')` takes. Synchronous, returns a string.
   */
  function readFileUtf8(pathOrFd: string | number, _flags?: number): string {
    try {
      if (typeof pathOrFd === 'number') {
        const entry = fds.get(pathOrFd);
        if (!entry) throw new VfsError('EBADF', 'read', String(pathOrFd));
        return new TextDecoder().decode(vfs.readFile(entry.path));
      }
      return new TextDecoder().decode(vfs.readFile(pathOrFd));
    } catch (err) {
      return asReadError(err);
    }
  }

  /**
   * `binding.writeFileUtf8(path|fd, data, flags, mode)`: the fast whole-file
   * write path `fs.writeFileSync(path, str, 'utf8')` takes. Synchronous. It is a
   * *single* VFS operation (not open+write+close) so `fs.watch` reports one
   * event for a whole-file write, the way the native path does.
   */
  function writeFileUtf8(
    pathOrFd: string | number,
    data: string,
    flags: number,
    mode: number,
  ): void {
    const bytes = new TextEncoder().encode(String(data));
    if (typeof pathOrFd === 'number') {
      writeSync(pathOrFd, bytes, 0, bytes.byteLength, 0);
      return;
    }
    const flag = flagsToMode(flags);
    if (flag.startsWith('a')) {
      vfs.appendFile(pathOrFd, bytes);
      return;
    }
    if (flag === 'wx' || flag === 'wx+' || flag === 'rs' || flag === 'rs+') {
      // Exclusive create (or read-only): preserve the open() error semantics.
      const fd = openSync(pathOrFd, flag, mode);
      try {
        writeSync(fd, bytes, 0, bytes.byteLength, 0);
      } finally {
        closeSync(fd);
      }
      return;
    }
    vfs.writeFile(pathOrFd, bytes);
  }

  /** A `SystemError`-shaped error: `name: 'Error'` plus the `ERR_*` code. */
  function fsError(code: string, message: string): Error {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    return err;
  }

  /** True when `child` is `parent` itself or lives underneath it. */
  function isSubPath(parent: string, child: string): boolean {
    const p = vfs.resolve(parent);
    const c = vfs.resolve(child);
    return c === p || c.startsWith(p === '/' ? '/' : p + '/');
  }

  /**
   * `C++` `CpSyncCheckPaths`: validate a `fs.cpSync` source/destination pair.
   * Mirrors the native checks (order, messages and codes all come from
   * `src/node_file.cc`).
   */
  function cpSyncCheckPaths(
    src: string,
    dest: string,
    _dereference: boolean,
    recursive: boolean,
  ): void {
    const srcStat = vfs.stat(src);
    const srcIsDir = srcStat.type === 'dir';
    const destExists = vfs.exists(dest);
    const srcStr = vfs.resolve(src);
    const destStr = vfs.resolve(dest);
    if (destExists) {
      const destIsDir = vfs.stat(dest).type === 'dir';
      if (srcStr === destStr) {
        throw fsError('ERR_FS_CP_EINVAL', `src and dest cannot be the same ${destStr}`);
      }
      if (srcIsDir && !destIsDir) {
        throw fsError(
          'ERR_FS_CP_DIR_TO_NON_DIR',
          `Cannot overwrite non-directory ${destStr} with directory ${srcStr}`,
        );
      }
      if (!srcIsDir && destIsDir) {
        throw fsError(
          'ERR_FS_CP_NON_DIR_TO_DIR',
          `Cannot overwrite directory ${destStr} with non-directory ${srcStr}`,
        );
      }
    }
    const srcPathStr = srcStr.endsWith('/') ? srcStr : `${srcStr}/`;
    if (srcIsDir && destStr.startsWith(srcPathStr)) {
      throw fsError(
        'ERR_FS_CP_EINVAL',
        `Cannot copy ${srcPathStr} to a subdirectory of self ${destStr}`,
      );
    }
    if (srcIsDir && !recursive) {
      throw fsError(
        'ERR_FS_EISDIR',
        `Recursive option not enabled, cannot copy a directory: ${srcPathStr}`,
      );
    }
  }

  /**
   * `C++` `CpSyncOverrideFile`: copy `src` over the existing `dest`.
   */
  function cpSyncOverrideFile(
    src: string,
    dest: string,
    mode: number,
    _preserveTimestamps: boolean,
  ): void {
    const fd = openSync(dest, 'w', mode);
    try {
      const data = vfs.readFile(src);
      writeSync(fd, data, 0, data.byteLength, 0);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * `C++` `CpSyncCopyDir`: recursively copy `src` into `dest`. The VFS has no
   * symlinks, so the link/special-file branches of the native version can never
   * be reached.
   */
  function cpSyncCopyDir(
    src: string,
    dest: string,
    force: boolean,
    _dereference: boolean,
    errorOnExist: boolean,
    _verbatimSymlinks: boolean,
    _preserveTimestamps: boolean,
    mode?: number,
  ): void {
    const srcStat = vfs.stat(src);
    if (srcStat.type !== 'dir') {
      if (vfs.exists(dest)) {
        if (!force) {
          if (errorOnExist) throw fsError('ERR_FS_CP_EEXIST', 'Target already exists');
          return;
        }
        const dstStat = vfs.stat(dest);
        if (dstStat.type === 'dir') {
          throw fsError(
            'ERR_FS_CP_NON_DIR_TO_DIR',
            `Cannot overwrite directory ${dest} with non-directory ${src}`,
          );
        }
        cpSyncOverrideFile(src, dest, mode ?? 0o666, _preserveTimestamps);
        return;
      }
      const fd = openSync(dest, 'w', mode ?? 0o666);
      try {
        const data = vfs.readFile(src);
        writeSync(fd, data, 0, data.byteLength, 0);
      } finally {
        closeSync(fd);
      }
      return;
    }
    if (vfs.exists(dest)) {
      const dstStat = vfs.stat(dest);
      if (dstStat.type !== 'dir') {
        throw fsError(
          'ERR_FS_CP_DIR_TO_NON_DIR',
          `Cannot overwrite non-directory ${dest} with directory ${src}`,
        );
      }
    } else {
      vfs.mkdir(dest, { recursive: true, mode: mode ?? 0o777 });
    }
    for (const entry of vfs.readdir(src)) {
      cpSyncCopyDir(
        src === '/' ? `/${entry.name}` : `${src}/${entry.name}`,
        dest === '/' ? `/${entry.name}` : `${dest}/${entry.name}`,
        force,
        _dereference,
        errorOnExist,
        _verbatimSymlinks,
        _preserveTimestamps,
        mode,
      );
    }
  }

  /**
   * `binding.CpDirJob` (`src/node_file.cc`): the async directory copy the
   * promise `fs.cp` uses. Calls `ondone(err)` with `this === job`.
   */
  class CpDirJobBinding {
    ondone:
      | ((this: CpDirJobBinding, err: Error | null, specialFile?: string, specialFilePath?: string) => void)
      | null = null;
    private readonly src: string;
    private readonly dest: string;
    private readonly force: boolean;
    private readonly dereference: boolean;
    private readonly errorOnExist: boolean;
    private readonly verbatimSymlinks: boolean;
    private readonly preserveTimestamps: boolean;
    constructor(
      src: string,
      dest: string,
      force: boolean,
      dereference: boolean,
      errorOnExist: boolean,
      verbatimSymlinks: boolean,
      preserveTimestamps: boolean,
      _mode?: number,
    ) {
      this.src = src;
      this.dest = dest;
      this.force = force;
      this.dereference = dereference;
      this.errorOnExist = errorOnExist;
      this.verbatimSymlinks = verbatimSymlinks;
      this.preserveTimestamps = preserveTimestamps;
    }
    run(): Error | undefined {
      ctx.nextTick(() => {
        try {
          cpSyncCopyDir(
            this.src,
            this.dest,
            this.force,
            this.dereference,
            this.errorOnExist,
            this.verbatimSymlinks,
            this.preserveTimestamps,
          );
          this.ondone?.call(this, null);
        } catch (err) {
          this.ondone?.call(this, err as Error);
        }
      });
      return undefined;
    }
  }

  return {
    // ---- request/job shapes ----
    FSReqCallback,
    FileHandle: FileHandleBinding,
    ReadFileJob: ReadFileJobBinding,
    WriteFileJob: WriteFileJobBinding,
    CpDirJob: CpDirJobBinding,
    StatWatcher: StatWatcherBinding,
    kFsStatsFieldsNumber: 18,
    // ---- extra sync paths `lib/fs.js` takes ----
    readFileUtf8,
    writeFileUtf8,
    handleToFd: (handle: { fd?: number }) => handle.fd ?? -1,
    cpSyncCheckPaths,
    cpSyncCopyDir,
    cpSyncOverrideFile,
    // ---- sync primitives ----
    openSync,
    closeSync,
    readSync,
    writeSync,
    statSync,
    lstatSync: (path: string) => toStat(vfs.lstat(path)),
    fstatSync: (fd: number) => {
      const entry = fds.get(fd);
      if (!entry) throw new VfsError('EBADF', 'fstat', String(fd));
      return statSync(entry.path);
    },
    existsSync: (path: string) => vfs.exists(path),
    readFileSync,
    writeFileSync,
    appendFileSync: (path: string, data: Uint8Array) => vfs.appendFile(path, data),
    readdirSync: (path: string, _encoding?: unknown, withFileTypes?: boolean) =>
      vfs.readdir(path, { withFileTypes: !!withFileTypes }),
    mkdirSync: (path: string, mode?: number, recursive?: boolean) =>
      vfs.mkdir(path, { recursive: !!recursive, mode }),
    rmdirSync: (path: string, opts?: { recursive?: boolean }) => vfs.rm(path, { recursive: opts?.recursive, syscall: 'rmdir' }),
    unlinkSync: (path: string) => vfs.rm(path, { syscall: 'unlink' }),
    renameSync: (from: string, to: string) => vfs.rename(from, to),
    copyFileSync: (from: string, to: string, mode?: number) => vfs.copyFile(from, to, mode),
    chmodSync: (path: string, mode: number) => vfs.chmod(path, mode),
    accessSync: (path: string) => {
      if (!vfs.exists(path)) throw new VfsError('ENOENT', 'access', path);
    },
    ftruncateSync: (fd: number, len = 0) => {
      const entry = fds.get(fd);
      if (!entry) throw new VfsError('EBADF', 'ftruncate', String(fd));
      const data = vfs.readFile(entry.path);
      const next = new Uint8Array(len);
      next.set(data.subarray(0, Math.min(len, data.byteLength)));
      vfs.writeFile(entry.path, next);
    },
    fsyncSync: () => undefined,
    fdatasyncSync: () => undefined,
    realpathSync: (path: string) => vfs.realpath(path),
    // `lib/fs.js` calls this positionally: (path, maxRetries, recursive,
    // retryDelay). `validateRmOptionsSync` has already applied `force`/EISDIR
    // logic before we get here, so a missing path is a no-op (as in native Rimraf).
    rmSync: (path: string, _maxRetries?: number, recursive?: boolean, _retryDelay?: number) => {
      if (!vfs.exists(path)) return;
      vfs.rm(path, { recursive: !!recursive });
    },

    // ---- async / promise surface (`internal/fs/promises` drives these) ----
    //
    // `src/node_file.cc` methods take a trailing "request wrap" argument: the
    // `kUsePromises` token (return a Promise), an `FSReqCallback` or callback
    // (invoke it), or neither (run synchronously). Both fs modules mix them.
    kUsePromises: USE_PROMISES,

    open: (path: string, flags: string | number, mode: number, token?: unknown) =>
      wrap(() => openSync(path, typeof flags === 'number' ? flagsToMode(flags) : flags, mode), token),
    close: (fd: number, token?: unknown) => wrap(() => closeSync(fd), token),
    read: (
      fd: number,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null,
      token?: unknown,
    ) => wrap(() => readSync(fd, buffer, offset, length, position), token),
    readBuffers: (fd: number, buffers: Uint8Array[], position: number | null, token?: unknown) =>
      wrap(() => readBuffersSync(fd, buffers, position), token),
    writeBuffer: (
      fd: number,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null,
      token?: unknown,
    ) => wrap(() => writeSync(fd, buffer, offset, length, position), token),
    writeBuffers: (fd: number, buffers: Uint8Array[], position: number | null, token?: unknown) =>
      wrap(() => writeBuffersSync(fd, buffers, position), token),
    writeString: (fd: number, string: string, position: number | null, encoding: unknown, token?: unknown) => {
      const bytes = encodeWith(string, encoding);
      return wrap(() => writeSync(fd, bytes, 0, bytes.byteLength, position), token);
    },
    stat: (path: string, bigint: boolean, token?: unknown, throwIfNoEntry?: boolean) =>
      wrap(() => {
        try {
          return statSlots(vfs.stat(path), !!bigint);
        } catch (err) {
          if (throwIfNoEntry === false && isEnoent(err)) return undefined;
          throw err;
        }
      }, token),
    lstat: (path: string, bigint: boolean, token?: unknown, throwIfNoEntry?: boolean) =>
      wrap(() => {
        try {
          return statSlots(vfs.lstat(path), !!bigint);
        } catch (err) {
          if (throwIfNoEntry === false && isEnoent(err)) return undefined;
          throw err;
        }
      }, token),
    fstat: (fd: number, bigint: boolean, token?: unknown) =>
      wrap(() => statSlots(vfs.stat(fdPath(fd)), !!bigint), token),
    statfs: (_path: string, bigint: boolean, token?: unknown) =>
      wrap(() => statfsSlots(bigint), token),
    access: (path: string, _mode: number, token?: unknown) =>
      wrap(() => {
        if (!vfs.exists(path)) throw new VfsError('ENOENT', 'access', path);
      }, token),
    copyFile: (src: string, dest: string, mode: number, token?: unknown) =>
      wrap(() => vfs.copyFile(src, dest, mode), token),
    rename: (oldPath: string, newPath: string, token?: unknown) =>
      wrap(() => vfs.rename(oldPath, newPath), token),
    unlink: (path: string, token?: unknown) => wrap(() => vfs.rm(path, { syscall: 'unlink' }), token),
    rmdir: (path: string, token?: unknown) => wrap(() => vfs.rm(path, { syscall: 'rmdir' }), token),
    mkdir: (path: string, mode: number | undefined, recursive: boolean, token?: unknown) =>
      wrap(() => vfs.mkdir(path, { recursive: !!recursive, mode }), token),
    readdir: (path: string, _encoding: unknown, withFileTypes: boolean, token?: unknown) =>
      wrap(() => readdirShape(path, !!withFileTypes), token),
    mkdtemp: (prefix: string, _encoding: unknown, token?: unknown) => wrap(() => mkdtempSync(prefix), token),
    realpath: (path: string, encoding: unknown, token?: unknown) =>
      wrap(() => encodeResult(vfs.realpath(path), encoding), token),
    openFileHandle: (path: string, flags: number, mode: number, token?: unknown) =>
      wrap(() => new FileHandleBinding(openSync(path, flagsToMode(flags), mode)), token),
    ftruncate: (fd: number, len: number, token?: unknown) => wrap(() => ftruncateFd(fd, len), token),
    truncate: (path: string, len: number, token?: unknown) =>
      wrap(() => {
        const data = vfs.readFile(path);
        const next = new Uint8Array(len);
        next.set(data.subarray(0, Math.min(len, data.byteLength)));
        vfs.writeFile(path, next);
      }, token),
    fsync: (_fd: number, token?: unknown) => wrap(() => undefined, token),
    fdatasync: (_fd: number, token?: unknown) => wrap(() => undefined, token),
    fchmod: (fd: number, mode: number, token?: unknown) => wrap(() => vfs.chmod(fdPath(fd), mode), token),
    chmod: (path: string, mode: number, token?: unknown) => wrap(() => vfs.chmod(path, mode), token),
    // The VFS has no ownership model, so the chown family and timestamp setters
    // succeed as no-ops (matching how a real permission-less FS behaves).
    fchown: (_fd: number, _uid: number, _gid: number, token?: unknown) => wrap(() => undefined, token),
    chown: (path: string, _uid: number, _gid: number, token?: unknown) =>
      wrap(() => {
        if (!vfs.exists(path)) throw new VfsError('ENOENT', 'chown', path);
      }, token),
    lchown: (path: string, _uid: number, _gid: number, token?: unknown) =>
      wrap(() => {
        if (!vfs.exists(path)) throw new VfsError('ENOENT', 'lchown', path);
      }, token),
    utimes: (path: string, _atime: number, _mtime: number, token?: unknown) =>
      wrap(() => {
        if (!vfs.exists(path)) throw new VfsError('ENOENT', 'utime', path);
      }, token),
    futimes: (_fd: number, _atime: number, _mtime: number, token?: unknown) => wrap(() => undefined, token),
    lutimes: (path: string, _atime: number, _mtime: number, token?: unknown) =>
      wrap(() => {
        if (!vfs.exists(path)) throw new VfsError('ENOENT', 'lutime', path);
      }, token),
    // No symlink support: reproduce the two ways these calls fail on a real FS
    // (missing parent, parent is a file) so error handling matches, then fail
    // loudly rather than silently pretending the link was created.
    symlink: (target: string, path: string, _type: number, _token?: unknown) => {
      const abs = vfs.resolve(path);
      const parent = abs.slice(0, abs.lastIndexOf('/')) || '/';
      if (!vfs.exists(parent)) throw new VfsError('ENOENT', 'symlink', target, undefined, path);
      if (vfs.stat(parent).type !== 'dir') {
        throw new VfsError('ENOTDIR', 'symlink', target, undefined, path);
      }
      throw new VfsError('ENOSYS', 'symlink', path);
    },
    link: (existing: string, path: string, _token?: unknown) => {
      if (!vfs.exists(existing)) throw new VfsError('ENOENT', 'link', existing, undefined, path);
      throw new VfsError('ENOSYS', 'link', path);
    },
    readlink: (path: string, _encoding: unknown, _token?: unknown) => {
      if (!vfs.exists(path)) throw new VfsError('ENOENT', 'readlink', path);
      throw new VfsError('EINVAL', 'readlink', path);
    },

    // ---- helpers used by the fs builtin ----
    __fds: fds,
    __statSync: statSync,

    // ---- internal/fs/utils + fs/promises support ----
    //
    // `src/node_file.cc`'s `InternalModuleStat`: the module "type" code for a
    // path — 1 for a CommonJS-loadable file, 2 for an ES module, 0 otherwise.
    // `internal/fs/utils`'s recursive readdir uses it to flag directories that
    // contain modules rather than ordinary files.
    internalModuleStat: (path: string): number => {
      let st: Stat;
      try {
        st = vfs.stat(path);
      } catch {
        return 0;
      }
      if (st.type !== 'file') return 0;
      // The VFS has no package.json `type` rules, so the extension is the whole
      // story: `.mjs` is always ESM, everything else loads as CommonJS.
      return path.endsWith('.mjs') ? 2 : 1;
    },

    // `binding.readdirRecursive(path, encoding, withFileTypes, kUsePromises)`.
    // `internal/fs/utils`'s `getRecursiveDirents` consumes the result as
    // `{ 0: names, 1: types, 2: counts, 3: dirs }`: entries grouped by directory,
    // with `counts[d]` entries under the relative directory `dirs[d]` (the root
    // being `''`).
    readdirRecursive: (
      path: string,
      _encoding?: unknown,
      _withFileTypes?: boolean,
      _usePromises?: unknown,
    ): { 0: string[]; 1: Uint8Array; 2: Uint32Array; 3: string[] } => {
      const DIRENT_FILE = 1;
      const DIRENT_DIR = 2;
      const DIRENT_LINK = 3;
      const names: string[] = [];
      const types: number[] = [];
      const counts: number[] = [];
      const dirs: string[] = [];

      const typeCode = (t: string): number =>
        t === 'dir' ? DIRENT_DIR : t === 'symlink' ? DIRENT_LINK : DIRENT_FILE;

      const visit = (abs: string, rel: string): void => {
        const entries = vfs.readdir(abs, { withFileTypes: true }) as Array<{
          name: string;
          type: string;
        }>;
        // The root directory (rel === '') is `dirs[0]`, matching the binding.
        dirs.push(rel);
        counts.push(entries.length);
        const subdirs: Array<{ abs: string; rel: string }> = [];
        for (const entry of entries) {
          names.push(entry.name);
          types.push(typeCode(entry.type));
          if (entry.type === 'dir') {
            subdirs.push({
              abs: `${abs === '/' ? '' : abs}/${entry.name}`,
              rel: rel === '' ? entry.name : `${rel}/${entry.name}`,
            });
          }
        }
        for (const sub of subdirs) visit(sub.abs, sub.rel);
      };

      visit(vfs.resolve(path), '');
      return { 0: names, 1: Uint8Array.from(types), 2: Uint32Array.from(counts), 3: dirs };
    },
  };
};
