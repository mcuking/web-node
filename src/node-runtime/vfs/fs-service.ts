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
  type SnapshotEntry,
  type PersistedSnapshot,
  type StoreEntry,
} from '../../sync/fs-protocol';

/** The index file: a cheap way to rebuild the tree without walking OPFS. */
export const SNAPSHOT_FILE = '.wvm.json';
/**
 * Bumped when the on-disk shape changes; `load()` still reads older versions.
 *
 * v3: the index carries only **structure** (`path`, `type`, `mode`, `size`) — no
 * file bodies. The mirror next to it holds the bytes, and the FS-worker backend
 * reads them back synchronously, so the runtime restores a v3 tree cold. v2 kept
 * every body base64-inlined in `.wvm.json`, which grew without bound (a
 * `node_modules` pushed the index past 100MB and the boot-time decode OOM'd the
 * renderer) and made every debounce re-read the whole tree.
 */
export const SNAPSHOT_VERSION = 3;

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
  /**
   * Paths the in-flight snapshot is (re)writing.
   *
   * Reads bypass the write queue (see `serveSyncChannel`) so a lookup is never
   * parked behind a draining snapshot. That would let a read observe a file
   * mid-`truncate(0)→write` — empty or partial — so a read that lands on a path
   * being rewritten waits for the snapshot to finish first. Only that file, and
   * only while it is actually being written; the mirror is small because a
   * structure index leaves untouched files alone.
   */
  #writing = new Set<string>();
  #snapshotInFlight: Promise<void> | null = null;

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

  /**
   * Wait out a snapshot that is rewriting `rel`, if one is.
   *
   * Reads run off the write queue, so without this a read could catch a file
   * between `truncate(0)` and `write`. Cheap in practice: a structure-index
   * snapshot only rewrites files the session actually touched.
   */
  async #joinWrite(rel: string): Promise<void> {
    if (this.#snapshotInFlight && this.#writing.has(rel)) await this.#snapshotInFlight;
  }

  async #read(path: string): Promise<Uint8Array> {
    const rel = relativePath(path);
    await this.#joinWrite(rel);
    const data = await this.#store.readOrNull(rel);
    return data === null ? encodeReadResult(false) : encodeReadResult(true, data);
  }

  async #stat(path: string): Promise<Uint8Array> {
    const rel = relativePath(path);
    await this.#joinWrite(rel);
    const info = await this.#store.info(rel);
    return info === null ? encodeReadResult(false) : encodeReadResult(true, encodeInfoBody(info));
  }

  async #list(path: string): Promise<Uint8Array> {
    const rel = relativePath(path);
    await this.#joinWrite(rel);
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
   * The index is **structure only** (`path`, `type`, `mode`, `size`) since v3. The
   * mirrored files are the bytes, and the runtime reads them back synchronously
   * (the FS worker is the only writer), so there is nothing to duplicate here.
   *
   * Only entries that actually carry `data` are written to the mirror. A cold
   * entry (`data` absent) is one the runtime never touched this session: its bytes
   * are already byte-for-byte on disk, and re-writing it would be a pointless
   * `truncate(0)` that risks a reader catching the empty window. Leaving it alone
   * is also what keeps a large `node_modules` snapshot cheap — only the handful of
   * files a session edits travel.
   *
   * The snapshot is tracked as in-flight and the files it writes are marked, so a
   * synchronous read that races one waits it out (see `#joinWrite`).
   */
  writeSnapshot(entries: SnapshotEntry[]): Promise<void> {
    const run = (async (): Promise<void> => {
      // Structure index: `path`, `type`, `mode`, and a file's `size`. The bodies
      // live in the mirror next to it, written just below and read back
      // synchronously (the FS worker is the only writer), so there is nothing to
      // inline. That keeps the index tiny for a whole `node_modules` and means a
      // debounce rewrites only the files a session actually touched.
      const index = entries.map((item) =>
        item.type === 'dir'
          ? { path: item.path, type: item.type, mode: item.mode }
          : {
              path: item.path,
              type: item.type,
              mode: item.mode,
              size: item.size ?? item.data?.byteLength ?? 0,
            },
      );
      for (const item of entries) {
        if (item.type !== 'file' || item.data === undefined) continue;
        const rel = relativePath(item.path);
        this.#writing.add(rel);
        try {
          await this.#store.put(rel, item.data);
        } finally {
          this.#writing.delete(rel);
        }
      }
      await this.#store.putText(this.#snapshotFile, JSON.stringify({ v: SNAPSHOT_VERSION, entries: index }, null, 0));
    })();
    this.#snapshotInFlight = run;
    run.finally(() => {
      if (this.#snapshotInFlight === run) this.#snapshotInFlight = null;
    });
    return run;
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
