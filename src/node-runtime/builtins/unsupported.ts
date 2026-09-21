import type { BuiltinSpec } from './types';
import { notImplemented } from '../errors';

/**
 * Placeholder builtins for core modules that real tooling *imports* but whose
 * functionality cannot exist in a browser tab (no processes, no raw sockets, no
 * native addons) or is simply outside the supported surface.
 *
 * The rule is the same as everywhere else in this runtime: never return
 * `undefined`. But there is a second rule specific to loading: a **side-effect
 * import must not throw**. Vite, for instance, does `import 'node:tty'` at the
 * top of its bundle purely so the bundler keeps the dependency; failing at that
 * line would make the whole module unloadable even though nothing calls it.
 *
 * So these modules load as an object where *using* an unsupported API throws a
 * loud, typed `NotImplementedError`, while merely importing the module is fine.
 * A small set of innocuous properties (isatty, a no-op process-ish surface) is
 * provided for real, because tooling genuinely reads them.
 */

function throwingFn(moduleName: string, prop: string): (...args: unknown[]) => never {
  return () => {
    throw notImplemented('api', `${moduleName}.${prop}`);
  };
}

/**
 * A module whose every property, when *called*, throws `NotImplementedError`.
 * `provided` overrides selected properties with real values.
 *
 * Interop keys are deliberately *absent* rather than throwing: `__wnDefault`
 * tests `m.__esModule` to decide whether a module is an ES namespace, and a
 * throwing function there is truthy, which would make it unwrap `.default` and
 * hand callers a stub instead of the namespace object.
 */
function unsupported(moduleName: string, provided: Record<string, unknown> = {}): Record<string, unknown> {
  const isInteropKey = (prop: string): boolean =>
    prop === '__esModule' || prop === 'default' || prop === 'then';
  return new Proxy(provided, {
    get(target, prop) {
      if (typeof prop === 'symbol') return (target as Record<symbol, unknown>)[prop];
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      if (isInteropKey(prop)) return undefined;
      return throwingFn(moduleName, prop);
    },
    has(target, prop) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) return true;
      if (typeof prop === 'symbol') return false;
      return !isInteropKey(prop);
    },
  });
}

export const unsupportedSpecs: BuiltinSpec[] = [
  {
    id: 'tty',
    aliases: ['node:tty'],
    origin: 'web-node',
    init: () =>
      unsupported('tty', {
        // Colour detection is the one thing libraries (picocolors et al.) call.
        isatty: () => false,
        WriteStream: class WriteStream {},
        ReadStream: class ReadStream {},
      }),
  },
  {
    id: 'v8',
    aliases: ['node:v8'],
    origin: 'web-node',
    init: () => unsupported('v8', { serialize: undefined, deserialize: undefined }),
  },
  {
    id: 'tls',
    aliases: ['node:tls'],
    origin: 'web-node',
    init: () => unsupported('tls'),
  },
  {
    id: 'vm',
    aliases: ['node:vm'],
    origin: 'web-node',
    // A full `vm` (isolated contexts, `Script`, `compileFunction`) is out of
    // scope, but `runInNewContext` is not optional: Node's own vendored
    // `internal/util.js` reaches for a **cross-realm** RegExp through it
    // (`getInternalGlobal` / `SideEffectFreeRegExpPrototypeSymbolReplace`),
    // which the WHATWG streams finalizers hit. Without it, merely garbage
    // collecting a stream writer raised an unhandled `NotImplementedError`.
    // Everything else throws on use, as usual.
    init: () =>
      unsupported('vm', {
        runInNewContext: (code: string, contextObject?: Record<string, unknown>) => {
          // `this` in the evaluated program must be the context object, and a
          // bare `runInNewContext('this')` has to hand back something with the
          // standard intrinsics on it (Node returns the contextified global),
          // so default to an object that delegates to the host global.
          const context = contextObject ?? Object.create(globalThis);
          const run = new Function(
            '__ctx__',
            '__code__',
            'with (__ctx__) { return eval(__code__); }',
          ) as (ctx: unknown, code: string) => unknown;
          return run.call(context, context, code);
        },
      }),
  },
];
