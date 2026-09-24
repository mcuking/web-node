/**
 * What the runtime worker expects from its storage backend.
 *
 * Two implementations satisfy it: `OpfsPersistence` (the original, which talks
 * to OPFS directly from the runtime worker — asynchronous, works everywhere) and
 * `OpfsWorkerPersistence` (M120, which delegates to the FS worker so a write can
 * be forced durable **synchronously** — requires cross-origin isolation).
 */

import type { PersistedEntry, PersistedSnapshot, StoreEntry } from '../../sync/fs-protocol';

/** Just enough of `MemoryVfs` for the backend; keeps this file import-free of it. */
export interface SnapshotSource {
  snapshot(): PersistedEntry[];
}

/**
 * A **synchronous** reach into backing storage, for paths the in-memory tree does
 * not hold (M120).
 *
 * The memory tree is authoritative, so this is only ever asked about paths it
 * has already missed. It exists because the store can hold two things memory
 * does not: a file whose `fsync` landed while the debounced snapshot did not
 * (a tab closed, or crashed, inside the debounce window), and anything another
 * context wrote into the shared OPFS tree.
 *
 * Only the FS worker backend can offer it — answering synchronously is the whole
 * point, and that needs the shared-memory channel.
 */
export interface ReadSource {
  /** Type and size of `path`, or `null` when backing storage has nothing there. */
  info(path: string): { type: 'file' | 'dir'; size: number } | null;
  /** Backing-storage bytes for a file. Throws if the file cannot be read. */
  read(path: string): Uint8Array;
  /** Immediate children of a directory, or `null` when `path` is not one. */
  list(path: string): StoreEntry[] | null;
}

export interface Persistence {
  /** True when `sync()` puts a file's bytes on disk before it returns. */
  readonly durable: boolean;
  load(): Promise<PersistedSnapshot | null>;
  /** Mirror the tree soon (debounced); callers do not wait. */
  schedule(source: SnapshotSource): void;
  /** Mirror the tree now and resolve when it has landed. */
  flush(source: SnapshotSource): Promise<void>;
  /** Make one file durable. Blocking. A no-op when `durable` is false. */
  sync(path: string, data: Uint8Array): void;
  /**
   * Tell the backend these paths no longer exist.
   *
   * Best-effort and non-blocking: `fs.rm` is no more a durability point in Node
   * than it is here, and a caller removing a directory must not pay a round trip
   * per entry. It still matters — the store is append-only on its own, so without
   * this a deleted file would come back the next time a lookup reaches through.
   */
  deleted(paths: string[]): void;
  /** The synchronous read path, when this backend has one. */
  readSource(): ReadSource | null;
  clear(): Promise<void>;
}
