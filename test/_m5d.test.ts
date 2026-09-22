import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// These spikes read the bundled packages off the real disk under `/tmp`, which
// an OS temp sweep can clear. When the fixtures are gone the test has nothing
// to measure, so skip it rather than fail on a module-resolution error.
const depsReady = DEPS.every(([, disk]) => {
  try {
    return existsSync(disk) && readdirSync(disk).length > 0;
  } catch {
    return false;
  }
});

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

describe.skipIf(!depsReady)('M5d feasibility: vite dev server in the runtime', () => {
  it('boots the dev server and transforms a module on demand', async () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    for (const [name, disk] of DEPS) {
      const vfsDir = '/project/node_modules/' + name;
      vfs.mkdir(vfsDir, { recursive: true });
      loadDir(vfs, disk, vfsDir);
    }
    vfs.mkdir('/project/site/src', { recursive: true });
    vfs.writeFile('/project/site/index.html', new TextEncoder().encode(`<!doctype html><html><body><h1 id="app"></h1><script type="module" src="/src/main.js"></script></body></html>`));
    vfs.writeFile('/project/site/src/main.js', new TextEncoder().encode(`import { greet } from './message.js';\ndocument.getElementById('app').textContent = greet('dev');\n`));
    vfs.writeFile('/project/site/src/message.js', new TextEncoder().encode(`export function greet(who) { return 'Hello from ' + who; }\n`));
    vfs.writeFile('/project/package.json', new TextEncoder().encode(JSON.stringify({ name: 'p', version: '1.0.0' })));

    vfs.writeFile(
      '/project/dev.mjs',
      new TextEncoder().encode(`
        import { createServer, version } from 'vite';
        import * as esbuild from 'esbuild';
        import fs from 'fs';
        import http from 'http';

        function get(path) {
          return new Promise(function (resolve, reject) {
            http.get({ host: '127.0.0.1', port: 5173, path: path }, function (res) {
              var body = '';
              res.setEncoding('utf8');
              res.on('data', function (c) { body += c; });
              res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
            }).on('error', reject);
          });
        }

        (async function () {
          console.log('STEP boot');
          const wasm = fs.readFileSync('/project/node_modules/esbuild-wasm/esbuild.wasm');
          await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });

          const server = await createServer({
            root: '/project/site',
            logLevel: 'error',
            server: { host: '127.0.0.1', watch: null, hmr: false },
          });
          console.log('STEP server-created');
          console.log('VITE ' + version);

          await server.listen(5173);
          console.log('STEP listening');

          const index = await get('/');
          console.log('INDEX ' + index.status + ' ' + JSON.stringify(index.body.slice(0, 80)));
          console.log('INDEX-HAS-CLIENT ' + index.body.includes('/@vite/client'));

          const mod = await get('/src/main.js');
          console.log('MAIN ' + mod.status + ' bytes=' + mod.body.length);
          console.log('MAIN-TRANSFORMED ' + (mod.body.includes('/src/message.js') && !mod.body.includes('export function')));

          const client = await get('/@vite/client');
          console.log('CLIENT ' + client.status + ' bytes=' + client.body.length);

          await server.close();
          console.log('DONE');
        })().catch(function (e) { console.log('FAILED ' + (e && e.stack ? e.stack : e)); });
      `),
    );

    const out: string[] = [];
    const err: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/dev.mjs'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: (c) => err.push(c),
    });
    runtime.runMain('/project/dev.mjs');
    const done = () => out.join('').includes('DONE') || out.join('').includes('FAILED');
    for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 100));

    // eslint-disable-next-line no-console
    console.error('OUT:\n' + out.join('') + '\nERR:\n' + err.join('').slice(0, 2000));
    expect(out.join('')).not.toContain('FAILED');
    expect(out.join('')).toContain('INDEX-HAS-CLIENT true');
  }, 120000);
});
