import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';

/**
 * `process` builtin. Builds the singleton the bootstrap installs as
 * `globalThis.process`.
 */
export const processSpec: BuiltinSpec = {
  id: 'process',
  aliases: ['node:process'],
  origin: 'web-node',
  deps: ['events'],
  init: (ctx: BuiltinInitContext) => {
    const EventEmitter = (ctx.require('events') as { EventEmitter: new () => unknown }).EventEmitter;
    const binding = ctx.binding;

    // Lazily loaded (see `internal/process/task_queues.js` — Node requires
    // async_hooks lazily here too), so a plain `require('process')` does not
    // pull the whole async-context machinery in.
    let asyncHooks: {
      newAsyncId: () => number;
      getDefaultTriggerAsyncId: () => number;
      emitInit: (asyncId: number, type: string, triggerAsyncId: number, resource: unknown) => void;
      emitBefore: (asyncId: number, triggerAsyncId: number, resource: unknown) => void;
      emitAfter: (asyncId: number) => void;
      emitDestroy: (asyncId: number) => void;
    } | null = null;
    const hooks = () => (asyncHooks ??= ctx.require('internal/async_hooks') as typeof asyncHooks)!;

    function makeStream(write: (s: string) => void, isTTY: boolean) {
      // `process.stdout`/`process.stderr` are real Writables, like Node's — the
      // vendored console writes through `stream.write(string, cb)` and probes
      // `listenerCount('error')`/`once`/`removeListener`, so a bare object with a
      // `write` method is not enough. `_write` drains synchronously (this is a
      // file-like sync sink, not a pipe).
      const { Writable } = ctx.require('stream') as {
        Writable: new (opts: { write: (chunk: unknown, enc: string, cb: () => void) => void }) => {
          isTTY: boolean;
          columns: number;
          rows: number;
        };
      };
      const stream = new Writable({
        write(chunk, _enc, cb) {
          write(typeof chunk === 'string' ? chunk : String(chunk));
          cb();
        },
      });
      stream.isTTY = isTTY;
      stream.columns = 80;
      stream.rows = 24;
      return stream;
    }

    /**
     * `process.stdin` is a real EventEmitter (the dev server calls `stdin.off()`
     * when it tears down its SIGTERM listener), but reading is never possible in
     * a tab — so it is an emitter that simply never emits, with `read()` → null.
     */
    class StdinStream extends (EventEmitter as new () => object) {
      isTTY = false;
      readable = true;
      fd = 0;
      read(): null {
        return null;
      }
      pause(): this {
        return this;
      }
      resume(): this {
        return this;
      }
      setEncoding(): this {
        return this;
      }
      setRawMode(): this {
        return this;
      }
      ref(): this {
        return this;
      }
      unref(): this {
        return this;
      }
    }

    const startTime = Date.now();
    // The public core-module ids (`fs`, `path`, …). `getBuiltinModule` reports
    // `undefined` for anything else, including `internal/*`, like Node.
    const builtinModuleIds = new Set(ctx.builtinModuleIds);
    const errorsCodes = (): Record<string, new (...args: unknown[]) => Error> =>
      (ctx.require('internal/errors') as { codes: Record<string, new (...args: unknown[]) => Error> }).codes;

    class Process extends (EventEmitter as new () => object) {
      argv = ['/bin/node', ...binding.argv];
      argv0 = 'node';
      execArgv: string[] = [];
      execPath = binding.execPath;
      env = binding.env;
      version = 'v26.9.1';
      versions = {
        node: '26.9.1',
        webnode: '0.1.0',
        v8: '0.0.0-web-node',
        uv: '0.0.0-web-node',
        modules: '137',
      };
      platform = 'linux';
      arch = 'wasm32';
      pid = 1;
      ppid = 0;
      title = 'node';
      exitCode: number | undefined = undefined;
      features = {
        inspector: false,
        debug: false,
        uv: false,
        ipv6: false,
        tls: false,
        tls_alpn: false,
        tls_sni: false,
        tls_ocsp: false,
        tls_psk: false,
        cached_builtins: true,
        openssl_is_boringssl: false,
        require_module: true,
        typescript: 'strip',
      };
      release = { name: 'node', sourceUrl: '', headersUrl: '' };
      config = { variables: {}, target_defaults: {}, ...({} as Record<string, unknown>) };
      allowedNodeEnvironmentFlags = new Set<string>();
      #stdout?: Record<string, unknown>;
      #stderr?: Record<string, unknown>;
      // Lazily built so requiring `stream` does not happen while `process` is
      // still being constructed (the real Node process exposes these as getters
      // for the same reason). The setters exist because the spawn host assigns a
      // pipe-backed stream onto a child's `process.stdout`/`stderr`.
      get stdout(): Record<string, unknown> {
        return (this.#stdout ??= makeStream(binding.writeStdout, false) as unknown as Record<string, unknown>);
      }
      set stdout(value: Record<string, unknown>) {
        this.#stdout = value;
      }
      get stderr(): Record<string, unknown> {
        return (this.#stderr ??= makeStream(binding.writeStderr, false) as unknown as Record<string, unknown>);
      }
      set stderr(value: Record<string, unknown>) {
        this.#stderr = value;
      }
      stdin = new StdinStream();

      cwd(): string {
        return binding.vfs.cwd;
      }
      chdir(dir: string): void {
        binding.vfs.chdir(dir);
      }
      exit(code?: number): never {
        binding.exit(code ?? 0);
        throw new Error('unreachable');
      }
      nextTick(fn: (...args: unknown[]) => void, ...args: unknown[]): void {
        // Node models each tick as a TickObject async resource
        // (`internal/process/task_queues.js`), which is what lets async_hooks
        // see it and AsyncLocalStorage carry its store across a nextTick.
        const ah = hooks();
        const asyncId = ah.newAsyncId();
        const triggerAsyncId = ah.getDefaultTriggerAsyncId();
        const resource = { asyncId, triggerAsyncId };
        ah.emitInit(asyncId, 'TickObject', triggerAsyncId, resource);
        binding.nextTick(() => {
          ah.emitBefore(asyncId, triggerAsyncId, resource);
          try {
            fn(...args);
          } finally {
            ah.emitAfter(asyncId);
          }
          ah.emitDestroy(asyncId);
        });
      }
      hrtime(prev?: [number, number]): [number, number] {
        const now = (process as unknown as { hrtime: { bigint: () => bigint } }).hrtime.bigint();
        if (prev) {
          const diff = now - (BigInt(prev[0]) * 1_000_000_000n + BigInt(prev[1]));
          return [Number(diff / 1_000_000_000n), Number(diff % 1_000_000_000n)];
        }
        return [Number(now / 1_000_000_000n), Number(now % 1_000_000_000n)];
      }
      uptime(): number {
        return (Date.now() - startTime) / 1000;
      }
      memoryUsage(): Record<string, number> {
        const m = (performance as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } })
          .memory;
        return {
          rss: m?.usedJSHeapSize ?? 0,
          heapTotal: m?.totalJSHeapSize ?? 0,
          heapUsed: m?.usedJSHeapSize ?? 0,
          external: 0,
          arrayBuffers: 0,
        };
      }
      getuid = () => 0;
      getgid = () => 0;
      geteuid = () => 0;
      getegid = () => 0;
      getgroups = () => [0];
      umask = () => 0o022;
      setuid = () => undefined;
      setgid = () => undefined;
      abort = () => {
        throw new Error('process.abort is not supported in web-node');
      };
      kill = () => {
        throw new Error('process.kill is not supported in web-node');
      };
      emitWarning = () => undefined;
      resourceUsage = () => ({
        userCPUTime: 0,
        systemCPUTime: 0,
        maxRSS: 0,
        sharedMemorySize: 0,
        unsharedDataSize: 0,
        unsharedStackSize: 0,
        minorPageFault: 0,
        majorPageFault: 0,
        swappedOut: 0,
        fsRead: 0,
        fsWrite: 0,
        ipcSent: 0,
        ipcReceived: 0,
        signalsCount: 0,
        voluntaryContextSwitches: 0,
        involuntaryContextSwitches: 0,
      });
      cpuUsage = () => ({ user: 0, system: 0 });
      threadCpuUsage = () => ({ user: 0, system: 0 });
      availableMemory = () => 512 * 1024 * 1024;
      constrainedMemory = () => 512 * 1024 * 1024;
      sourceMapsEnabled = false;
      setSourceMapsEnabled = () => undefined;
      binding = (name: string): never => {
        throw new Error(`process.binding('${name}') is not available in web-node`);
      };
      _linkedBinding = (name: string): never => {
        throw new Error(`process._linkedBinding('${name}') is not available in web-node`);
      };

      // --- diagnostics / lifecycle surface ----------------------------------
      /** Set while the process is unwinding after an unhandled exception. */
      _exiting = false;
      /** `process.domain` is a legacy no-op; Node keeps it `null`. */
      domain = null;
      debugPort = 9229;
      ref = (): undefined => undefined;
      unref = (): undefined => undefined;
      reallyExit = (code?: number): never => {
        binding.exit(code ?? 0);
        throw new Error('unreachable');
      };
      openStdin = (): unknown => this.stdin;
      /**
       * `process.report` — the diagnostic-report surface. The data properties
       * are real (and `reportOnUncaughtException` is read/written by the
       * capture-callback setters below, as in Node). The two generators would
       * have to be assembled in C++ from native stacks, handle lists and build
       * metadata, so they throw rather than return a fabricated report.
       */
      report = {
        compact: false,
        directory: '',
        excludeEnv: false,
        excludeNetwork: false,
        filename: '',
        reportOnFatalError: false,
        reportOnSignal: false,
        reportOnUncaughtException: false,
        signal: 'SIGUSR2',
        getReport: (): never => {
          throw notImplemented('api', 'process.report.getReport');
        },
        writeReport: (): never => {
          throw notImplemented('api', 'process.report.writeReport');
        },
      };

      /**
       * Return a core module by id without a `require` from the caller (Node
       * 22+). Only public modules resolve; `node:` is stripped, and anything
       * else (including `internal/*`) yields `undefined`, exactly as in Node.
       */
      getBuiltinModule = (id: string): unknown => {
        if (typeof id !== 'string') {
          const codes = errorsCodes();
          throw new codes.ERR_INVALID_ARG_TYPE('id', 'string', id);
        }
        const name = id.startsWith('node:') ? id.slice('node:'.length) : id;
        if (!builtinModuleIds.has(name)) return undefined;
        return ctx.require(name);
      };

      /**
       * The libuv handle names holding the loop open (timers, listening
       * sockets). Node enumerates live handles in C++; the list is built from
       * the same timer queue and virtual network the rest of the runtime uses.
       */
      getActiveResourcesInfo = (): string[] => binding.activeResources();

      hasUncaughtExceptionCaptureCallback = (): boolean => binding.uncaughtCapture.captureFn !== null;

      setUncaughtExceptionCaptureCallback = (fn: unknown): void => {
        const state = binding.uncaughtCapture;
        if (fn === null) {
          state.captureFn = null;
          // Restore the report flag only when no auxiliaries remain, matching
          // `setUncaughtExceptionCaptureCallback(null)` in Node.
          if (state.auxiliaryCallbacks.length === 0) {
            state.shouldAbortOnUncaught[0] = 1;
            this.report.reportOnUncaughtException = state.reportFlag;
          }
          return;
        }
        if (typeof fn !== 'function') {
          const codes = errorsCodes();
          throw new codes.ERR_INVALID_ARG_TYPE('fn', ['Function', 'null'], fn);
        }
        if (state.captureFn !== null) {
          const codes = errorsCodes();
          throw new codes.ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET();
        }
        state.captureFn = fn as (err: unknown) => void;
        state.shouldAbortOnUncaught[0] = 0;
        state.reportFlag = this.report.reportOnUncaughtException === true;
        this.report.reportOnUncaughtException = false;
      };

      addUncaughtExceptionCaptureCallback = (fn: unknown): void => {
        if (typeof fn !== 'function') {
          const codes = errorsCodes();
          throw new codes.ERR_INVALID_ARG_TYPE('fn', 'Function', fn);
        }
        const state = binding.uncaughtCapture;
        if (state.auxiliaryCallbacks.length === 0 && state.captureFn === null) {
          state.reportFlag = this.report.reportOnUncaughtException === true;
          this.report.reportOnUncaughtException = false;
          state.shouldAbortOnUncaught[0] = 0;
        }
        state.auxiliaryCallbacks.push(fn as (err: unknown) => boolean | void);
      };

      /**
       * Load a `.env` file (default `./.env`) into `process.env`. Variables
       * already set are kept, like Node — the file never overrides the
       * environment. Parsing is `util.parseEnv`, the same code path Node uses.
       */
      loadEnvFile = (path?: string): void => {
        const { parseEnv } = ctx.require('util') as { parseEnv: (content: string) => Record<string, string> };
        const fs = ctx.require('fs') as { readFileSync: (p: string, enc: string) => string };
        const env = this.env as Record<string, string | undefined>;
        const parsed = parseEnv(fs.readFileSync(path ?? './.env', 'utf8'));
        for (const key of Object.keys(parsed)) {
          if (env[key] === undefined) env[key] = parsed[key];
        }
      };
    }

    // hrtime.bigint
    const proto = Process.prototype as unknown as { hrtime: ((p?: [number, number]) => [number, number]) & { bigint?: () => bigint } };
    proto.hrtime.bigint = () => BigInt(Math.round(performance.now() * 1e6));

    const process = new Process() as unknown as Record<string, unknown>;
    (process as unknown as { hrtime: { bigint: () => bigint } }).hrtime.bigint = proto.hrtime.bigint;
    return process;
  },
};
