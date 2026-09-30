import type { Persistence, ReadSource, SnapshotSource } from './persistence';

/**
 * The debounce must ride the **host** timer queue: `installGlobals` replaces the
 * worker's `globalThis.setTimeout` with the runtime's own, whose queue `runMain`
 * clears before every run. Captured at module load, before `installGlobals`.
 */
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);

/**
 * OPFS-backed persistence for the in-memory VFS — the backend used when the FS
 * worker is unavailable (no cross-origin isolation, so no `SharedArrayBuffer`).
 *
 * The memory tree stays authoritative (fast, synchronous). This sidecar writes
 * a debounced snapshot into the Origin Private File System so a page reload
 * restores the project. OPFS sync access handles (`createSyncAccessHandle`) are
 * only available inside a Worker, which is where the runtime lives.
 *
 * It cannot honour a *synchronous* flush: the handles it needs are created by
 * `await`ing, and the thread that wants to block is the very thread that would
 * have to run the continuation. `durable` is therefore `false` and `sync()` is a
 * no-op — `fs.writeFileSync` still reaches OPFS, just on the debounce.
 */
export class OpfsPersistence implements Persistence {
  readonly durable = false;
  #rootName: string;
  #dir: FileSystemDirectoryHandle | null = null;
  #timer: ReturnType<typeof hostSetTimeout> | null = null;
  #pending = false;
  #debounceMs: number;

  constructor(rootName = 'web-node-project', debounceMs = 400) {
    this.#rootName = rootName;
    this.#debounceMs = debounceMs;
  }

  static get supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage?.getDirectory === 'function'
    );
  }

  async #ensureDir(): Promise<FileSystemDirectoryHandle> {
    if (this.#dir) return this.#dir;
    const root = await navigator.storage.getDirectory();
    this.#dir = await root.getDirectoryHandle(this.#rootName, { create: true });
    return this.#dir;
  }

  /** Schedule a flush; multiple calls within the debounce window collapse into one. */
  schedule(vfs: SnapshotSource): void {
    if (!OpfsPersistence.supported) return;
    this.#pending = true;
    if (this.#timer !== null) return;
    this.#timer = hostSetTimeout(() => {
      this.#timer = null;
      if (!this.#pending) return;
      this.#pending = false;
      void this.flush(vfs);
    }, this.#debounceMs);
  }

  /** Write the full snapshot to OPFS. */
  async flush(vfs: SnapshotSource): Promise<void> {
    if (!OpfsPersistence.supported) return;
    const dir = await this.#ensureDir();
    const snapshot = vfs.snapshot();

    // Structure index + one `bodies.bin` pack. Bodies are NOT inlined in the
    // index: it is JSON, so inlining means base64 — which inflates every body by
    // 4/3 and builds a string the size of the whole tree (plus one more in
    // `JSON.stringify`) on every debounce, the dominant cost of a webpack build
    // here. Nor are they mirrored one file per entry: a whole `node_modules` is
    // thousands of files, and opening a sync access handle per file costs
    // seconds. Instead every body is written into a single file at the offset
    // the index records, through one handle. `v: 3` marks the layout.
    const entries: Array<{
      path: string;
      type: 'file' | 'dir';
      mode?: number;
      size?: number;
      offset?: number;
    }> = [];
    const offsets = new Map<string, number>();
    let total = 0;
    for (const item of snapshot) {
      if (item.type === 'dir') {
        entries.push({ path: item.path, type: item.type, mode: item.mode });
        continue;
      }
      const size = item.data?.byteLength ?? 0;
      offsets.set(item.path, total);
      entries.push({ path: item.path, type: item.type, mode: item.mode, size, offset: total });
      total += size;
    }

    // One buffer, one write. Assembling the pack in memory costs a single
    // transient copy (~the tree's bytes, external, not JS heap); writing it as
    // thousands of tiny `access.write` calls costs ~seconds, because each sync
    // access write is a syscall. The copy is far cheaper than either the old
    // base64 string or the per-body writes.
    const pack = new Uint8Array(total);
    for (const item of snapshot) {
      if (item.type !== 'file' || !item.data || item.data.byteLength === 0) continue;
      pack.set(item.data, offsets.get(item.path) ?? 0);
    }
    const packFh = await (dir as any).getFileHandle('bodies.bin', { create: true });
    const access = await packFh.createSyncAccessHandle();
    try {
      access.truncate(total);
      access.write(pack, { at: 0 });
      access.flush();
    } finally {
      access.close();
    }

    await this.#writeText(dir, '.wvm.json', JSON.stringify({ v: 3, pack: 'bodies.bin', entries }, null, 0));
  }

  async #writeText(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
    await this.#writeBytes(dir, name, new TextEncoder().encode(text));
  }

  async #writeBytes(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
    const fh = await (dir as any).getFileHandle(name, { create: true });
    const access = await fh.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(bytes, { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
  }

  /** Load a previously persisted snapshot, if any. */
  async load(): Promise<{
    version: number;
    entries: Array<{
      path: string;
      type: 'file' | 'dir';
      data?: string | Uint8Array;
      mode?: number;
      size?: number;
    }>;
  } | null> {
    if (!OpfsPersistence.supported) return null;
    try {
      const dir = await this.#ensureDir();
      const fh = await (dir as any).getFileHandle('.wvm.json');
      const file = await fh.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      // v1 wrote a bare array with UTF-8 text contents.
      if (Array.isArray(parsed)) return { version: 1, entries: parsed };
      if (!parsed || !Array.isArray(parsed.entries)) return null;
      const version: number = parsed.v ?? 2;
      const entries = parsed.entries as Array<{
        path: string;
        type: 'file' | 'dir';
        data?: string | Uint8Array;
        mode?: number;
        size?: number;
        offset?: number;
      }>;
      // v3 keeps a file's bytes off the index. This backend has no lazy read
      // path, so read them back now and hand the tree a ready-to-materialise
      // `Uint8Array` per file. Newer snapshots pack every body into one
      // `bodies.bin` (read once, sliced by offset); an earlier v3 build mirrored
      // a real file per entry, so fall back to that when there is no pack.
      if (version >= 3) {
        let pack: Uint8Array | null = null;
        const packName = typeof parsed.pack === 'string' ? parsed.pack : null;
        if (packName !== null) {
          try {
            const pfh = await (dir as any).getFileHandle(packName);
            pack = new Uint8Array(await (await pfh.getFile()).arrayBuffer());
          } catch {
            pack = null;
          }
        }
        for (const entry of entries) {
          if (entry.type !== 'file' || entry.data !== undefined) continue;
          if (pack !== null && typeof entry.offset === 'number') {
            entry.data = pack.subarray(entry.offset, entry.offset + (entry.size ?? 0));
          } else {
            entry.data = await this.#readMirror(dir, entry.path);
          }
        }
      }
      return { version, entries };
    } catch {
      return null;
    }
  }

  /** Read a mirrored file's bytes back out of OPFS (v3 index bodies). */
  async #readMirror(dir: FileSystemDirectoryHandle, path: string): Promise<Uint8Array> {
    try {
      const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
      const name = parts.pop();
      if (name === undefined) return new Uint8Array(0);
      let cur = dir;
      for (const part of parts) cur = await cur.getDirectoryHandle(part);
      const fh = await (cur as any).getFileHandle(name);
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return new Uint8Array(0);
    }
  }

  async clear(): Promise<void> {
    if (!OpfsPersistence.supported) return;
    try {
      const root = await navigator.storage.getDirectory();
      await (root as any).removeEntry(this.#rootName, { recursive: true });
      this.#dir = null;
    } catch {
      /* ignore */
    }
  }

  /**
   * Drop removed paths, deepest first.
   *
   * Same reasoning as the FS worker's version, and it matters here too: reads do
   * not reach through from this backend, but the snapshot that restores a page
   * reload does not delete anything either — without this, a removed file would
   * sit in OPFS indefinitely and come back if the store is ever consulted.
   */
  deleted(paths: string[]): void {
    if (!OpfsPersistence.supported || paths.length === 0) return;
    void this.#removePaths(paths).catch(() => undefined);
  }

  async #removePaths(paths: string[]): Promise<void> {
    for (const path of [...paths].sort((a, b) => b.length - a.length)) {
      try {
        const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
        const name = parts.pop();
        if (name === undefined) continue;
        let dir = await this.#ensureDir();
        for (const part of parts) dir = await dir.getDirectoryHandle(part);
        await (dir as any).removeEntry(name);
      } catch {
        /* already gone, or a directory still holding children we never mirrored */
      }
    }
  }

  /**
   * No synchronous read path: reaching through needs the shared-memory channel,
   * which is exactly what is missing when this backend is the one in use.
   */
  readSource(): ReadSource | null {
    return null;
  }

  /**
   * Not supported by this backend: see the class comment. The bytes are already
   * in the authoritative memory tree and will be mirrored on the next debounce,
   * so the call is a no-op rather than an error — the same thing a real `fsync`
   * does on a filesystem that keeps its writes in a page cache.
   */
  sync(_path: string, _data: Uint8Array): void {}
}
