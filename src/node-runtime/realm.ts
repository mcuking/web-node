import { createBindingTable, hasBinding, unsupportedBinding } from './bindings';
import type { BindingContext } from './bindings/context';
import { ALL_BUILTINS, PUBLIC_BUILTIN_IDS } from './builtins';
import type { BuiltinInitContext, BuiltinSpec, UserRequireFn } from './builtins/types';
import { vendoredSource } from './vendored';
import { compileCjs } from './vm';
import { notImplemented } from './errors';

/**
 * A symbol bag that lazily mints a stable Symbol per requested name.
 *
 * Node injects `privateSymbols` / `perIsolateSymbols` from C++. Our vendored
 * per-context files only read a handful of these, so minting on demand keeps us
 * honest without hard-coding the C++ symbol inventory.
 */
function symbolBag(): Record<string, symbol> {
  const target: Record<string, symbol> = {};
  return new Proxy(target, {
    get(t, key) {
      if (typeof key !== 'string') return undefined;
      return (t[key] ??= Symbol(key));
    },
    has() {
      return true;
    },
  });
}

type ModuleState = 'unloaded' | 'loading' | 'loaded';

interface ModuleRecord {
  exports: Record<string, unknown>;
  // Kept for vendored modules so a circular `require` observes live
  // reassignments of `module.exports` (Node's `stream.js` swaps it out mid-file).
  moduleObj?: { exports: unknown };
  state: ModuleState;
  spec: BuiltinSpec;
}

/**
 * The realm owns exactly two things:
 *   1. the `internalBinding` dispatch table (the "engine swap" point), and
 *   2. the builtin/internals module registry (vendored Node source + our code).
 *
 * User code never talks to it directly; the module loader does.
 */
export class Realm {
  readonly primordials: Record<string, unknown>;
  readonly privateSymbols: Record<string, symbol>;
  readonly perIsolateSymbols: Record<string, symbol>;
  readonly bindingIds: string[];

  #bindings: Map<string, Record<string, unknown>>;
  #records = new Map<string, ModuleRecord>();
  #byAlias = new Map<string, string>();
  #ctx: BuiltinInitContext;

  constructor(bindingCtx: BindingContext) {
    this.#bindings = createBindingTable(bindingCtx);
    this.bindingIds = [...this.#bindings.keys()].sort();
    this.privateSymbols = symbolBag();
    this.perIsolateSymbols = symbolBag();
    this.primordials = this.#initPrimordials();

    this.#ctx = {
      binding: bindingCtx,
      internalBinding: (name: string) => this.internalBinding(name),
      require: (id: string) => this.require(id),
      primordials: this.primordials,
      privateSymbols: this.privateSymbols,
      perIsolateSymbols: this.perIsolateSymbols,
      builtinModuleIds: PUBLIC_BUILTIN_IDS,
    };

    for (const spec of ALL_BUILTINS) {
      this.#records.set(spec.id, { exports: {}, state: 'unloaded', spec });
      for (const alias of spec.aliases ?? []) this.#byAlias.set(alias, spec.id);
    }
  }

  /** Wire the loader in so `module.createRequire` can resolve user files. */
  setUserRequire(fn: UserRequireFn): void {
    this.#ctx.userRequire = fn;
  }

  // -- the "engine swap" point ------------------------------------------------

  /** `internalBinding(name)` — Node internal code's only door to the host. */
  internalBinding(name: string): Record<string, unknown> {
    const b = this.#bindings.get(name);
    if (b !== undefined) return b;
    return unsupportedBinding(name);
  }

  hasBinding(name: string): boolean {
    return hasBinding(name);
  }

  // -- module registry --------------------------------------------------------

  #normalize(id: string): string {
    const stripped = id.startsWith('node:') ? id.slice(5) : id;
    return this.#byAlias.get(id) ?? this.#byAlias.get(stripped) ?? stripped;
  }

  hasBuiltin(id: string): boolean {
    if (typeof id !== 'string') return false;
    return this.#records.has(this.#normalize(id));
  }

  /** Resolve + execute a builtin/internal module. Throws for unknown ids. */
  require(id: string): unknown {
    const key = this.#normalize(id);
    const rec = this.#records.get(key);
    if (!rec) {
      throw notImplemented(
        'module',
        id,
        `Known core modules: ${PUBLIC_BUILTIN_IDS.join(', ')}.`,
      );
    }
    return this.#materialize(key, rec);
  }

  #materialize(key: string, rec: ModuleRecord): unknown {
    if (rec.state === 'loaded') return rec.moduleObj ? rec.moduleObj.exports : rec.exports;
    // Circular import: hand back whatever exports exist so far. For vendored
    // modules that is the live `module.exports`, so a reassignment earlier in
    // the file (e.g. `module.exports = Stream`) is already visible.
    if (rec.state === 'loading') return rec.moduleObj ? rec.moduleObj.exports : rec.exports;
    rec.state = 'loading';

    // Ensure declared dependencies exist first (mirrors Node's ordered bootstrap).
    for (const dep of rec.spec.deps ?? []) this.require(dep);

    if (rec.spec.vendorPath) {
      const src = vendoredSource(rec.spec.vendorPath);
      if (src === undefined) {
        throw notImplemented('module', key, `Vendored file vendor/node-lib/${rec.spec.vendorPath} is missing. Run \`npm run vendor\`.`);
      }
      const fn = compileCjs(src, rec.spec.vendorPath);
      const moduleObj = { exports: rec.exports };
      rec.moduleObj = moduleObj;
      const dirname = key.startsWith('internal/') ? `internal/${key.split('/').slice(1, -1).join('/')}` : '/';
      fn(
        rec.exports,
        (request: string) => this.require(request),
        moduleObj,
        key,
        dirname,
        this.primordials,
        this.privateSymbols,
        this.perIsolateSymbols,
      );
      rec.exports = moduleObj.exports as Record<string, unknown>;
    } else if (rec.spec.init) {
      rec.exports = rec.spec.init(this.#ctx);
    } else {
      throw new Error(`Builtin "${key}" has neither vendorPath nor init`);
    }

    rec.state = 'loaded';
    return rec.exports;
  }

  // -- primordials ------------------------------------------------------------

  #initPrimordials(): Record<string, unknown> {
    const bag: Record<string, unknown> = {};
    const src = vendoredSource('internal/per_context/primordials.js');
    if (src === undefined) {
      throw new Error('Vendored primordials.js missing. Run `npm run vendor`.');
    }
    const fn = compileCjs(src, 'internal/per_context/primordials.js');
    const moduleObj = { exports: bag };
    fn(bag, () => ({}), moduleObj, 'internal/per_context/primordials.js', 'internal/per_context', bag, this.privateSymbols, this.perIsolateSymbols);
    return bag;
  }

  // -- introspection ----------------------------------------------------------

  listModules(): Array<{ id: string; origin: string; state: ModuleState }> {
    return [...this.#records.entries()]
      .map(([id, r]) => ({ id, origin: r.spec.origin, state: r.state }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
