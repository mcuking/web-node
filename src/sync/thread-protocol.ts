/**
 * The wire protocol between a **real-thread worker** and the runtime worker that
 * owns the VFS (M147, Phase A).
 *
 * A real Web Worker is a separate realm: it cannot touch the parent's
 * `MemoryVfs`. But a worker script loads its own modules and reads the project
 * **synchronously** (`require`, `fs.readFileSync`), so the tree has to be
 * reachable without `await`. The answer is the same one M120 used for
 * `fsyncSync`: a synchronous request/response channel over shared memory
 * (`src/sync/sab-rpc.ts`), with this module defining *what* travels on it.
 *
 * The parent is the single owner of the authoritative tree, so every call — read
 * or write — is applied **there**, never on a second copy. That keeps the two
 * sides consistent by construction: there is exactly one tree.
 *
 * Framing is `[u32 metaLen LE][meta JSON][body bytes]`, so a call's arguments
 * ride as JSON and any bulk bytes (a file body) ride raw — no base64 inflation
 * on the hot read path.
 */

import type { Dirent, MkdirOptions, ReaddirOptions, Stat, WriteOptions } from '../node-runtime/vfs/types';
import { PARENT_PORT_ID, type PortBridgeFrame } from './port-bridge';

/** Numeric op codes (the `SyncChannel.call()` argument) for each VFS method. */
export const VFS_OP = {
  readFile: 1,
  writeFile: 2,
  appendFile: 3,
  exists: 4,
  stat: 5,
  lstat: 6,
  mkdir: 7,
  readdir: 8,
  rm: 9,
  rename: 10,
  copyFile: 11,
  chmod: 12,
  realpath: 13,
  sync: 14,
} as const;

export type VfsOpName = keyof typeof VFS_OP;
export type VfsOpCode = (typeof VFS_OP)[VfsOpName];

/** Code → name, for dispatch and messages. */
export const VFS_OP_BY_CODE: Record<number, VfsOpName> = Object.fromEntries(
  Object.entries(VFS_OP).map(([name, code]) => [code, name as VfsOpName]),
);

/**
 * Read-only ops never mutate the tree, so the parent may answer them **outside**
 * its write queue (see `serveSyncChannel`) — a lookup must not be parked behind
 * a slow write, which would risk the channel's `Atomics.wait` timeout.
 */
export function isReadOnlyVfsOp(code: number): boolean {
  return (
    code === VFS_OP.readFile ||
    code === VFS_OP.exists ||
    code === VFS_OP.stat ||
    code === VFS_OP.lstat ||
    code === VFS_OP.readdir ||
    code === VFS_OP.realpath
  );
}

/** The arguments of one call (the JSON half of the frame). */
export type VfsCallMeta =
  | { op: 'readFile'; path: string }
  | { op: 'writeFile'; path: string; opts?: WriteOptions }
  | { op: 'appendFile'; path: string }
  | { op: 'exists'; path: string }
  | { op: 'stat'; path: string }
  | { op: 'lstat'; path: string }
  | { op: 'mkdir'; path: string; opts?: MkdirOptions }
  | { op: 'readdir'; path: string; opts?: ReaddirOptions }
  | { op: 'rm'; path: string; opts?: { recursive?: boolean; force?: boolean; syscall?: 'unlink' | 'rmdir' | 'lstat' } }
  | { op: 'rename'; from: string; to: string }
  | { op: 'copyFile'; from: string; to: string; mode?: number }
  | { op: 'chmod'; path: string; mode: number }
  | { op: 'realpath'; path: string }
  | { op: 'sync'; path: string };

/** The value half of a response (the JSON half of the reply frame). */
export type VfsResultMeta =
  | { op: 'readFile' } // the body carries the bytes
  | { op: 'writeFile' }
  | { op: 'appendFile' }
  | { op: 'exists'; result: boolean }
  | { op: 'stat'; stat: Stat }
  | { op: 'lstat'; stat: Stat }
  | { op: 'mkdir'; result: string | undefined }
  | { op: 'readdir'; entries: Dirent[] }
  | { op: 'rm' }
  | { op: 'rename' }
  | { op: 'copyFile' }
  | { op: 'chmod' }
  | { op: 'realpath'; result: string }
  | { op: 'sync' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EMPTY = new Uint8Array(0);

/** Frame `meta` + `body` as `[u32 metaLen][meta JSON][body]`. */
export function encodeFrame(meta: VfsCallMeta | VfsResultMeta, body: Uint8Array = EMPTY): Uint8Array {
  const json = encoder.encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + json.byteLength + body.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, 4);
  out.set(body, 4 + json.byteLength);
  return out;
}

/** Split a frame produced by {@link encodeFrame}. */
export function decodeFrame<T>(bytes: Uint8Array): { meta: T; body: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLen = view.getUint32(0, true);
  // The frame may arrive inside a `SharedArrayBuffer`, which `TextDecoder`
  // refuses to read — copy the JSON slice out first.
  const meta = JSON.parse(decoder.decode(bytes.slice(4, 4 + metaLen))) as T;
  return { meta, body: bytes.subarray(4 + metaLen) };
}

/** The `kind` handshake the parent posts to a fresh thread worker. */
export interface ThreadInitMessage {
  kind: 'web-node:thread-init';
  /** Synchronous VFS channel: the worker's end of the port pair. */
  vfsPort: MessagePort;
  /** Control block for the synchronous VFS channel. */
  vfsControl: SharedArrayBuffer;
  /** Messaging channel: the worker's `parentPort`. */
  messagePort: MessagePort;
  /** What the entry is, its `workerData` (already cloned) and its options. */
  filename: string;
  workerData: unknown;
  argv: string[];
  name: string;
  env: Record<string, string>;
  execArgv: string[];
  /** The tree's working directory, so the thread resolves relative paths alike. */
  cwd: string;
  /** The worker's thread id (assigned by the parent, as Node's handle does). */
  threadId: number;
  /** A snapshot of `getEnvironmentData()` (a structured clone, mutations do not travel back). */
  environmentData: Map<unknown, unknown>;
  stdin: boolean;
  stdout: boolean;
  stderr: boolean;
}

/** A frame the thread sends the parent over the messaging channel (not the VFS one). */
export type ThreadToParent =
  | { t: 'online' }
  | { t: 'message'; value: unknown }
  | { t: 'messageerror'; value: unknown }
  | { t: 'error'; message: string; stack?: string }
  | { t: 'exit'; code: number }
  | { t: 'stdout'; data: Uint8Array }
  | { t: 'stderr'; data: Uint8Array }
  | { t: 'port'; frame: PortBridgeFrame };

/** A frame the parent sends the thread over the messaging channel. */
export type ParentToThread =
  | { t: 'message'; value: unknown }
  | { t: 'stdin'; data: Uint8Array }
  | { t: 'stdin-end' }
  | { t: 'terminate' }
  | { t: 'port'; frame: PortBridgeFrame };

/**
 * Map a bridge frame leaving this realm onto a wire frame. A plain
 * (port-free) message to the `parentPort` link rides as the classic
 * `{ t: 'message' }` frame so the wire format stays compatible; anything that
 * carries ports rides as `{ t: 'port' }`.
 */
export function bridgeFrameToWire(
  frame: PortBridgeFrame,
): { t: 'message'; value: unknown } | { t: 'port'; frame: PortBridgeFrame } {
  if (frame.__wnPort === 'msg' && frame.id === PARENT_PORT_ID && frame.tokens.length === 0) {
    return { t: 'message', value: frame.data };
  }
  return { t: 'port', frame };
}

/** The inverse of {@link bridgeFrameToWire}; `null` for frames the bridge ignores. */
export function wireToBridgeFrame(frame: {
  t: string;
  value?: unknown;
  frame?: PortBridgeFrame;
}): PortBridgeFrame | null {
  if (frame.t === 'message') return { __wnPort: 'msg', id: PARENT_PORT_ID, data: frame.value, tokens: [] };
  if (frame.t === 'port') return frame.frame ?? null;
  return null;
}
