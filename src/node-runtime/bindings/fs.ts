import type { BindingContext, BindingFactory } from './context';
import { VfsError, type Stat } from '../vfs/types';

/**
 * `fs` binding.
 *
 * Contract: synchronous primitives over the VFS plus nextTick-deferred callback
 * variants, mirroring the shape of Node's internal fs binding closely enough
 * that builtins can be written against it. An fd table lives here so file
 * descriptors behave like real ones (position, append).
 */

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

  function readFileSync(path: string): Uint8Array {
    return vfs.readFile(path);
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
    const data = vfs.readFile(entry.path);
    const pos = position ?? entry.position;
    const available = Math.max(0, data.byteLength - pos);
    const n = Math.min(length, available);
    buffer.set(data.subarray(pos, pos + n), offset);
    if (position === null) entry.position = pos + n;
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
    if (entry.append) {
      vfs.appendFile(entry.path, chunk);
      entry.position = vfs.readFile(entry.path).byteLength;
    } else {
      const pos = position ?? entry.position;
      const existing = vfs.readFile(entry.path);
      const needed = pos + chunk.byteLength;
      const merged = new Uint8Array(Math.max(existing.byteLength, needed));
      merged.set(existing, 0);
      merged.set(chunk, pos);
      vfs.writeFile(entry.path, merged);
      if (position === null) entry.position = needed;
    }
    return chunk.byteLength;
  }

  /** Wrap a sync op as a nextTick-deferred Node-style callback. */
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

  return {
    // ---- sync primitives ----
    openSync,
    closeSync,
    readSync,
    writeSync,
    statSync,
    lstatSync: statSync,
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
    mkdirSync: (path: string, opts?: { recursive?: boolean; mode?: number }) => vfs.mkdir(path, opts ?? {}),
    rmdirSync: (path: string, opts?: { recursive?: boolean }) => vfs.rm(path, { recursive: opts?.recursive }),
    unlinkSync: (path: string) => vfs.rm(path),
    renameSync: (from: string, to: string) => vfs.rename(from, to),
    copyFileSync: (from: string, to: string) => vfs.copyFile(from, to),
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
    realpathSync: (path: string) => vfs.resolve(path),
    rmSync: (path: string, opts?: { recursive?: boolean; force?: boolean }) => vfs.rm(path, opts ?? {}),

    // ---- callback variants ----
    open: (path: string, flags: string, mode: number, cb: (err: Error | null, fd?: number) => void) =>
      asyncCall(() => openSync(path, flags, mode), cb),
    close: (fd: number, cb: (err: Error | null) => void) => asyncCall(() => closeSync(fd), cb),
    read: (
      fd: number,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null,
      cb: (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => void,
    ) => asyncCall(() => readSync(fd, buffer, offset, length, position), cb, (n) => n),
    write: (
      fd: number,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null,
      cb: (err: Error | null, bytesWritten?: number) => void,
    ) => asyncCall(() => writeSync(fd, buffer, offset, length, position), cb, (n) => n),
    stat: (path: string, cb: (err: Error | null, st?: unknown) => void) => asyncCall(() => statSync(path), cb),
    lstat: (path: string, cb: (err: Error | null, st?: unknown) => void) => asyncCall(() => statSync(path), cb),
    fstat: (fd: number, cb: (err: Error | null, st?: Record<string, unknown>) => void) => {
      const entry = fds.get(fd);
      asyncCall<Record<string, unknown>>(() => {
        if (!entry) throw new VfsError('EBADF', 'fstat', String(fd));
        return statSync(entry.path);
      }, cb);
    },
    readdir: (path: string, cb: (err: Error | null, names?: unknown) => void) =>
      asyncCall(() => vfs.readdir(path).map((d) => d.name), cb),
    mkdir: (path: string, opts: unknown, cb: (err: Error | null) => void) =>
      asyncCall(() => vfs.mkdir(path, (opts ?? {}) as Record<string, never>), cb),
    unlink: (path: string, cb: (err: Error | null) => void) => asyncCall(() => vfs.rm(path), cb),
    rename: (from: string, to: string, cb: (err: Error | null) => void) => asyncCall(() => vfs.rename(from, to), cb),

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
