/**
 * The wire protocol between the runtime worker and the **FS worker**.
 *
 * Two channels ride the same `MessagePort`:
 *
 *  - **synchronous** operations (`FS_OP_*`) go over the shared-memory channel in
 *    `src/sync/sab-rpc.ts`. They are what a blocking Node call needs: the runtime
 *    worker parks in `Atomics.wait` and the FS worker answers through the
 *    `SharedArrayBuffer`. Two kinds ride here: durable **writes** (`FS_OP_PUT`),
 *    and the **reads** that let a path absent from the in-memory tree still be
 *    reached synchronously (`FS_OP_GET`/`FS_OP_STAT`/`FS_OP_LIST`).
 *  - **asynchronous** operations (`FsAsyncRequest`) are ordinary messages with a
 *    reply. Nothing is blocked, so they can afford a round trip and a real
 *    `Promise`; they carry the bulky payloads (whole-tree snapshots) that would
 *    not fit a single shared buffer.
 */

/** Write a file and make it durable before returning. Payload: `[u32 pathLen][path][bytes]`. */
export const FS_OP_PUT = 1;
/** Read a file's bytes. Payload: a path. Body: the raw bytes. */
export const FS_OP_GET = 2;
/** Type and size of one path. Payload: a path. Body: `[u8 type][f64 size]`. */
export const FS_OP_STAT = 3;
/** One level of a directory. Payload: a path. Body: a listing. */
export const FS_OP_LIST = 4;

export type FsOp = typeof FS_OP_PUT | typeof FS_OP_GET | typeof FS_OP_STAT | typeof FS_OP_LIST;

/** Frame a bare path (`[u32 len][UTF-8]`). */
export function encodePath(path: string): Uint8Array {
  const bytes = new TextEncoder().encode(path);
  const out = new Uint8Array(4 + bytes.byteLength);
  new DataView(out.buffer).setUint32(0, bytes.byteLength, true);
  out.set(bytes, 4);
  return out;
}

/** Split a payload framed by {@link encodePath}. */
export function decodePath(payload: Uint8Array): string {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const len = view.getUint32(0, true);
  // The payload arrives in a `SharedArrayBuffer`, which `TextDecoder` refuses to
  // read — copy the path out first (see `decodePut` for the same rule).
  return new TextDecoder().decode(payload.slice(4, 4 + len));
}

/** What the store can say about a path: the type, and the size of a file. */
export interface StoreEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
}

/** `null` is "absent", which is an answer, not an error: a lookup that misses must
 *  not be reported as a failed call (nothing is broken). */
export interface ReadResult {
  present: boolean;
  body: Uint8Array;
}

/**
 * Frame a read response as `[u8 present][u32 len][body]`.
 *
 * The extra byte is why the channel's `STATUS_RETRY` sizing matters: "no such
 * file" still has to travel back through the shared buffer, so even a request
 * that produces nothing needs room for an envelope.
 */
export function encodeReadResult(present: boolean, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(5 + body.byteLength);
  out[0] = present ? 1 : 0;
  new DataView(out.buffer).setUint32(1, body.byteLength, true);
  out.set(body, 5);
  return out;
}

/** Split a payload framed by {@link encodeReadResult}. */
export function decodeReadResult(payload: Uint8Array): ReadResult {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const present = payload[0] === 1;
  const len = view.getUint32(1, true);
  // No copy: `SyncChannel.call` already handed the caller private bytes, so the
  // shared buffer cannot be reused underneath these.
  return { present, body: payload.subarray(5, 5 + len) };
}

/** A file's whole body is the raw bytes; a stat is `[u8 dirFlag][f64 size]`. */
export function encodeInfoBody(info: { type: 'file' | 'dir'; size: number }): Uint8Array {
  const out = new Uint8Array(9);
  out[0] = info.type === 'dir' ? 1 : 0;
  new DataView(out.buffer).setFloat64(1, info.size, true);
  return out;
}

export function decodeInfoBody(body: Uint8Array): { type: 'file' | 'dir'; size: number } {
  return { type: body[0] === 1 ? 'dir' : 'file', size: new DataView(body.buffer, body.byteOffset, body.byteLength).getFloat64(1, true) };
}

/**
 * A listing body: `[u32 count]`, then per entry `[u8 dirFlag][f64 size][u32 nameLen][name]`.
 *
 * Sizes ride along so that `fs.readdirSync()` followed by `fs.statSync()` on each
 * name — a shape Node tooling is full of — costs one round trip instead of one
 * per file.
 */
export function encodeListingBody(entries: StoreEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const names = entries.map((entry) => encoder.encode(entry.name));
  const total = 4 + entries.reduce((sum, _e, i) => sum + 13 + names[i].byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, entries.length, true);
  let at = 4;
  for (let i = 0; i < entries.length; i++) {
    out[at] = entries[i].type === 'dir' ? 1 : 0;
    view.setFloat64(at + 1, entries[i].size, true);
    view.setUint32(at + 9, names[i].byteLength, true);
    out.set(names[i], at + 13);
    at += 13 + names[i].byteLength;
  }
  return out;
}

export function decodeListingBody(body: Uint8Array): StoreEntry[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const count = view.getUint32(0, true);
  const decoder = new TextDecoder();
  const out: StoreEntry[] = [];
  let at = 4;
  for (let i = 0; i < count; i++) {
    const type = body[at] === 1 ? 'dir' : 'file';
    const size = view.getFloat64(at + 1, true);
    const nameLen = view.getUint32(at + 9, true);
    out.push({ name: decoder.decode(body.subarray(at + 13, at + 13 + nameLen)), type, size });
    at += 13 + nameLen;
  }
  return out;
}

/** Frame a `[u32 pathLen][path UTF-8][bytes]` payload. */
export function encodePut(path: string, data: Uint8Array): Uint8Array {
  const pathBytes = new TextEncoder().encode(path);
  const out = new Uint8Array(4 + pathBytes.byteLength + data.byteLength);
  new DataView(out.buffer).setUint32(0, pathBytes.byteLength, true);
  out.set(pathBytes, 4);
  out.set(data, 4 + pathBytes.byteLength);
  return out;
}

/** Split a payload framed by {@link encodePut}. */
export function decodePut(payload: Uint8Array): { path: string; data: Uint8Array } {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const pathLen = view.getUint32(0, true);
  // `TextDecoder` refuses a view onto a `SharedArrayBuffer`, and this payload
  // arrives in exactly one — copy the path out before decoding it.
  const path = new TextDecoder().decode(payload.slice(4, 4 + pathLen));
  // Copy the body too: the shared buffer is reused as soon as the call returns.
  return { path, data: payload.slice(4 + pathLen) };
}

/** A snapshot entry, as `MemoryVfs.snapshot()` produces them (file data is base64). */
export interface PersistedEntry {
  path: string;
  type: 'file' | 'dir';
  data?: string;
  mode?: number;
}

export interface PersistedSnapshot {
  version: number;
  entries: PersistedEntry[];
}

/** Hand the FS worker its port, its control block and its OPFS root. */
export interface FsInitMessage {
  kind: 'init';
  control: SharedArrayBuffer;
  rootName: string;
  port: MessagePort;
}

export type FsAsyncCall =
  | { kind: 'load' }
  /** Mirror the whole tree: rewrite `.wvm.json` and every file next to it. */
  | { kind: 'snapshot'; snapshot: PersistedEntry[] }
  /**
   * Drop these paths from the store.
   *
   * The store is append-only on its own, and reads reach through it for paths the
   * in-memory tree does not hold — so a deletion that never reaches here would
   * let the file be found again later.
   */
  | { kind: 'delete'; paths: string[] }
  | { kind: 'clear' };

/** The same call with the correlation id the transport adds. */
export type FsAsyncRequest = FsAsyncCall & { id: number };

export type FsAsyncResponse =
  | { id: number; kind: 'ok'; result?: unknown }
  | { id: number; kind: 'error'; message: string; code?: string };
