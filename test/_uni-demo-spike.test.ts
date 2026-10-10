/**
 * Spike: does the uni-app *demo* (src/demo/uni-project.ts) install and build
 * end-to-end inside the runtime, using the runtime's own installer?
 *
 * Writes the demo files to a real directory (mapped to /project by a DiskVfs),
 * installs dependencies with the runtime's npm installer against the real
 * registry, then runs the demo's build.mjs. Throwaway (leading underscore).
 */
import { describe, expect, it } from 'vitest';
import * as fssync from 'node:fs';
import * as npath from 'node:path';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { installProject } from '../src/node-runtime/npm';
import type { Vfs, Stat, Dirent, WriteOptions, MkdirOptions, ReaddirOptions } from '../src/node-runtime/vfs';
import { UNI_PROJECT_FILES } from '../src/demo/uni-project';

const PREFIX = '/project';
const HOST_ROOT = process.env.UNI_DEMO_ROOT ?? '/tmp/uni-demo';
const REGISTRY = process.env.UNI_DEMO_REGISTRY ?? 'https://registry.npmmirror.com';

class DiskVfs implements Vfs {
  #root: string;
  #cwd = PREFIX;
  constructor(root: string) {
    this.#root = root;
  }
  get cwd(): string {
    return this.#cwd;
  }
  chdir(dir: string): void {
    const r = this.resolve(dir);
    if (!this.exists(r) || this.stat(r).type !== 'dir') throw Object.assign(new Error(`ENOENT: chdir '${dir}'`), { code: 'ENOENT' });
    this.#cwd = r;
  }
  resolve(input: string): string {
    const s = String(input);
    const abs = s.startsWith('/') ? s : npath.posix.join(this.#cwd, s);
    return npath.posix.normalize(abs);
  }
  #host(p: string): string {
    const abs = this.resolve(p);
    if (abs !== PREFIX && !abs.startsWith(PREFIX + '/')) throw Object.assign(new Error(`ENOENT: '${abs}'`), { code: 'ENOENT' });
    const rel = abs === PREFIX ? '' : abs.slice(PREFIX.length + 1);
    return rel ? npath.join(this.#root, rel) : this.#root;
  }
  readFile(path: string): Uint8Array {
    return new Uint8Array(fssync.readFileSync(this.#host(path)));
  }
  writeFile(path: string, data: Uint8Array, _opts: WriteOptions = {}): void {
    fssync.mkdirSync(npath.dirname(this.#host(path)), { recursive: true });
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
  stat(path: string): Stat {
    try {
      const s = fssync.statSync(this.#host(path));
      return {
        type: s.isDirectory() ? 'dir' : 'file', size: s.size, mode: s.mode, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs,
        dev: 0, ino: 0, nlink: 1, uid: 0, gid: 0, rdev: 0, blksize: 4096, blocks: Math.ceil(s.size / 512), atimeMs: s.atimeMs, birthtimeMs: s.birthtimeMs,
      };
    } catch {
      throw Object.assign(new Error(`ENOENT: stat '${path}'`), { code: 'ENOENT' });
    }
  }
  lstat(path: string): Stat {
    return this.stat(path);
  }
  mkdir(path: string, _opts: MkdirOptions = {}): string | undefined {
    fssync.mkdirSync(this.#host(path), { recursive: true });
    return undefined;
  }
  readdir(path: string, opts: ReaddirOptions = {}): Dirent[] {
    const host = this.#host(path);
    const names = fssync.readdirSync(host);
    return names.map((name) => {
      const s = fssync.statSync(npath.join(host, name));
      return { name, type: s.isDirectory() ? ('dir' as const) : ('file' as const) };
    });
  }
  rm(path: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
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
    return this.resolve(input);
  }
  subscribe(): () => void {
    return () => {};
  }
}

function writeDemoFiles(): void {
  fssync.rmSync(HOST_ROOT, { recursive: true, force: true });
  fssync.mkdirSync(HOST_ROOT, { recursive: true });
  for (const [path, contents] of Object.entries(UNI_PROJECT_FILES)) {
    const host = npath.join(HOST_ROOT, path.slice(PREFIX.length + 1));
    fssync.mkdirSync(npath.dirname(host), { recursive: true });
    fssync.writeFileSync(host, contents);
  }
}

const ENABLED = process.env.UNI_DEMO_SPIKE === '1';

describe.skipIf(!ENABLED)('uni-app demo', () => {
  it('installs and builds h5', async () => {
    writeDemoFiles();
    const vfs = new DiskVfs(HOST_ROOT);

    console.log('=== install ===');
    const installed = await installProject(vfs, {
      cwd: '/project/uni',
      fetch: globalThis.fetch.bind(globalThis) as never,
      registry: REGISTRY,
      concurrency: 12,
      log: (m) => console.log('[npm] ' + m),
      maxPackages: 4000,
    });
    console.log('installed packages: ' + installed.packages);

    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/uni/build.mjs'],
      env: { NODE_ENV: 'production' },
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: (c) => out.push('ERR:' + c),
    });
    runtime.runMain('/project/uni/build.mjs');
    await runtime.drain(900000);
    const text = out.join('');
    console.log('=== build output ===\n' + text);
    expect(text).toContain('Build complete');
    expect(fssync.existsSync(npath.join(HOST_ROOT, 'uni/dist/build/h5/index.html'))).toBe(true);
  }, 900000);
});
