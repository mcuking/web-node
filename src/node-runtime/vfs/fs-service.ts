/**
 * The FS worker's actual work, with no dependency on globals (M120).
 *
 * Kept apart from `src/worker/fs.worker.ts` on purpose: that file is a shell
 * that binds a `MessagePort` to this service, and a shell cannot be unit-tested
 * outside a worker. Everything with a decision in it — where a snapshot lands,
 * which encodings are accepted, what a durable write does — lives here and takes
 * its store as a parameter.
 */

import { SyncChannelError } from '../../sync/sab-rpc';
import {
  FS_OP_GET,
  FS_OP_LIST,
  FS_OP_PUT,
  FS_OP_STAT,
  decodePath,
  decodePut,
  encodeListingBody,
  encodeInfoBody,
  encodeReadResult,
  type FsAsyncCall,
  type PersistedEntry,
  type PersistedSnapshot,
  type StoreEntry,
} from '../../sync/fs-protocol';
import { decodeBase64 } from './base64';

/** The index file: a cheap way to rebuild the tree without walking OPFS. */
export const SNAPSHOT_FILE = '.wvm.json';
/** Bumped when the on-disk shape changes; `load()` still reads older versions. */
export const SNAPSHOT_VERSION = 2;

const EMPTY = new Uint8Array(0);

/**
 * The storage surface this service needs.
 *
 * `OpfsFileStore` implements it in the browser; tests implement it in memory.
 * Every method may be asynchronous: opening an OPFS handle always is, which is
 * the whole reason the service runs in its own worker.
 */
export interface FileStore {
  put(path: string, data: Uint8Array): Promise<void>;
  putText(path: string, text: string): Promise<void>;
  has(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  clearAll(): Promise<void>;
  /** Bytes, or `null` when nothing lives at `path`. */
  readOrNull(path: string): Promise<Uint8Array | null>;
  /** Type and size of `path`, or `null` when it is absent. */
  info(path: string): Promise<{ type: 'file' | 'dir'; size: number } | null>;
  /** Immediate children of `path`, or `null` when it is not a directory. */
  list(path: string): Promise<StoreEntry[] | null>;
}

/** VFS paths are absolute; store paths are relative to the root directory. */
export function relativePath(path: string): string {
  return path.replace(/^\/+/, '');
}

export class FsService {
  #store: FileStore;
  #snapshotFile: string;

  constructor(store: FileStore, options: { snapshotFile?: string } = {}) {
    this.#store = store;
    this.#snapshotFile = options.snapshotFile ?? SNAPSHOT_FILE;
  }

  /**
   * Handle one synchronous operation.
   *
   * Every branch may return a promise: the runtime worker is parked in
   * `Atomics.wait` regardless, so the FS worker is free to `await` OPFS here.
   * A lookup that misses answers "absent" (`present: false`) rather than
   * throwing — that is a real answer, and the caller turns it into whatever
   * errno its own syscall calls for.
   */
  sync(op: number, payload: Uint8Array): Uint8Array | Promise<Uint8Array> {
    switch (op) {
      case FS_OP_PUT: {
        const { path, data } = decodePut(payload);
        return this.#store.put(relativePath(path), data).then(() => EMPTY);
      }
      case FS_OP_GET:
        return this.#read(decodePath(payload));
      case FS_OP_STAT:
        return this.#stat(decodePath(payload));
      case FS_OP_LIST:
        return this.#list(decodePath(payload));
      default:
        throw new SyncChannelError(`unknown synchronous FS operation ${op}`);
    }
  }

  async #read(path: string): Promise<Uint8Array> {
    const data = await this.#store.readOrNull(relativePath(path));
    return data === null ? encodeReadResult(false) : encodeReadResult(true, data);
  }

  async #stat(path: string): Promise<Uint8Array> {
    const info = await this.#store.info(relativePath(path));
    return info === null ? encodeReadResult(false) : encodeReadResult(true, encodeInfoBody(info));
  }

  async #list(path: string): Promise<Uint8Array> {
    const rel = relativePath(path);
    const entries = await this.#store.list(rel);
    if (entries === null) return encodeReadResult(false);
    // The snapshot index is a store artifact, not a user file, and it lives in
    // the root directory — which is exactly where a listing would otherwise
    // expose it. Deeper directories are untouched, so a user file that happens
    // to share the name stays visible.
    const visible = rel === '' ? entries.filter((entry) => entry.name !== this.#snapshotFile) : entries;
    return encodeReadResult(true, encodeListingBody(visible));
  }

  async async(request: FsAsyncCall): Promise<unknown> {
    switch (request.kind) {
      case 'load':
        return this.load();
      case 'snapshot':
        await this.writeSnapshot(request.snapshot);
        return undefined;
      case 'delete':
        await this.#delete(request.paths);
        return undefined;
      case 'clear':
        await this.#store.clearAll();
        return undefined;
    }
  }

  /**
   * Remove paths from the store, deepest first.
   *
   * Order matters: OPFS refuses to remove a non-empty directory, so a child must
   * go before its parent. A path that is already absent is not an error — the
   * caller is reporting what it removed, not asking a question.
   */
  async #delete(paths: string[]): Promise<void> {
    const ordered = [...paths].sort((a, b) => b.length - a.length);
    for (const path of ordered) {
      try {
        await this.#store.remove(relativePath(path));
      } catch {
        /* already gone, or a directory whose children were never mirrored */
      }
    }
  }

  /**
   * Rewrite the whole tree: the `.wvm.json` index plus a real file per entry.
   *
   * The index is what makes a reload cheap (no directory walk); the mirrored
   * files are what keep OPFS browsable and byte-exact. Contents travel
   * base64-encoded, exactly as `MemoryVfs.snapshot()` produces them.
   */
  async writeSnapshot(entries: PersistedEntry[]): Promise<void> {
    await this.#store.putText(
      this.#snapshotFile,
      JSON.stringify({ v: SNAPSHOT_VERSION, entries }, null, 0),
    );
    for (const item of entries) {
      if (item.type !== 'file') continue;
      await this.#store.put(relativePath(item.path), decodeBase64(item.data ?? ''));
    }
  }

  async load(): Promise<PersistedSnapshot | null> {
    try {
      if (!(await this.#store.has(this.#snapshotFile))) return null;
      const parsed = JSON.parse(await this.#store.readText(this.#snapshotFile));
      // v1 wrote a bare array of UTF-8 text entries.
      if (Array.isArray(parsed)) return { version: 1, entries: parsed };
      if (parsed && Array.isArray(parsed.entries)) {
        return { version: parsed.v ?? SNAPSHOT_VERSION, entries: parsed.entries };
      }
      return null;
    } catch {
      return null;
    }
  }
}
