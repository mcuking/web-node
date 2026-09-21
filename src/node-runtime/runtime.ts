import type { BindingContext } from './bindings/context';
import type { Vfs } from './vfs';
import type { ProcessHost } from './proc/host';
import type { WorkerHost } from './proc/worker';
import { createProcessHost } from './proc/host';
import { createWorkerHost } from './proc/worker';
import { triggerUncaughtException } from './bindings/uncaught';
import { VirtualNetwork } from './net/network';
import { Realm } from './realm';
import { ModuleLoader } from './loader';
import * as p from './vfs/posix';
import { installProject, type FetchLike, type InstallResult } from './npm';

/** Thrown by `process.exit()` to unwind the call stack back to the runner. */
export class ProcessExit extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExit';
    this.code = code;
  }
}

// Capture the host timers *before* installGlobals() can shadow them, otherwise
// our timer bindings would call themselves through globalThis.setTimeout.
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);

/** A node in the vendored `internal/timers.js` linked lists (only what reset needs). */
interface TimerNode {
  _idleNext: TimerNode | null;
  _idlePrev: TimerNode | null;
}

/**
 * Seed a bootstrap `process` global when the host has none.
 *
 * Node's `lib/internal/util.js` reads `process.versions` / `process.platform`
 * at *load* time, and it is reached while `process` itself is still being built
 * (`process` → `events` → `internal/util`). A native embedder has `process`
 * from the very first line; a browser worker does not, so the load throws
 * `ReferenceError: process is not defined`. Seed just enough of a stand-in for
 * that load-time read; `#installGlobals()` replaces it with the real process
 * object once construction completes, and every later `process.x` read resolves
 * through `globalThis` to the real one.
 *
 * The stand-in mirrors the real process's `platform` and an empty `versions`
 * (this runtime has no OpenSSL/Amaro), so `internal/util.js`'s `noCrypto` /
 * `noTypeScript` / `isWindows` are computed the same way here as in the final
 * object. Skipped when the host already exposes `process` (Node, Vitest).
 */
function seedBootstrapProcess(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.process !== undefined) return;
  const noop = (): void => undefined;
  g.process = {
    versions: {},
    platform: 'linux',
    arch: 'wasm32',
    env: {},
    argv: [],
    version: 'v26.9.1',
    cwd: () => '/',
    nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]): void => {
      queueMicrotask(() => fn(...args));
    },
    emitWarning: noop,
    stdout: { write: () => true, isTTY: false },
    stderr: { write: () => true, isTTY: false },
  };
}
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const nativeSetInterval = globalThis.setInterval.bind(globalThis);
const nativeClearInterval = globalThis.clearInterval.bind(globalThis);

/**
 * Browser/worker globals mirrored onto the sandbox object so that user code
 * (and bundled libraries) can reach them through `globalThis.X`. Copied only
 * when the host defines them, so this stays a no-op under Node/Vitest.
 */
const HOST_GLOBALS = [
  'crypto',
  'performance',
  'WebAssembly',
  'TextEncoder',
  'TextDecoder',
  'URL',
  'URLSearchParams',
  'Blob',
  'File',
  'FormData',
  'Headers',
  'Request',
  'Response',
  'fetch',
  'WebSocket',
  'Worker',
  'MessageChannel',
  'MessagePort',
  'BroadcastChannel',
  'structuredClone',
  'atob',
  'btoa',
  'AbortController',
  'AbortSignal',
  'Event',
  'EventTarget',
  'location',
  'navigator',
  'self',
  'origin',
  'caches',
];

/**
 * Native-binary tools are aliased to their WASM counterparts: a browser tab can
 * not load a .node addon, so `require('rollup')`/`require('esbuild')` resolve to
 * the WASM builds that ship the same public API. Module constant so spawned
 * programs can inherit exactly the same map.
 */
const MODULE_ALIASES: Record<string, string> = {
  rollup: '@rollup/wasm-node',
  esbuild: 'esbuild-wasm',
};

export interface RuntimeOptions {
  vfs: Vfs;
  argv?: string[];
  env?: Record<string, string>;
  execPath?: string;
  /** Also assign runtime globals onto the real globalThis (browser worker use). */
  installGlobals?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /** Fired when a spawned program starts or finishes (diagnostics only). */
  onChildEvent?: (event: { type: 'spawn' | 'exit'; pid: number; command: string; code?: number | null }) => void;
}

interface TimerHandle {
  kind: 'timeout' | 'interval' | 'immediate';
}

/**
 * Creates a Node-flavoured runtime over a VFS.
 *
 * Ordering matters and mirrors Node's bootstrap: bindings → realm → primordials
 * → core modules → globals → loader.
 */
export class NodeRuntime {
  readonly vfs: Vfs;
  readonly realm: Realm;
  readonly loader: ModuleLoader;
  readonly bindingCtx: BindingContext;
  readonly network: VirtualNetwork;
  /** The controlled spawn surface (`child_process` + npm lifecycle scripts). */
  readonly spawn: ProcessHost;
  /** The worker surface (`worker_threads.Worker`). */
  readonly workers: WorkerHost;
  readonly process: Record<string, unknown>;
  readonly console: Record<string, unknown>;
  readonly Buffer: unknown;

  #timers = new Map<number, ReturnType<typeof nativeSetTimeout>>();
  /** In-flight host requests (see `#trackHostRequest`); part of `activeCount`. */
  #hostRequests = 0;
  /** Open host WebSockets (see `#trackHostSocket`); part of `activeCount`. */
  #hostSockets = 0;
  /** Bumped per run so a host request/socket abandoned by a previous run can
   * not leak its count into the next one (or drive it negative once it settles). */
  #hostGeneration = 0;
  #nextTimerId = 1;
  #exitCode: number | null = null;
  #nextTickQueue: Array<() => void> = [];
  #nextTickScheduled = false;

  constructor(opts: RuntimeOptions) {
    // Must run before anything materialises a module: `internal/util.js` (a
    // dependency of `events`, itself a dependency of `process`) reads `process`
    // at load time. See `seedBootstrapProcess`.
    seedBootstrapProcess();
    this.vfs = opts.vfs;
    const argv = opts.argv ?? [];
    const env = opts.env ?? {};
    const onStdout = opts.onStdout ?? (() => undefined);
    const onStderr = opts.onStderr ?? (() => undefined);
    const execPath = opts.execPath ?? '/bin/node';

    // The spawn surface is created before the realm, but it only reaches the
    // realm/loader lazily (through the closures below), so the ordering is safe.
    const spawn = createProcessHost({
      vfs: opts.vfs,
      realm: () => this.realm,
      loader: () => this.loader,
      globals: () => this.sandboxGlobals,
      aliases: () => ({ ...MODULE_ALIASES }),
      activeCount: () => this.#activeWorkCount(),
      execPath,
      baseEnv: env,
      onChildEvent: (event) => opts.onChildEvent?.(event),
    });

    // The worker surface, built exactly like the spawn surface: it reaches the
    // realm/loader lazily so it can be constructed before them.
    const workers = createWorkerHost({
      vfs: opts.vfs,
      realm: () => this.realm,
      loader: () => this.loader,
      globals: () => this.sandboxGlobals,
      aliases: () => ({ ...MODULE_ALIASES }),
      execPath,
      baseEnv: env,
    });

    const bindingCtx: BindingContext = {
      vfs: opts.vfs,
      network: new VirtualNetwork(),
      spawn,
      workers,
      env,
      argv,
      execPath,
      // Evaluated lazily (after `this.realm` is assigned) so bindings such as
      // `util.defineLazyProperties` can reach the module registry.
      requireBuiltin: (id: string) => this.realm.require(id),
      writeStdout: onStdout,
      writeStderr: onStderr,
      exit: (code: number) => {
        this.#exitCode = code;
        throw new ProcessExit(code);
      },
      // Node's `process.nextTick` is its own queue that drains to exhaustion
      // before any promise microtask runs (and before the event loop turns).
      // A bare `queueMicrotask` would interleave nested nextTicks behind
      // already-queued promise jobs, which reorders stream/lifecycle events.
      nextTick: (fn, ...args) => {
        this.#nextTickQueue.push(() => fn(...args));
        this.#scheduleNextTickDrain();
      },
      timers: {
        setTimeout: (fn, ms, ...args) => {
          const id = this.#nextTimerId++;
          const handle = nativeSetTimeout(() => {
            this.#timers.delete(id);
            fn(...args);
          }, Math.max(1, ms || 0));
          this.#timers.set(id, handle);
          return id;
        },
        clearTimeout: (id) => this.#clearTimer(id),
        setInterval: (fn, ms, ...args) => {
          const id = this.#nextTimerId++;
          const handle = nativeSetInterval(() => fn(...args), Math.max(1, ms || 0));
          this.#timers.set(id, handle);
          return id;
        },
        clearInterval: (id) => this.#clearTimer(id),
        setImmediate: (fn, ...args) => {
          const id = this.#nextTimerId++;
          const handle = nativeSetTimeout(() => {
            this.#timers.delete(id);
            fn(...args);
          }, 0);
          this.#timers.set(id, handle);
          return id;
        },
        clearImmediate: (id) => this.#clearTimer(id),
        activeCount: () => this.#activeWorkCount(),
      },
      now: () => performance.now(),
      hrtime: () => {
        const ns = Math.round(performance.now() * 1e6);
        return [Math.floor(ns / 1e9), ns % 1e9];
      },
      // `exceptionHandlerState` of lib/internal/process/execution.js: shared so
      // the process setters and the errors/util dispatchers agree on one state.
      uncaughtCapture: {
        captureFn: null,
        auxiliaryCallbacks: [],
        reportFlag: false,
        shouldAbortOnUncaught: new Uint8Array(1),
      },
      // The libuv handle names `process.getActiveResourcesInfo()` reports. Node
      // enumerates its live handles in C++; here the live timer queue plus the
      // listening sockets of the virtual network are the resources that hold
      // the loop open.
      activeResources: () => {
        const timersBinding = this.realm?.internalBinding('timers') as
          | { __activeResources?: () => string[] }
          | undefined;
        return [...(timersBinding?.__activeResources?.() ?? []), ...bindingCtx.network.activeResources()];
      },
    };
    this.bindingCtx = bindingCtx;
    this.network = bindingCtx.network;
    this.spawn = spawn;
    this.workers = workers;

    this.realm = new Realm(bindingCtx);
    this.loader = new ModuleLoader(this.realm, opts.vfs);
    // Native-binary tools are aliased to their WASM counterparts: a browser tab
    // cannot load a .node addon, so `require('rollup')`/`require('esbuild')`
    // resolve to the WASM builds that ship the same public API. Spawned programs
    // inherit the same aliases, which is why the map is a module constant.
    this.loader.setAliases(MODULE_ALIASES);
    // `module.createRequire(...)` needs more than a lookup: bundled tooling calls
    // `require.resolve(id)` to map an id to a path without loading it.
    const loader = this.loader;
    this.realm.setUserRequire(
      Object.assign((from: string, id: string) => loader.require(from, id), {
        resolve: (from: string, id: string, options?: { paths?: string[] }) =>
          loader.resolve(id, options?.paths?.[0] ?? p.dirname(from), 'require'),
      }),
    );

    this.process = this.realm.require('process') as Record<string, unknown>;
    // Node seeds `NODE_DEBUG` handling from `internal/process/pre_execution.js`
    // before any user code runs. Now that `internal/util/debuglog` is the real
    // vendored module, the same initialisation is required here — otherwise the
    // first `debug(...)` call touches an uninitialised `debugImpls` and throws.
    (
      this.realm.require('internal/util/debuglog') as { initializeDebugEnv: (env?: string) => void }
    ).initializeDebugEnv((this.process.env as Record<string, string | undefined> | undefined)?.NODE_DEBUG);
    this.console = this.realm.require('console') as Record<string, unknown>;
    // Node's `initializeGlobalConsole` (internal/process/pre_execution.js) binds the
    // global console's streams lazily to `process`. We do the same binding, but
    // with *our* sandbox process: vendored modules read the free `process` global,
    // which under Node/Vitest is the host process (tests run with
    // `installGlobals: false`), so letting the module pick it up would route console
    // output to the host instead of the runtime's stdout sink. The snapshot/
    // inspector half of `initializeGlobalConsole` is a no-op here (`hasInspector`
    // is false), so only this step is reproduced.
    const consoleConstructor = this.realm.require('internal/console/constructor') as {
      kBindStreamsLazy: symbol;
    };
    (this.console as Record<symbol, (object: unknown) => void>)[consoleConstructor.kBindStreamsLazy](this.process);
    this.Buffer = (this.realm.require('buffer') as { Buffer: unknown }).Buffer;

    // Node's bootstrap hands `internal/async_hooks`' `nativeHooks` to the
    // `async_wrap` binding (`setupHooks(...)` in lib/internal/bootstrap/node.js).
    // Doing the same here is what lets a queued `destroy` reach the JS hook
    // implementation instead of being dropped.
    const asyncHooks = this.realm.require('internal/async_hooks') as { nativeHooks: unknown };
    (this.realm.internalBinding('async_wrap') as { setupHooks: (h: unknown) => void }).setupHooks(asyncHooks.nativeHooks);

    // Node installs the timer callbacks last during bootstrap
    // (lib/internal/bootstrap/node.js): `getTimerCallbacks(runNextTicks)` builds
    // the queue runners and `setupTimers` hands them to C++, whose libuv timers
    // invoke them. Without this step the vendored timers never fire.
    const internalTimers = this.realm.require('internal/timers') as {
      getTimerCallbacks: (runNextTicks: () => void) => {
        processImmediate: () => void;
        processTimers: (now: number) => number;
      };
    };
    const { processImmediate, processTimers } = internalTimers.getTimerCallbacks(() => this.#runNextTicks());
    (
      this.realm.internalBinding('timers') as {
        setupTimers: (immediate: () => void, timers: (now: number) => number) => void;
      }
    ).setupTimers(processImmediate, processTimers);

    // Build the sandbox global object shared by all user modules. This is what
    // makes `process` / `Buffer` / `console` resolve inside user code without
    // touching the host realm's globals (which matters under Vitest).
    const timers = this.realm.require('timers') as Record<string, unknown>;
    const sandboxGlobal: Record<string, unknown> = {
      process: this.process,
      Buffer: this.Buffer,
      console: this.console,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      setImmediate: timers.setImmediate,
      clearImmediate: timers.clearImmediate,
      queueMicrotask: (fn: () => void) => queueMicrotask(fn),
    };
    sandboxGlobal.global = sandboxGlobal;
    sandboxGlobal.globalThis = sandboxGlobal;
    // Because `globalThis` inside user modules is the sandbox object, the
    // browser/worker globals a tab legitimately has (and that libraries like
    // esbuild-wasm reach through `globalThis.X`) must be mirrored onto it.
    // Node's own global has none of these; only copy what the host provides.
    for (const name of HOST_GLOBALS) {
      const value = (globalThis as unknown as Record<string, unknown>)[name];
      if (value !== undefined) sandboxGlobal[name] = value;
    }
    // `fetch` is the one host API a sandboxed program can park on, and the
    // request outlives the synchronous return: wrap it so an in-flight request
    // counts as live work (see `#trackHostRequest`).
    const hostFetch = (globalThis as unknown as Record<string, unknown>).fetch;
    if (typeof hostFetch === 'function') {
      const boundFetch = (hostFetch as (...a: unknown[]) => unknown).bind(globalThis);
      sandboxGlobal.fetch = (...args: unknown[]): Promise<unknown> =>
        this.#trackHostRequest(Promise.resolve(boundFetch(...args)));
    }
    // A WebSocket is another host API that outlives the synchronous return: it
    // is a long-lived handle, and an open socket keeps the process alive in real
    // Node (verified against v26.9.0). The host constructor has no idea it is
    // running inside a child that gets settled by an active-work delta, so wrap
    // it and count each open socket until it closes (see `#trackHostSocket`).
    const hostWebSocket = (globalThis as unknown as Record<string, unknown>).WebSocket;
    if (typeof hostWebSocket === 'function') {
      sandboxGlobal.WebSocket = this.#wrapHostSocket(hostWebSocket);
    }
    // `Blob`/`File` are ours, not the host's: Node exposes them from
    // `internal/blob` + `internal/file` (bootstrap/web), and the vendored
    // `internal/streams/duplexify` gates its Blob path on the real `isBlob`. If
    // user code created the host realm's Blob instead, that check would miss,
    // so the global and the module must agree on identity.
    try {
      const blob = this.realm.require('internal/blob') as { Blob?: unknown };
      if (blob.Blob !== undefined) sandboxGlobal.Blob = blob.Blob;
      const file = this.realm.require('internal/file') as { File?: unknown };
      if (file.File !== undefined) sandboxGlobal.File = file.File;
    } catch {
      /* keep the host's Blob/File if the vendored modules are unavailable */
    }
    // `self` only exists in a browser/worker host; browser-targeted libraries
    // rely on it. Under Node (tests) alias it to the real global so those
    // libraries still find crypto/performance/TextEncoder through it.
    if (sandboxGlobal.self === undefined) sandboxGlobal.self = globalThis;
    this.loader.setGlobals(sandboxGlobal);
    this.sandboxGlobals = sandboxGlobal;

    if (opts.installGlobals !== false) {
      this.#installGlobals(sandboxGlobal);
    }
  }

  readonly sandboxGlobals: Record<string, unknown>;

  get exitCode(): number | null {
    return this.#exitCode;
  }

  #scheduleNextTickDrain(): void {
    if (this.#nextTickScheduled) return;
    this.#nextTickScheduled = true;
    queueMicrotask(() => {
      this.#nextTickScheduled = false;
      this.#drainNextTicks();
    });
  }

  /**
   * Drain the nextTick queue to exhaustion. A tick queued while draining runs in
   * the same pass, which is what makes nested `process.nextTick` stay ahead of
   * promise jobs — the ordering streams depend on.
   */
  #drainNextTicks(): void {
    while (this.#nextTickQueue.length > 0) {
      const batch = this.#nextTickQueue;
      this.#nextTickQueue = [];
      for (let i = 0; i < batch.length; i++) {
        // A throw in a tick callback is an uncaught exception in Node, not a
        // reason to abandon the rest of the queue: report it, then keep going.
        try {
          batch[i]();
        } catch (err) {
          triggerUncaughtException(this.bindingCtx, err);
        }
      }
    }
  }

  /**
   * `runNextTicks`, as `internal/timers.js` expects it: run the tick queue
   * synchronously between timer lists (lib/internal/bootstrap/node.js passes the
   * `setupTaskQueue()` version to `getTimerCallbacks`).
   */
  #runNextTicks(): void {
    this.#drainNextTicks();
  }

  /**
   * Pending asynchronous work: the runtime's own host-timer surface (the spawn
   * host defers on) plus whatever the vendored `internal/timers.js` queue still
   * holds. `proc/host.ts` uses this to decide whether a spawned child is done.
   */
  #activeWorkCount(): number {
    const timers = this.realm?.internalBinding('timers') as { __liveCount?: () => number } | undefined;
    return (
      this.#timers.size +
      (timers?.__liveCount?.() ?? 0) +
      this.#hostRequests +
      this.#hostSockets +
      (this.workers?.activeWorkers ?? 0)
    );
  }

  /**
   * Count a promise that belongs to the *host* as live work for as long as it is
   * pending.
   *
   * The sandbox timer queue can only see timers the sandbox itself created. A
   * host request — a real `fetch()`, the one such API a sandboxed program gets —
   * lives on the host's event loop, so a child whose only remaining work is that
   * request would look idle and be reported as exited before the response lands.
   * Counting it here closes that gap. (Grounded in real Node: an in-flight
   * `fetch` keeps the process alive until it settles, whereas `crypto.subtle`
   * and `Blob.arrayBuffer()` — which resolve on the microtask queue — do not,
   * and so are deliberately *not* tracked.)
   */
  #trackHostRequest<T>(promise: Promise<T>): Promise<T> {
    const generation = this.#hostGeneration;
    this.#hostRequests += 1;
    const release = (): void => {
      // A host request left pending when its run ended is no longer this
      // process's work: drop its count without touching the current run's.
      if (generation === this.#hostGeneration) this.#hostRequests -= 1;
    };
    void promise.then(release, release);
    return promise;
  }

  /**
   * Count an open host WebSocket as live work for as long as it is open.
   *
   * Like an in-flight `fetch`, a WebSocket lives on the host's event loop and so
   * is invisible to the sandbox timer queue: a child whose only remaining work
   * is a socket would be reported as exited while the socket is still open, and
   * any message it delivers afterwards would be lost. Real Node treats an open
   * socket as an active handle that keeps the process alive, so count it here.
   *
   * The count is released on the first of `close`/`error` (a failed connection
   * fires both, in that order, so the release is guarded to fire once).
   */
  #trackHostSocket(socket: { addEventListener?: (type: string, listener: () => void) => void }): void {
    const generation = this.#hostGeneration;
    this.#hostSockets += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      // A socket left open when its run ended is no longer this process's work.
      if (generation === this.#hostGeneration) this.#hostSockets -= 1;
    };
    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('close', release);
      socket.addEventListener('error', release);
    }
  }

  /**
   * Wrap the host `WebSocket` so each constructed socket is tracked. The wrapper
   * returns the real socket (a plain constructor's return value overrides
   * `this`), keeps `instanceof` working by sharing the prototype, and copies the
   * static `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED` constants — leaving a socket
   * that behaves exactly like the host's except that the runtime can see it.
   */
  #wrapHostSocket(host: unknown): unknown {
    type SocketCtor = { new (url: unknown, protocols?: unknown): unknown; prototype: object };
    const Ctor = host as SocketCtor;
    const runtime = this;
    function WrappedCtor(this: unknown, url: unknown, protocols?: unknown): unknown {
      if (new.target === undefined) {
        throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator.");
      }
      // `protocols` is optional: passing `undefined` explicitly is not the same
      // as omitting it for every implementation, so branch on the argument count.
      const socket = arguments.length > 1 ? new Ctor(url, protocols) : new Ctor(url);
      runtime.#trackHostSocket(socket as { addEventListener?: (t: string, l: () => void) => void });
      return socket;
    }
    WrappedCtor.prototype = Ctor.prototype;
    for (const key of Object.getOwnPropertyNames(Ctor)) {
      if (key === 'prototype' || key === 'length' || key === 'name' || key === 'arguments' || key === 'caller') continue;
      const desc = Object.getOwnPropertyDescriptor(Ctor, key);
      if (desc !== undefined) Object.defineProperty(WrappedCtor, key, desc);
    }
    Object.defineProperty(WrappedCtor, 'name', { value: 'WebSocket', configurable: true });
    return WrappedCtor;
  }

  #installGlobals(sandboxGlobal: Record<string, unknown>): void {
    const g = globalThis as unknown as Record<string, unknown>;
    for (const key of ['process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate']) {
      g[key] = sandboxGlobal[key];
    }
    g.global = globalThis;
  }

  #clearTimer(id: number): void {
    const handle = this.#timers.get(id);
    if (handle === undefined) return;
    nativeClearTimeout(handle);
    nativeClearInterval(handle);
    this.#timers.delete(id);
  }

  /** Number of live timers (used by the runner / tests). */
  get activeTimers(): number {
    return this.#activeWorkCount();
  }

  /**
   * Execute a module by absolute VFS path (the program entry point).
   *
   * Every call models a *fresh process*: the user module cache is dropped and
   * pending timers/exit code are cleared, so clicking Run twice actually runs
   * the program twice (Node.2 semantics). Without this, the second run returns
   * the cached entry module and the process exits immediately with no output
   * — which looked like "[process exited 1ms]".
   */
  runMain(entryPath: string): unknown {
    this.resetRunState();
    try {
      return this.loader.loadModule(entryPath);
    } catch (err) {
      if (err instanceof ProcessExit) return undefined;
      throw err;
    }
  }

  /** Reset everything that belongs to a single program execution. */
  resetRunState(): void {
    this.loader.reset();
    this.#clearAllTimers();
    this.network.reset();
    // Host requests/sockets belong to the run that started them, like every
    // other kind of pending work: a `fetch` or socket the previous program
    // abandoned must not look like live work to the next one.
    this.#hostGeneration += 1;
    this.#hostRequests = 0;
    this.#hostSockets = 0;
    // Children and workers belong to the run that started them: like teardown of
    // a process group, nothing survives into the next Run.
    this.spawn.reset();
    this.workers.reset();
    this.#exitCode = null;
  }

  #clearAllTimers(): void {
    for (const id of [...this.#timers.keys()]) this.#clearTimer(id);
    // Each `runMain` models a fresh process, so a timeout/interval the previous
    // program left pending must not fire in the next one. The queue lives in the
    // vendored `internal/timers.js`, so clear it through the *public* path: that
    // keeps its linked lists, priority queue and ref counts consistent, which a
    // raw handle cancel would not. Then drop the host handles driving it.
    const timers = this.realm.require('timers') as {
      clearTimeout: (timer: unknown) => void;
      clearImmediate: (immediate: unknown) => void;
    };
    const internals = this.realm.require('internal/timers') as {
      timerListMap: Record<string, { _idleNext: TimerNode | null }>;
      immediateQueue: { head: TimerNode | null };
    };
    for (const key of Object.keys(internals.timerListMap)) {
      const list = internals.timerListMap[key];
      let node = list._idleNext;
      while (node !== null && node !== (list as unknown as TimerNode)) {
        const next = node._idleNext;
        timers.clearTimeout(node);
        node = next;
      }
    }
    let immediate = internals.immediateQueue.head;
    while (immediate !== null) {
      const next = immediate._idleNext;
      timers.clearImmediate(immediate);
      immediate = next;
    }
    (this.realm.internalBinding('timers') as { __reset?: () => void }).__reset?.();
  }

  /**
   * npm client (milestone 4).
   *
   * Resolves the project's `package.json` dependency ranges against the npm
   * registry, downloads the tarballs and extracts them into the VFS. `fetch`
   * is injected so the runtime stays host-agnostic (browser worker vs. test
   * harness) and the installer remains unit-testable without network access.
   */
  async installDependencies(
    opts: {
      cwd?: string;
      includeDev?: boolean;
      onLog?: (message: string) => void;
      onOutput?: (chunk: Uint8Array, stream: 'stdout' | 'stderr') => void;
      runScripts?: boolean;
      fetch?: FetchLike;
      concurrency?: number;
    } = {},
  ): Promise<InstallResult> {
    const fetchImpl = opts.fetch ?? (typeof fetch === 'function' ? (fetch.bind(globalThis) as unknown as FetchLike) : undefined);
    if (!fetchImpl) throw new Error('npm install requires a fetch implementation');
    return installProject(this.vfs, {
      cwd: opts.cwd ?? this.vfs.cwd,
      fetch: fetchImpl,
      includeDev: opts.includeDev ?? false,
      log: opts.onLog,
      // Lifecycle scripts run on the same controlled spawn surface user code
      // gets, so `npm install` never needs a capability `child_process` lacks.
      host: this.spawn,
      env: { ...(this.bindingCtx.env as Record<string, string>) },
      runScripts: opts.runScripts,
      onOutput: opts.onOutput,
      concurrency: opts.concurrency,
    });
  }

  /** Introspection used by the UI. */
  describe(): {
    bindings: string[];
    modules: Array<{ id: string; origin: string; state: string }>;
    ports: number[];
  } {
    return {
      bindings: this.realm.bindingIds,
      modules: this.realm.listModules(),
      ports: this.network.ports,
    };
  }
}
