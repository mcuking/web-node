/**
 * The wire protocol between the runtime worker and the **FS worker**.
 *
 * Two channels ride the same `MessagePort`:
 *
 *  - **synchronous** operations (`FS_OP_*`) go over the shared-memory channel in
 *    `src/sync/sab-rpc.ts`. They are what a blocking Node call needs: the runtime
 *    worker parks in `Atomics.wait` and the FS worker answers through the
 *    `SharedArrayBuffer`.
 *  - **asynchronous** operations (`FsAsyncRequest`) are ordinary messages with a
 *    reply. Nothing is blocked, so they can afford a round trip and a real
 *    `Promise`; they carry the bulky payloads (whole-tree snapshots) that would
 *    not fit a single shared buffer.
 */

/** Write a file and make it durable before returning. Payload: `[u32 pathLen][path][bytes]`. */
export const FS_OP_PUT = 1;

export type FsOp = typeof FS_OP_PUT;

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
  | { kind: 'clear' };

/** The same call with the correlation id the transport adds. */
export type FsAsyncRequest = FsAsyncCall & { id: number };

export type FsAsyncResponse =
  | { id: number; kind: 'ok'; result?: unknown }
  | { id: number; kind: 'error'; message: string; code?: string };
