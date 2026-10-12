/**
 * The **parent side** of the M147 real-thread VFS bridge.
 *
 * A thread worker cannot touch the parent's `MemoryVfs`, so it forwards every
 * filesystem call here over the shared-memory channel; this module applies it to
 * the authoritative tree and answers. Because the parent owns the only copy,
 * reads and writes are consistent by construction — no merge protocol, no second
 * source of truth.
 *
 * It rides `serveSyncChannel` (M120) unchanged: the caller parks in
 * `Atomics.wait`, the handler returns bytes, and a throwing op comes back as a
 * reconstructed `VfsError`. Read-only ops are marked so a lookup is never parked
 * behind a slow write (a whole-tree `fsync`), which would otherwise eat into the
 * channel's timeout.
 *
 * The handler is deliberately pure over a `Vfs`: it can be exercised in a test
 * without a worker or a browser (see `test/remote-vfs.test.ts`).
 */

import type { Vfs } from './types';
import { serveSyncChannel, type SyncAsyncRequest } from '../../sync/sab-rpc';
import {
  VFS_OP_BY_CODE,
  isReadOnlyVfsOp,
  decodeFrame,
  encodeFrame,
  type VfsCallMeta,
  type VfsResultMeta,
} from '../../sync/thread-protocol';

/** Apply one decoded call to `vfs` and produce the reply frame. */
export function applyVfsCall(vfs: Vfs, meta: VfsCallMeta, body: Uint8Array): Uint8Array {
  switch (meta.op) {
    case 'readFile':
      return encodeFrame({ op: 'readFile' } satisfies VfsResultMeta, vfs.readFile(meta.path));
    case 'writeFile':
      vfs.writeFile(meta.path, body, meta.opts);
      return encodeFrame({ op: 'writeFile' });
    case 'appendFile':
      vfs.appendFile(meta.path, body);
      return encodeFrame({ op: 'appendFile' });
    case 'exists':
      return encodeFrame({ op: 'exists', result: vfs.exists(meta.path) });
    case 'stat':
      return encodeFrame({ op: 'stat', stat: vfs.stat(meta.path) });
    case 'lstat':
      return encodeFrame({ op: 'lstat', stat: vfs.lstat(meta.path) });
    case 'mkdir':
      return encodeFrame({ op: 'mkdir', result: vfs.mkdir(meta.path, meta.opts) });
    case 'readdir':
      return encodeFrame({ op: 'readdir', entries: vfs.readdir(meta.path, meta.opts) });
    case 'rm':
      vfs.rm(meta.path, meta.opts);
      return encodeFrame({ op: 'rm' });
    case 'rename':
      vfs.rename(meta.from, meta.to);
      return encodeFrame({ op: 'rename' });
    case 'copyFile':
      vfs.copyFile(meta.from, meta.to, meta.mode);
      return encodeFrame({ op: 'copyFile' });
    case 'chmod':
      vfs.chmod(meta.path, meta.mode);
      return encodeFrame({ op: 'chmod' });
    case 'realpath':
      return encodeFrame({ op: 'realpath', result: vfs.realpath(meta.path) });
    case 'sync':
      // A VFS with nowhere to flush to treats `fsync` as a no-op, exactly like a
      // real filesystem whose writes sit in a page cache.
      vfs.sync?.(meta.path);
      return encodeFrame({ op: 'sync' });
  }
}

/**
 * Serve VFS calls for one thread worker. Returns a stop function.
 *
 * The parent processes these on its own event loop, which is idle while a thread
 * runs (it is blocked in `drain()` waiting for the worker), so the round trips
 * are fast in the common case. If the parent is itself parked in `Atomics.wait`
 * (an `fsyncSync`), a thread's call waits for it — bounded by the channel
 * timeout, never a hang.
 */
export function serveVfsChannel(port: MessagePort, control: SharedArrayBuffer, vfs: Vfs): () => void {
  return serveSyncChannel<SyncAsyncRequest>(port, control, {
    sync: (op, payload) => {
      const name = VFS_OP_BY_CODE[op];
      if (name === undefined) {
        throw new Error(`unknown VFS op code ${op}`);
      }
      const { meta, body } = decodeFrame<VfsCallMeta>(payload);
      if (meta.op !== name) {
        throw new Error(`VFS op mismatch: code ${op} is ${name}, frame says ${meta.op}`);
      }
      return applyVfsCall(vfs, meta, body);
    },
    isReadOp: isReadOnlyVfsOp,
  });
}
