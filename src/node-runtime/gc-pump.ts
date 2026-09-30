/**
 * Opportunistic garbage-collection pump (M139).
 *
 * A build compiles hundreds of modules back-to-back; V8's own heuristics let the
 * heap balloon to ~90 MB before it bothers to collect, even though half of that
 * is already-dead garbage (measured: forcing a GC mid-build drops the peak from
 * 83 MB to ~43 MB). Browsers do not hand page scripts a `gc()`, so nothing in
 * the runtime can trigger that collection — *unless* the host launched with
 * `--js-flags=--expose-gc`, which publishes a global `gc`. When that global
 * exists we run a low-frequency pump for the duration of a one-shot program,
 * bounding the peak; when it does not, this is a silent no-op.
 *
 * The interval rides the **host** timer queue: `installGlobals` swaps the
 * worker's `setTimeout`/`setInterval` for the runtime's own, and `runMain`
 * clears that queue before every run — a pump on the runtime's timers would be
 * cancelled the instant a build started. Captured at module load, before
 * `installGlobals` runs.
 */
const hostSetInterval = globalThis.setInterval.bind(globalThis);
const hostClearInterval = globalThis.clearInterval.bind(globalThis);

/** Default pump period: short enough to bound a build, long enough to be cheap. */
export const GC_PUMP_INTERVAL_MS = 100;

type GcFn = () => void;

function gcFunction(): GcFn | null {
  const candidate = (globalThis as { gc?: unknown }).gc;
  return typeof candidate === 'function' ? (candidate as GcFn) : null;
}

let active = 0;
let timer: ReturnType<typeof hostSetInterval> | null = null;

/**
 * Start (or join) the pump. Returns a release function to call when the heavy
 * phase ends. Reference-counted so overlapping one-shot programs share one
 * interval. Returns a no-op when `gc` is unavailable, so callers never branch.
 */
export function beginGcPump(intervalMs: number = GC_PUMP_INTERVAL_MS): () => void {
  const collect = gcFunction();
  if (collect === null) return () => {};
  active += 1;
  if (timer === null) {
    timer = hostSetInterval(() => {
      try {
        collect();
      } catch {
        // A throwing gc is not worth surfacing; the next tick simply retries.
      }
    }, intervalMs);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active -= 1;
    if (active <= 0 && timer !== null) {
      hostClearInterval(timer);
      timer = null;
      active = 0;
    }
  };
}

/** Test helper: whether the pump currently holds a live interval. */
export function gcPumpActive(): boolean {
  return timer !== null;
}
