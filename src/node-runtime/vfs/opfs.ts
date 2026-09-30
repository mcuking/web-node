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

    // Structure index + per-file mirror. Bodies are NOT inlined: the index is
    // JSON, so inlining means base64 — which inflates every body by 4/3 and
    // builds a string the size of the whole tree (plus one more in
    // `JSON.stringify`) on every debounce. That was the dominant cost of a
    // webpack build on this backend. The mirror holds the bytes; `load()` reads
    // them back. `v: 3` marks the layout.
    const entries = snapshot.map((item) =>
      item.type === 'dir'
        ? { path: item.path, type: item.type, mode: item.mode }
        : {
            path: item.path,
            type: item.type,
            mode: item.mode,
            size: item.data?.byteLength ?? 0,
          },
    );

    // Mirror actual file contents so OPFS stays browsable/inspectable.
    for (const item of snapshot) {
      if (item.type !== 'file') continue;
      const rel = item.path.replace(/^\//, '');
      const parts = rel.split('/');
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i], { create: true });
      }
      await this.#writeBytes(cur, parts[parts.length - 1], item.data ?? new Uint8Array(0));
    }

    await this.#writeText(dir, '.wvm.json', JSON.stringify({ v: 3, entries }, null, 0));
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
      }>;
      // v3 keeps a file's bytes in the mirror, not the index (see `flush`). This
      // backend has no lazy read path, so read them back now and hand the tree a
      // ready-to-materialise `Uint8Array` per file.
      if (version >= 3) {
        for (const entry of entries) {
          if (entry.type !== 'file' || entry.data !== undefined) continue;
          entry.data = await this.#readMirror(dir, entry.path);
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
