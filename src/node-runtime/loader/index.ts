import type { Realm } from '../realm';
import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import { transformEsmToCjs, EXPORTS_BINDING, REQUIRE_BINDING, IMPORT_BINDING } from './esm-transform';
import { codeMask } from './code-mask';
import { notImplemented } from '../errors';
import { compileTagged } from '../vm';

const USER_CJS_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'] as const;
const EXTENSIONS = ['', '.js', '.cjs', '.mjs', '.json'];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
/** Shared empty arrays for the no-injection paths (never mutated). */
const EMPTY_GLOBALS: [] = [];

/**
 * Names bound at a module's top level by `let`/`const`/`class`.
 *
 * Sandbox globals are injected into every module as wrapper *parameters*, so a
 * module that also declares one of those names lexically at its top level cannot
 * compile — V8 rejects it with `Identifier 'X' has already been declared`. That
 * is not hypothetical: bundles do this (`const WebSocket = websocket;`,
 * `const btoa = …`) and it crosses library boundaries. Such a name is therefore
 * excluded from the parameter list for *that* module only, so its own binding
 * wins while every other module still sees the sandbox global.
 *
 * Strings, templates and comments are masked first, so a name inside a literal
 * is not mistaken for a declaration.
 */
function topLevelLexicalBindings(code: string): Set<string> {
  const names = new Set<string>();
  const mask = codeMask(code);
  const n = code.length;
  const readIdent = (from: number): { name: string; end: number } => {
    let j = from;
    while (j < n && mask[j] === 1 && IDENT_PART.test(code[j])) j++;
    return { name: code.slice(from, j), end: j };
  };
  let depth = 0;
  let i = 0;
  while (i < n) {
    if (mask[i] === 0) {
      i++;
      continue;
    }
    const ch = code[i];
    if (ch === '{' || ch === '(' || ch === '[') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && IDENT_START.test(ch)) {
      const { name, end } = readIdent(i);
      if (name === 'let' || name === 'const' || name === 'class') {
        let j = end;
        while (j < n && mask[j] === 1 && /\s/.test(code[j])) j++;
        if (j < n && mask[j] === 1 && IDENT_START.test(code[j])) names.add(readIdent(j).name);
      }
      i = end;
      continue;
    }
    i++;
  }
  return names;
}

/**
 * The name V8 reports in a "redeclaration" SyntaxError, or `null`.
 *
 * `topLevelLexicalBindings` above is intentionally shallow (it only looks at
 * the identifier right after `const`/`let`/`class`), so it misses destructuring
 * like `const { Buffer } = require('buffer')`. Rather than reimplement a JS
 * parser, we let the compiler tell us when an injected wrapper parameter
 * collides with a real declaration and drop just that one parameter.
 */
function redeclaredIdentifier(message: string): string | null {
  const m = /Identifier '([A-Za-z_$][\w$]*)' has already been declared/.exec(message);
  return m ? m[1] : null;
}

/**
 * Drop a leading `#!` line.
 *
 * Node does this for the main module, and it matters more here than there: a
 * program reached through a `.bin` shim starts with `#!/usr/bin/env node` (both
 * npm's shims and ours do), and handing that byte pair to `new Function` is a
 * syntax error rather than a shebang.
 */
export function stripShebang(source: string): string {
  if (!source.startsWith('#!')) return source;
  const newline = source.indexOf('\n');
  return newline === -1 ? '' : source.slice(newline + 1);
}

/**
 * Sentinel returned when a `browser` field maps a specifier to `false`
 * ("this module is empty in the browser"). Resolving to a real VFS path would
 * either miss or pick up the Node-only file we were told to drop.
 */
export const EMPTY_MODULE = '\u0000web-node:empty';

interface PackageJson {
  name?: string;
  main?: string;
  module?: string;
  browser?: string | Record<string, string | false>;
  type?: string;
  exports?: unknown;
}

type Condition = 'import' | 'require';

/**
 * Package `exports` resolution conditions.
 *
 * We emulate Node, so `node` is included; `browser` is deliberately omitted so
 * resolution stays deterministic (DOM-targeted builds are reached through the
 * `browser` *field* when a package declares one).
 */
function conditionsFor(condition: Condition): string[] {
  return condition === 'import' ? ['node', 'import', 'default'] : ['node', 'require', 'default'];
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
  #aliases: Record<string, string>;
  /**
   * Builtins this registry should resolve to something other than the realm's
   * shared instance. Only a worker uses it: inside a worker, `require('worker_threads')`
   * must hand back the worker-side view (`isMainThread === false`, its own
   * `parentPort`/`workerData`), not the main thread's module.
   */
  #builtinOverrides: Record<string, unknown> = {};
  #globalNames!: string[];
  #globalValues!: unknown[];
  #paramNames!: string[];

  constructor(realm: Realm, vfs: Vfs, globals: Record<string, unknown> = {}) {
    this.#realm = realm;
    this.#vfs = vfs;
    this.#globals = globals;
    this.#aliases = {};
    this.#syncGlobals();
  }

  setGlobals(globals: Record<string, unknown>): void {
    this.#globals = globals;
    this.#syncGlobals();
  }

  /** Register worker-side replacements for core modules in this registry. */
  setBuiltinOverrides(overrides: Record<string, unknown>): void {
    this.#builtinOverrides = { ...overrides };
  }

  /**
   * Replace one package with another at resolution time, e.g.
   * `{ rollup: '@rollup/wasm-node', esbuild: 'esbuild-wasm' }`.
   *
   * This is how a native-binary dependency is swapped for its WASM/browser
   * counterpart without touching the installed tree — the same trick bundler
   * ports use. Subpaths are rewritten too (`rollup/parseAst` →
   * `@rollup/wasm-node/parseAst`).
   */
  setAliases(aliases: Record<string, string>): void {
    this.#aliases = { ...aliases };
  }

  get aliases(): Record<string, string> {
    return { ...this.#aliases };
  }

  /** Apply the alias map to a bare specifier, if one matches. */
  #applyAlias(request: string): string {
    if (request.startsWith('.') || p.isAbsolute(request)) return request;
    const exact = this.#aliases[request];
    if (exact) return exact;
    const slash = request.indexOf('/');
    // scoped package: keep `@scope/name` together when splitting
    const nameEnd = request.startsWith('@') ? request.indexOf('/', slash + 1) : slash;
    if (nameEnd > 0) {
      const head = request.slice(0, nameEnd);
      const replacement = this.#aliases[head];
      if (replacement) return replacement + request.slice(nameEnd);
    }
    return request;
  }

  /**
   * Recompute the globals injected into every CommonJS wrapper.
   *
   * Only globals whose sandbox value *differs* from the host's are injected.
   * Identical ones (btoa, performance, TextEncoder, …) are reachable through
   * the real global scope anyway, and injecting them as parameters would clash
   * with a module's own top-level `const btoa = …` (`Identifier 'btoa' has
   * already been declared`) — a real failure seen with rollup.
   */
  #syncGlobals(): void {
    const host = globalThis as unknown as Record<string, unknown>;
    const names: string[] = [];
    const values: unknown[] = [];
    for (const [name, value] of Object.entries(this.#globals)) {
      if (value === host[name]) continue;
      names.push(name);
      values.push(value);
    }
    this.#globalNames = names;
    this.#globalValues = values;
    this.#paramNames = [...USER_CJS_PARAMS, ...names];
  }

  /**
   * The injected globals that are safe for *this* module: everything except a
   * name the module itself binds at its top level with `let`/`const`/`class`
   * (see `topLevelLexicalBindings`). In the common case nothing is excluded and
   * the shared arrays are returned without copying.
   */
  #injectedGlobals(code: string): { names: string[]; values: unknown[] } {
    const names = this.#globalNames;
    if (names.length === 0) return { names: EMPTY_GLOBALS, values: EMPTY_GLOBALS };
    const declared = topLevelLexicalBindings(code);
    if (declared.size === 0) return { names, values: this.#globalValues };
    const keptNames: string[] = [];
    const keptValues: unknown[] = [];
    for (let i = 0; i < names.length; i++) {
      if (declared.has(names[i])) continue;
      keptNames.push(names[i]);
      keptValues.push(this.#globalValues[i]);
    }
    return { names: keptNames, values: keptValues };
  }

  get realm(): Realm {
    return this.#realm;
  }

  /** Node's require resolution order, reduced to what the VFS supports. */
  resolve(request: string, fromDir: string, condition: Condition = 'require'): string {
    request = this.#applyAlias(request);
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
      const found = this.#resolveInNodeModules(nmDir, request, condition);
      if (found) return found;
    }
    throw Object.assign(new Error(`Cannot find module '${request}' from '${fromDir}'`), { code: 'MODULE_NOT_FOUND' });
  }

  /** Resolve `request` inside `nmDir` (a `node_modules` directory), if present. */
  #resolveInNodeModules(nmDir: string, request: string, condition: Condition): string | null {
    // Split `@scope/name/rest` into the package name and the subpath.
    const isScoped = request.startsWith('@');
    const firstSlash = request.indexOf('/');
    let nameEnd: number;
    if (isScoped) {
      // `@scope/name` needs its second slash; without one the whole id is the name.
      nameEnd = firstSlash < 0 ? -1 : request.indexOf('/', firstSlash + 1);
    } else {
      nameEnd = firstSlash;
    }
    const pkgName = nameEnd < 0 ? request : request.slice(0, nameEnd);
    const subpath = nameEnd < 0 ? '' : request.slice(nameEnd + 1);
    if (pkgName === '') return null;

    const pkgDir = p.join(nmDir, pkgName);
    if (!this.#vfs.exists(pkgDir) || this.#vfs.stat(pkgDir).type !== 'dir') return null;
    const json = this.#packageJson(pkgDir);

    // `exports` takes precedence over `main` whenever it is present.
    if (json?.exports !== undefined) {
      const target = this.#resolveExports(json.exports, pkgDir, subpath, conditionsFor(condition));
      if (target) {
        const found = this.#tryFileOrDir(target);
        if (found) return found;
      }
      // A package with `exports` is *sealed*: Node does not fall back to `main`
      // for an unmatched subpath. But being permissive here is more useful than
      // failing, so we still try the direct path below.
    }

    if (subpath === '') {
      if (json) {
        const entry = this.#packageEntry(pkgDir, json);
        if (entry) return entry;
      }
      return this.#tryFileOrDir(pkgDir);
    }
    return this.#tryFileOrDir(p.join(pkgDir, subpath));
  }

  /**
   * Resolve a package's `exports` field for a subpath (`''` = the root `.`).
   *
   * Supports the shapes real packages use: a bare string, an array of
   * fallbacks, a conditions object (`{ import, require, default }`) and a
   * subpath map (`{ '.': …, './runtime': …, './dist/*': … }`) with `*` patterns.
   */
  #resolveExports(field: unknown, pkgDir: string, subpath: string, conditions: string[]): string | null {
    const target = subpath === '' ? '.' : './' + subpath;
    const hit = this.#walkExports(field, target, conditions);
    return hit ? p.join(pkgDir, hit) : null;
  }

  #walkExports(node: unknown, target: string, conditions: string[]): string | null {
    if (typeof node === 'string') {
      return node.startsWith('./') ? node : null;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = this.#walkExports(item, target, conditions);
        if (hit) return hit;
      }
      return null;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const keys = Object.keys(obj);
      const isSubpathMap = keys.some((k) => k.startsWith('.'));
      if (isSubpathMap) {
        // Longest matching key wins; `*` captures the rest.
        let bestKey: string | null = null;
        let bestStar = '';
        for (const key of keys) {
          if (!key.startsWith('.')) continue;
          if (key === target) {
            bestKey = key;
            bestStar = '';
            break;
          }
          const star = key.indexOf('*');
          if (star >= 0) {
            const prefix = key.slice(0, star);
            const suffix = key.slice(star + 1);
            if (target.startsWith(prefix) && target.endsWith(suffix) && target.length >= key.length - 1) {
              if (!bestKey || key.length > bestKey.length) {
                bestKey = key;
                bestStar = target.slice(prefix.length, target.length - suffix.length);
              }
            }
          }
        }
        if (!bestKey) return null;
        const value = this.#walkExports(obj[bestKey], target, conditions);
        return value && bestStar !== '' ? value.split('*').join(bestStar) : value;
      }
      // conditions object
      for (const condition of conditions) {
        if (Object.prototype.hasOwnProperty.call(obj, condition)) {
          const hit = this.#walkExports(obj[condition], target, conditions);
          if (hit) return hit;
        }
      }
      return null;
    }
    return null;
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

    // `browser` field *targets* are resolved relative to the package root, not
    // the requesting file (`{ "util": "./lib/util-browser.js" }` in tapable
    // means `<pkg>/lib/util-browser.js`). A bare target is a plain specifier.
    const target = (value: string | false): string => {
      if (value === false) return EMPTY_MODULE;
      if (value.startsWith('.')) return p.resolve(owner.dir, value);
      return value;
    };

    const apply = (key: string): string | null | undefined => {
      if (!Object.prototype.hasOwnProperty.call(map, key)) return undefined;
      return target(map[key]);
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
    if (json.main) candidates.push(json.main);
    if (json.module) candidates.push(json.module);
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
  require = (fromFile: string, request: string, condition: Condition = 'require'): unknown => {
    if (typeof request !== 'string') {
      throw new TypeError(`The "id" argument must be of type string. Received ${typeof request}`);
    }
    // The `browser` field is applied before the builtin check: bundlers let a
    // package drop a Node builtin entirely (`"fs": false` → `{}`).
    const remapped = this.#browserRemap(request, fromFile);
    if (remapped === EMPTY_MODULE) return {};
    if (remapped !== null) request = remapped;

    const override = this.#builtinOverrides[request];
    if (override !== undefined) return override;
    if (this.#realm.hasBuiltin(request)) return this.#realm.require(request);
    if (request.startsWith('node:')) {
      throw notImplemented('module', request, 'Only whitelisted core modules are exposed.');
    }
    const fromDir = p.dirname(fromFile);
    const resolved = this.resolve(request, fromDir, condition);
    return this.loadModule(resolved);
  };

  /**
   * Load a module by absolute VFS path.
   *
   * `sourceOverride` lets the runtime execute a module whose text does not come
   * from the VFS — `node -e` / `node -p` inside a spawned program. Everything
   * else about the load (resolution root, module type, wrapper parameters) is
   * derived from the path exactly as usual.
   */
  loadModule(absPath: string, sourceOverride?: string): unknown {
    const cached = this.#cache.get(absPath);
    if (cached && sourceOverride === undefined) return cached.exports;

    if (absPath.endsWith('.json') && sourceOverride === undefined) {
      const text = new TextDecoder().decode(this.#vfs.readFile(absPath));
      const exports = JSON.parse(text);
      this.#cache.set(absPath, { exports, state: 'loaded' });
      return exports;
    }

    const source = stripShebang(sourceOverride ?? new TextDecoder().decode(this.#vfs.readFile(absPath)));
    const isEsm = absPath.endsWith('.mjs') || (absPath.endsWith('.js') && this.#isPackageEsm(absPath));

    const mod: UserModule = { exports: {}, state: 'loading' };
    this.#cache.set(absPath, mod);

    const code = isEsm ? transformEsmToCjs(source, `file://${absPath}`).code : source;
    const dirname = p.dirname(absPath);
    // Tag the compiled unit (the post-transform text, so frame line numbers
    // line up) with a URL. This gives stack frames a real file name — instead of
    // `<anonymous>` — and lets `internal/errors/error_source` recover the source
    // line for assertions like `assert.ok`.
    const sourceUrl = isEsm ? `file://${absPath}` : absPath;

    // A module that declares its own top-level `const`/`let`/`class` under a
    // name that is also injected as a wrapper parameter cannot compile, so the
    // few such names are dropped for this module (see `#injectedGlobals`).
    const { names: globalNames, values: globalValues } = this.#injectedGlobals(code);

    // Real ESM has no `__filename`/`__dirname`/`require`/`exports` in scope, and
    // modules routinely declare their own (`const require = createRequire(...)`,
    // `const __filename = fileURLToPath(import.meta.url)`, as Vite's chunks do).
    // So ESM gets only the prefixed bindings the transform emits; CJS keeps the
    // Node-shaped parameter list.
    const esmParams = [EXPORTS_BINDING, REQUIRE_BINDING, IMPORT_BINDING, ...globalNames];
    const cjsParams = [...USER_CJS_PARAMS, ...globalNames];

    // The shallow `topLevelLexicalBindings` scan misses destructuring-of-require
    // (`const { Buffer } = require('buffer')`) and similar, so a wrapper
    // parameter can still collide with a real declaration. V8 reports every
    // collision by name in one SyntaxError, so on failure we drop the named
    // parameter(s) and retry — a bounded loop that converges.
    let globals = globalNames;
    let globalVals = globalValues;
    let fn: (...args: unknown[]) => void;
    for (;;) {
      const params = isEsm ? esmParams : cjsParams;
      try {
        fn = compileTagged(params, code, sourceUrl) as unknown as (...args: unknown[]) => void;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const redeclared = redeclaredIdentifier(message);
        const dropAt = globals.indexOf(redeclared ?? '\u0000');
        if (redeclared === null || dropAt === -1) {
          this.#cache.delete(absPath);
          throw new Error(`Failed to compile ${absPath}: ${message}`);
        }
        globals = globals.filter((_, i) => i !== dropAt);
        globalVals = globalVals.filter((_, i) => i !== dropAt);
        // Rebuild the ESM/CJS parameter lists rather than splice the originals.
        esmParams.length = 0;
        esmParams.push(EXPORTS_BINDING, REQUIRE_BINDING, IMPORT_BINDING, ...globals);
        cjsParams.length = 0;
        cjsParams.push(...USER_CJS_PARAMS, ...globals);
      }
    }
    const moduleObj = { exports: mod.exports };
    // ESM files resolve their imports under the `import` condition so that
    // `exports` maps (`{ import, require }`) pick the right entry.
    const reqCondition: Condition = isEsm ? 'import' : 'require';
    const requireFn = Object.assign(
      (request: string) => this.require(absPath, request, reqCondition),
      {
        resolve: (request: string, options?: { paths?: string[] }): string => {
          const fromDir = options?.paths?.[0] ?? dirname;
          const remapped = this.#browserRemap(request, absPath);
          return this.resolve(remapped && remapped !== EMPTY_MODULE ? remapped : request, fromDir, reqCondition);
        },
      },
    );
    // Dynamic `import()` resolves relative to the importing module and always
    // uses the `import` condition, like real ESM.
    const dynamicImport = (specifier: string): Promise<unknown> =>
      Promise.resolve().then(() => this.require(absPath, specifier, 'import'));
    try {
      if (isEsm) fn(moduleObj.exports, requireFn, dynamicImport, ...globalVals);
      else fn(moduleObj.exports, requireFn, moduleObj, absPath, dirname, ...globalVals);
    } catch (err) {
      this.#cache.delete(absPath);
      // eslint-disable-next-line no-console
      if ((globalThis as { __WN_DEBUG__?: boolean }).__WN_DEBUG__) console.error('load error in', absPath, err);
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
