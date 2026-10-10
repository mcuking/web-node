/**
 * Spike: can the uni-app toolchain build H5 inside the web-node runtime?
 *
 * The blocker seen earlier is Vite's *config loading*: `vite-plugin-uni` lets
 * Vite auto-discover `vite.config.js`, and Vite bundles that config with
 * esbuild (`bundleConfigFile`). esbuild-wasm has no file system of its own, so
 * it fails with "Cannot read directory … / not implemented on js" before the
 * build even starts. Vite's own `externalize-deps` plugin declines the
 * entry-point (`kind === 'entry-point'` → return), leaving esbuild to resolve
 * the config against a file system it does not have.
 *
 * This spike injects a VFS-backed esbuild plugin via the loader's builtin
 * override for `esbuild`, so `build()` can resolve/load straight from the VFS.
 *
 * Everything here is throwaway (excluded from tsc by the leading underscore).
 */
import { describe, expect, it } from 'vitest';
import * as fssync from 'node:fs';
import * as npath from 'node:path';
import { NodeRuntime } from '../src/node-runtime/runtime';
import type { Vfs, Stat, Dirent, WriteOptions, MkdirOptions, ReaddirOptions } from '../src/node-runtime/vfs';

const ROOT = '/project';
const UNI_ROOT = process.env.UNI_SPIKE_ROOT ?? '/tmp/uni-spike/myuni';

/** A Vfs over a real host directory, mounted at /project. */
class DiskVfs implements Vfs {
  #root: string;
  #cwd = ROOT;
  constructor(root: string) {
    this.#root = root;
  }
  get cwd(): string {
    return this.#cwd;
  }
  chdir(dir: string): void {
    const r = this.resolve(dir);
    if (!this.exists(r)) throw Object.assign(new Error(`ENOENT: no such file or directory, chdir '${dir}'`), { code: 'ENOENT' });
    this.#cwd = r;
  }
  resolve(input: string): string {
    const s = String(input);
    const abs = s.startsWith('/') ? s : npath.posix.join(this.#cwd, s);
    return npath.posix.normalize(abs);
  }
  #host(p: string): string {
    const abs = this.resolve(p);
    if (abs !== ROOT && !abs.startsWith(ROOT + '/')) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, '${abs}'`), { code: 'ENOENT' });
    }
    const rel = abs === ROOT ? '' : abs.slice(ROOT.length + 1);
    return rel ? npath.join(this.#root, rel) : this.#root;
  }
  readFile(path: string): Uint8Array {
    return new Uint8Array(fssync.readFileSync(this.#host(path)));
  }
  writeFile(path: string, data: Uint8Array, _opts: WriteOptions = {}): void {
    fssync.writeFileSync(this.#host(path), data);
  }
  appendFile(path: string, data: Uint8Array): void {
    fssync.appendFileSync(this.#host(path), data);
  }
  exists(path: string): boolean {
    try {
      return fssync.existsSync(this.#host(path));
    } catch {
      return false;
    }
  }
  #stat(p: string, throwIfMissing: boolean): Stat {
    try {
      const s = fssync.statSync(this.#host(p));
      return {
        type: s.isDirectory() ? 'dir' : 'file',
        size: s.size,
        mode: s.mode,
        mtimeMs: s.mtimeMs,
        ctimeMs: s.ctimeMs,
        dev: 0, ino: 0, nlink: 1, uid: 0, gid: 0, rdev: 0,
        blksize: 4096, blocks: Math.ceil(s.size / 512),
        atimeMs: s.atimeMs, birthtimeMs: s.birthtimeMs,
      };
    } catch {
      if (!throwIfMissing) throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${p}'`), { code: 'ENOENT' });
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${p}'`), { code: 'ENOENT' });
    }
  }
  stat(path: string): Stat { return this.#stat(path, true); }
  lstat(path: string): Stat { return this.#stat(path, true); }
  mkdir(path: string, _opts: MkdirOptions = {}): string | undefined {
    fssync.mkdirSync(this.#host(path), { recursive: true });
    return undefined;
  }
  readdir(path: string, opts: ReaddirOptions = {}): Dirent[] {
    const host = this.#host(path);
    const names = fssync.readdirSync(host);
    if (!opts.withFileTypes) return names.map((name) => ({ name, type: 'file' as const }));
    return names.map((name) => {
      const s = fssync.lstatSync(npath.join(host, name));
      return { name, type: s.isDirectory() ? ('dir' as const) : ('file' as const) };
    });
  }
  rm(path: string, opts: { recursive?: boolean; force?: boolean; syscall?: 'unlink' | 'rmdir' | 'lstat' } = {}): void {
    fssync.rmSync(this.#host(path), { recursive: !!opts.recursive, force: !!opts.force });
  }
  rename(from: string, to: string): void {
    fssync.renameSync(this.#host(from), this.#host(to));
  }
  copyFile(from: string, to: string): void {
    fssync.copyFileSync(this.#host(from), this.#host(to));
  }
  chmod(path: string, mode: number): void {
    fssync.chmodSync(this.#host(path), mode);
  }
  realpath(input: string): string {
    const r = this.resolve(input);
    if (!this.exists(r)) throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${input}'`), { code: 'ENOENT' });
    return r;
  }
  subscribe(): () => void {
    return () => {};
  }
}

/** Resolve a relative/absolute VFS path to a file, trying extensions + index. */
function resolveVfsFile(vfs: Vfs, base: string): string | null {
  const candidates = [base, base + '.js', base + '.mjs', base + '.cjs', base + '.json', base + '.ts', base + '.mts', base + '.cts'];
  for (const c of candidates) {
    if (vfs.exists(c) && vfs.stat(c).type === 'file') return c;
  }
  if (vfs.exists(base) && vfs.stat(base).type === 'dir') {
    for (const idx of ['index.js', 'index.mjs', 'index.cjs', 'index.json', 'index.ts']) {
      const c = npath.posix.join(base, idx);
      if (vfs.exists(c) && vfs.stat(c).type === 'file') return c;
    }
  }
  return null;
}

function loaderFor(path: string): string {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  if (/\.(ts|mts|cts)$/.test(path)) return 'ts';
  return 'js';
}

/** The esbuild plugin that lets `build()` resolve/load from the VFS. */
function vfsEsbuildPlugin(vfs: Vfs) {
  return {
    name: 'web-node-vfs',
    setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => {
        if (args.kind === 'entry-point') {
          const p = vfs.resolve(args.path);
          const found = resolveVfsFile(vfs, p);
          return found ? { path: found } : null;
        }
        if (args.path.startsWith('node:')) return null;
        const isRelative = args.path.startsWith('.') || args.path.startsWith('/');
        if (!isRelative) return null; // bare specifiers: let Vite's externalize plugin decide
        const base = args.path.startsWith('/')
          ? args.path
          : npath.posix.join(npath.posix.dirname(args.importer || ROOT), args.path);
        const found = resolveVfsFile(vfs, base);
        return found ? { path: found } : null;
      });
      build.onLoad({ filter: /.*/ }, (args: any) => {
        // Let Vite's `inject-file-scope-variables` plugin read + rewrite JS/TS
        // (its fsp reads through the same VFS); only claim what it will not.
        if (/\.[cm]?[jt]s$/.test(args.path)) return null;
        const abs = vfs.resolve(args.path);
        if (!vfs.exists(abs) || vfs.stat(abs).type !== 'file') return null;
        return { contents: new TextDecoder().decode(vfs.readFile(abs)), loader: loaderFor(args.path) };
      });
    },
  };
}

function boot(args: string[], env: Record<string, string> = {}): { runtime: NodeRuntime; out: string[] } {
  const vfs = new DiskVfs(UNI_ROOT);
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/webnode-uni.mjs', ...args],
    env: { UNI_PLATFORM: 'h5', ...env },
    installGlobals: false,
    onStdout: (c) => { out.push(c); fssync.appendFileSync('/tmp/uni-spike-live.log', c); },
    onStderr: (c) => { out.push('ERR:' + c); fssync.appendFileSync('/tmp/uni-spike-live.log', 'ERR:' + c); },
  });

  // Wrap the esbuild module the runtime aliases to esbuild-wasm, prepending the
  // VFS plugin to every `build()` call. `import esbuild from 'esbuild'` and the
  // vite chunk's named imports then all see the patched module.
  const esbuildWasm = runtime.loader.require('/project/vite.config.js', 'esbuild-wasm') as Record<string, unknown>;
  const wrapper: Record<string, unknown> = {};
  for (const k of Object.getOwnPropertyNames(esbuildWasm)) wrapper[k] = esbuildWasm[k];
  const origBuild = esbuildWasm.build as (o: any) => unknown;
  wrapper.build = (opts: any) => origBuild({ ...opts, plugins: [vfsEsbuildPlugin(vfs), ...(opts?.plugins ?? [])] });
  wrapper.default = wrapper;
  runtime.loader.setBuiltinOverrides({ esbuild: wrapper });

  return { runtime, out };
}

const HAS_FIXTURE = fssync.existsSync(UNI_ROOT);

describe.skipIf(!HAS_FIXTURE)('uni-app spike', () => {
  it('builds h5', async () => {
    const { runtime, out } = boot(['build'], { NODE_ENV: 'production' });
    runtime.runMain('/project/webnode-uni.mjs');
    await runtime.drain(600000);
    const text = out.join('');
    console.log('=== H5 BUILD OUTPUT ===\n' + text);
    expect(text).toContain('Build complete');
  }, 600000);
});
