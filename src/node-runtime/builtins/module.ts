import type { BuiltinSpec, BuiltinInitContext, UserRequireFn } from './types';

/**
 * `module` builtin — a structurally compatible subset of Node's module module.
 *
 * `createRequire` returns a require bound to the loader for the given path, so
 * `import { createRequire } from 'node:module'` works for user code.
 */
export const moduleSpec: BuiltinSpec = {
  id: 'module',
  aliases: ['node:module'],
  origin: 'web-node',
  init: (ctx: BuiltinInitContext) => {
    const builtinModuleIds = [...ctx.builtinModuleIds].sort();

    class Module {
      id: string;
      filename: string;
      path: string;
      exports: unknown = {};
      parent: Module | null;
      children: Module[] = [];
      paths: string[] = [];
      loaded = false;

      constructor(id = '', parent?: Module | null) {
        this.id = id;
        this.filename = id;
        this.path = id.split('/').slice(0, -1).join('/') || '/';
        this.parent = parent ?? null;
      }

      require(id: string): unknown {
        const loader = (ctx as unknown as { userRequire?: (from: string, id: string) => unknown }).userRequire;
        if (loader) return loader(this.filename, id);
        return ctx.require(id);
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
        const loader = (ctx as unknown as { userRequire?: UserRequireFn }).userRequire;
        const req = ((id: string) => {
          if (loader) return loader(from, id);
          return ctx.require(id);
        }) as ((id: string) => unknown) & {
          resolve: (id: string, options?: { paths?: string[] }) => string;
        };
        // Node's `require` carries `.resolve`; bundled tooling relies on it to
        // turn an id into an absolute path without loading the module.
        req.resolve = (id: string, options?: { paths?: string[] }): string => {
          if (loader?.resolve) return loader.resolve(from, id, options);
          return id;
        };
        return req;
      };
      static register = (): void => undefined;
      static _cache = new Map<string, Module>();
      static _extensions: Record<string, unknown> = {};
      static globalPaths: string[] = [];
    }

    // Fold the statics onto the constructor-shaped export the way Node does.
    Object.assign(Module, { Module });
    const fn = Module as unknown as Record<string, unknown>;
    fn.Module = Module;
    fn.default = Module;

    return fn;
  },
};
