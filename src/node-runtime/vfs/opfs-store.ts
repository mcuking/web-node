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

/**
 * `entries()` is in the File System Access API but not in this TypeScript's DOM
 * lib, so it is declared here rather than cast at the call site.
 */
interface EnumerableDirectory extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

import type { StoreEntry } from '../../sync/fs-protocol';

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
    const dir = await this.#dirHandle(parts, create);
    return { dir, name };
  }

  /**
   * Walk to a directory, reusing cached handles.
   *
   * `parts` are the segments *above* the leaf; `create` decides whether a missing
   * segment is made. The cache is keyed by absolute-style path (`/a/b`), the same
   * shape the VFS uses, so one lookup can warm the next.
   */
  async #dirHandle(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
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
    return dir;
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

  /** Bytes, or `null` when nothing lives at `path` — the read counterpart of `has()`. */
  async readOrNull(path: string): Promise<Uint8Array | null> {
    let handle: FileSystemSyncAccessHandle;
    try {
      handle = await this.#open(path, false);
    } catch {
      return null;
    }
    try {
      const size = await handle.getSize();
      const buffer = new Uint8Array(size);
      const read = await handle.read(buffer, { at: 0 });
      return read >= size ? buffer : buffer.subarray(0, read);
    } finally {
      await handle.close();
    }
  }

  /**
   * Type and size of one path.
   *
   * Deliberately does **not** open a sync access handle: a `stat` should not pay
   * for a handle (let alone a read), and `getFile()` gives the size directly.
   * A path that is neither a file nor a directory is `null` — the answer
   * "absent" rather than an error.
   */
  async info(path: string): Promise<{ type: 'file' | 'dir'; size: number } | null> {
    if (path === '') return { type: 'dir', size: 0 };
    let parent: { dir: FileSystemDirectoryHandle; name: string };
    try {
      parent = await this.#parentOf(path, false);
    } catch {
      return null;
    }
    try {
      const file = await parent.dir.getFileHandle(parent.name);
      return { type: 'file', size: (await file.getFile()).size };
    } catch {
      /* not a file — try a directory instead */
    }
    try {
      await parent.dir.getDirectoryHandle(parent.name);
      return { type: 'dir', size: 0 };
    } catch {
      return null;
    }
  }

  /**
   * Immediate children of a directory, sorted by name.
   *
   * `null` when `path` is not a directory (or does not exist). Sizes are read
   * eagerly: `fs.readdirSync()` is almost always followed by a `statSync()` per
   * name, and having the size here turns that into one call instead of N.
   */
  async list(path: string): Promise<StoreEntry[] | null> {
    // A file must not be listed as a directory, and the walk below would happily
    // treat one as an empty directory.
    const probe = await this.info(path);
    if (probe === null || probe.type !== 'dir') return null;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.#dirHandle(path.replace(/^\/+/, '').split('/').filter(Boolean), false);
    } catch {
      return null;
    }
    const out: StoreEntry[] = [];
    for await (const [name, handle] of (dir as EnumerableDirectory).entries()) {
      if (handle.kind === 'directory') {
        out.push({ name, type: 'dir', size: 0 });
        continue;
      }
      let size = 0;
      try {
        size = (await (handle as FileSystemFileHandle).getFile()).size;
      } catch {
        /* vanished between listing and stat — report it empty */
      }
      out.push({ name, type: 'file', size });
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
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
