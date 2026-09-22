import * as p from '../vfs/posix';

/** `Symbol.dispose` is not in every TS lib target; fall back to a private symbol. */
const DISPOSE: symbol = (Symbol as unknown as { dispose?: symbol }).dispose ?? Symbol('dispose');

/**
 * Synchronous loader hooks — the machinery behind `module.registerHooks()`
 * (`lib/internal/modules/customization_hooks.js`).
 *
 * Node's CJS loader runs every `require()` through two chains of user hooks
 * (resolve then load), each ending in a default step. A hook either delegates by
 * calling `next(specifier, context)` or takes over by returning a result with
 * `shortCircuit: true`. The observable contract is reproduced here:
 *
 * - a returned result *must* set `shortCircuit: true` or Node throws
 *   `ERR_INVALID_RETURN_PROPERTY_VALUE`;
 * - `resolve` must return a string `url`;
 * - the context object is shared and merged across the chain;
 * - `registerHooks` returns a frozen object exposing `resolve`, `load` and a
 *   `deregister` (also `Symbol.dispose`).
 */

/** CJS filename → `file://` URL, the form hooks receive (Node's `pathToFileURL`). */
export function cjsFilenameToURL(filename: string): string {
  if (!filename) return filename;
  if (filename.startsWith('node:')) return filename;
  if (p.isAbsolute(filename)) return `file://${filename}`;
  return filename;
}

/** `file://` URL → CJS filename, the inverse of {@link cjsFilenameToURL}. */
export function urlToCjsFilename(url: string): string {
  if (!url) return url;
  if (url.startsWith('node:')) return url;
  if (url.startsWith('file://')) return decodeURIComponent(url.slice('file://'.length));
  return url;
}

/** The context handed to a `resolve` hook (`ModuleResolveContext`). */
export class ModuleResolveContext {
  constructor(
    public parentURL: string | undefined,
    public importAttributes: Record<string, string> | undefined,
    public conditions: string[],
  ) {}
}

/** The context handed to a `load` hook (`ModuleLoadContext`). */
export class ModuleLoadContext {
  constructor(
    public format: string | undefined,
    public importAttributes: Record<string, string> | undefined,
    public conditions: string[],
  ) {}
}

export interface ResolveResult {
  url: string;
  format?: string;
  importAttributes?: Record<string, string>;
}
export interface LoadResult {
  source?: string | ArrayBuffer | ArrayBufferView;
  format?: string;
}

type ResolveHook = (
  specifier: string,
  context: ModuleResolveContext,
  next: (specifier: string, context: ModuleResolveContext) => ResolveResult,
) => ResolveResult;
type LoadHook = (
  url: string,
  context: ModuleLoadContext,
  next: (url: string, context: ModuleLoadContext) => LoadResult,
) => LoadResult;

interface HookSet {
  id: symbol;
  resolve?: ResolveHook;
  load?: LoadHook;
}

function receivedType(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return `type string ('${String(value)}')`;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return `type ${t} (${String(value)})`;
  return `type ${t}`;
}

function invalidReturnPropertyValue(expected: string, name: string, prop: string, value: unknown): Error {
  return Object.assign(
    new TypeError(`Expected ${expected} to be returned for the "${prop}" from the "${name}" hook but got ${receivedType(value)}.`),
    { code: 'ERR_INVALID_RETURN_PROPERTY_VALUE' },
  );
}

/**
 * The per-runtime hook registry. Mirrors Node's module-level `resolveHooks`/
 * `loadHooks` arrays plus `buildHooks`, including the context merging and the
 * `shortCircuit` contract.
 */
export class ModuleHooksRegistry {
  #resolveHooks: HookSet[] = [];
  #loadHooks: HookSet[] = [];

  registerHooks(hooks: { resolve?: ResolveHook; load?: LoadHook }): {
    resolve?: ResolveHook;
    load?: LoadHook;
    deregister: () => void;
  } {    // Node destructures immediately, so a missing `hooks` throws the V8
    // destructuring TypeError ("Cannot destructure property 'resolve' of
    // 'hooks' as it is undefined.") with no `code`.
    const { resolve, load } = hooks;
    if (resolve !== undefined && typeof resolve !== 'function') {
      throw Object.assign(
        new TypeError(`The "hooks.resolve" property must be of type function. Received ${receivedType(resolve)}`),
        { code: 'ERR_INVALID_ARG_TYPE' },
      );
    }
    if (load !== undefined && typeof load !== 'function') {
      throw Object.assign(
        new TypeError(`The "hooks.load" property must be of type function. Received ${receivedType(load)}`),
        { code: 'ERR_INVALID_ARG_TYPE' },
      );
    }
    const set: HookSet = { id: Symbol('module-hook') };
    if (resolve) {
      set.resolve = resolve;
      this.#resolveHooks.push(set);
    }
    if (load) {
      set.load = load;
      this.#loadHooks.push(set);
    }
    const self = this;
    const api: { resolve?: ResolveHook; load?: LoadHook; deregister: () => void } = {
      resolve,
      load,
      deregister: () => undefined,
    };
    // Node's returned object exposes `deregister` via a getter (so it is not an
    // own enumerable key): `Object.keys(hooks)` is exactly `['resolve','load']`.
    Object.defineProperty(api, 'deregister', {
      value: () => self.#remove(set),
      enumerable: false,
    });
    Object.defineProperty(api, DISPOSE, { value: api.deregister, enumerable: false });
    return Object.freeze(api);
  }

  #remove(set: HookSet): void {
    let i = this.#resolveHooks.findIndex((h) => h.id === set.id);
    if (i !== -1) this.#resolveHooks.splice(i, 1);
    i = this.#loadHooks.findIndex((h) => h.id === set.id);
    if (i !== -1) this.#loadHooks.splice(i, 1);
  }

  get hasResolveHooks(): boolean {
    return this.#resolveHooks.length > 0;
  }
  get hasLoadHooks(): boolean {
    return this.#loadHooks.length > 0;
  }
  get hasAny(): boolean {
    return this.hasResolveHooks || this.hasLoadHooks;
  }

  /**
   * Run the resolve chain. `defaultResolve` is the loader's own resolution; the
   * returned `url` is already validated to be a string.
   */
  resolveWithHooks(
    specifier: string,
    context: ModuleResolveContext,
    defaultResolve: (specifier: string, context: ModuleResolveContext) => ResolveResult,
  ): ResolveResult {
    if (this.#resolveHooks.length === 0) return defaultResolve(specifier, context);
    const runner = this.#buildChain('resolve', this.#resolveHooks, defaultResolve, context, (result) => {
      if (typeof result.url !== 'string') {
        throw invalidReturnPropertyValue('a URL string', 'resolve', 'url', result.url);
      }
      return result;
    });
    return runner(specifier, context);
  }

  /** Run the load chain. */
  loadWithHooks(
    url: string,
    context: ModuleLoadContext,
    defaultLoad: (url: string, context: ModuleLoadContext) => LoadResult,
  ): LoadResult {
    if (this.#loadHooks.length === 0) return defaultLoad(url, context);
    const runner = this.#buildChain('load', this.#loadHooks, defaultLoad, context, (result) => result);
    return runner(url, context);
  }

  /**
   * Node's `buildHooks`: wrap the default step and each hook so that a hook that
   * stops the chain without `shortCircuit: true` throws, and the (merged) context
   * is shared by reference across the chain.
   */
  #buildChain<TContext, TResult>(
    name: 'resolve' | 'load',
    sets: HookSet[],
    defaultStep: (arg: string, context: TContext) => TResult,
    mergedContext: TContext,
    validate: (result: TResult) => TResult,
  ): (arg: string, context: TContext) => TResult {
    let lastRunIndex = sets.length;
    const wrap = (
      index: number,
      hook: (arg: string, context: TContext, next: (a: string, c: TContext) => TResult) => TResult,
      next?: (a: string, c: TContext) => TResult,
    ) => {
      return (arg: string, context: TContext): TResult => {
        lastRunIndex = index;
        if (context && context !== mergedContext) {
          Object.assign(mergedContext as object, context as object);
        }
        const result = hook(arg, mergedContext, next as (a: string, c: TContext) => TResult);
        if (lastRunIndex > 0 && lastRunIndex === index && !(result as { shortCircuit?: boolean })?.shortCircuit) {
          throw invalidReturnPropertyValue('true', name, 'shortCircuit', (result as { shortCircuit?: boolean })?.shortCircuit);
        }
        return validate(result);
      };
    };

    const chain: Array<(arg: string, context: TContext) => TResult> = [wrap(0, defaultStep)];
    for (let i = 0; i < sets.length; i++) {
      const hook = sets[i][name] as unknown as (
        arg: string,
        context: TContext,
        next: (a: string, c: TContext) => TResult,
      ) => TResult;
      chain.push(wrap(i + 1, hook, chain[i]));
    }
    return chain[chain.length - 1];
  }
}
