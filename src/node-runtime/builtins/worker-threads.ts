import type { BuiltinSpec } from './types';
import { notImplemented } from '../errors';

/**
 * `worker_threads` — the message-passing half of Node's worker API.
 *
 * A browser tab cannot start a thread, and this runtime deliberately does not
 * pretend otherwise: `Worker` and `postMessageToThread` throw. What *is* real is
 * everything the vendored `internal/worker/io.js` provides, because that was
 * always plain JS on top of a native port handle — `MessageChannel`,
 * `MessagePort`, `BroadcastChannel`, `receiveMessageOnPort` and
 * `markAsUncloneable` all come from that file unmodified, on top of the
 * `messaging` binding.
 *
 * The constants (`isMainThread`, `threadId`, `parentPort: null`) are the truth
 * for a single-threaded runtime, and `markAsUntransferable`/`isMarkedAsUntransferable`
 * come from `internal/buffer` exactly as Node's own `lib/worker_threads.js` gets
 * them.
 */

function throwing(prop: string): (...args: unknown[]) => never {
  return () => {
    throw notImplemented(
      'api',
      `worker_threads.${prop}`,
      'This runtime has no worker threads: it executes a single realm in one browser tab.',
    );
  };
}

export const workerThreadsSpec: BuiltinSpec = {
  id: 'worker_threads',
  aliases: ['node:worker_threads'],
  origin: 'web-node',
  deps: ['internal/worker/io', 'internal/buffer'],
  init: (ctx) => {
    const io = ctx.require('internal/worker/io') as {
      MessageChannel: unknown;
      MessagePort: unknown;
      BroadcastChannel: unknown;
      receiveMessageOnPort: unknown;
      markAsUncloneable: unknown;
      moveMessagePortToContext: unknown;
    };
    const buffer = ctx.require('internal/buffer') as {
      markAsUntransferable: unknown;
      isMarkedAsUntransferable: unknown;
    };
    return {
      isMainThread: true,
      threadId: 0,
      threadName: 'main',
      isInternalThread: false,
      parentPort: null,
      workerData: null,
      resourceLimits: {},
      SHARE_ENV: Symbol('nodejs.worker_threads.SHARE_ENV'),
      MessageChannel: io.MessageChannel,
      MessagePort: io.MessagePort,
      BroadcastChannel: io.BroadcastChannel,
      receiveMessageOnPort: io.receiveMessageOnPort,
      markAsUncloneable: io.markAsUncloneable,
      moveMessagePortToContext: io.moveMessagePortToContext,
      markAsUntransferable: buffer.markAsUntransferable,
      isMarkedAsUntransferable: buffer.isMarkedAsUntransferable,
      getEnvironmentData: () => undefined,
      setEnvironmentData: () => undefined,
      Worker: throwing('Worker'),
      postMessageToThread: throwing('postMessageToThread'),
    };
  },
};
