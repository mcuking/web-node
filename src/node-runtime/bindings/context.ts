import type { Vfs } from '../vfs';

/**
 * Everything a binding is allowed to see about the host. Bindings never reach
 * for globals; they receive this object, which keeps them testable and lets us
 * swap the host (browser worker vs. Node test harness) freely.
 */
export interface BindingContext {
  vfs: Vfs;
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
}

export type BindingFactory = (ctx: BindingContext) => Record<string, unknown>;
