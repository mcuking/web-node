import type { Realm } from '../realm';
import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import { transformEsmToCjs } from './esm-transform';
import { notImplemented } from '../errors';

const USER_CJS_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'] as const;
const EXTENSIONS = ['', '.js', '.cjs', '.mjs', '.json'];

/**
 * Sentinel returned when a `browser` field maps a specifier to `false`
 * ("this module is empty in the browser"). Resolving to a real VFS path would
 * either miss or pick up the Node-only file we were told to drop.
 */
export const EMPTY_MODULE = '\u0000web-node:empty';

interface PackageJson {
  main?: string;
  module?: string;
  browser?: string | Record<string, string | false>;
  type?: string;
  exports?: unknown;
}

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

  /** Read and parse the `package.json` in `dir`, if any. */
  #packageJson(dir: string): PackageJson | null {
    const pkgPath = p.join(dir, 'package.json');
    if (!this.#vfs.exists(pkgPath)) return null;
    try {
      return JSON.parse(new TextDecoder().decode(this.#vfs.readFile(pkgPath))) as PackageJson;
    } catch {
      return null;
    }
  }

  /** The package directory that owns `fromDir` (nearest `package.json` upward). */
  #owningPackage(fromDir: string): { dir: string; json: PackageJson } | null {
    let dir = fromDir;
    for (let i = 0; i < 40; i++) {
      const json = this.#packageJson(dir);
      if (json) return { dir, json };
      const parent = p.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /**
   * Apply a package's `browser` field to a specifier — the map bundlers use to
   * swap Node-only files for browser ones (`{ "fs": false, "./node.js": "./browser.js" }`),
   * or a bare string that redirects the package entry point.
   *
   * Returns the replacement specifier, `EMPTY_MODULE` for `false`, or `null`
   * when nothing applies. This is what lets a package whose `main` is a Node
   * build (spawning child processes, reading files) resolve to its browser
   * build instead — required for real tooling like esbuild-wasm.
   */
  #browserRemap(request: string, fromFile: string): string | null {
    const owner = this.#owningPackage(p.dirname(fromFile));
    if (!owner) return null;
    const browser = owner.json.browser;
    if (!browser || typeof browser !== 'object') return null;
    const map = browser as Record<string, string | false>;

    const apply = (key: string): string | null | undefined => {
      if (!Object.prototype.hasOwnProperty.call(map, key)) return undefined;
      const value = map[key];
      return value === false ? EMPTY_MODULE : value;
    };

    // Bare specifier: remap by exact name.
    if (!request.startsWith('.') && !p.isAbsolute(request)) {
      const hit = apply(request);
      return hit === undefined ? null : hit;
    }

    // Relative/absolute: keys are `./`-prefixed, relative to the package root.
    const abs = p.resolve(p.dirname(fromFile), request);
    const rel = './' + this.#relative(owner.dir, abs);
    const stem = rel.replace(/\.(js|cjs|mjs|json)$/, '');
    for (const key of [rel, stem, stem + '.js', stem + '.cjs', stem + '.mjs', stem + '.json']) {
      const hit = apply(key);
      if (hit !== undefined) return hit;
    }
    return null;
  }

  /** Path of `to` relative to `from` (both absolute, normalized). */
  #relative(from: string, to: string): string {
    const a = p.segments(from);
    const b = p.segments(to);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
  }

  /** Resolve a package directory's entry point, honouring `browser` + `main`. */
  #packageEntry(dir: string, json: PackageJson): string | null {
    const candidates: string[] = [];
    if (typeof json.browser === 'string') {
      candidates.push(json.browser);
    } else if (json.browser && typeof json.browser === 'object') {
      const map = json.browser as Record<string, string | false>;
      const main = json.main ?? 'index.js';
      const stem = './' + main.replace(/^\.\//, '').replace(/\.js$/, '');
      for (const key of ['.', main, './' + main.replace(/^\.\//, ''), stem, stem + '.js']) {
        const value = map[key];
        if (typeof value === 'string') {
          candidates.push(value);
          break;
        }
      }
    }
    if (json.module) candidates.push(json.module);
    if (json.main) candidates.push(json.main);
    candidates.push('index.js', 'index.cjs', 'index.mjs', 'index.json');

    for (const candidate of candidates) {
      const found = this.#tryFileOrDir(p.join(dir, candidate));
      if (found) return found;
    }
    return null;
  }

  #tryFileOrDir(base: string): string | null {
    for (const ext of EXTENSIONS) {
      const candidate = base + ext;
      if (this.#vfs.exists(candidate)) {
        const st = this.#vfs.stat(candidate);
        if (st.type === 'file') return candidate;
      }
    }
    // directory: package.json (browser/main) / index.*
    if (this.#vfs.exists(base) && this.#vfs.stat(base).type === 'dir') {
      const json = this.#packageJson(base);
      if (json) {
        const entry = this.#packageEntry(base, json);
        if (entry) return entry;
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
    // The `browser` field is applied before the builtin check: bundlers let a
    // package drop a Node builtin entirely (`"fs": false` → `{}`).
    const remapped = this.#browserRemap(request, fromFile);
    if (remapped === EMPTY_MODULE) return {};
    if (remapped !== null) request = remapped;

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
    const requireFn = Object.assign(
      (request: string) => this.require(absPath, request),
      {
        resolve: (request: string, options?: { paths?: string[] }): string => {
          const fromDir = options?.paths?.[0] ?? dirname;
          const remapped = this.#browserRemap(request, absPath);
          return this.resolve(remapped && remapped !== EMPTY_MODULE ? remapped : request, fromDir);
        },
      },
    );
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
      const json = this.#packageJson(dir);
      if (json) return json.type === 'module';
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
