import type { BindingContext } from '../bindings';

/** Context handed to every builtin initializer. */
export interface BuiltinInitContext {
  binding: BindingContext;
  /** `internalBinding(name)` — the single interception point of the runtime. */
  internalBinding(name: string): Record<string, unknown>;
  /** Resolve another builtin / internal module by id. */
  require(id: string): unknown;
  primordials: Record<string, unknown>;
  privateSymbols: Record<string, symbol>;
  perIsolateSymbols: Record<string, symbol>;
  /** Public core module ids (e.g. `path`, `fs`) known to the realm. */
  builtinModuleIds: string[];
  /** Set by the module loader so `module.createRequire` can resolve user files. */
  userRequire?: UserRequireFn;
}

/** `require` facade the loader hands to `module.createRequire`, with `resolve`. */
export interface UserRequireFn {
  (from: string, id: string): unknown;
  resolve?: (from: string, id: string, options?: { paths?: string[] }) => string;
}

export interface BuiltinSpec {
  /** Canonical id, e.g. `path` or `internal/validators`. */
  id: string;
  /** Public aliases, e.g. `node:path`. */
  aliases?: string[];
  /** Relative path under vendor/node-lib when backed by real Node source. */
  vendorPath?: string;
  /** TS initializer for our own implementations. */
  init?: (ctx: BuiltinInitContext) => Record<string, unknown>;
  /** Ids that must be materialized before this one runs. */
  deps?: string[];
  /**
   * Node's `Function.length` for exported callables, applied after
   * materialization so optional-argument probing matches Node even where our
   * implementation uses rest parameters. See `alignArity`.
   */
  arity?: Record<string, number>;
  /** Marks provenance for docs/UI. */
  origin: 'node-source' | 'web-node';
}
