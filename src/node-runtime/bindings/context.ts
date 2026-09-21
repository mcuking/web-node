import type { Vfs } from '../vfs';
import type { VirtualNetwork } from '../net/network';
import type { ProcessHost } from '../proc/host';
import type { WorkerHost } from '../proc/worker';

/**
 * Everything a binding is allowed to see about the host. Bindings never reach
 * for globals; they receive this object, which keeps them testable and lets us
 * swap the host (browser worker vs. Node test harness) freely.
 */
export interface BindingContext {
  vfs: Vfs;
  /**
   * The virtual TCP layer. Node talks to the OS through `tcp_wrap`; we talk to
   * this instead. `net`/`http` are written against it, and the ServiceWorker
   * bridge dials it from outside the worker.
   */
  network: VirtualNetwork;
  /**
   * The controlled spawn surface. Node reaches the OS through `uv_spawn`; we
   * reach this instead. It is the *only* way user code can cause another
   * program to run, `child_process` is written against it, and npm drives
   * lifecycle scripts through it.
   */
  spawn: ProcessHost;
  /**
   * The worker surface. Node starts a thread; we start a second module registry
   * on the same loop. `worker_threads` is written against this.
   */
  workers: WorkerHost;
  env: Record<string, string>;
  argv: string[];
  execPath: string;
  writeStdout(chunk: string): void;
  writeStderr(chunk: string): void;
  exit(code: number): void;
  /** Microtask-queue equivalent of `process.nextTick`. */
  nextTick(fn: (...args: unknown[]) => void, ...args: unknown[]): void;
  /** Event-loop timer surface exposed to the `timers` builtin. */
  timers: {
    setTimeout(fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]): number;
    clearTimeout(id: number): void;
    setInterval(fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]): number;
    clearInterval(id: number): void;
    setImmediate(fn: (...args: unknown[]) => void, ...args: unknown[]): number;
    clearImmediate(id: number): void;
    /** Live timer count; the runner uses it to reason about the event loop. */
    activeCount(): number;
  };
  now(): number;
  hrtime(): [number, number];
  /**
   * Uncaught-exception handling state, shared by the `process` builtin (which
   * owns the public setters) and the `errors`/`util` bindings (which dispatch
   * a thrown/`unhandledRejection` error into it). It mirrors the
   * `exceptionHandlerState` in `lib/internal/process/execution.js`: one primary
   * capture callback plus a list of auxiliary callbacks that coexist with it.
   */
  uncaughtCapture: UncaughtCaptureState;
  /**
   * The active-resource list `process.getActiveResourcesInfo()` returns: the
   * libuv handle/request names libuv would report. Node builds it in C++ from
   * its live handles; we build it from the timer queue and the virtual network.
   */
  activeResources(): string[];
  /**
   * Resolve a builtin/internal module by id. Used only by bindings that must
   * lazily reach another module (e.g. `defineLazyProperties`), mirroring the
   * `Require` hook the real C++ embedder hands to V8 lazy properties.
   */
  requireBuiltin?(id: string): unknown;
}

export type UncaughtCaptureFn = (err: unknown) => void;
export type UncaughtAuxiliaryFn = (err: unknown) => boolean | void;

/**
 * Mirrors Node's `exceptionHandlerState`
 * (`lib/internal/process/execution.js`). `captureFn` is the primary callback
 * (domains use it exclusively); `auxiliaryCallbacks` run only when there is no
 * primary and must return `true` to claim the error. `reportFlag` records
 * whether `process.report.reportOnUncaughtException` was on before a handler
 * was installed, so clearing the handler can restore it.
 */
export interface UncaughtCaptureState {
  captureFn: UncaughtCaptureFn | null;
  auxiliaryCallbacks: UncaughtAuxiliaryFn[];
  reportFlag: boolean;
  shouldAbortOnUncaught: Uint8Array;
}

export type BindingFactory = (ctx: BindingContext, table: BindingTable) => Record<string, unknown>;

/**
 * The binding table under construction. A factory receives it so one binding can
 * read another's exports — Node's internal bindings are independent C++ objects,
 * but a few of ours must agree on identity (e.g. `messaging` needs the `symbols`
 * binding's `oninit`/`no_message_symbol` to drive a port the way
 * `src/node_messaging.cc` does).
 */
export type BindingTable = Map<string, Record<string, unknown>>;
