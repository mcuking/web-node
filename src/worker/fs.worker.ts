/// <reference lib="webworker" />
/**
 * The **FS worker** (M120): the single owner of the Origin Private File System.
 *
 * It exists because a blocking call and an asynchronous backing store cannot
 * live on the same thread. The runtime worker runs user code, which must be able
 * to block (`fs.fsyncSync`) — but blocking it would also freeze the event loop
 * that has to `await` OPFS handle lookups, and OPFS sync access handles are only
 * obtainable asynchronously. Splitting the two fixes it: this worker does the
 * `await`s, the runtime worker parks in `Atomics.wait`.
 *
 * Everything the runtime worker persists flows through here — the debounced
 * whole-tree snapshot (bulk, asynchronous) and durable single-file writes
 * (blocking, over the shared-memory channel). Both go through **one** queue in
 * `serveSyncChannel`, so they cannot interleave.
 *
 * This file is only the shell: it binds a port to `FsService`. The decisions
 * live there, where they can be tested without a worker.
 */

import { CONTROL_WORDS, serveSyncChannel, SyncChannelError } from '../sync/sab-rpc';
import type { FsAsyncRequest, FsInitMessage } from '../sync/fs-protocol';
import { OpfsFileStore } from '../node-runtime/vfs/opfs-store';
import { FsService } from '../node-runtime/vfs/fs-service';

function initialise(message: FsInitMessage): void {
  // A protocol drift would otherwise surface as a hung tab rather than as an
  // error, so the control block's size is checked up front.
  if (message.control.byteLength !== CONTROL_WORDS * 4) {
    throw new SyncChannelError(
      `control block is ${message.control.byteLength} bytes, expected ${CONTROL_WORDS * 4}`,
    );
  }
  const service = new FsService(new OpfsFileStore(message.rootName));
  serveSyncChannel<FsAsyncRequest>(message.port, message.control, {
    sync: (op, payload) => service.sync(op, payload),
    async: (request) => service.async(request),
  });
}

self.onmessage = (event: MessageEvent): void => {
  const message = event.data as { kind?: string };
  if (message?.kind === 'init') initialise(message as FsInitMessage);
};
