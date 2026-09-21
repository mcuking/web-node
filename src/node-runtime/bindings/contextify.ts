import type { BindingFactory } from './context';
import { notImplemented } from '../errors';

/**
 * `contextify` — the native half of `vm`.
 *
 * Real Node builds a genuine V8 context per `vm.createContext` (its own
 * intrinsics, its own global) and compiles scripts with V8's `ScriptCompiler`.
 * A page cannot create a second realm, so this binding emulates the *observable
 * data semantics* of a vm context instead:
 *
 * - a "context" is the sandbox object itself, tagged with Node's
 *   `contextify_context_private_symbol`. `createContext(o) === o`, exactly like
 *   Node, and `vm.isContext` reads the tag back through `internal/vm`.
 * - a script runs inside `with (context) { … }`, with `this` bound to a fresh
 *   proxy over that context, so reads see the sandbox then the standard
 *   intrinsics, writes land on the sandbox, `var` declarations behave, and the
 *   completion value is returned.
 *
 * What it deliberately does *not* do (documented deviations, see DEVLOG):
 * realm isolation (the intrinsics are the host's, not a second realm's), the
 * enumerable-global surface of `globalThis`, and code timing. `timeout`/
 * `breakOnSigint` need an interruptible isolate, so they throw.
 */

/**
 * The names a fresh vm context exposes: the ECMAScript intrinsics plus the
 * `console` Node injects. Everything else (`process`, `require`, `Buffer`,
 * `setTimeout`, `fetch`, …) is *absent* in a real vm context, and must stay
 * absent here — so the scope resolves unknown names to `undefined` rather than
 * leaking the host's globals.
 *
 * (Probed against Node v26.9.0: `vm.runInContext('typeof <name>', {})`.)
 */
const CONTEXT_GLOBAL_NAMES = [
  'Object', 'Function', 'Array', 'Number', 'parseFloat', 'parseInt', 'Infinity', 'NaN',
  'Boolean', 'String', 'Symbol', 'Date', 'Promise', 'RegExp',
  'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
  'JSON', 'Math', 'Intl',
  'ArrayBuffer', 'SharedArrayBuffer', 'Atomics', 'DataView',
  'Uint8Array', 'Int8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'BigInt', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry', 'Proxy', 'Reflect',
  'decodeURI', 'encodeURI', 'decodeURIComponent', 'encodeURIComponent', 'escape', 'unescape', 'eval',
  'console',
] as const;

/**
 * Snapshot the intrinsic objects once, so a context's view of `Math`/`RegExp`/…
 * is fixed at creation time (frozen against later host mutation of the *binding*,
 * which is as close to realm isolation as one realm allows).
 */
let sharedGlobals: Record<string, unknown> | null = null;
function intrinsicGlobals(): Record<string, unknown> {
  if (sharedGlobals === null) {
    const globals: Record<string, unknown> = {};
    const host = globalThis as unknown as Record<string, unknown>;
    for (const name of CONTEXT_GLOBAL_NAMES) {
      if (name in host) globals[name] = host[name];
    }
    sharedGlobals = globals;
  }
  return sharedGlobals;
}

/** What `makeContext` records on a contextified object. */
interface ContextRecord {
  name: string;
  origin: string | undefined;
  codeGenerationStrings: boolean;
  codeGenerationWasm: boolean;
  microtaskQueue: boolean;
  globals: Record<string, unknown>;
}

/**
 * Build the scope a script's identifiers resolve against.
 *
 * `has` answers `true` for everything the runner's own parameter names do not
 * claim, which is what routes bare assignments (and `var` writes) onto the
 * sandbox and makes the fallback lookup happen in `get`. `exclude` is the set of
 * names that must *not* be intercepted: the runner's hidden parameters (or a
 * `var __scope0__` in user code would break the `with` clause) and a compiled
 * function's own parameters.
 */
function makeScope(
  sandbox: Record<string, unknown>,
  record: ContextRecord,
  exclude: ReadonlySet<string>,
): Record<string, unknown> {
  let proxy: Record<string, unknown>;
  proxy = new Proxy(sandbox, {
    has: (_target, key) => typeof key === 'symbol' || !exclude.has(key),
    get(target, key, receiver) {
      if (key === 'globalThis') return proxy;
      if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
      const name = typeof key === 'string' ? key : undefined;
      if (name !== undefined && Object.prototype.hasOwnProperty.call(record.globals, name)) {
        return record.globals[name];
      }
      return undefined;
    },
    set: (target, key, value) => Reflect.set(target, key, value),
  });
  return proxy;
}

/**
 * The runner's hidden parameter names. They are excluded from the scope's `has`
 * trap so the wrapper can still read them; `with` gives the scope's object
 * environment record priority over the function's parameters otherwise.
 */
const RUNNER_PARAMS = new Set(['__webnode_scope__', '__webnode_code__']);

/**
 * Run a script body with the current context (no sandbox): no `with`, so
 * resolution reaches the host globals, and `this` is the host global because the
 * sloppy wrapper is invoked unbound.
 */
const thisContextRunner = new Function('__webnode_code__', 'return eval(__webnode_code__);') as (
  code: string,
) => unknown;

/** Run a script body with a scope object and `this` bound to it. */
const withContextRunner = new Function(
  '__webnode_scope__',
  '__webnode_code__',
  'with (__webnode_scope__) { return eval(__webnode_code__); }',
) as (this: unknown, scope: unknown, code: string) => unknown;

export const contextifyBinding: BindingFactory = (_ctx, table) => {
  const utilBinding = table.get('util') as { privateSymbols: Record<string, symbol> } | undefined;
  const contextSymbolRaw = utilBinding?.privateSymbols?.contextify_context_private_symbol;
  if (typeof contextSymbolRaw !== 'symbol') {
    throw new Error('util binding did not expose contextify_context_private_symbol');
  }
  const contextSymbol: symbol = contextSymbolRaw;

  /** Run a script body against a contextified object or the current context. */
  function runScript(source: string, sandbox: unknown, record: ContextRecord | undefined): unknown {
    if (sandbox === null || sandbox === undefined) {
      return thisContextRunner(source);
    }
    if (record === undefined) {
      // Should be unreachable: `lib/vm.js` validates `isContext` first.
      throw new TypeError('The "contextifiedObject" argument must be a vm.Context');
    }
    const scope = makeScope(sandbox as Record<string, unknown>, record, RUNNER_PARAMS);
    return withContextRunner.call(scope, scope, source);
  }

  /** A syntax check that matches Node's "parse at construction" timing. */
  function parseCheck(source: string): void {
    // `new Function` parses the body as function code. It catches the syntax
    // errors a script shares with a function body; the one difference is a
    // top-level `return`, which is legal function code — and the runner's
    // `eval` rejects it at run time anyway.
    try {
      // eslint-disable-next-line no-new-func
      new Function(source);
    } catch (err) {
      if (err instanceof SyntaxError) throw err;
    }
  }

  class ContextifyScript {
    source: string;
    filename: string;
    lineOffset: number;
    columnOffset: number;

    constructor(
      code: string,
      filename?: string,
      lineOffset?: number,
      columnOffset?: number,
      cachedData?: unknown,
      produceCachedData?: boolean,
      _parsingContext?: unknown,
      _hostDefinedOptionId?: unknown,
    ) {
      this.source = String(code);
      this.filename = filename === undefined ? 'evalmachine.<anonymous>' : String(filename);
      this.lineOffset = lineOffset ?? 0;
      this.columnOffset = columnOffset ?? 0;
      if (cachedData !== undefined && cachedData !== null) {
        throw notImplemented(
          'api',
          'vm.Script cachedData',
          'A page cannot produce or consume V8 code cache.',
        );
      }
      if (produceCachedData) {
        throw notImplemented('api', 'vm.Script produceCachedData', 'A page cannot produce V8 code cache.');
      }
      parseCheck(this.source);
    }

    runInContext(
      contextifiedObject: unknown,
      timeout?: number,
      _displayErrors?: boolean,
      breakOnSigint?: boolean,
      _breakFirstLine?: boolean,
    ): unknown {
      if (typeof timeout === 'number' && timeout >= 0) {
        throw notImplemented(
          'api',
          'vm timeout',
          'Interrupting a running script needs an interruptible isolate.',
        );
      }
      if (breakOnSigint) {
        throw notImplemented(
          'api',
          'vm breakOnSigint',
          'Interrupting a running script needs an interruptible isolate.',
        );
      }
      const record =
        contextifiedObject === null || contextifiedObject === undefined
          ? undefined
          : (contextifiedObject as Record<symbol, ContextRecord | undefined>)[contextSymbol];
      return runScript(this.source, contextifiedObject, record);
    }

    createCachedData(): never {
      throw notImplemented('api', 'vm.Script.createCachedData', 'A page cannot produce V8 code cache.');
    }
  }

  function makeContext(
    contextObject: unknown,
    name: string,
    origin: string | undefined,
    strings: boolean,
    wasm: boolean,
    microtaskQueue: boolean,
  ): unknown {
    const record: ContextRecord = {
      name: String(name),
      origin,
      codeGenerationStrings: strings,
      codeGenerationWasm: wasm,
      microtaskQueue,
      globals: intrinsicGlobals(),
    };
    // `DONT_CONTEXTIFY` asks for the *current* context; `lib/vm.js` passes the
    // sentinel symbol through, and the only object standing in for the current
    // global is the host global itself.
    const target =
      typeof contextObject === 'symbol' ? (globalThis as object) : (contextObject as object);
    Object.defineProperty(target, contextSymbol, {
      value: record,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    return target;
  }

  /**
   * `compileFunction` — build a function whose scope is the parameters, then the
   * context extensions, then (when given) the `parsingContext`. Extension scopes
   * are inner relative to the context, so they win identifier resolution.
   */
  function compileFunction(
    code: string,
    _filename: string,
    _lineOffset: number,
    _columnOffset: number,
    cachedData: unknown,
    produceCachedData: boolean,
    parsingContext: unknown,
    contextExtensions: unknown[],
    params: string[] | undefined,
  ): { function: (...args: unknown[]) => unknown } {
    if (cachedData !== undefined && cachedData !== null) {
      throw notImplemented('api', 'vm.compileFunction cachedData', 'A page cannot consume V8 code cache.');
    }
    if (produceCachedData) {
      throw notImplemented(
        'api',
        'vm.compileFunction produceCachedData',
        'A page cannot produce V8 code cache.',
      );
    }

    const parameterNames = params ?? [];
    const exclude = new Set<string>(parameterNames);

    // Priority order, lowest first: the parsing context, then the extensions.
    const scopes: Record<string, unknown>[] = [];
    if (parsingContext !== undefined && parsingContext !== null) {
      const record = (parsingContext as Record<symbol, ContextRecord | undefined>)[contextSymbol];
      if (record === undefined) {
        throw new TypeError('The "options.parsingContext" property must be an instance of Context');
      }
      scopes.push(parsingContext as Record<string, unknown>);
    }
    for (const extension of contextExtensions) {
      if (extension !== null && extension !== undefined) {
        scopes.push(extension as Record<string, unknown>);
      }
    }

    const scopeParams = scopes.map((_scope, i) => `__webnode_scope${i}__`);
    for (const name of scopeParams) exclude.add(name);

    // Wrap from the last scope outward so the list's head ends up outermost.
    // The parsing context (index 0) becomes a `with`-scope with the global
    // fallback; extensions stay plain objects so their own scope chains apply.
    const parsingRecord =
      scopes.length > 0 && (parsingContext !== undefined && parsingContext !== null)
        ? (parsingContext as Record<symbol, ContextRecord>)[contextSymbol]
        : undefined;
    let body = code;
    for (let i = scopes.length - 1; i >= 0; i--) {
      body = `with (${scopeParams[i]}) {\n${body}\n}`;
    }
    const fn = new Function(...parameterNames, ...scopeParams, body) as (
      ...args: unknown[]
    ) => unknown;
    const bound = scopes.map((scope, i) =>
      parsingRecord !== undefined && i === 0
        ? makeScope(scope, parsingRecord, exclude)
        : scope,
    );
    return {
      function: (...args: unknown[]) => fn(...args, ...bound),
    };
  }

  return {
    ContextifyScript,
    makeContext,
    compileFunction,
    // V8's `MeasureMemoryMode`/`MeasureMemoryExecution` (src/node_contextify.cc).
    constants: {
      measureMemory: {
        mode: { SUMMARY: 0, DETAILED: 1 },
        execution: { DEFAULT: 0, EAGER: 1 },
      },
    },
    measureMemory: (): never => {
      throw notImplemented(
        'api',
        'vm.measureMemory',
        'Per-context memory measurement needs the V8 inspector/heap API.',
      );
    },
  };
};
