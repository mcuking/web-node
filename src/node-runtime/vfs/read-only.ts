import type { Persistence, ReadSource, SnapshotSource } from './persistence';

/**
 * A read-through, write-nothing view of a persistence backend (M139).
 *
 * The dedicated **build worker** restores a project from the shared OPFS store,
 * runs one build, and is then terminated; the page mounts the build's outputs
 * back into the main worker, which owns the store. So the build worker must be
 * able to *read* everything the main worker persisted while writing none of it —
 * otherwise two workers would race on the same snapshot, and a stale build-worker
 * tree could clobber the main one.
 *
 * `load` and `readSource` pass straight through: the cold-body read path is the
 * whole reason a build worker can see a `node_modules` it never materialised into
 * memory. Every mutating method is dropped, and `durable` is false so the tree
 * installs no synchronous flush sink.
 */
export function readOnlyPersistence(inner: Persistence): Persistence {
  return {
    durable: false,
    load: () => inner.load(),
    schedule: (_source: SnapshotSource) => {},
    flush: (_source: SnapshotSource) => Promise.resolve(),
    sync: (_path: string, _data: Uint8Array) => {},
    deleted: (_paths: string[]) => {},
    readSource: (): ReadSource | null => inner.readSource(),
    clear: () => Promise.resolve(),
  };
}
