/**
 * The **parent side** of a real-thread worker (M147, Phase B).
 *
 * Where the cooperative worker (`proc/worker.ts`) runs its entry on the *same*
 * event loop, this spawns a **real browser `Worker`** — a separate realm, a
 * separate thread, real CPU parallelism — and bridges the three things a thread
 * cannot share with its parent:
 *
 *   - the **VFS**: a synchronous shared-memory channel to the authoritative tree
 *     (`serveVfsChannel`, Phase A), because the worker's `require` is synchronous;
 *   - **messaging/stdio**: a host `MessagePort` pair carrying `parentPort`
 *     messages and stdout/stderr/stdin frames;
 *   - **lifecycle**: `online`/`message`/`error`/`exit`/`terminate`, translated
 *     between the thread's frames and the `WorkerHandle` surface.
 *
 * The browser `Worker` constructor is injected (`spawn`) so this can be
 * exercised without a real second thread; the default factory is the only place
 * that knows the bundle URL.
 */

import type { Vfs } from '../vfs';
import type { Realm } from '../realm';
import type { WorkerHandle, WorkerRequest } from './worker';
import { serveVfsChannel } from '../vfs/remote-server';
import { CONTROL_BYTES } from '../../sync/sab-rpc';
import { PARENT_PORT_ID, type PortBridgeApi } from '../../sync/port-bridge';
import {
  bridgeFrameToWire,
  type ParentToThread,
  type ThreadInitMessage,
  type ThreadToParent,
} from '../../sync/thread-protocol';

/** The host `Worker` surface this needs (browser `Worker` satisfies it). */
export interface SpawnedThread {
  postMessage(value: unknown, transfer?: Transferable[]): void;
  terminate(): void | Promise<number>;
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: any) => void): void;
}

export interface RealWorkerDeps {
  vfs: Vfs;
  realm(): Realm;
  /** Create the host worker. Defaults to the bundled `thread.worker.ts`. */
  spawn(req: WorkerRequest): SpawnedThread;
}

/** Node's first worker thread id is 2 (0 is main, 1 is reserved). */
const FIRST_THREAD_ID = 2;

let nextThreadId = FIRST_THREAD_ID;

/** How long an unconsumed `worker.stdin` refs the worker (Node: until ended). */
export class RealWorker implements WorkerHandle {
  readonly threadId: number;
  readonly #request: WorkerRequest;
  readonly #deps: RealWorkerDeps;

  #worker: SpawnedThread | null = null;
  #serve: (() => void) | null = null;
  /** The parent's end of the messaging/stdio port, kept to post to the thread. */
  #msgPort: MessagePort | null = null;
  /** The messaging binding's cross-realm bridge (M147 Phase C). */
  #ports: PortBridgeApi | null = null;
  #started = false;
  #exited = false;
  #exitCode: number | null = null;
  #refed = true;
  #onlineEmitted = false;
  #stdinEnded = false;

  #onlineCbs: Array<() => void> = [];
  #messageCbs: Array<(value: unknown) => void> = [];
  #messageErrorCbs: Array<(err: unknown) => void> = [];
  #errorCbs: Array<(err: unknown) => void> = [];
  #exitCbs: Array<(code: number) => void> = [];

  #stdout: Record<string, unknown> | null = null;
  #stderr: Record<string, unknown> | null = null;
  #stdin: Record<string, unknown> | null = null;

  constructor(request: WorkerRequest, deps: RealWorkerDeps) {
    this.threadId = nextThreadId++;
    this.#request = request;
    this.#deps = deps;
    // The parent side always builds stdout/stderr (Node pipes them to
    // `process.stdout`/`stderr` unless the caller opted out); stdin exists only
    // under `stdin: true`.
    this.#buildStdio();
  }

  get started(): boolean {
    return this.#started;
  }

  get exited(): boolean {
    return this.#exited;
  }

  get refed(): boolean {
    return this.#refed;
  }

  get threadName(): string | null {
    return this.#request.name;
  }

  get stdout(): unknown {
    return this.#stdout;
  }

  get stderr(): unknown {
    return this.#stderr;
  }

  get stdin(): unknown {
    return this.#stdin;
  }

  /** Spawn the real worker, transfer its ports, and serve its VFS. */
  start(environmentData: Map<unknown, unknown>): void {
    if (this.#started) return;
    this.#started = true;

    const vfsChannel = new MessageChannel();
    const control = new SharedArrayBuffer(CONTROL_BYTES);
    const messaging = new MessageChannel();

    const init: ThreadInitMessage = {
      kind: 'web-node:thread-init',
      vfsPort: vfsChannel.port2,
      vfsControl: control,
      messagePort: messaging.port2,
      filename: this.#request.filename,
      workerData: this.#request.workerData,
      argv: this.#request.argv,
      name: this.#request.name,
      env: this.#request.env,
      execArgv: this.#request.execArgv,
      cwd: this.#deps.vfs.cwd,
      threadId: this.threadId,
      environmentData,
      stdin: Boolean(this.#request.stdin),
      stdout: Boolean(this.#request.stdout),
      stderr: Boolean(this.#request.stderr),
    };

    this.#msgPort = messaging.port1;
    this.#msgPort.addEventListener('message', (event: MessageEvent) => this.#onFrame(event.data));
    this.#msgPort.start();

    // The parent's messaging binding drives the proxy halves of the `parent`
    // link and of any port that crosses; its frames ride the host port.
    const messagingBinding = this.#deps.realm().internalBinding('messaging') as unknown as {
      __ports: PortBridgeApi;
    };
    this.#ports = messagingBinding.__ports;
    this.#ports.connect((frame) => this.#toThread(bridgeFrameToWire(frame)));

    // The parent is the single owner of the tree: every call the thread makes is
    // applied here and nowhere else (Phase A). Read-only ops bypass the write
    // queue so a lookup cannot be parked behind a slow write.
    this.#serve = serveVfsChannel(vfsChannel.port1, control, this.#deps.vfs);

    try {
      this.#worker = this.#deps.spawn(this.#request);
    } catch (err) {
      this.#serve();
      this.#onHardError(err);
      return;
    }
    // The init message carries the transferred ports; a static `transfer` list
    // is required so the ports move rather than being cloned.
    this.#worker.postMessage(init, [init.vfsPort, init.messagePort]);
    this.#worker.addEventListener('error', (event) => this.#onHardError(event));
    this.#worker.addEventListener('messageerror', (event) => this.#onMessageError(event));
  }

  // ---- frames from the thread ---------------------------------------------

  /** Fan a message out to the parent's `on('message')` listeners. */
  #deliver(value: unknown): void {
    for (const cb of this.#messageCbs.slice()) cb(value);
  }

  #onFrame(frame: ThreadToParent): void {
    if (!frame || typeof frame !== 'object') return;
    switch (frame.t) {
      case 'online':
        this.#onlineEmitted = true;
        for (const cb of this.#onlineCbs.splice(0)) cb();
        return;
      case 'message':
        // A plain (port-free) message posted by the worker's `parentPort`.
        this.#deliver(frame.value);
        return;
      case 'port': {
        const bridgeFrame = frame.frame;
        if (bridgeFrame.__wnPort === 'msg' && bridgeFrame.id === PARENT_PORT_ID) {
          const { value } = this.#ports!.importMessage(bridgeFrame);
          this.#deliver(value);
        } else {
          this.#ports?.onFrame(bridgeFrame);
        }
        return;
      }
      case 'error':
        this.#emitError(frame);
        return;
      case 'exit':
        this.#stop(frame.code);
        return;
      case 'stdout':
        this.#onStdio('stdout', frame.data);
        return;
      case 'stderr':
        this.#onStdio('stderr', frame.data);
        return;
    }
  }

  #emitError(frame: { message: string; stack?: string }): void {
    const err = new Error(frame.message);
    if (frame.stack) err.stack = frame.stack;
    for (const cb of this.#errorCbs.slice()) cb(err);
  }

  #onHardError(event: unknown): void {
    const e = event as { message?: string; error?: Error };
    const err = e?.error ?? new Error(e?.message ?? 'worker error');
    for (const cb of this.#errorCbs.slice()) cb(err);
    // A hard crash has no exit frame, so settle the handle here.
    this.#stop(1);
  }

  #onMessageError(event: unknown): void {
    for (const cb of this.#messageErrorCbs.slice()) cb(event);
  }

  // ---- event subscription --------------------------------------------------

  #sub<T>(list: T[], cb: T): () => void {
    list.push(cb);
    return () => {
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    };
  }

  onOnline(cb: () => void): () => void {
    if (this.#exited) return () => undefined;
    if (this.#onlineEmitted) {
      queueMicrotask(cb);
      return () => undefined;
    }
    return this.#sub(this.#onlineCbs, cb);
  }

  onMessage(cb: (value: unknown) => void): () => void {
    return this.#sub(this.#messageCbs, cb);
  }

  onMessageError(cb: (err: unknown) => void): () => void {
    return this.#sub(this.#messageErrorCbs, cb);
  }

  onError(cb: (err: unknown) => void): () => void {
    return this.#sub(this.#errorCbs, cb);
  }

  onExit(cb: (code: number) => void): () => void {
    if (this.#exited) {
      queueMicrotask(() => cb(this.#exitCode ?? 0));
      return () => undefined;
    }
    return this.#sub(this.#exitCbs, cb);
  }

  // ---- messaging / lifecycle ----------------------------------------------

  #toThread(frame: ParentToThread): void {
    if (this.#exited || this.#msgPort === null) return;
    this.#msgPort.postMessage(frame);
  }

  postMessage(value: unknown, transferList?: unknown): void {
    if (this.#exited || this.#ports === null) return;
    // A message with a transfer list crosses the bridge (its ports are handed to
    // the peer as proxies); a plain message rides as the classic frame.
    const { data, tokens } = this.#ports.buildMessage(value, transferList);
    this.#toThread(bridgeFrameToWire({ __wnPort: 'msg', id: PARENT_PORT_ID, data, tokens }));
  }

  eventLoopUtilization(): unknown {
    const perf = this.#deps.realm().require('perf_hooks') as {
      performance: { eventLoopUtilization: () => unknown };
    };
    return perf.performance.eventLoopUtilization();
  }

  ref(): void {
    this.#refed = true;
  }

  unref(): void {
    this.#refed = false;
  }

  hasRef(): boolean {
    return this.#refed;
  }

  terminate(): Promise<number> | undefined {
    if (this.#exited) return undefined;
    this.#teardown();
    this.#stop(1);
    return Promise.resolve(1);
  }

  /** Close the messaging port + stop serving; the host worker is terminated too. */
  #teardown(): void {
    try {
      this.#serve?.();
    } catch {
      /* already stopped */
    }
    this.#serve = null;
    try {
      this.#msgPort?.close();
    } catch {
      /* already closed */
    }
    this.#msgPort = null;
    try {
      const result = this.#worker?.terminate();
      void result;
    } catch {
      /* already gone */
    }
    this.#worker = null;
  }

  #stop(code: number): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#exitCode = code;
    // Close channels but do not re-terminate an already-exiting worker.
    try {
      this.#serve?.();
    } catch {
      /* already stopped */
    }
    this.#serve = null;
    try {
      this.#msgPort?.close();
    } catch {
      /* already closed */
    }
    this.#msgPort = null;
    const cbs = this.#exitCbs;
    this.#exitCbs = [];
    for (const cb of cbs) cb(code);
  }

  // ---- stdio ---------------------------------------------------------------

  #buildStdio(): void {
    const streams = this.#deps.realm().require('stream') as {
      Readable: new (opts: { read(): void }) => Record<string, unknown>;
      Writable: new (opts: {
        write(chunk: unknown, enc: string, cb: () => void): void;
        final?(cb: () => void): void;
      }) => Record<string, unknown>;
    };
    this.#stdout = new streams.Readable({ read() {} });
    this.#stderr = new streams.Readable({ read() {} });
    if (this.#request.stdin) {
      this.#stdin = new streams.Writable({
        write: (chunk: unknown, _enc: string, cb: () => void): void => {
          const buffer = this.#deps.realm().require('buffer') as { Buffer: { from(c: unknown): unknown } };
          this.#toThread({ t: 'stdin', data: buffer.Buffer.from(chunk) as Uint8Array });
          cb();
        },
        final: (cb: () => void): void => {
          this.#stdinEnded = true;
          this.#toThread({ t: 'stdin-end' });
          cb();
        },
      });
    }
  }

  #onStdio(stream: 'stdout' | 'stderr', data: unknown): void {
    const sink = (stream === 'stdout' ? this.#stdout : this.#stderr) as { push(c: unknown): boolean } | null;
    const optedOut = stream === 'stdout' ? this.#request.stdout : this.#request.stderr;
    if (!optedOut) {
      const parentProcess = this.#deps.realm().require('process') as Record<string, unknown>;
      const target = (stream === 'stdout' ? parentProcess.stdout : parentProcess.stderr) as {
        write?: (c: unknown) => void;
      };
      try {
        target.write?.(data);
      } catch {
        /* the host stream is gone */
      }
    }
    sink?.push(data);
  }
}

/** True when a real thread can be spawned here (isolated, `Worker` present). */
export function realThreadsAvailable(scope: unknown = globalThis): boolean {
  const s = scope as { crossOriginIsolated?: boolean; Worker?: unknown };
  return s.crossOriginIsolated === true && typeof s.Worker === 'function';
}
