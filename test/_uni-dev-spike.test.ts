/**
 * Spike: can the uni-app H5 *dev server* run in the runtime? Runs the real
 * demo dev.mjs (from src/demo/uni-project.ts) plus a probe. Reuses the packages
 * installed by _uni-demo-spike. Throwaway (leading underscore).
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
  readdir(path: string, _opts: ReaddirOptions = {}): Dirent[] {
    const host = this.#host(path);
    return fssync.readdirSync(host).map((name) => {
      const s = fssync.statSync(npath.join(host, name));
      return { name, type: s.isDirectory() ? ('dir' as const) : ('file' as const) };
    });
  }
  rm(path: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
    fssync.rmSync(this.#host(path), { recursive: opts.recursive, force: opts.force });
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

/** A probe appended to the real dev.mjs so the spike can confirm it serves. */
const PROBE = `

// --- spike probe ---
import http from 'http';
function get(p, ms) {
  return new Promise(function (resolve, reject) {
    var req = http.get({ host: '127.0.0.1', port: 5176, path: p }, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
    });
    req.on('error', reject);
    if (ms) req.setTimeout(ms, function () { req.destroy(new Error('timeout')); });
  });
}
(async function () {
  var t0 = Date.now();
  for (;;) {
    try {
      const m = await get('/src/main.js', 20000);
      console.log('MAIN status=' + m.status + ' bytes=' + m.body.length);
      const page = await get('/src/pages/index/index.vue', 20000);
      console.log('PAGE status=' + page.status + ' bytes=' + page.body.length);
      const idx = await get('/', 20000);
      console.log('PROBE / status=' + idx.status + ' bytes=' + idx.body.length);
      console.log('DEV-READY');
      return;
    } catch (e) {
      console.log('probe ' + (e && e.message ? e.message : e));
    }
    if (Date.now() - t0 > 90000) { console.log('DEV-TIMEOUT'); return; }
    await new Promise(function (r) { setTimeout(r, 500); });
  }
})();
`;

function writeFiles(): void {
  for (const [path, contents] of Object.entries(UNI_PROJECT_FILES)) {
    const host = npath.join(HOST_ROOT, path.slice(PREFIX.length + 1));
    fssync.mkdirSync(npath.dirname(host), { recursive: true });
    fssync.writeFileSync(host, contents);
  }
  fssync.writeFileSync(npath.join(HOST_ROOT, 'uni/dev.mjs'), UNI_PROJECT_FILES['/project/uni/dev.mjs'] + PROBE);
}

const ENABLED = process.env.UNI_DEV_SPIKE === '1';

describe.skipIf(!ENABLED)('uni-app dev spike', () => {
  it('boots the h5 dev server and serves modules', async () => {
    const hasDeps = fssync.existsSync(npath.join(HOST_ROOT, 'uni/node_modules/@dcloudio/vite-plugin-uni'));
    if (!hasDeps) {
      fssync.rmSync(HOST_ROOT, { recursive: true, force: true });
      fssync.mkdirSync(HOST_ROOT, { recursive: true });
      writeFiles();
      const installed = await installProject(new DiskVfs(HOST_ROOT), {
        cwd: '/project/uni', fetch: globalThis.fetch.bind(globalThis) as never, registry: REGISTRY, concurrency: 12, log: (m) => console.log('[npm] ' + m), maxPackages: 4000,
      });
      console.log('installed packages: ' + installed.packages);
    } else {
      writeFiles();
    }

    const out: string[] = [];
    const liveLog = '/tmp/uni-dev-live.log';
    fssync.writeFileSync(liveLog, '');
    const runtime = new NodeRuntime({
      vfs: new DiskVfs(HOST_ROOT),
      argv: ['/project/uni/dev.mjs'],
      env: { NODE_ENV: 'development' },
      installGlobals: false,
      onStdout: (c) => { out.push(c); fssync.appendFileSync(liveLog, c); },
      onStderr: (c) => { out.push('ERR:' + c); fssync.appendFileSync(liveLog, 'ERR:' + c); },
    });
    runtime.runMain('/project/uni/dev.mjs');
    const done = () => /DEV-READY|DEV-FAILED|DEV-TIMEOUT/.test(out.join(''));
    for (let i = 0; i < 480 && !done(); i++) await new Promise((r) => setTimeout(r, 250));
    const text = out.join('');
    console.log('=== dev output ===\n' + text);
    expect(text).toContain('listening   : http://127.0.0.1:5176');
    expect(text).toContain('PROBE / status=200');
  }, 900000);
});
