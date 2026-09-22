import type { BuiltinInitContext } from './types';

/**
 * The inspector console extensions.
 *
 * Node's `require('console')` is the global console; at bootstrap
 * `internal/util/inspector.js` `wrapConsole()` grafts the V8 inspector console
 * APIs (`context`, `createTask`, `profile`, `profileEnd`, `timeStamp`) onto it.
 * web-node has no inspector, but the surface is still observable (feature
 * detection, and `createTask().run()` / `context()` are usable without a
 * client), so we reproduce it faithfully:
 *
 *   - `createTask(name)` -> `{ run(fn) }` (V8 task object; `run` returns fn()).
 *   - `context(name)`    -> a console-like namespace with the console methods
 *                           (bound) — not a `Console` instance, matching Node.
 *   - `profile`/`profileEnd`/`timeStamp` -> no-ops (no inspector to talk to).
 *
 * Argument validation mirrors V8's messages exactly (`First argument must be a
 * non-empty string.` / `First argument must be a function.`).
 */
export function installConsoleExtensions(
  exports: Record<string, unknown>,
  _ctx: BuiltinInitContext,
): Record<string, unknown> {
  const globalConsole = exports;

  // V8 reports `createTask.length === 0`, so declare it with a rest parameter.
  const createTask = (...args: unknown[]): { run: (fn: () => unknown) => unknown } => {
    const name = args[0];
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('First argument must be a non-empty string.');
    }
    return {
      // V8 reports `run.length === 0`; a rest parameter keeps it there.
      run(...args: unknown[]) {
        const fn = args[0];
        if (typeof fn !== 'function') {
          throw new Error('First argument must be a function.');
        }
        return (fn as () => unknown)();
      },
    };
  };

  const noop = (): undefined => undefined;

  const context = (name: unknown): Record<string, unknown> => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('First argument must be a non-empty string.');
    }
    // A fresh namespace whose [[Prototype]] is an empty object (not
    // %ObjectPrototype%), with the console methods bound to it — the same shape
    // Node builds for the global console, minus `Console`/`context`/`createTask`.
    const namespace: Record<string, unknown> = { __proto__: {} } as unknown as Record<string, unknown>;
    for (const key of Object.keys(globalConsole)) {
      if (key === 'Console' || key === 'context' || key === 'createTask') continue;
      const value = globalConsole[key];
      if (typeof value === 'function') {
        const bound = (value as (...args: unknown[]) => unknown).bind(namespace);
        Object.defineProperty(bound, 'name', { value: key, configurable: true });
        namespace[key] = bound;
      }
    }
    // V8's console spells it `dirXml`; Node's spells it `dirxml`.
    if (typeof globalConsole.dirxml === 'function') {
      namespace.dirXml = (globalConsole.dirxml as (...args: unknown[]) => unknown).bind(namespace);
    }
    namespace.profile = noop;
    namespace.profileEnd = noop;
    namespace.timeStamp = noop;
    return namespace;
  };

  Object.defineProperties(globalConsole, {
    context: { value: context, enumerable: true, writable: true, configurable: true },
    createTask: { value: createTask, enumerable: true, writable: true, configurable: true },
    profile: { value: noop, enumerable: true, writable: true, configurable: true },
    profileEnd: { value: noop, enumerable: true, writable: true, configurable: true },
    timeStamp: { value: noop, enumerable: true, writable: true, configurable: true },
  });

  return globalConsole;
}
