/**
 * The OPFS file store, used **inside the FS worker** (M120).
 *
 * Origin Private File System handles are the only durable storage a tab has, and
 * the only *synchronous* handle — `FileSystemSyncAccessHandle` — can only be
 * created in a worker. That is why this lives here and not in the runtime
 * worker: the FS worker is the single writer, and a sync access handle is
 * exclusive per file, so there must be exactly one owner.
 *
 * ## Durability
 *
 * `put()` writes **and flushes** before it returns. `FileSystemSyncAccessHandle`
 * gives no ordering guarantee until `flush()`, so a write that merely reached
 * the handle would not survive a reload. Handles are opened and closed per
 * operation rather than held: `createSyncAccessHandle` is expensive in kernel
 * state, an npm install touches thousands of files, and holding one per file
 * would exhaust it. Opening lazily costs one directory walk per call, which is
 * what the previous per-write implementation already paid.
 */

/** Everything this store needs from OPFS — swappable so the FS worker is testable. */
export interface DirectoryProvider {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class OpfsFileStore {
  #rootName: string;
  #provider: DirectoryProvider;
  #root: FileSystemDirectoryHandle | null = null;
  /** Cache of intermediate directory handles, keyed by VFS path (`/a/b`). */
  #dirs = new Map<string, FileSystemDirectoryHandle>();

  constructor(rootName: string, provider: DirectoryProvider = navigator.storage as DirectoryProvider) {
    this.#rootName = rootName;
    this.#provider = provider;
  }

  get rootName(): string {
    return this.#rootName;
  }

  async #rootDir(): Promise<FileSystemDirectoryHandle> {
    if (this.#root) return this.#root;
    const origin = await this.#provider.getDirectory();
    this.#root = await origin.getDirectoryHandle(this.#rootName, { create: true });
    return this.#root;
  }

  /** Resolve the directory handle that contains `name`, creating parents on demand. */
  async #parentOf(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) throw new Error('empty path');
    const name = parts.pop()!;
    let dir = await this.#rootDir();
    let key = '';
    for (const part of parts) {
      key += `/${part}`;
      const cached = this.#dirs.get(key);
      if (cached) {
        dir = cached;
        continue;
      }
      dir = await dir.getDirectoryHandle(part, { create });
      if (create) this.#dirs.set(key, dir);
    }
    return { dir, name };
  }

  /** Open a sync access handle; `create` decides whether a missing file is made. */
  async #open(path: string, create: boolean): Promise<FileSystemSyncAccessHandle> {
    const { dir, name } = await this.#parentOf(path, create);
    const file = await dir.getFileHandle(name, { create });
    return (file as unknown as { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }).createSyncAccessHandle();
  }

  /** Write a file and flush it; returns once the bytes are durable. */
  async put(path: string, data: Uint8Array): Promise<void> {
    const handle = await this.#open(path, true);
    try {
      await handle.truncate(0);
      await handle.write(data, { at: 0 });
      await handle.flush();
    } finally {
      await handle.close();
    }
  }

  async putText(path: string, text: string): Promise<void> {
    await this.put(path, encoder.encode(text));
  }

  async has(path: string): Promise<boolean> {
    try {
      const { dir, name } = await this.#parentOf(path, false);
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<Uint8Array> {
    const handle = await this.#open(path, false);
    try {
      const size = await handle.getSize();
      const buffer = new Uint8Array(size);
      const read = await handle.read(buffer, { at: 0 });
      return read === size ? buffer : buffer.subarray(0, read);
    } finally {
      await handle.close();
    }
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.read(path));
  }

  async remove(path: string): Promise<void> {
    const { dir, name } = await this.#parentOf(path, false);
    await dir.removeEntry(name);
  }

  /** Drop the whole tree. Used by the UI's reset; the store rebuilds lazily. */
  async clearAll(): Promise<void> {
    this.#dirs.clear();
    this.#root = null;
    try {
      const origin = await this.#provider.getDirectory();
      await origin.removeEntry(this.#rootName, { recursive: true });
    } catch {
      /* nothing persisted yet */
    }
  }
}
