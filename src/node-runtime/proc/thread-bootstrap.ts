/**
 * The **thread side** of a real-thread worker (M147, Phase B).
 *
 * A real Web Worker is a separate realm, so it cannot reuse the parent's module
 * registry, bindings or VFS. This module is what turns a bare browser worker
 * into a *Node worker*: it builds a fresh `NodeRuntime` over a `RemoteVfs`
 * (which reaches the parent's authoritative tree synchronously, Phase A),
 * installs a worker-side `worker_threads` view, and bridges the
 * `online`/`message`/`error`/`exit` lifecycle plus stdio over a host port.
 *
 * It is deliberately **transport-agnostic and injection-friendly** (`deps`) so
 * the same code path can be driven in a test without a second thread: the real
 * `SyncChannel` (which parks in `Atomics.wait`) and the real realm are the only
 * two things a test replaces, and everything else — the worker view, the
 * lifecycle frames, the entry execution — runs unchanged.
 *
 * Scope note: `parentPort` is a **real realm `MessagePort`** whose peer lives in
 * the parent (`Worker`); port transfer across the thread boundary rides the same
 * cross-realm bridge, so `instanceof MessagePort`, `receiveMessageOnPort` and
 * transferring a `MessageChannel` end to the parent all behave as in Node
 * (M147 Phase C).
 */

import { NodeRuntime, ProcessExit, type RuntimeOptions } from '../runtime';
import type { Egress } from '../net/egress';
import { notImplemented } from '../errors';
import { RemoteVfs } from '../vfs/remote';
import { SyncChannel } from '../../sync/sab-rpc';
import {
  PARENT_PORT_ID,
  type PortBridgeApi,
} from '../../sync/port-bridge';
import {
  bridgeFrameToWire,
  wireToBridgeFrame,
  type ParentToThread,
  type ThreadInitMessage,
  type ThreadToParent,
} from '../../sync/thread-protocol';

const encoder = new TextEncoder();

/** Enough of the thread's world to swap out for a test. */
export interface ThreadBootstrapDeps {
  /** Build the synchronous VFS channel (overridden in tests with a loopback). */
  createChannel?: (port: MessagePort, control: SharedArrayBuffer) => SyncChannel;
  /** Construct the runtime (overridden in tests to tweak options). */
  createRuntime?: (opts: RuntimeOptions) => NodeRuntime;
  /** Outbound network for the worker's own realm (needed for `http`/`fetch`). */
  egress?: Egress;
  /** Install the sandbox globals onto the thread's real globalThis (browser workers do). */
  installGlobals?: boolean;
}

export interface ThreadBootstrapResult {
  runtime: NodeRuntime;
  /** Resolves with the worker's exit code once the entry has drained. */
  done: Promise<number>;
}

/**
 * Boot a Node worker in this realm. Call from a browser worker's `onmessage`
 * once the init message (with its transferred ports) has arrived.
 */
export function bootstrapThread(init: ThreadInitMessage, deps: ThreadBootstrapDeps = {}): ThreadBootstrapResult {
  const send = (frame: ThreadToParent): void => {
    init.messagePort.postMessage(frame);
  };

  const makeChannel = deps.createChannel ?? ((port, control) => new SyncChannel(port, control));
  const vfs = new RemoteVfs(makeChannel(init.vfsPort, init.vfsControl), { cwd: init.cwd });

  const makeRuntime = deps.createRuntime ?? ((opts: RuntimeOptions) => new NodeRuntime(opts));
  const runtime = makeRuntime({
    vfs,
    argv: init.argv,
    env: init.env,
    installGlobals: deps.installGlobals ?? true,
    egress: deps.egress,
    onStdout: (chunk) => send({ t: 'stdout', data: encoder.encode(chunk) }),
    onStderr: (chunk) => send({ t: 'stderr', data: encoder.encode(chunk) }),
  });

  // `parentPort` is a real realm `MessagePort` (so `instanceof`, `.on('message')`,
  // `ref`/`unref` and `receiveMessageOnPort` all behave as in Node); it is the
  // proxy half of the `parent` link, driven over the host port. Port transfer
  // across the boundary rides the same machinery.
  const messaging = runtime.realm.internalBinding('messaging') as unknown as {
    __ports: PortBridgeApi;
  };
  const ports = messaging.__ports;
  ports.connect((frame) => send(bridgeFrameToWire(frame)));

  // A worker's `process.execArgv` is its own, and its `process.argv0` is the
  // exec path; the runtime already set `argv`/`env` from the options above.
  const proc = runtime.process as Record<string, unknown>;
  proc.execArgv = init.execArgv;

  // The worker's stdin: a Readable that the parent's `worker.stdin` feeds over
  // the host port. `process.stdout`/`stderr` are already wired to the onStdout
  // / onStderr callbacks above, so only stdin needs building here — the runtime
  // gives a plain `process` no per-thread stdin.
  const streams = runtime.realm.require('stream') as {
    Readable: new (opts: { read(): void }) => Record<string, unknown> & { push(chunk: unknown): boolean };
  };
  const stdin = new streams.Readable({ read() {} });
  proc.stdin = stdin;

  const parentPort = ports.importPort(PARENT_PORT_ID) as {
    start(): void;
  };
  // Node starts the worker's `parentPort` for it, so `parentPort.on('message')`
  // receives without an explicit `start()` (verified against real Node). The
  // proxy we just built is a plain `MessagePort`, which needs the explicit call.
  parentPort.start();
  const workerThreads = createWorkerThreadsView(runtime, init, parentPort);
  runtime.loader.setBuiltinOverrides({
    worker_threads: workerThreads,
    'node:worker_threads': workerThreads,
  });

  // The parent's frames arrive on the same host port the worker posts on.
  const hostPort = init.messagePort as unknown as {
    addEventListener(type: 'message', cb: (event: { data: unknown }) => void): void;
    start?: () => void;
  };
  hostPort.addEventListener('message', (event): void => {
    const frame = event.data as ParentToThread | undefined;
    if (!frame || typeof frame !== 'object') return;
    switch (frame.t) {
      case 'stdin':
        stdin.push(frame.data);
        return;
      case 'stdin-end':
        stdin.push(null);
        return;
      case 'terminate':
        // The browser worker's own `terminate()` is authoritative; this frame is
        // a best-effort cooperative stop for hosts whose Worker has no terminate.
        return;
      case 'message':
      case 'port': {
        const bridgeFrame = wireToBridgeFrame(frame);
        if (bridgeFrame !== null) ports.onFrame(bridgeFrame);
        return;
      }
    }
  });
  hostPort.start?.();

  // `online` is emitted before the entry runs — the same place Node's
  // `upAndRunning` lands, and what lets the parent attach listeners first.
  send({ t: 'online' });

  const done = (async (): Promise<number> => {
    try {
      runtime.runMain(init.filename);
    } catch (err) {
      if (err instanceof ProcessExit) {
        const code = err.code;
        send({ t: 'exit', code });
        return code;
      }
      const error = err as Error;
      send({ t: 'error', message: error.message, stack: error.stack });
      send({ t: 'exit', code: 1 });
      return 1;
    }
    // The program is over when the loop has drained, not when the entry returns
    // (a pending timer or socket keeps it alive) — same rule as the main worker.
    await runtime.drain();
    const code = runtime.exitCode ?? 0;
    send({ t: 'exit', code });
    return code;
  })();

  return { runtime, done };
}

/** The worker's `parentPort` is a real realm `MessagePort` (see `bootstrapThread`). */

/** The worker-side `worker_threads` module: its own `parentPort`/`workerData`. */
function createWorkerThreadsView(
  runtime: NodeRuntime,
  init: ThreadInitMessage,
  parentPort: unknown,
): Record<string, unknown> {
  const realm = runtime.realm;
  const io = realm.require('internal/worker/io') as {
    MessagePort: unknown;
    MessageChannel: unknown;
    BroadcastChannel: unknown;
    receiveMessageOnPort: unknown;
    markAsUncloneable: unknown;
    moveMessagePortToContext: unknown;
  };
  const buffer = realm.require('internal/buffer') as {
    markAsUntransferable: unknown;
    isMarkedAsUntransferable: unknown;
  };
  return {
    isInternalThread: false,
    isMainThread: false,
    threadId: init.threadId,
    threadName: init.name,
    parentPort,
    workerData: init.workerData,
    resourceLimits: {},
    SHARE_ENV: Symbol.for('nodejs.worker_threads.SHARE_ENV'),
    MessagePort: io.MessagePort,
    MessageChannel: io.MessageChannel,
    BroadcastChannel: io.BroadcastChannel,
    receiveMessageOnPort: io.receiveMessageOnPort,
    markAsUncloneable: io.markAsUncloneable,
    moveMessagePortToContext: io.moveMessagePortToContext,
    markAsUntransferable: buffer.markAsUntransferable,
    isMarkedAsUntransferable: buffer.isMarkedAsUntransferable,
    // A snapshot of the parent's environment-data map (clone-local: a mutation
    // here does not travel back, unlike Node's process-global store).
    getEnvironmentData: (key: unknown): unknown => init.environmentData.get(key),
    setEnvironmentData: (key: unknown, value: unknown): void => {
      if (value === undefined) init.environmentData.delete(key);
      else init.environmentData.set(key, value);
    },
    // A worker cannot start a nested worker: the runtime would have to boot a
    // third realm, which is not modelled.
    Worker: class Worker {
      constructor() {
        throw notImplemented(
          'api',
          'worker_threads.Worker',
          'Nested workers are not supported: a worker does not start further threads.',
        );
      }
    },
    postMessageToThread: (): never => {
      throw notImplemented('api', 'worker_threads.postMessageToThread', 'There are no other threads to message.');
    },
  };
}
