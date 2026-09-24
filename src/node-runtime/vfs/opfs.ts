import type { Persistence, SnapshotSource } from './persistence';
import { encodeBase64, decodeBase64 } from './base64';

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
  #timer: number | null = null;
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
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (!this.#pending) return;
      this.#pending = false;
      void this.flush(vfs);
    }, this.#debounceMs) as unknown as number;
  }

  /** Write the full snapshot to OPFS. */
  async flush(vfs: SnapshotSource): Promise<void> {
    if (!OpfsPersistence.supported) return;
    const dir = await this.#ensureDir();
    const snapshot = vfs.snapshot();

    // Directory index file: cheap way to restore structure without walking OPFS.
    // Contents are base64 so binary files (wasm, images) survive intact. `v`
    // marks the encoding so pre-base64 snapshots can still be read back.
    await this.#writeText(dir, '.wvm.json', JSON.stringify({ v: 2, entries: snapshot }, null, 0));

    // Mirror actual file contents so OPFS stays browsable/inspectable.
    for (const item of snapshot) {
      if (item.type !== 'file') continue;
      const rel = item.path.replace(/^\//, '');
      const parts = rel.split('/');
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i], { create: true });
      }
      await this.#writeBytes(cur, parts[parts.length - 1], decodeBase64(item.data ?? ''));
    }
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
  async load(): Promise<{ version: number; entries: Array<{ path: string; type: 'file' | 'dir'; data?: string; mode?: number }> } | null> {
    if (!OpfsPersistence.supported) return null;
    try {
      const dir = await this.#ensureDir();
      const fh = await (dir as any).getFileHandle('.wvm.json');
      const file = await fh.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      // v1 wrote a bare array with UTF-8 text contents.
      if (Array.isArray(parsed)) return { version: 1, entries: parsed };
      if (parsed && Array.isArray(parsed.entries)) return { version: parsed.v ?? 2, entries: parsed.entries };
      return null;
    } catch {
      return null;
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
   * Not supported by this backend: see the class comment. The bytes are already
   * in the authoritative memory tree and will be mirrored on the next debounce,
   * so the call is a no-op rather than an error — the same thing a real `fsync`
   * does on a filesystem that keeps its writes in a page cache.
   */
  sync(_path: string, _data: Uint8Array): void {}
}
