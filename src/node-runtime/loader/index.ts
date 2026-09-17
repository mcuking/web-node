import type { Realm } from '../realm';
import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import { transformEsmToCjs } from './esm-transform';
import { notImplemented } from '../errors';

const USER_CJS_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'] as const;
const EXTENSIONS = ['', '.js', '.cjs', '.mjs', '.json'];

interface UserModule {
  exports: unknown;
  state: 'loading' | 'loaded';
}

/** Resolution + execution for user modules living in the VFS. */
export class ModuleLoader {
  #realm: Realm;
  #vfs: Vfs;
  #cache = new Map<string, UserModule>();
  /** Extra names injected into every user module's scope (a sandbox global). */
  #globals: Record<string, unknown>;
  #paramNames: string[];

  constructor(realm: Realm, vfs: Vfs, globals: Record<string, unknown> = {}) {
    this.#realm = realm;
    this.#vfs = vfs;
    this.#globals = globals;
    this.#paramNames = [...USER_CJS_PARAMS, ...Object.keys(globals)];
  }

  setGlobals(globals: Record<string, unknown>): void {
    this.#globals = globals;
    this.#paramNames = [...USER_CJS_PARAMS, ...Object.keys(globals)];
  }

  get realm(): Realm {
    return this.#realm;
  }

  /** Node's require resolution order, reduced to what the VFS supports. */
  resolve(request: string, fromDir: string): string {
    if (request.startsWith('.') || p.isAbsolute(request)) {
      const base = p.resolve(fromDir, request);
      const found = this.#tryFileOrDir(base);
      if (found) return found;
      throw Object.assign(new Error(`Cannot find module '${request}' from '${fromDir}'`), { code: 'MODULE_NOT_FOUND' });
    }

    // node_modules walk-up
    const parts = p.segments(fromDir);
    for (let i = parts.length; i >= 0; i--) {
      const nmDir = '/' + parts.slice(0, i).concat('node_modules').join('/');
      const candidate = p.join(nmDir, request);
      const found = this.#tryFileOrDir(candidate);
      if (found) return found;
    }
    throw Object.assign(new Error(`Cannot find module '${request}' from '${fromDir}'`), { code: 'MODULE_NOT_FOUND' });
  }

  #tryFileOrDir(base: string): string | null {
    for (const ext of EXTENSIONS) {
      const candidate = base + ext;
      if (this.#vfs.exists(candidate)) {
        const st = this.#vfs.stat(candidate);
        if (st.type === 'file') return candidate;
      }
    }
    // directory: package.json main / index.js
    if (this.#vfs.exists(base) && this.#vfs.stat(base).type === 'dir') {
      const pkgPath = p.join(base, 'package.json');
      if (this.#vfs.exists(pkgPath)) {
        try {
          const pkg = JSON.parse(new TextDecoder().decode(this.#vfs.readFile(pkgPath))) as { main?: string };
          if (pkg.main) {
            const mainPath = this.#tryFileOrDir(p.join(base, pkg.main));
            if (mainPath) return mainPath;
          }
        } catch {
          /* ignore malformed package.json */
        }
      }
      for (const idx of ['index.js', 'index.cjs', 'index.mjs', 'index.json']) {
        const candidate = p.join(base, idx);
        if (this.#vfs.exists(candidate)) return candidate;
      }
    }
    return null;
  }

  /** Public require facade: builtins first, then VFS modules. */
  require = (fromFile: string, request: string): unknown => {
    if (typeof request !== 'string') {
      throw new TypeError(`The "id" argument must be of type string. Received ${typeof request}`);
    }
    if (this.#realm.hasBuiltin(request)) return this.#realm.require(request);
    if (request.startsWith('node:')) {
      throw notImplemented('module', request, 'Only whitelisted core modules are exposed.');
    }
    const fromDir = p.dirname(fromFile);
    const resolved = this.resolve(request, fromDir);
    return this.loadModule(resolved);
  };

  /** Load a module by absolute VFS path. */
  loadModule(absPath: string): unknown {
    const cached = this.#cache.get(absPath);
    if (cached) return cached.exports;

    if (absPath.endsWith('.json')) {
      const text = new TextDecoder().decode(this.#vfs.readFile(absPath));
      const exports = JSON.parse(text);
      this.#cache.set(absPath, { exports, state: 'loaded' });
      return exports;
    }

    const source = new TextDecoder().decode(this.#vfs.readFile(absPath));
    const isEsm = absPath.endsWith('.mjs') || (absPath.endsWith('.js') && this.#isPackageEsm(absPath));

    const mod: UserModule = { exports: {}, state: 'loading' };
    this.#cache.set(absPath, mod);

    const code = isEsm ? transformEsmToCjs(source, `file://${absPath}`).code : source;
    const dirname = p.dirname(absPath);

    let fn: (...args: unknown[]) => void;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function(...this.#paramNames, code) as unknown as (...args: unknown[]) => void;
    } catch (err) {
      this.#cache.delete(absPath);
      throw new Error(`Failed to compile ${absPath}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const moduleObj = { exports: mod.exports };
    const requireFn = (request: string) => this.require(absPath, request);
    const globalValues = Object.keys(this.#globals).map((k) => this.#globals[k]);
    try {
      fn(moduleObj.exports, requireFn, moduleObj, absPath, dirname, ...globalValues);
    } catch (err) {
      this.#cache.delete(absPath);
      throw err;
    }

    mod.exports = moduleObj.exports;
    mod.state = 'loaded';
    return mod.exports;
  }

  #isPackageEsm(absPath: string): boolean {
    let dir = p.dirname(absPath);
    for (let i = 0; i < 20; i++) {
      const pkgPath = p.join(dir, 'package.json');
      if (this.#vfs.exists(pkgPath)) {
        try {
          const pkg = JSON.parse(new TextDecoder().decode(this.#vfs.readFile(pkgPath))) as { type?: string };
          return pkg.type === 'module';
        } catch {
          return false;
        }
      }
      const parent = p.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return false;
  }

  /** Cache keys currently loaded — used by tests and the UI. */
  get loadedModules(): string[] {
    return [...this.#cache.keys()].sort();
  }

  /**
   * Drop the user-module cache so the next `loadModule()` re-executes from
   * source. `NodeRuntime.runMain()` calls this on every run: clicking Run twice
   * must behave like `node index.js` twice, not like a cached no-op.
   *
   * Builtins (`realm`) are deliberately *not* reset — they model the process's
   * own loaded core, not the user's module graph.
   */
  reset(): void {
    this.#cache.clear();
  }
}
