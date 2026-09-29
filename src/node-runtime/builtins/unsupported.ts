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
  // A *function expression*, not an arrow: arrow functions are not
  // constructable, so `new DatabaseSync(...)` would fail with a confusing
  // "is not a constructor" TypeError before the body ran. As a plain function
  // the body runs and the caller gets the honest NotImplementedError instead.
  return function (): never {
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
export function unsupported(moduleName: string, provided: Record<string, unknown> = {}): Record<string, unknown> {
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

/**
 * Core modules that exist in Node but have no browser-tab implementation.
 *
 * They must still **load**: tooling sometimes does `import 'node:http2'` for
 * side effects (so a bundler keeps the dep), and a bare `MODULE_NOT_FOUND`
 * there would take the whole module graph down. So they resolve to a module
 * whose properties throw a loud, typed `NotImplementedError` on *use* — the
 * failure stays at the call site, where it belongs, and never looks like a
 * missing file.
 *
 * `http2` needs a full HTTP/2 (HPACK + frame/stream) stack; `sqlite` needs a
 * bundled native SQLite; `trace_events` needs V8's tracing subsystem. All are
 * deliberately out of scope, so they get the "loads but is not usable"
 * treatment rather than silent stubs. (Node itself throws
 * `ERR_TRACE_EVENTS_UNAVAILABLE` when built without tracing, so "no tracing in
 * the tab" is upstream-legitimate rather than a web-node-only limitation.)
 */
export const unsupportedSpecs: BuiltinSpec[] = [
  {
    id: 'http2',
    origin: 'web-node',
    init: () => unsupported('http2'),
  },
  {
    id: 'sqlite',
    aliases: ['node:sqlite'],
    origin: 'web-node',
    init: () => unsupported('sqlite'),
  },
  {
    id: 'trace_events',
    aliases: ['node:trace_events'],
    origin: 'web-node',
    init: () => unsupported('trace_events'),
  },
];
