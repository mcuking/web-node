import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const DEPS: Array<[string, string]> = [
  ['vite', '/tmp/vt/package'],
  ['postcss', '/tmp/vdeps/postcss'],
  ['esbuild-wasm', '/tmp/vdeps/esbuild-wasm'],
  ['@rollup/wasm-node', '/tmp/rw/package'],
  ['nanoid', '/tmp/vdeps/nanoid'],
  ['picocolors', '/tmp/vdeps/picocolors'],
  ['source-map-js', '/tmp/vdeps/source-map-js'],
];

function loadDir(vfs: MemoryVfs, diskDir: string, vfsDir: string): void {
  for (const name of readdirSync(diskDir)) {
    const diskPath = join(diskDir, name);
    const vfsPath = vfsDir + '/' + name;
    const st = statSync(diskPath);
    if (st.isDirectory()) {
      vfs.mkdir(vfsPath, { recursive: true });
      loadDir(vfs, diskPath, vfsPath);
    } else {
      vfs.writeFile(vfsPath, new Uint8Array(readFileSync(diskPath)));
    }
  }
}

describe('M5c feasibility: vite build in the runtime', () => {
  it('boots vite and bundles a project', async () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    for (const [name, disk] of DEPS) {
      const vfsDir = '/project/node_modules/' + name;
      vfs.mkdir(vfsDir, { recursive: true });
      loadDir(vfs, disk, vfsDir);
    }
    vfs.mkdir('/project/src', { recursive: true });
    vfs.writeFile('/project/src/main.js', new TextEncoder().encode(`document.body.textContent = 'hi vite';`));
    vfs.writeFile('/project/index.html', new TextEncoder().encode(`<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>`));
    vfs.writeFile('/project/package.json', new TextEncoder().encode(JSON.stringify({ name: 'p', version: '1.0.0' })));

    vfs.writeFile(
      '/project/build.mjs',
      new TextEncoder().encode(`
        import { build, version } from 'vite';
        import * as esbuild from 'esbuild';
        import fs from 'fs';

        (async function () {
          console.log('VITE VERSION ' + version);
          // Vite expects the *native* esbuild, which cannot load in a tab. The
          // runtime aliases 'esbuild' to the WASM build, which must be started
          // explicitly (this is what the real UI does before running a project).
          const wasm = fs.readFileSync('/project/node_modules/esbuild-wasm/esbuild.wasm');
          await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });

          const out = await build({
            root: '/project',
            logLevel: 'silent',
            build: { write: false, minify: false },
          });
          const res = Array.isArray(out) ? out[0] : out;
          console.log('OK ' + JSON.stringify(res.output.map(function (c) { return c.fileName; })));
        })().catch(function (e) { console.log('FAILED ' + (e && e.stack ? e.stack : e)); });
      `),
    );

    const out: string[] = [];
    const err: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/build.mjs'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: (c) => err.push(c),
    });
    runtime.runMain('/project/build.mjs');
    const done = () => out.join('').includes('OK ') || out.join('').includes('FAILED');
    for (let i = 0; i < 150 && !done(); i++) await new Promise((r) => setTimeout(r, 100));

    // eslint-disable-next-line no-console
    console.error('OUT:\n' + out.join('') + '\nERR:\n' + err.join(''));
    expect(out.join('')).not.toContain('FAILED');
  }, 120000);
});
