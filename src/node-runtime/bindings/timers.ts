import type { BindingContext, BindingFactory } from './context';

/**
 * `timers` binding.
 *
 * Node's real `lib/internal/timers.js` keeps the timer queue in JS and leans on
 * libuv (through `src/timers.cc`) for the three things it cannot do itself:
 * arm a handle for the next expiry (`scheduleTimer`), run the queue when that
 * handle fires (`processTimers`), and run the immediates on the per-iteration
 * check handle (`processImmediate`). There is no libuv here, so this binding
 * exposes the same call surface backed by *host* timers and drives it itself.
 *
 * The two `Int32Array`s are the shared counters that C++ owns in Node:
 * `timeoutInfo[0]` is the refed-timeout count, and `immediateInfo` is
 * `[kCount, kRefCount, kHasOutstanding]`. `internal/timers.js` writes into them
 * directly, which is why they must be TypedArrays rather than plain objects.
 */

// Captured at module load, before the runtime's `#installGlobals()` can shadow
// the globals, so the driver is always scheduled on the *host* timer queue.
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);

type ImmediateCallback = () => void;
type TimersCallback = (now: number) => number;

export const timersBinding: BindingFactory = (ctx: BindingContext) => {
  // `getLibuvNow()` (like Node's `Environment::GetNowUint64`) counts from the
  // environment's creation, not from the clock's epoch, and is whole
  // milliseconds.
  const timerBase = ctx.now();
  const getLibuvNow = (): number => Math.floor(ctx.now() - timerBase);

  const immediateInfo = new Int32Array(3);
  const timeoutInfo = new Int32Array(1);

  let onImmediate: ImmediateCallback | null = null;
  let onTimers: TimersCallback | null = null;

  let timerHandle: ReturnType<typeof hostSetTimeout> | null = null;
  let timerRefed = true;
  let checkHandle: ReturnType<typeof hostSetTimeout> | null = null;

  /** Arm (or re-arm) the single libuv-timer stand-in for the next expiry. */
  function armTimer(durationMs: number): void {
    if (timerHandle !== null) hostClearTimeout(timerHandle);
    timerHandle = hostSetTimeout(() => {
      timerHandle = null;
      runTimers();
    }, durationMs > 0 ? durationMs : 1);
  }

  /**
   * Stand-in for `Environment::RunTimers`. Calls the JS queue runner, then
   * honours the returned expiry the way `src/env.cc` does: `0` means the queue
   * is empty, `> 0` means a refed timer remains, `< 0` means only unrefed ones
   * do.
   */
  function runTimers(): void {
    if (onTimers === null) return;
    let expiry: number;
    try {
      expiry = onTimers(getLibuvNow());
    } catch (err) {
      // Node's RunTimers re-enters the queue runner after an uncaught exception
      // (`ret.IsEmpty()` loop in src/env.cc). Re-arm so the entries the throw
      // skipped still get their turn, then let the exception surface.
      if (timerHandle === null) armTimer(1);
      throw err;
    }
    if (expiry !== 0) {
      armTimer(Math.abs(expiry) - getLibuvNow());
      timerRefed = expiry > 0;
    } else {
      timerRefed = false;
    }
  }

  /**
   * Stand-in for `Environment::CheckImmediate`. In Node the check handle runs
   * once per loop iteration; here one host macrotask stands in for "the loop
   * turned", and the check keeps rescheduling itself while immediates remain.
   */
  function ensureCheck(): void {
    if (checkHandle !== null) return;
    checkHandle = hostSetTimeout(() => {
      checkHandle = null;
      runCheck();
    }, 0);
  }

  function runCheck(): void {
    if (onImmediate === null) return;
    if (immediateInfo[0] === 0) return;
    do {
      onImmediate();
    } while (immediateInfo[2] !== 0);
    // Immediates queued after the batch finished are the next iteration's.
    if (immediateInfo[0] > 0) ensureCheck();
  }

  return {
    // -- the shared counters ------------------------------------------------
    immediateInfo,
    timeoutInfo,

    // -- the C++ call surface ----------------------------------------------
    setupTimers(immediate: ImmediateCallback, timers: TimersCallback): void {
      onImmediate = immediate;
      onTimers = timers;
    },
    getLibuvNow,
    scheduleTimer: (durationMs: number): void => armTimer(durationMs),
    toggleTimerRef: (ref: boolean): void => {
      timerRefed = ref;
    },
    toggleImmediateRef: (ref: boolean): void => {
      if (ref) ensureCheck();
    },

    // -- runtime plumbing (not part of the Node surface) --------------------
    /**
     * Pending work as the runner sees it: an armed refed expiry, a refed
     * timeout, or any immediate. `proc/host.ts` compares this before and after a
     * spawned program to decide whether the child still has work to do.
     */
    __liveCount: (): number =>
      (timerHandle !== null && timerRefed ? 1 : 0) +
      (timeoutInfo[0] > 0 ? 1 : 0) +
      (immediateInfo[0] > 0 ? 1 : 0),
    /**
     * Stop the driver between runs. Each `runMain` models a fresh process, so a
     * timeout left pending by the previous program must not fire in the next
     * one. The queue itself lives in `internal/timers.js` and is cleared there
     * (through the public `clearTimeout`/`clearImmediate` path, so the linked
     * lists, the priority queue and the ref counts all stay consistent); this
     * only drops the host handles that were driving it.
     */
    __reset: (): void => {
      if (timerHandle !== null) {
        hostClearTimeout(timerHandle);
        timerHandle = null;
      }
      if (checkHandle !== null) {
        hostClearTimeout(checkHandle);
        checkHandle = null;
      }
    },
  };
};
