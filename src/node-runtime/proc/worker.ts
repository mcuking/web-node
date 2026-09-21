/**
 * The `Worker` surface of `worker_threads`.
 *
 * ## What this is (and is not)
 *
 * Real Node runs a `Worker` on a new OS thread with a new V8 isolate, and the two
 * sides talk over a native port. A browser tab cannot start a thread, and this
 * runtime does not pretend it can. What it *can* do honestly is reproduce the
 * **data semantics** of a worker on the one event loop it has, exactly the way
 * `proc/host.ts` reproduces a child process: the worker script runs in its own
 * module registry (its own module cache, its own injected globals, its own
 * `process`/`worker_threads` views) and the two sides exchange structured clones
 * over a real `MessageChannel` port pair.
 *
 * That means:
 *
 *   - `MessageChannel`-style message passing, `postMessage`/`on('message')`,
 *     `workerData` (a structured clone), the `online`/`message`/`error`/`exit`
 *     lifecycle and `terminate()` all behave as they do in Node.
 *   - There is **no parallelism**: the worker shares the thread and the event
 *     loop, so a worker that never yields blocks the parent (and vice versa),
 *     and `Atomics.wait` cannot be used to block. This is the one deviation that
 *     matters, and it is deliberate rather than hidden — see docs/DEVLOG.md.
 *
 * The pieces that need the native thread/isolate machinery — resource limits,
 * `eval`, worker stdio, heap/cpu profiling, `postMessageToThread` — refuse
 * loudly rather than approximate.
 */

import type { Vfs } from '../vfs';
import type { Realm } from '../realm';
import type { ModuleLoader } from '../loader';
import { notImplemented } from '../errors';

/** A request to start one worker; the module and `workerData` are pre-cloned. */
export interface WorkerRequest {
  /** Absolute VFS path of the entry module. */
  filename: string;
  /** The already-structured-cloned `workerData` handed to the worker. */
  workerData: unknown;
  /** The worker's `process.argv` (execPath, filename, …argv). */
  argv: string[];
  /** Worker name (`options.name`, trimmed; defaults to "WorkerThread"). */
  name: string;
  /** The worker's own environment (a copy, or the shared map for SHARE_ENV). */
  env: Record<string, string>;
  /** The worker's `process.execArgv`. */
  execArgv: string[];
}

/** The parent's view of one worker. */
export interface WorkerHandle {
  readonly threadId: number;
  readonly threadName: string | null;
  readonly started: boolean;
  readonly exited: boolean;
  readonly refed: boolean;
  postMessage(value: unknown, transferList?: unknown): void;
  terminate(): Promise<number> | undefined;
  ref(): void;
  unref(): void;
  hasRef(): boolean;
  eventLoopUtilization(): unknown;
  onOnline(cb: () => void): () => void;
  onMessage(cb: (value: unknown) => void): () => void;
  onMessageError(cb: (err: unknown) => void): () => void;
  onError(cb: (err: unknown) => void): () => void;
  onExit(cb: (code: number) => void): () => void;
}

export interface WorkerHost {
  create(req: WorkerRequest): WorkerHandle;
  /** Live, ref'd workers — they keep the run alive, like a ref'd thread. */
  readonly activeWorkers: number;
  /** `setEnvironmentData`/`getEnvironmentData` storage, shared per process. */
  readonly environmentData: Map<unknown, unknown>;
  /** Stop every worker (called between runs, like tearing a process down). */
  reset(): void;
}

export interface WorkerHostDeps {
  vfs: Vfs;
  realm(): Realm;
  loader(): ModuleLoader;
  /** The parent's injected sandbox globals (the worker's are derived from these). */
  globals(): Record<string, unknown>;
  /** Module aliases (native → WASM shims) that workers must inherit. */
  aliases(): Record<string, string>;
  execPath: string;
  baseEnv: Record<string, string>;
  /** Defer to the next macrotask. Injectable so tests stay deterministic. */
  defer?(fn: () => void): void;
}

/** Thrown inside a worker by `process.exit()` to unwind its own stack. */
class WorkerExit extends Error {
  code: number;
  constructor(code: number) {
    super(`worker exited with code ${code}`);
    this.name = 'WorkerExit';
    this.code = code;
  }
}

/** Node's first worker thread id is 2 (0 is the main thread, 1 is reserved). */
const FIRST_THREAD_ID = 2;

/** The `MessagePort` surface from `internal/worker/io.js` this host drives. */
interface PortLike {
  postMessage(value?: unknown, transferList?: unknown): boolean;
  on(name: string, cb: (...args: unknown[]) => void): unknown;
  close(): void;
  ref(): void;
  unref(): void;
  hasRef(): boolean;
}

function formatUncaught(err: unknown): string {
  const e = err as { stack?: string; message?: string };
  return (e?.stack ?? e?.message ?? String(err)) + '\n';
}

export function createWorkerHost(deps: WorkerHostDeps): WorkerHost {
  // Captured before the sandbox shadows globals so the settle poll runs on the
  // host timer queue and never shows up in any sandbox timer count.
  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis) as (fn: () => void, ms: number) => unknown;
  const defer = deps.defer ?? ((fn: () => void) => void nativeSetTimeout(fn, 0));

  const workers = new Set<Worker>();
  const environmentData = new Map<unknown, unknown>();
  let nextThreadId = FIRST_THREAD_ID;

  class Worker implements WorkerHandle {
    readonly threadId: number;
    readonly #request: WorkerRequest;
    readonly #threadName: string;

    /** The parent's end of the worker's port pair. */
    #port: PortLike | null = null;
    /** The worker's end (`parentPort`), kept so `terminate` can close it. */
    #workerPort: PortLike | null = null;

    #onlineCbs: Array<() => void> = [];
    #messageCbs: Array<(value: unknown) => void> = [];
    #messageErrorCbs: Array<(err: unknown) => void> = [];
    #errorCbs: Array<(err: unknown) => void> = [];
    #exitCbs: Array<(code: number) => void> = [];

    #started = false;
    #exited = false;
    #exitCode: number | null = null;
    #refed = true;
    /** Outstanding one-shot timers and intervals the worker itself scheduled. */
    #timers = new Set<unknown>();
    #settleScheduled = false;
    #onlineEmitted = false;

    constructor(request: WorkerRequest) {
      this.threadId = nextThreadId++;
      this.#request = request;
      this.#threadName = request.name;

      // The port pair exists from construction, so a `postMessage` sent before
      // the worker has started is queued on its end and delivered when it does —
      // the ordering Node gives a worker that has not yet sent `upAndRunning`.
      const { MessageChannel } = deps.realm().require('internal/worker/io') as {
        MessageChannel: new () => { port1: PortLike; port2: PortLike };
      };
      const channel = new MessageChannel();
      this.#port = channel.port1;
      this.#workerPort = channel.port2;
      channel.port1.on('message', (value: unknown) => this.#deliver(value));
      channel.port1.on('messageerror', (err: unknown) => {
        for (const cb of this.#messageErrorCbs.slice()) cb(err);
      });
    }

    get threadName(): string | null {
      return this.#request.name;
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

    // ---- event subscription -------------------------------------------------

    #sub<T>(list: T[], cb: T): () => void {
      list.push(cb);
      return () => {
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
      };
    }

    onOnline(cb: () => void): () => void {
      if (this.#onlineEmitted) {
        defer(cb);
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
        defer(() => cb(this.#exitCode ?? 0));
        return () => undefined;
      }
      return this.#sub(this.#exitCbs, cb);
    }

    // ---- messaging ----------------------------------------------------------

    postMessage(value: unknown, transferList?: unknown): void {
      // Node's handle is gone after exit, so the send is a no-op rather than an
      // error (`Worker#postMessage` uses an optional-call on `this[kHandle]`).
      if (this.#exited || this.#port === null) return;
      this.#port.postMessage(value, transferList);
    }

    eventLoopUtilization(): unknown {
      const perf = deps.realm().require('perf_hooks') as {
        performance: { eventLoopUtilization: () => unknown };
      };
      return perf.performance.eventLoopUtilization();
    }

    // ---- lifecycle ----------------------------------------------------------

    ref(): void {
      this.#refed = true;
      this.#port?.ref();
    }

    unref(): void {
      this.#refed = false;
      this.#port?.unref();
    }

    hasRef(): boolean {
      return this.#refed;
    }

    /** `worker.terminate()`: stop the worker and resolve with its exit code. */
    terminate(): Promise<number> | undefined {
      // Node returns `undefined` once the worker is gone (its handle is null).
      if (this.#exited) return undefined;
      this.#stop(1, null);
      return Promise.resolve(1);
    }

    /** Handler for a message arriving from the worker. */
    #deliver(value: unknown): void {
      for (const cb of this.#messageCbs.slice()) cb(value);
      this.#scheduleSettle();
    }

    #fail(err: unknown): void {
      for (const cb of this.#errorCbs.slice()) cb(err);
    }

    #scheduleSettle(): void {
      if (this.#settleScheduled || this.#exited) return;
      this.#settleScheduled = true;
      defer(() => {
        this.#settleScheduled = false;
        if (this.#exited) return;
        // The worker is done once its entry returned, it scheduled no further
        // work of its own, and nothing is holding its parent port open. Only the
        // worker's *own* timers count — an unrelated timer on the shared loop
        // must not keep it alive (that is why this is not a global delta).
        const portOpen = this.#workerPort !== null && this.#workerPort.hasRef();
        if (!portOpen && this.#timers.size === 0) {
          this.#stop(0, null);
          return;
        }
        this.#scheduleSettle();
      });
    }

    #stop(code: number, _err: unknown): void {
      if (this.#exited) return;
      this.#exited = true;
      this.#exitCode = code;
      workers.delete(this);
      try {
        this.#workerPort?.close();
        this.#port?.close();
      } catch {
        /* the port may already be gone */
      }
      const cbs = this.#exitCbs;
      this.#exitCbs = [];
      for (const cb of cbs) cb(code);
    }

    // ---- startup ------------------------------------------------------------

    /**
     * Build the worker's globals + module registry and run its entry.
     *
     * Deferred to a macrotask by the caller so the parent finishes wiring its
     * listeners (`worker.on('message', …)`) before the worker can post — the same
     * "constructor returns, thread starts behind it" ordering Node has.
     */
    start(): void {
      if (this.#started) return;
      const parentPort = this.#port as PortLike;
      const workerPort = this.#workerPort as PortLike;

      this.#started = true;
      workers.add(this);

      // `online` fires once the worker is up, before its script runs — the same
      // place Node's `upAndRunning` message lands. It is already asynchronous
      // with respect to the constructor (this whole method is deferred), which
      // is what lets the parent attach its listeners first.
      this.#onlineEmitted = true;
      const onlineCbs = this.#onlineCbs;
      this.#onlineCbs = [];
      for (const cb of onlineCbs) cb();

      try {
        this.#runEntry(workerPort);
      } catch (err) {
        if (err instanceof WorkerExit) {
          this.#stop(err.code, null);
        } else {
          this.#fail(err);
          this.#stop(1, err);
        }
        return;
      }
      if (!this.#exited) this.#scheduleSettle();
    }

    /** Attribute a throwing callback to this worker instead of the whole tab. */
    #guard(fn: () => void): void {
      if (this.#exited) return;
      try {
        fn();
      } catch (err) {
        if (err instanceof WorkerExit) {
          this.#stop(err.code, null);
          return;
        }
        this.#fail(err);
        this.#stop(1, err);
      }
    }

    #runEntry(workerPort: PortLike): void {
      const realm = deps.realm();
      const request = this.#request;
      const workerThreads = this.#workerThreadsView(workerPort);
      const workerProcess = this.#workerProcess();

      const parentGlobals = deps.globals();
      const globals: Record<string, unknown> = { ...parentGlobals, process: workerProcess };
      globals.global = globals;
      globals.globalThis = globals;
      this.#wrapTimers(globals, workerProcess);

      const Ctor = deps.loader().constructor as new (
        r: Realm,
        v: Vfs,
        g: Record<string, unknown>,
      ) => ModuleLoader;
      const loader = new Ctor(realm, deps.vfs, globals);
      loader.setAliases(deps.aliases());
      loader.setBuiltinOverrides({
        worker_threads: workerThreads,
        'node:worker_threads': workerThreads,
        process: workerProcess,
      });
      loader.loadModule(request.filename);
    }

    /**
     * Wrap the worker's timer surface so two things hold: a throwing callback is
     * attributed to *this* worker, and the worker's pending timers are counted so
     * `#scheduleSettle` knows when it is truly done.
     */
    #wrapTimers(globals: Record<string, unknown>, workerProcess: Record<string, unknown>): void {
      const timers = deps.realm().require('timers') as {
        setTimeout(fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]): number;
        setInterval(fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]): number;
        setImmediate(fn: (...a: unknown[]) => void, ...a: unknown[]): number;
        clearTimeout(id: number): void;
        clearInterval(id: number): void;
        clearImmediate(id: number): void;
      };
      const schedule =
        (kind: 'setTimeout' | 'setInterval' | 'setImmediate', oneShot: boolean) =>
        (...args: unknown[]): number => {
          const fn = args[0];
          if (typeof fn !== 'function') throw new TypeError(`${kind} requires a function`);
          let id: unknown;
          const wrapped = (...callArgs: unknown[]) => {
            if (oneShot) this.#timers.delete(id);
            this.#guard(() => (fn as (...a: unknown[]) => void)(...callArgs));
          };
          id = timers[kind](wrapped, ...(args.slice(1) as [number]));
          this.#timers.add(id);
          return id as number;
        };
      globals.setTimeout = schedule('setTimeout', true);
      globals.setImmediate = schedule('setImmediate', true);
      globals.setInterval = schedule('setInterval', false);
      const clears = {
        clearTimeout: timers.clearTimeout,
        clearInterval: timers.clearInterval,
        clearImmediate: timers.clearImmediate,
      };
      for (const kind of ['clearTimeout', 'clearInterval', 'clearImmediate'] as const) {
        const delegate = clears[kind];
        globals[kind] = (id: number): void => {
          this.#timers.delete(id);
          delegate.call(timers, id);
        };
      }
      globals.queueMicrotask = (fn: unknown): void => {
        if (typeof fn !== 'function') throw new TypeError('queueMicrotask requires a function');
        queueMicrotask(() => this.#guard(fn as () => void));
      };
      workerProcess.nextTick = (fn: unknown, ...rest: unknown[]): void => {
        if (typeof fn !== 'function') throw new TypeError('process.nextTick requires a function');
        queueMicrotask(() => this.#guard(() => (fn as (...a: unknown[]) => void)(...rest)));
      };
    }

    /** The worker-side `worker_threads` module (its own `parentPort`/`workerData`). */
    #workerThreadsView(workerPort: PortLike): Record<string, unknown> {
      const realm = deps.realm();
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
      const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');
      return {
        isInternalThread: false,
        isMainThread: false,
        MessagePort: io.MessagePort,
        MessageChannel: io.MessageChannel,
        BroadcastChannel: io.BroadcastChannel,
        receiveMessageOnPort: io.receiveMessageOnPort,
        markAsUncloneable: io.markAsUncloneable,
        moveMessagePortToContext: io.moveMessagePortToContext,
        markAsUntransferable: buffer.markAsUntransferable,
        isMarkedAsUntransferable: buffer.isMarkedAsUntransferable,
        SHARE_ENV,
        threadId: this.threadId,
        threadName: this.#threadName,
        parentPort: workerPort,
        workerData: this.#request.workerData,
        resourceLimits: {},
        setEnvironmentData: (key: unknown, value: unknown): void => {
          if (value === undefined) environmentData.delete(key);
          else environmentData.set(key, value);
        },
        getEnvironmentData: (key: unknown): unknown => environmentData.get(key),
        Worker: class Worker {
          constructor() {
            throw notImplemented(
              'api',
              'worker_threads.Worker',
              'Nested workers are not supported: this runtime runs a single cooperative worker registry.',
            );
          }
        },
        postMessageToThread: () => {
          throw notImplemented('api', 'worker_threads.postMessageToThread', 'There are no other threads to message.');
        },
      };
    }

    /** The worker's `process` view: a copy that exits the worker, not the tab. */
    #workerProcess(): Record<string, unknown> {
      const parent = deps.realm().require('process') as Record<string, unknown>;
      const Ctor = parent.constructor as new () => Record<string, unknown>;
      const proc = new Ctor();
      proc.argv = this.#request.argv;
      proc.argv0 = deps.execPath;
      proc.env = this.#request.env;
      proc.execArgv = this.#request.execArgv;
      proc.exit = (code?: number): void => {
        throw new WorkerExit(code ?? 0);
      };
      return proc;
    }

    /** Called by `process.exit` from inside the worker's async phase. */
    requestExit(code: number): void {
      this.#stop(code, null);
    }
  }

  return {
    create(req: WorkerRequest): WorkerHandle {
      const worker = new Worker(req);
      defer(() => worker.start());
      return worker;
    },
    get activeWorkers(): number {
      let n = 0;
      for (const w of workers) if (w.refed && !w.exited) n += 1;
      return n;
    },
    environmentData,
    reset(): void {
      for (const w of [...workers]) w.terminate();
      workers.clear();
    },
  };
}
