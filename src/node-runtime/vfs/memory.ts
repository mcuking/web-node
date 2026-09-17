import {
  type Dirent,
  type MkdirOptions,
  type ReaddirOptions,
  type Stat,
  type Vfs,
  type WriteOptions,
  VfsError,
} from './types';
import * as p from './posix';

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
    this.#onChange = opts.onChange;
  }

  #onChange?: (path: string | null) => void;

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

  #touch(path: string | null = null) {
    this.#onChange?.(path);
  }

  get cwd(): string {
    return this.#cwd;
  }

  resolve(input: string): string {
    if (!input) throw new VfsError('ENOENT', 'open', input);
    if (p.isAbsolute(input)) return p.normalize(input);
    return p.resolve(this.#cwd, input);
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
    const abs = this.resolve(path);
    const e = this.#entries.get(abs);
    if (!e) throw new VfsError('ENOENT', 'stat', path);
    return this.#toStat(e);
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
    const e = this.#entries.get(abs);
    if (!e) throw new VfsError('ENOENT', 'open', path);
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
        this.#touch(abs);
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
    this.#touch(abs);
  }

  appendFile(path: string, data: Uint8Array): void {
    this.writeFile(path, data, { flag: 'a' });
  }

  mkdir(path: string, opts: MkdirOptions = {}): void {
    const abs = this.resolve(path);
    if (abs === '/') {
      if (opts.recursive) return;
      throw new VfsError('EEXIST', 'mkdir', path);
    }
    if (this.#entries.has(abs)) {
      if (opts.recursive && this.#entries.get(abs)!.type === 'dir') return;
      throw new VfsError('EEXIST', 'mkdir', path);
    }

    if (opts.recursive) {
      const parts = p.segments(abs);
      let cur = '';
      for (const part of parts) {
        cur += '/' + part;
        const ex = this.#entries.get(cur);
        if (ex) {
          if (ex.type !== 'dir') throw new VfsError('ENOTDIR', 'mkdir', path);
          continue;
        }
        this.#entries.set(cur, this.#makeDir());
      }
      this.#touch(abs);
      return;
    }

    const [dir] = this.#parent(abs);
    this.#requireDir(dir, 'mkdir', path);
    this.#entries.set(abs, this.#makeDir());
    this.#touch(abs);
  }

  readdir(path: string, opts: ReaddirOptions = {}): Dirent[] {
    const abs = this.resolve(path);
    const e = this.#entries.get(abs);
    if (!e) throw new VfsError('ENOENT', 'scandir', path);
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

  rm(path: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
    const abs = this.resolve(path);
    const e = this.#entries.get(abs);
    if (!e) {
      if (opts.force) return;
      throw new VfsError('ENOENT', 'unlink', path);
    }
    if (abs === '/') throw new VfsError('EBUSY', 'unlink', path);

    if (e.type === 'dir') {
      const prefix = abs + '/';
      const children = [...this.#entries.keys()].filter((k) => k.startsWith(prefix));
      if (children.length > 0) {
        if (!opts.recursive) throw new VfsError('ENOTEMPTY', 'rmdir', path);
        for (const c of children) this.#entries.delete(c);
      }
      this.#entries.delete(abs);
    } else {
      this.#entries.delete(abs);
    }
    this.#touch(abs);
  }

  rename(from: string, to: string): void {
    const src = this.resolve(from);
    const dst = this.resolve(to);
    const e = this.#entries.get(src);
    if (!e) throw new VfsError('ENOENT', 'rename', from);
    const [dstDir] = this.#parent(dst);
    this.#requireDir(dstDir, 'rename', to);
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
    this.#touch(dst);
  }

  copyFile(from: string, to: string): void {
    const data = this.readFile(from);
    this.writeFile(to, data);
  }

  chmod(path: string, mode: number): void {
    const abs = this.resolve(path);
    const e = this.#entries.get(abs);
    if (!e) throw new VfsError('ENOENT', 'chmod', path);
    e.mode = mode & 0o777;
    this.#touch(abs);
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
        data: e.type === 'file' ? new TextDecoder().decode(e.data) : undefined,
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Bulk-load a snapshot (used when rehydrating from OPFS). */
  static fromSnapshot(
    snapshot: Array<{ path: string; type: 'file' | 'dir'; data?: string; mode?: number }>,
    opts: { cwd?: string; onChange?: (path: string | null) => void } = {},
  ): MemoryVfs {
    const vfs = new MemoryVfs(opts);
    const dirs = snapshot.filter((s) => s.type === 'dir').sort((a, b) => a.path.length - b.path.length);
    for (const d of dirs) vfs.mkdir(d.path, { recursive: true, mode: d.mode });
    for (const f of snapshot.filter((s) => s.type === 'file')) {
      vfs.writeFile(f.path, new TextEncoder().encode(f.data ?? ''), { mode: f.mode });
    }
    return vfs;
  }
}
