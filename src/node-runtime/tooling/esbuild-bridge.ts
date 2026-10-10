import * as p from '../vfs/posix';
import type { Vfs } from '../vfs';

/**
 * The esbuild ⇄ VFS bridge.
 *
 * A browser tab has no file system, so the runtime aliases `esbuild` to
 * `esbuild-wasm` (see `MODULE_ALIASES`). That keeps `transform()` working — it
 * is a pure string-in/string-out call — but `build()` is a different story:
 * esbuild's wasm build has *no* file system of its own and reports
 * `Cannot read directory "…": not implemented on js` the moment it has to
 * resolve or read a file. Its only file door is a **plugin** (`onResolve` /
 * `onLoad`), so a tool that lets esbuild read the project directly (Vite
 * auto-discovering `vite.config.js`, for one) fails before it starts.
 *
 * This bridge closes that door: it appends a plugin to every `build()` call
 * that resolves and loads from the runtime's virtual file system, so esbuild
 * reads the same tree the rest of the runtime does. The plugin is appended
 * *last*, so any plugin the caller (or Vite) already installed keeps priority
 * and this one only handles what would otherwise fall through to esbuild's
 * own — and broken — file system.
 */

/** Try a path as a file (with extensions), then as a directory index. */
function resolveFile(vfs: Vfs, base: string): string | null {
  for (const ext of ['', '.js', '.mjs', '.cjs', '.json', '.ts', '.mts', '.cts']) {
    const candidate = base + ext;
    if (vfs.exists(candidate) && vfs.stat(candidate).type === 'file') return candidate;
  }
  if (vfs.exists(base) && vfs.stat(base).type === 'dir') {
    for (const idx of ['index.js', 'index.mjs', 'index.cjs', 'index.json', 'index.ts']) {
      const candidate = p.join(base, idx);
      if (vfs.exists(candidate) && vfs.stat(candidate).type === 'file') return candidate;
    }
  }
  return null;
}

/** The esbuild `loader` to use for a path (esbuild transforms by extension). */
function loaderFor(path: string): string {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  if (/\.(ts|mts|cts)$/.test(path)) return 'ts';
  if (/\.(tsx)$/.test(path)) return 'tsx';
  if (/\.(jsx)$/.test(path)) return 'jsx';
  return 'js';
}

/** The plugin that lets `build()` resolve and load from the VFS. */
export function vfsEsbuildPlugin(vfs: Vfs): { name: string; setup(build: EsbuildBuild): void } {
  return {
    name: 'web-node-vfs',
    setup(build: EsbuildBuild) {
      build.onResolve({ filter: /.*/ }, (args: EsbuildResolveArgs) => {
        if (args.kind === 'entry-point') {
          const found = resolveFile(vfs, vfs.resolve(args.path));
          return found ? { path: found } : null;
        }
        // Core modules and bare specifiers are left for the caller's plugins
        // (Vite externalises bare deps; the runtime provides the core modules).
        if (args.path.startsWith('node:')) return null;
        const relative = args.path.startsWith('.') || args.path.startsWith('/');
        if (!relative) return null;
        const base = args.path.startsWith('/')
          ? args.path
          : p.join(p.dirname(args.importer || vfs.cwd), args.path);
        const found = resolveFile(vfs, base);
        return found ? { path: found } : null;
      });
      build.onLoad({ filter: /.*/ }, (args: EsbuildLoadArgs) => {
        // JavaScript/TypeScript is left to the caller's loaders — Vite's
        // `inject-file-scope-variables` reads + rewrites it through the same
        // VFS. Only the loaders it does not claim (JSON, CSS, …) are handled
        // here; anything absent from the VFS falls through, so the real error
        // still surfaces.
        if (/\.[cm]?[jt]sx?$/.test(args.path)) return null;
        const abs = vfs.resolve(args.path);
        if (!vfs.exists(abs) || vfs.stat(abs).type !== 'file') return null;
        return { contents: new TextDecoder().decode(vfs.readFile(abs)), loader: loaderFor(args.path) };
      });
    },
  };
}

interface EsbuildResolveArgs {
  path: string;
  importer: string;
  kind: string;
}
interface EsbuildLoadArgs {
  path: string;
}
interface EsbuildBuild {
  onResolve(options: { filter: RegExp }, callback: (args: EsbuildResolveArgs) => unknown): void;
  onLoad(options: { filter: RegExp }, callback: (args: EsbuildLoadArgs) => unknown): void;
}

/**
 * Wrap an `esbuild` module so every `build()` call sees the VFS plugin.
 *
 * The wrapper is a flat copy of the module with `build` replaced; `default` is
 * pointed back at the wrapper so both `import esbuild from 'esbuild'` and
 * `import { build } from 'esbuild'` reach the patched function. `transform` and
 * everything else are passed straight through.
 */
export function wrapEsbuild(esbuild: Record<string, unknown>, vfs: Vfs): Record<string, unknown> {
  const wrapped: Record<string, unknown> = Object.create(Object.getPrototypeOf(esbuild) ?? Object.prototype);
  for (const key of Reflect.ownKeys(esbuild)) {
    // `build` and `default` are redefined below (esbuild exports them as
    // getter-only properties, so a plain copy could not be reassigned).
    if (key === 'build' || key === 'default') continue;
    const descriptor = Object.getOwnPropertyDescriptor(esbuild, key);
    if (descriptor) Object.defineProperty(wrapped, key, descriptor);
  }
  const original = esbuild.build;
  const define = (key: string, value: unknown) =>
    Object.defineProperty(wrapped, key, { value, writable: true, enumerable: true, configurable: true });
  if (typeof original === 'function') {
    const plugin = vfsEsbuildPlugin(vfs);
    define('build', (options: Record<string, unknown> = {}) => {
      const plugins = Array.isArray(options.plugins) ? (options.plugins as unknown[]) : [];
      return (original as (o: unknown) => unknown).call(esbuild, { ...options, plugins: [...plugins, plugin] });
    });
  }
  // Both import styles must reach the patched module.
  define('default', wrapped);
  return wrapped;
}

/**
 * The tooling wrappers the runtime installs, keyed by the *request* a module
 * uses. Only the aliased name (`esbuild`) is wrapped: that is what Vite and the
 * demo scripts require, and it is the alias target the loader maps to
 * `esbuild-wasm`.
 */
export function createToolingWrappers(vfs: Vfs): Record<string, (module: unknown) => unknown> {
  return {
    esbuild: (module) => wrapEsbuild(module as Record<string, unknown>, vfs),
  };
}
