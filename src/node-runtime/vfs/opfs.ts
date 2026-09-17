import type { MemoryVfs } from './memory';

/**
 * OPFS-backed persistence for the in-memory VFS.
 *
 * The memory tree stays authoritative (fast, synchronous). This sidecar writes
 * a debounced snapshot into the Origin Private File System so a page reload
 * restores the project. OPFS sync access handles (`createSyncAccessHandle`) are
 * only available inside a Worker, which is where the runtime lives.
 */
export class OpfsPersistence {
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
  schedule(vfs: MemoryVfs): void {
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
  async flush(vfs: MemoryVfs): Promise<void> {
    if (!OpfsPersistence.supported) return;
    const dir = await this.#ensureDir();
    const snapshot = vfs.snapshot();

    // Directory index file: cheap way to restore structure without walking OPFS.
    await this.#writeFile(dir, '.wvm.json', JSON.stringify(snapshot, null, 0));

    // Mirror actual file contents so OPFS stays browsable/inspectable.
    for (const item of snapshot) {
      if (item.type !== 'file') continue;
      const rel = item.path.replace(/^\//, '');
      const parts = rel.split('/');
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i], { create: true });
      }
      await this.#writeFile(cur, parts[parts.length - 1], item.data ?? '');
    }
  }

  async #writeFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
    const fh = await (dir as any).getFileHandle(name, { create: true });
    const access = await fh.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(new TextEncoder().encode(text), { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
  }

  /** Load a previously persisted snapshot, if any. */
  async load(): Promise<Array<{ path: string; type: 'file' | 'dir'; data?: string; mode?: number }> | null> {
    if (!OpfsPersistence.supported) return null;
    try {
      const dir = await this.#ensureDir();
      const fh = await (dir as any).getFileHandle('.wvm.json');
      const file = await fh.getFile();
      const text = await file.text();
      return JSON.parse(text);
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
}
