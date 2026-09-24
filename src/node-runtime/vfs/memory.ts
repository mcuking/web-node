import {
  type Dirent,
  type MkdirOptions,
  type ReaddirOptions,
  type Stat,
  type Vfs,
  type VfsChange,
  type WriteOptions,
  type PathLike,
  VfsError,
} from './types';
import * as p from './posix';
import { encodeBase64, decodeBase64 } from './base64';

interface Entry {
  type: 'file' | 'dir';
  data: Uint8Array;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  ino: number;
}

const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

/**
 * In-memory, inode-style VFS. This is the authoritative store; a persistence
 * backend (e.g. OPFS) mirrors it asynchronously.
 */
export class MemoryVfs implements Vfs {
  #entries = new Map<string, Entry>();
  #nextIno = 1;
  #cwd = '/';

  constructor(opts: { cwd?: string; onChange?: (path: string | null) => void } = {}) {
    this.#cwd = p.normalize(opts.cwd ?? '/');
    this.#entries.set('/', this.#makeDir());
    // `onChange` predates the subscription API; keep it working by projecting.
    if (opts.onChange) {
      const cb = opts.onChange;
      this.#listeners.add((change) => cb(change.path));
    }
  }

  #listeners = new Set<(change: VfsChange) => void>();

  /**
   * Where `sync()` sends a file's bytes (`fs.fsyncSync`). Injected by the
   * runtime once a durable backend exists; without one, `sync()` is a no-op
   * because the memory tree is already the authority for every reader.
   */
  #syncSink: ((path: string, data: Uint8Array) => void) | null = null;

  /** Install (or clear with `null`) the durable-write sink. */
  setSyncSink(sink: ((path: string, data: Uint8Array) => void) | null): void {
    this.#syncSink = sink;
  }

  /**
   * `fs.fsyncSync` / `fdatasyncSync`: block until this file's bytes are durable.
   *
   * The bytes come from the tree, which is the authority — the backing store may
   * be behind (persistence is debounced). A path with no file behind it is a
   * no-op, not an error: an fd stays usable after its file is unlinked, and
   * `fsync` on a directory descriptor is legal on Linux. Node reports both as
   * success.
   */
  sync(path: string): void {
    const resolved = p.resolve(this.#cwd, path);
    const entry = this.#entries.get(resolved);
    if (!entry || entry.type !== 'file') return;
    this.#syncSink?.(resolved, entry.data);
  }

  subscribe(listener: (change: VfsChange) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #makeDir(): Entry {
    const now = Date.now();
    return {
      type: 'dir',
      data: new Uint8Array(0),
      mode: 0o755,
      mtimeMs: now,
      ctimeMs: now,
      birthtimeMs: now,
      ino: this.#nextIno++,
    };
  }

  #makeFile(data: Uint8Array, mode = 0o644): Entry {
    const now = Date.now();
    return {
      type: 'file',
      data,
      mode,
      mtimeMs: now,
      ctimeMs: now,
      birthtimeMs: now,
      ino: this.#nextIno++,
    };
  }

  #touch(path: string, type: VfsChange['type']) {
    for (const listener of [...this.#listeners]) listener({ type, path });
  }

  get cwd(): string {
    return this.#cwd;
  }

  resolve(input: PathLike): string {
    // Accept Node's `PathLike` (string | file URL | Buffer) — see posix.toPathValue.
    const path = p.toPathValue(input);
    if (!path) throw new VfsError('ENOENT', 'open', path);
    if (p.isAbsolute(path)) return p.normalize(path);
    return p.resolve(this.#cwd, path);
  }

  chdir(dir: string): void {
    const abs = this.resolve(dir);
    const e = this.#entries.get(abs);
    if (!e) throw new VfsError('ENOENT', 'chdir', dir);
    if (e.type !== 'dir') throw new VfsError('ENOTDIR', 'chdir', dir);
    this.#cwd = abs;
  }

  #parent(path: string): [string, string] {
    const abs = p.normalize(path);
    const dir = p.dirname(abs);
    const name = p.basename(abs);
    return [dir, name];
  }

  #requireDir(dir: string, syscall: string, path: string): Entry {
    const e = this.#entries.get(dir);
    if (!e) throw new VfsError('ENOENT', syscall, path);
    if (e.type !== 'dir') throw new VfsError('ENOTDIR', syscall, path);
    return e;
  }

  exists(path: string): boolean {
    let abs: string;
    try {
      abs = this.resolve(path);
    } catch {
      return false;
    }
    return this.#entries.has(abs);
  }

  stat(path: string): Stat {
    return this.#statWith(path, 'stat');
  }

  lstat(path: string): Stat {
    // No symlinks exist in the VFS, so lstat is stat with a different syscall
    // name — which is exactly the observable difference Node exposes.
    return this.#statWith(path, 'lstat');
  }

  /**
   * Shared `stat`/`lstat` lookup. When the entry is missing Node distinguishes a
   * genuinely absent path (`ENOENT`) from one whose ancestor is a non-directory
   * (`ENOTDIR`): traversing `file/child` fails with `ENOTDIR` because `file`
   * cannot be descended into.
   */
  #statWith(path: string, syscall: string): Stat {
    const abs = this.resolve(path);
    return this.#toStat(this.#entryOrThrow(abs, path, syscall));
  }

  /**
   * Look up an entry, or throw the error Node's syscall would: `ENOENT` when it
   * is genuinely absent, `ENOTDIR` when an ancestor is a regular file.
   */
  #entryOrThrow(abs: string, path: string, syscall: string): Entry {
    const e = this.#entries.get(abs);
    if (e) return e;
    if (this.#ancestorFile(abs) !== undefined) throw new VfsError('ENOTDIR', syscall, path);
    throw new VfsError('ENOENT', syscall, path);
  }

  /** The nearest ancestor of `abs` (excluding itself) that is a regular file. */
  #ancestorFile(abs: string): string | undefined {
    let cur = p.dirname(abs);
    while (cur !== '/' && cur !== '.') {
      const e = this.#entries.get(cur);
      if (e && e.type !== 'dir') return cur;
      const parent = p.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return undefined;
  }

  /** `fs.realpath`: resolve the path and verify it exists (syscall `lstat`). */
  realpath(input: PathLike): string {
    const abs = this.resolve(input);
    const e = this.#entries.get(abs);
    if (!e) {
      if (this.#ancestorFile(abs) !== undefined) throw new VfsError('ENOTDIR', 'lstat', abs);
      throw new VfsError('ENOENT', 'lstat', abs);
    }
    return abs;
  }

  #toStat(e: Entry): Stat {
    return {
      type: e.type,
      size: e.type === 'file' ? e.data.byteLength : 0,
      mode: e.mode | (e.type === 'dir' ? S_IFDIR : S_IFREG),
      mtimeMs: e.mtimeMs,
      ctimeMs: e.ctimeMs,
      atimeMs: e.mtimeMs,
      birthtimeMs: e.birthtimeMs,
      dev: 1,
      ino: e.ino,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      blksize: 4096,
      blocks: e.type === 'file' ? Math.ceil(e.data.byteLength / 512) : 0,
    };
  }

  readFile(path: string): Uint8Array {
    const abs = this.resolve(path);
    const e = this.#entryOrThrow(abs, path, 'open');
    if (e.type === 'dir') throw new VfsError('EISDIR', 'read', path);
    return e.data.slice();
  }

  writeFile(path: string, data: Uint8Array, opts: WriteOptions = {}): void {
    const abs = this.resolve(path);
    const flag = opts.flag ?? 'w';
    const [dir, name] = this.#parent(abs);
    if (abs === '/') throw new VfsError('EISDIR', 'open', path);
    this.#requireDir(dir, 'open', path);

    const existing = this.#entries.get(abs);
    if (existing?.type === 'dir') throw new VfsError('EISDIR', 'open', path);
    if (existing && (flag === 'wx' || flag === 'ax')) {
      throw new VfsError('EEXIST', 'open', path);
    }

    if (flag === 'a' || flag === 'ax') {
      if (existing) {
        const merged = new Uint8Array(existing.data.byteLength + data.byteLength);
        merged.set(existing.data, 0);
        merged.set(data, existing.data.byteLength);
        existing.data = merged;
        existing.mtimeMs = Date.now();
        this.#touch(abs, 'change');
        return;
      }
    }

    if (existing) {
      existing.data = data.slice();
      existing.mtimeMs = Date.now();
      if (opts.mode !== undefined) existing.mode = opts.mode & 0o777;
    } else {
      this.#entries.set(abs, this.#makeFile(data.slice(), opts.mode !== undefined ? opts.mode & 0o777 : 0o644));
      void name;
    }
    this.#touch(abs, existing ? 'change' : 'create');
  }

  appendFile(path: string, data: Uint8Array): void {
    this.writeFile(path, data, { flag: 'a' });
  }

  mkdir(path: string, opts: MkdirOptions = {}): string | undefined {
    const abs = this.resolve(path);
    if (abs === '/') {
      if (opts.recursive) return undefined;
      throw new VfsError('EEXIST', 'mkdir', path);
    }
    if (this.#entries.has(abs)) {
      if (opts.recursive && this.#entries.get(abs)!.type === 'dir') return undefined;
      throw new VfsError('EEXIST', 'mkdir', path);
    }

    if (opts.recursive) {
      const parts = p.segments(abs);
      let cur = '';
      // Node returns the *first* directory the recursive mkdir had to create,
      // or `undefined` when the whole chain already existed.
      let firstCreated: string | undefined;
      for (const part of parts) {
        cur += '/' + part;
        const ex = this.#entries.get(cur);
        if (ex) {
          if (ex.type !== 'dir') throw new VfsError('ENOTDIR', 'mkdir', path);
          continue;
        }
        this.#entries.set(cur, this.#makeDir());
        firstCreated ??= cur;
      }
      this.#touch(abs, 'create');
      return firstCreated;
    }

    const [dir] = this.#parent(abs);
    this.#requireDir(dir, 'mkdir', path);
    this.#entries.set(abs, this.#makeDir());
    this.#touch(abs, 'create');
  }

  readdir(path: string, opts: ReaddirOptions = {}): Dirent[] {
    const abs = this.resolve(path);
    const e = this.#entries.get(abs);
    if (!e) {
      if (this.#ancestorFile(abs) !== undefined) throw new VfsError('ENOTDIR', 'scandir', path);
      throw new VfsError('ENOENT', 'scandir', path);
    }
    if (e.type !== 'dir') throw new VfsError('ENOTDIR', 'scandir', path);

    const prefix = abs === '/' ? '/' : abs + '/';
    const out: Dirent[] = [];
    const seen = new Set<string>();
    for (const key of this.#entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.length === 0) continue;
      const slash = rest.indexOf('/');
      const childName = slash === -1 ? rest : rest.slice(0, slash);
      if (opts.recursive) {
        const childPath = prefix + rest;
        const child = this.#entries.get(childPath)!;
        out.push({ name: childPath, type: child.type });
        continue;
      }
      if (seen.has(childName)) continue;
      seen.add(childName);
      const childPath = abs === '/' ? '/' + childName : abs + '/' + childName;
      const child = this.#entries.get(childPath);
      out.push({ name: childName, type: child ? child.type : 'file' });
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }

  rm(path: string, opts: { recursive?: boolean; force?: boolean; syscall?: 'unlink' | 'rmdir' | 'lstat' } = {}): void {
    const abs = this.resolve(path);
    const e = this.#entries.get(abs);
    if (!e) {
      if (opts.force) return;
      // `fs.rm` probes with lstat, `unlink`/`rmdir` report themselves.
      throw new VfsError('ENOENT', opts.syscall ?? 'unlink', path);
    }
    if (abs === '/') throw new VfsError('EBUSY', 'unlink', path);

    if (e.type === 'dir') {
      // `unlink` never removes a directory (libuv reports EPERM on macOS).
      if (opts.syscall === 'unlink' && !opts.recursive) throw new VfsError('EPERM', 'unlink', path);
      const prefix = abs + '/';
      const children = [...this.#entries.keys()].filter((k) => k.startsWith(prefix));
      if (children.length > 0) {
        if (!opts.recursive) throw new VfsError('ENOTEMPTY', 'rmdir', path);
        for (const c of children) this.#entries.delete(c);
      }
      this.#entries.delete(abs);
    } else {
      // `rmdir` requires a directory; a regular file yields ENOTDIR.
      if (opts.syscall === 'rmdir') throw new VfsError('ENOTDIR', 'rmdir', path);
      this.#entries.delete(abs);
    }
    this.#touch(abs, 'delete');
  }

  rename(from: string, to: string): void {
    const src = this.resolve(from);
    const dst = this.resolve(to);
    const e = this.#entries.get(src);
    if (!e) {
      if (this.#ancestorFile(src) !== undefined) throw new VfsError('ENOTDIR', 'rename', from, undefined, to);
      throw new VfsError('ENOENT', 'rename', from, undefined, to);
    }
    const [dstDir] = this.#parent(dst);
    const dstDirEntry = this.#entries.get(dstDir);
    if (!dstDirEntry) throw new VfsError('ENOENT', 'rename', from, undefined, to);
    if (dstDirEntry.type !== 'dir') throw new VfsError('ENOTDIR', 'rename', from, undefined, to);
    this.#entries.delete(src);
    this.#entries.set(dst, e);
    if (e.type === 'dir') {
      const prefix = src + '/';
      for (const key of [...this.#entries.keys()]) {
        if (key.startsWith(prefix)) {
          const moved = dst + '/' + key.slice(prefix.length);
          const ce = this.#entries.get(key)!;
          this.#entries.delete(key);
          this.#entries.set(moved, ce);
        }
      }
    }
    this.#touch(src, 'delete');
    this.#touch(dst, 'create');
  }

  copyFile(from: string, to: string, mode = 0): void {
    const src = this.resolve(from);
    const srcE = this.#entries.get(src);
    if (!srcE) {
      if (this.#ancestorFile(src) !== undefined) throw new VfsError('ENOTDIR', 'copyfile', from, undefined, to);
      throw new VfsError('ENOENT', 'copyfile', from, undefined, to);
    }
    // libuv's `copyfile(2)` on macOS reports ENOTSUP for a directory source.
    if (srcE.type === 'dir') throw new VfsError('ENOTSUP', 'copyfile', from, undefined, to);
    // `COPYFILE_EXCL` (1): fail if the destination already exists.
    if ((mode & 1) !== 0 && this.exists(to)) {
      throw new VfsError('EEXIST', 'copyfile', from, undefined, to);
    }
    this.writeFile(to, srcE.data.slice());
  }

  chmod(path: string, mode: number): void {
    const abs = this.resolve(path);
    const e = this.#entryOrThrow(abs, path, 'chmod');
    e.mode = mode & 0o777;
    this.#touch(abs, 'change');
  }

  /** Snapshot the whole tree (used for persistence + tests). */
  snapshot(): Array<{ path: string; type: 'file' | 'dir'; data?: string; mode: number }> {
    const out: Array<{ path: string; type: 'file' | 'dir'; data?: string; mode: number }> = [];
    for (const [path, e] of this.#entries) {
      if (path === '/') continue;
      out.push({
        path,
        type: e.type,
        mode: e.mode,
        // base64, not text: contents are arbitrary bytes (wasm, images) and a
        // UTF-8 round-trip would corrupt and inflate them.
        data: e.type === 'file' ? encodeBase64(e.data) : undefined,
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Bulk-load a snapshot (used when rehydrating from OPFS).
   *
   * `encoding` selects how `data` is interpreted: `base64` (current) or `text`
   * (legacy snapshots written before binary-safe persistence).
   */
  static fromSnapshot(
    snapshot: Array<{ path: string; type: 'file' | 'dir'; data?: string; mode?: number }>,
    opts: { cwd?: string; onChange?: (path: string | null) => void } = {},
    encoding: 'base64' | 'text' = 'base64',
  ): MemoryVfs {
    const vfs = new MemoryVfs(opts);
    const dirs = snapshot.filter((s) => s.type === 'dir').sort((a, b) => a.path.length - b.path.length);
    for (const d of dirs) vfs.mkdir(d.path, { recursive: true, mode: d.mode });
    for (const f of snapshot.filter((s) => s.type === 'file')) {
      const bytes = encoding === 'base64' ? decodeBase64(f.data ?? '') : new TextEncoder().encode(f.data ?? '');
      vfs.writeFile(f.path, bytes, { mode: f.mode });
    }
    return vfs;
  }
}
