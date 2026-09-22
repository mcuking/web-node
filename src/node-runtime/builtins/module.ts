import type { BuiltinSpec, BuiltinInitContext, UserRequireFn } from './types';
import { notImplemented } from '../errors';
import { SourceMap } from './source-map';

/**
 * `module` builtin — a structurally compatible subset of Node's module module.
 *
 * `createRequire` returns a require bound to the loader for the given path, so
 * `import { createRequire } from 'node:module'` works for user code. The loader
 * internally is ours (not Node's CJS loader), so the members that would drive
 * that loader (`_findPath`/`_load`/`registerHooks`/`stripTypeScriptTypes`/…)
 * are present but throw loudly rather than pretend to have machinery we lack.
 */
export const moduleSpec: BuiltinSpec = {
  id: 'module',
  aliases: ['node:module'],
  origin: 'web-node',
  arity: {
    register: 1,
    _resolveFilename: 4,
    _findPath: 3,
    _initPaths: 0,
    _load: 3,
    _nodeModulePaths: 1,
    _preloadModules: 1,
    _readPackage: 1,
    _resolveLookupPaths: 2,
    _stat: 1,
    createRequire: 1,
    enableCompileCache: 1,
    findPackageJSON: 1,
    findSourceMap: 1,
    flushCompileCache: 0,
    getCompileCacheDir: 0,
    getSourceMapsSupport: 0,
    isBuiltin: 1,
    registerHooks: 1,
    runMain: 0,
    setSourceMapsSupport: 1,
    stripTypeScriptTypes: 1,
    syncBuiltinESMExports: 0,
    wrap: 1,
    SourceMap: 1,
  },
  init: (ctx: BuiltinInitContext) => {
    const builtinModuleIds = [...ctx.builtinModuleIds].sort();
    const loader = (): UserRequireFn | undefined =>
      (ctx as unknown as { userRequire?: UserRequireFn }).userRequire;

    /** Node's `SourceMap` support flags (`setSourceMapsSupport`/`getSourceMapsSupport`). */
    const userLoader = (ctx as unknown as { userLoader?: import('./types').UserLoader }).userLoader;

    class Module {
      id: string;
      filename: string;
      path: string;
      exports: unknown = {};
      children: Module[] = [];
      paths: string[] = [];
      loaded = false;

      #parent: Module | null = null;

      constructor(id = '', parent?: Module | null) {
        this.id = id;
        this.filename = id;
        this.path = id.split('/').slice(0, -1).join('/') || '/';
        this.#parent = parent ?? null;
      }

      /** The module that first required this one (Node exposes an accessor). */
      get parent(): Module | null {
        return this.#parent;
      }
      set parent(value: Module | null) {
        this.#parent = value;
      }

      /** @internal — true while the bootstrapper is preloading builtins. */
      get isPreloading(): boolean {
        return false;
      }

      require(id: string): unknown {
        const req = loader();
        if (req) return req(this.filename, id);
        return ctx.require(id);
      }

      /** @internal — Node's CJS compile step; our loader owns compilation. */
      _compile(): never {
        throw notImplemented(
          'api',
          'module.Module.prototype._compile',
          'Compilation is owned by the web-node loader, not a Module instance.',
        );
      }

      /** @internal — Node's CJS load step; our loader owns loading. */
      load(): never {
        throw notImplemented(
          'api',
          'module.Module.prototype.load',
          'Loading is owned by the web-node loader, not a Module instance.',
        );
      }

      static _nodeModulePaths(from: string): string[] {
        const parts = from.split('/').filter(Boolean);
        const paths: string[] = [];
        for (let i = parts.length; i >= 0; i--) {
          paths.push('/' + parts.slice(0, i).concat('node_modules').join('/'));
        }
        return paths;
      }

      static _resolveFilename = (id: string): string => id;
      static Module = Module;
      static builtinModules = builtinModuleIds;
      static isBuiltin = (id: string): boolean => builtinModuleIds.includes(id.replace(/^node:/, ''));
      static syncBuiltinESMExports = (): void => undefined;
      static createRequire = (filename: string | URL): ((id: string) => unknown) => {
        // Vite (and anything bundled by rollup) calls `createRequire(import.meta.url)`,
        // so the argument is usually a `file://` URL that must be turned back
        // into a VFS path before the loader can resolve relative to it.
        const raw = typeof filename === 'string' ? filename : filename.href;
        const from = raw.startsWith('file://') ? decodeURIComponent(raw.slice('file://'.length)) : raw;
        const req = ((id: string) => {
          const load = loader();
          if (load) return load(from, id);
          return ctx.require(id);
        }) as ((id: string) => unknown) & {
          resolve: (id: string, options?: { paths?: string[] }) => string;
        };
        // Node's `require` carries `.resolve`; bundled tooling relies on it to
        // turn an id into an absolute path without loading the module.
        req.resolve = (id: string, options?: { paths?: string[] }): string => {
          const load = loader();
          if (load?.resolve) return load.resolve(from, id, options);
          return id;
        };
        return req;
      };

      /** @internal — alias of `createRequire` with `node:` ids preserved. */
      static register = (): void => undefined;
      static _cache = new Map<string, Module>();
      static _extensions: Record<string, unknown> = {};
      static globalPaths: string[] = [];

      /** Node's CJS wrapper `(function (exports, require, …) { … });`. */
      static wrapper = ['(function (exports, require, module, __filename, __dirname) { ', '\n});'];
      /** Wrap a script body in the CJS wrapper, exactly like Node. */
      static wrap = (script: string): string =>
        `${Module.wrapper[0]}${script}${Module.wrapper[1]}`;

      /** `module.constants.compileCacheStatus`. */
      static constants = {
        compileCacheStatus: { FAILED: 0, ENABLED: 1, ALREADY_ENABLED: 2, DISABLED: 3 },
      };

      /** @internal — resolved-path memo (Node ships an empty Map). */
      static _pathCache = new Map<string, string>();

      /** @internal — the web-node loader owns path resolution. */
      static _findPath = (request: string, paths?: string[], isMain?: boolean): string | false => {
        if (userLoader) return userLoader.findPath(request, paths, isMain);
        throw notImplemented('api', 'module.Module._findPath', 'Path resolution is owned by the web-node loader.');
      };
      /** @internal — global search paths are fixed to `[]` here. */
      static _initPaths = (): void => {
        Module.globalPaths = [];
      };
      /** @internal — the web-node loader owns module loading. */
      static _load = (request: string, parent?: unknown, isMain?: boolean): unknown => {
        if (userLoader) return userLoader.load(request, parent, isMain);
        throw notImplemented('api', 'module.Module._load', 'Module loading is owned by the web-node loader.');
      };
      /** @internal — builtins preload through `require` in the loader. */
      static _preloadModules = (requests?: string[]): void => {
        for (const request of requests ?? []) {
          const load = loader();
          if (load) load('/index.js', request);
        }
      };
      /** @internal — package.json reading needs the loader's resolver. */
      static _readPackage = (request: string): unknown => {
        if (userLoader) return userLoader.readPackage(request);
        throw notImplemented('api', 'module.Module._readPackage', 'Package.json reading is owned by the web-node loader.');
      };
      static _resolveLookupPaths = (request: string, _parent?: unknown): string[] =>
        request.startsWith('.') ? ['.'] : Module.globalPaths.slice();
      /** @internal — the web-node loader owns fs stats. */
      static _stat = (filename: string): number => {
        if (userLoader) return userLoader.statModule(filename);
        throw notImplemented('api', 'module.Module._stat', 'Filesystem stats are owned by the web-node loader.');
      };

      /** `module.runMain()` — re-run the entry point (bootstrap-only). */
      static runMain = (): never => {
        throw notImplemented(
          'api',
          'module.Module.runMain',
          'The entry point is already run by the web-node host.',
        );
      };
      /** `module.registerHooks(hooks)` — synchronous loader hooks. */
      static registerHooks = (hooks?: unknown): unknown => {
        if (userLoader) return userLoader.registerHooks(hooks);
        throw notImplemented(
          'api',
          'module.Module.registerHooks',
          'Loader hooks are not available in web-node.',
        );
      };
      /** `module.stripTypeScriptTypes(code, options)` — needs a TS transform. */
      static stripTypeScriptTypes = (_code?: unknown, ..._rest: unknown[]): never => {
        throw notImplemented(
          'api',
          'module.Module.stripTypeScriptTypes',
          'Stripping TypeScript types needs the amaro transform, which is not bundled.',
        );
      };
      /** `module.findPackageJSON(packageJsonPath, base)` — needs the loader. */
      static findPackageJSON = (specifier: string, base?: string | URL): string => {
        if (userLoader) return userLoader.findPackageJSON(specifier, base);
        throw notImplemented(
          'api',
          'module.Module.findPackageJSON',
          'Package.json discovery is owned by the web-node loader.',
        );
      };

      /** `module.findSourceMap(path)` — the map registered when the module loaded. */
      static findSourceMap = (sourceURL?: unknown): unknown => {
        if (userLoader) return userLoader.findSourceMap(sourceURL);
        return undefined;
      };
      /** `module.getSourceMapsSupport()` — reflects `setSourceMapsSupport`. */
      static getSourceMapsSupport = (): { enabled: boolean; nodeModules: boolean; generatedCode: boolean } =>
        userLoader ? userLoader.sourceMapsSupport : { enabled: false, nodeModules: false, generatedCode: false };
      /** `module.setSourceMapsSupport(enabled, options)` — records the flags. */
      static setSourceMapsSupport = (enabled: boolean, options?: { nodeModules?: boolean; generatedCode?: boolean }): void => {
        if (userLoader) return userLoader.setSourceMapsSupport(enabled, options);
        if (typeof enabled !== 'boolean') {
          throw Object.assign(
            new TypeError(`The "enabled" argument must be of type boolean. Received type ${typeof enabled}`),
            { code: 'ERR_INVALID_ARG_TYPE' },
          );
        }
      };

      /** `module.getCompileCacheDir()` — the cache is never enabled here. */
      static getCompileCacheDir = (): undefined => undefined;
      /** `module.flushCompileCache()` — nothing to flush. */
      static flushCompileCache = (): undefined => undefined;
      /** `module.enableCompileCache(dir)` — unsupported, reports FAILED. */
      static enableCompileCache = (_dir?: unknown): { status: number; message: string } => ({
        status: Module.constants.compileCacheStatus.FAILED,
        message: 'Compile cache is not supported in web-node.',
      });

      static SourceMap = SourceMap;
    }

    // Fold the statics onto the constructor-shaped export the way Node does.
    Object.assign(Module, { Module });
    const fn = Module as unknown as Record<string, unknown>;
    fn.Module = Module;
    fn.default = Module;

    return fn;
  },
};
