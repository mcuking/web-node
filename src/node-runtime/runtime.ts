import type { BindingContext } from './bindings/context';
import type { Vfs } from './vfs';
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

export interface RuntimeOptions {
  vfs: Vfs;
  argv?: string[];
  env?: Record<string, string>;
  execPath?: string;
  /** Also assign runtime globals onto the real globalThis (browser worker use). */
  installGlobals?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
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
  readonly process: Record<string, unknown>;
  readonly console: Record<string, unknown>;
  readonly Buffer: unknown;

  #timers = new Map<number, ReturnType<typeof nativeSetTimeout>>();
  #nextTimerId = 1;
  #exitCode: number | null = null;

  constructor(opts: RuntimeOptions) {
    this.vfs = opts.vfs;
    const argv = opts.argv ?? [];
    const env = opts.env ?? {};
    const onStdout = opts.onStdout ?? (() => undefined);
    const onStderr = opts.onStderr ?? (() => undefined);

    const bindingCtx: BindingContext = {
      vfs: opts.vfs,
      network: new VirtualNetwork(),
      env,
      argv,
      execPath: opts.execPath ?? '/bin/node',
      writeStdout: onStdout,
      writeStderr: onStderr,
      exit: (code: number) => {
        this.#exitCode = code;
        throw new ProcessExit(code);
      },
      nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
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
        activeCount: () => this.#timers.size,
      },
      now: () => performance.now(),
      hrtime: () => {
        const ns = Math.round(performance.now() * 1e6);
        return [Math.floor(ns / 1e9), ns % 1e9];
      },
    };
    this.bindingCtx = bindingCtx;
    this.network = bindingCtx.network;

    this.realm = new Realm(bindingCtx);
    this.loader = new ModuleLoader(this.realm, opts.vfs);
    // Native-binary tools are aliased to their WASM counterparts: a browser tab
    // cannot load a .node addon, so `require('rollup')`/`require('esbuild')`
    // resolve to the WASM builds that ship the same public API.
    this.loader.setAliases({ rollup: '@rollup/wasm-node', esbuild: 'esbuild-wasm' });
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
    this.console = this.realm.require('console') as Record<string, unknown>;
    this.Buffer = (this.realm.require('buffer') as { Buffer: unknown }).Buffer;

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
    return this.#timers.size;
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
    this.#exitCode = null;
  }

  #clearAllTimers(): void {
    for (const id of [...this.#timers.keys()]) this.#clearTimer(id);
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
    opts: { cwd?: string; includeDev?: boolean; onLog?: (message: string) => void; fetch?: FetchLike } = {},
  ): Promise<InstallResult> {
    const fetchImpl = opts.fetch ?? (typeof fetch === 'function' ? (fetch.bind(globalThis) as unknown as FetchLike) : undefined);
    if (!fetchImpl) throw new Error('npm install requires a fetch implementation');
    return installProject(this.vfs, {
      cwd: opts.cwd ?? this.vfs.cwd,
      fetch: fetchImpl,
      includeDev: opts.includeDev ?? false,
      log: opts.onLog,
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
