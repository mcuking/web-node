import type { BindingContext } from './context';

/**
 * Port of `createOnGlobalUncaughtException()` from
 * `lib/internal/process/execution.js`: route a thrown error (or an unhandled
 * rejection) through the user's handlers before the process is allowed to die.
 *
 * Order, as in Node:
 *   1. `uncaughtExceptionMonitor` is always emitted.
 *   2. If a primary capture callback is set (domains), it handles the error.
 *   3. Otherwise each auxiliary callback runs, newest first, until one returns
 *      `true`.
 *   4. Otherwise `uncaughtException` is emitted; a listener claiming it counts.
 *   5. Only if nothing claimed it does the process print the error and exit(1).
 *
 * Returning `true` means "handled — keep running"; the C++ side of Node uses
 * exactly this boolean to decide whether to abort.
 */
export function triggerUncaughtException(ctx: BindingContext, err: unknown, fromPromise = false): boolean {
  const state = ctx.uncaughtCapture;
  const type = fromPromise ? 'unhandledRejection' : 'uncaughtException';
  // `process` is a builtin; a binding can not require it at binding-creation
  // time, but by the time an error is thrown it is always resolvable.
  const proc = ctx.requireBuiltin?.('process') as
    | { emit?: (event: string, ...args: unknown[]) => boolean; _exiting?: boolean; exitCode?: number }
    | undefined;

  proc?.emit?.('uncaughtExceptionMonitor', err, type);

  let handled = false;
  if (state.captureFn !== null) {
    state.captureFn(err);
    handled = true;
  } else {
    for (let i = state.auxiliaryCallbacks.length - 1; i >= 0; i--) {
      if (state.auxiliaryCallbacks[i](err) === true) {
        handled = true;
        break;
      }
    }
    if (!handled && proc?.emit?.('uncaughtException', err, type)) {
      handled = true;
    }
  }

  if (!handled) {
    try {
      if (proc && !proc._exiting) {
        proc._exiting = true;
        proc.exitCode = 1;
        proc.emit?.('exit', 1);
      }
    } catch {
      /* nothing further can be done while unwinding */
    }
    ctx.writeStderr(`${(err as Error)?.stack ?? String(err)}\n`);
    ctx.exit(1);
    return false;
  }

  return true;
}
