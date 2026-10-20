/**
 * Shims for the `internal/*` modules the vendored `node:test` reaches but that
 * we do not vendor (M152).
 *
 * The rule from the rest of the runtime applies: only the *names* Node's own
 * code pulls off these modules matter, and each one has to do the same thing.
 * Two of them are structural — `internal/modules/cjs/loader` and
 * `internal/modules/customization_hooks` — and simply forward to our `module`
 * builtin, which already owns loading. The other three are where a tab genuinely
 * differs from a process:
 *
 *  - `internal/test_runner/runner` spawns a child process per test file. A tab
 *    cannot spawn, so `run()` loads each file in this realm (`isolation: 'none'`,
 *    which Node itself supports) and returns the root's reporter stream.
 *  - `internal/test_runner/coverage` drives V8's process-wide coverage
 *    collector, which a page cannot start. `run({ coverage: true })` therefore
 *    reports "no coverage" instead of failing the run.
 *  - `internal/source_map/source_map_cache` answers from the loader's own map
 *    (the same store `module.findSourceMap` reads).
 */
import type { BuiltinInitContext, BuiltinSpec } from './types';

/**
 * `module` is the public builtin that already owns loading and hook
 * registration. Resolving it lazily keeps these internal modules out of the
 * builtin-init cycle (`module` itself requires `internal/errors` and friends).
 */
function publicModule(ctx: BuiltinInitContext): Record<string, unknown> {
  return ctx.require('module') as Record<string, unknown>;
}

/**
 * `internal/modules/cjs/loader` only exports `Module` (the constructor that also
 * carries `_load`, `_resolveFilename`, `_nodeModulePaths` and `_cache`). Our
 * `module` builtin attaches the very same class to itself as `.Module`.
 */
export const internalCjsLoaderSpec: BuiltinSpec = {
  id: 'internal/modules/cjs/loader',
  origin: 'web-node',
  deps: ['module'],
  init: (ctx) => ({ Module: publicModule(ctx).Module }),
};

/**
 * `internal/modules/customization_hooks.registerHooks(hooks)` — Node's
 * synchronous `module.registerHooks`. Ours delegates to the loader that already
 * implements the hook contract.
 */
export const internalCustomizationHooksSpec: BuiltinSpec = {
  id: 'internal/modules/customization_hooks',
  origin: 'web-node',
  deps: ['module'],
  init: (ctx) => ({
    registerHooks: (hooks?: unknown): unknown => {
      const mod = publicModule(ctx) as { registerHooks?: (hooks?: unknown) => unknown };
      if (typeof mod.registerHooks === 'function') return mod.registerHooks(hooks);
      throw new Error('module.registerHooks is unavailable');
    },
  }),
};

/**
 * `internal/source_map/source_map_cache.findSourceMap(file)` — the source map
 * registered when `file` was loaded. The loader owns that registry, and
 * `module.findSourceMap` is its public face.
 */
export const internalSourceMapCacheSpec: BuiltinSpec = {
  id: 'internal/source_map/source_map_cache',
  origin: 'web-node',
  deps: ['module'],
  init: (ctx) => ({
    findSourceMap: (file?: unknown): unknown => {
      const mod = publicModule(ctx) as { findSourceMap?: (file?: unknown) => unknown };
      return typeof mod.findSourceMap === 'function' ? mod.findSourceMap(file) : undefined;
    },
  }),
};

/**
 * `internal/test_runner/coverage.setupCoverage(options)`.
 *
 * Node's version starts V8's process-wide coverage collector and returns a
 * handle with `summary()` / `stop()`. A page cannot start that collector, so
 * this reports "coverage unavailable" by returning `null`: the harness treats a
 * null handle as "no coverage to report" and the run still succeeds. Returning a
 * throwing stub would instead mark the run failed for a feature the user did not
 * ask to be fatal.
 */
export const internalTestRunnerCoverageSpec: BuiltinSpec = {
  id: 'internal/test_runner/coverage',
  origin: 'web-node',
  init: () => ({
    setupCoverage: (): null => null,
  }),
};

/**
 * `internal/test_runner/runner.run(options)`.
 *
 * Returns Node's `TestsStream` (the same object the CLI pipes into a reporter),
 * so `run({ files }).pipe(reporter)` behaves as documented. The difference is
 * only *where* the files run: each one is loaded into this realm through the
 * module loader, one after another. `test()` calls made while a file loads
 * attach to the root created here, which is why the tree is created **before**
 * the first file is required.
 *
 * The global options come from Node's own `parseCommandLine()` rather than being
 * restated here — that function also builds the `setup(rootReporter)` hook that
 * pipes the stream into the default reporter, so without it a `run()` would
 * collect results and print nothing. Only what a tab cannot have is overridden:
 * there is no process to spawn (`isolation: 'none'`) and no `process.cwd()` of
 * its own beyond what the runtime reports.
 */
export const internalTestRunnerRunnerSpec: BuiltinSpec = {
  id: 'internal/test_runner/runner',
  origin: 'web-node',
  deps: ['module', 'internal/test_runner/harness', 'internal/test_runner/utils'],
  init: (ctx) => ({
    run: (options: Record<string, unknown> = {}): unknown => {
      const harness = ctx.require('internal/test_runner/harness') as {
        createTestTree: (
          rootTestOptions: Record<string, unknown>,
          globalOptions: Record<string, unknown>,
        ) => { reporter: unknown };
      };
      const utils = ctx.require('internal/test_runner/utils') as {
        parseCommandLine: () => Record<string, unknown>;
      };
      const files = Array.isArray(options.files) ? (options.files as string[]) : [];
      // `parseCommandLine()` is the source of truth for reporters, destinations,
      // `setup()`, timeouts and patterns; a caller's options win where given.
      const globalOptions: Record<string, unknown> = {
        ...utils.parseCommandLine(),
        ...options,
        isolation: options.isolation ?? 'none',
      };
      delete globalOptions.files;
      const proc = (globalThis as { process?: { cwd?: () => string } }).process;
      globalOptions.cwd = options.cwd ?? (typeof proc?.cwd === 'function' ? proc.cwd() : '/');

      const root = harness.createTestTree(
        { __proto__: null, entryFile: files[0], loc: undefined },
        globalOptions,
      );

      // `createTestTree()` bootstraps globalSetup, but *not* the reporter pipe —
      // the CLI does that (and so does `lazyBootstrapRoot()`). Without this the
      // whole run would be silent: results are emitted and nothing reads them.
      const tree = root as unknown as {
        reporter: unknown;
        harness: { bootstrapPromise: Promise<unknown> };
      };
      const setup = globalOptions.setup as ((reporter: unknown) => Promise<unknown>) | undefined;
      if (typeof setup === 'function') {
        tree.harness.bootstrapPromise = Promise.all([
          tree.harness.bootstrapPromise,
          setup(tree.reporter),
        ]);
      }

      // Load the files. A throw while loading is the run's failure, not the
      // caller's: the return value is a stream and cannot reject, so report it
      // and let the summary show what ran.
      void (async () => {
        const mod = publicModule(ctx) as {
          createRequire?: (filename: string) => (id: string) => unknown;
        };
        const cwd = String(globalOptions.cwd ?? '/');
        const req = mod.createRequire?.(`${cwd.replace(/\/$/, '')}/__test_runner__.js`);
        for (const file of files) {
          if (typeof req !== 'function') break;
          try {
            req(file);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`Failed to load ${file}:`, error);
          }
        }
      })();

      return root.reporter;
    },
  }),
};

/**
 * `internal/modules/esm/loader`.
 *
 * Only two members are reached by `node:test`:
 *
 *  - `getOrInitializeCascadedLoader()` → an object with `import()` (custom
 *    reporters, `globalSetup`) and `resolveSync()` (the mock loader resolves a
 *    request the same way a real import would).
 *  - `import(specifier, parentURL, attributes)` behaves like a dynamic import.
 *
 * There is no separate ESM loader here: one loader owns both syntaxes, so a
 * `file://` parent URL is turned into the owning module's path and the import
 * goes through `module.createRequire(...)` — the same entry point our
 * `import()` uses.
 */
export const internalEsmLoaderSpec: BuiltinSpec = {
  id: 'internal/modules/esm/loader',
  origin: 'web-node',
  deps: ['module'],
  init: (ctx) => {
    /** `file:///a/b.js` → `/a/b.js`; anything else is passed through. */
    const parentPath = (parentURL: unknown): string => {
      const url = typeof parentURL === 'string' ? parentURL : '';
      if (!url.startsWith('file:')) return '/';
      try {
        return decodeURIComponent(new URL(url).pathname);
      } catch {
        return '/';
      }
    };

    const loader = {
      /**
       * Resolve like an `import`, without executing. Returns `{ format, url }`
       * (`url` a `file://` string), which is the shape the mock loader reads.
       */
      resolveSync: (specifier: string, parentURL?: unknown): { format: string; url: string } => {
        const mod = publicModule(ctx) as {
          createRequire?: (filename: string) => { resolve: (id: string) => string };
        };
        const from = parentPath(parentURL);
        const req = mod.createRequire?.(from);
        const resolved = req === undefined ? specifier : req.resolve(specifier);
        const url = resolved.startsWith('file:') ? resolved : `file://${resolved}`;
        const format = /\.m[jt]s$/.test(resolved) ? 'module' : 'commonjs';
        return { __proto__: null, format, url } as { format: string; url: string };
      },

      /** Dynamic import relative to `parentURL`. */
      import: async (specifier: string, parentURL?: unknown): Promise<Record<string, unknown>> => {
        const mod = publicModule(ctx) as {
          createRequire?: (filename: string) => (id: string) => unknown;
        };
        const req = mod.createRequire?.(parentPath(parentURL));
        if (typeof req !== 'function') {
          throw new Error(`Cannot import '${specifier}' without a module loader`);
        }
        const exports = req(specifier);
        // An ES module namespace is a frozen object whose keys mirror the
        // module's exports, plus `default`. Callers (`getReportersMap`) read
        // `.default` and then treat the value as either a function or a class.
        const namespace: Record<string, unknown> = { __proto__: null, default: exports };
        if (exports !== null && (typeof exports === 'object' || typeof exports === 'function')) {
          for (const key of Object.keys(exports as object)) {
            if (key !== 'default' && !(key in namespace)) namespace[key] = (exports as Record<string, unknown>)[key];
          }
        }
        return namespace;
      },
    };

    return {
      getOrInitializeCascadedLoader: (): typeof loader => loader,
    };
  },
};

/** The `internal/*` specs this milestone adds. */
export const testRunnerInternalSpecs: BuiltinSpec[] = [
  internalCjsLoaderSpec,
  internalCustomizationHooksSpec,
  internalEsmLoaderSpec,
  internalSourceMapCacheSpec,
  internalTestRunnerCoverageSpec,
  internalTestRunnerRunnerSpec,
];
