/**
 * What the runtime worker expects from its storage backend.
 *
 * Two implementations satisfy it: `OpfsPersistence` (the original, which talks
 * to OPFS directly from the runtime worker — asynchronous, works everywhere) and
 * `OpfsWorkerPersistence` (M120, which delegates to the FS worker so a write can
 * be forced durable **synchronously** — requires cross-origin isolation).
 */

import type { PersistedEntry, PersistedSnapshot } from '../../sync/fs-protocol';

/** Just enough of `MemoryVfs` for the backend; keeps this file import-free of it. */
export interface SnapshotSource {
  snapshot(): PersistedEntry[];
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
  clear(): Promise<void>;
}
