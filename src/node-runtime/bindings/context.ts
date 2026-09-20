import type { Vfs } from '../vfs';
import type { VirtualNetwork } from '../net/network';
import type { ProcessHost } from '../proc/host';

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
   * Resolve a builtin/internal module by id. Used only by bindings that must
   * lazily reach another module (e.g. `defineLazyProperties`), mirroring the
   * `Require` hook the real C++ embedder hands to V8 lazy properties.
   */
  requireBuiltin?(id: string): unknown;
}

export type BindingFactory = (ctx: BindingContext) => Record<string, unknown>;
