/**
 * The runtime worker's half of the **FS worker** bridge (M120).
 *
 * The synchronous half is the interesting one: `sync()` must not return until
 * the bytes are on disk, so it writes the request into a `SharedArrayBuffer`,
 * posts a nudge, and parks in `Atomics.wait`. That is legal only because the
 * peer is a *different* worker — see `src/sync/sab-rpc.ts` for why the same
 * thread cannot both block and do the awaiting.
 *
 * The asynchronous half (whole-tree snapshots) rides the same port but does not
 * park: nothing is waiting on it, and its payload would dwarf a shared buffer.
 */

import { CONTROL_BYTES, SyncChannel, SyncChannelError } from '../../sync/sab-rpc';
import {
  FS_OP_GET,
  FS_OP_LIST,
  FS_OP_PUT,
  FS_OP_STAT,
  decodeInfoBody,
  decodeListingBody,
  decodeReadResult,
  encodePath,
  encodePut,
  type FsAsyncCall,
  type FsAsyncResponse,
  type PersistedSnapshot,
} from '../../sync/fs-protocol';
import type { Persistence, ReadSource, SnapshotSource } from './persistence';

/** Why the FS worker could not be started; the caller keeps the async backend. */
export type FsWorkerUnavailable =
  | 'no-worker'
  | 'no-shared-memory'
  | 'no-opfs'
  | 'not-cross-origin-isolated';

export class OpfsWorkerPersistence implements Persistence {
  readonly durable = true;

  #worker: Worker;
  #port: MessagePort;
  #channel: SyncChannel;
  #nextId = 1;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #waiting: SnapshotSource | null = null;
  #debounceMs: number;
  #closed = false;

  private constructor(worker: Worker, port: MessagePort, control: SharedArrayBuffer, debounceMs: number) {
    this.#worker = worker;
    this.#port = port;
    this.#channel = new SyncChannel(port, control);
    this.#debounceMs = debounceMs;
    this.#port.onmessage = (event: MessageEvent): void => {
      const reply = event.data as FsAsyncResponse;
      const entry = this.#pending.get(reply.id);
      if (!entry) return;
      this.#pending.delete(reply.id);
      if (reply.kind === 'ok') {
        entry.resolve(reply.result);
        return;
      }
      const err = new Error(reply.message) as Error & { code?: string };
      if (reply.code !== undefined) err.code = reply.code;
      entry.reject(err);
    };
    this.#port.start();
  }

  /**
   * Start the FS worker, or explain why we cannot.
   *
   * Every condition here is a real one, not a guess: a shared buffer needs
   * cross-origin isolation (COOP/COEP), the worker needs a Worker constructor,
   * and the store needs OPFS.
   */
  static unavailableReason(): FsWorkerUnavailable | null {
    if (typeof Worker === 'undefined') return 'no-worker';
    if (typeof SharedArrayBuffer !== 'function') return 'no-shared-memory';
    if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
      return 'not-cross-origin-isolated';
    }
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
      return 'no-opfs';
    }
    return null;
  }

  static create(opts: { rootName?: string; debounceMs?: number } = {}): OpfsWorkerPersistence | null {
    if (OpfsWorkerPersistence.unavailableReason() !== null) return null;
    const { rootName = 'web-node-project', debounceMs = 400 } = opts;
    const worker = new Worker(new URL('../../worker/fs.worker.ts', import.meta.url), {
      type: 'module',
      name: 'web-node-fs',
    });
    const control = new SharedArrayBuffer(CONTROL_BYTES);
    const channel = new MessageChannel();
    worker.postMessage({ kind: 'init', control, rootName, port: channel.port2 }, [channel.port2]);
    return new OpfsWorkerPersistence(worker, channel.port1, control, debounceMs);
  }

  #request(message: FsAsyncCall): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error('FS worker bridge is closed'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#port.postMessage({ ...message, id });
    });
  }

  load(): Promise<PersistedSnapshot | null> {
    return this.#request({ kind: 'load' }) as Promise<PersistedSnapshot | null>;
  }

  schedule(source: SnapshotSource): void {
    this.#waiting = source;
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const pending = this.#waiting;
      this.#waiting = null;
      if (pending) void this.flush(pending).catch(() => undefined);
    }, this.#debounceMs);
  }

  async flush(source: SnapshotSource): Promise<void> {
    await this.#request({ kind: 'snapshot', snapshot: source.snapshot() });
  }

  /**
   * Report removed paths to the store, without blocking.
   *
   * Deliberately not a synchronous call: `fs.rm` is not a durability point, and
   * an `rm -rf` of a large tree would otherwise pay a round trip per entry. The
   * request still rides the same queue as the snapshots, so it cannot overtake a
   * write it is supposed to follow.
   */
  deleted(paths: string[]): void {
    if (this.#closed || paths.length === 0) return;
    void this.#request({ kind: 'delete', paths }).catch(() => undefined);
  }

  /**
   * Write one file and make it durable, blocking this thread until it is.
   *
   * `data` comes from the memory tree, which is authoritative: the file may not
   * have been mirrored yet (the snapshot is debounced), so the bytes are sent
   * rather than a "flush that path" request.
   */
  sync(path: string, data: Uint8Array): void {
    this.#channel.call(FS_OP_PUT, encodePut(path, data));
  }

  /**
   * The synchronous read path (M120).
   *
   * Same channel as `sync()`, opposite direction: the runtime worker parks while
   * the FS worker reads OPFS. That is what lets a file which exists only in the
   * store — a `fsync` whose snapshot never ran, or something another context
   * wrote — still be reached by `fs.readFileSync`.
   */
  readSource(): ReadSource {
    return {
      info: (path) => {
        const result = decodeReadResult(this.#channel.call(FS_OP_STAT, encodePath(path)));
        return result.present ? decodeInfoBody(result.body) : null;
      },
      read: (path) => {
        const result = decodeReadResult(this.#channel.call(FS_OP_GET, encodePath(path)));
        // The caller only asks about paths `info()` has already confirmed, so
        // "absent" here means the store changed underneath it mid-flight.
        if (!result.present) {
          throw new SyncChannelError(`no such file in backing storage: ${path}`, 'ENOENT');
        }
        // `decodeReadResult` is a view onto bytes `call()` already copied out.
        return result.body;
      },
      list: (path) => {
        const result = decodeReadResult(this.#channel.call(FS_OP_LIST, encodePath(path)));
        return result.present ? decodeListingBody(result.body) : null;
      },
    };
  }

  async clear(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
      this.#waiting = null;
    }
    await this.#request({ kind: 'clear' });
  }

  close(): void {
    this.#closed = true;
    this.#channel.close();
    this.#worker.terminate();
  }
}
