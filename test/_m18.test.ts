import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

// M18 feasibility: a real Vue 3 single-file component, compiled by
// @vitejs/plugin-vue *inside* the runtime. The fixture tree is a full
// `npm install vue @vitejs/plugin-vue vite esbuild-wasm@0.21 ...`.
const NM = '/tmp/v18/node_modules';

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

const APP_VUE = `<script setup>
import { ref } from 'vue';
defineProps({ greeting: { type: String, default: 'Hello' } });
const count = ref(0);
</script>

<template>
  <h1>{{ greeting }}</h1>
  <button type="button" @click="count++">count is {{ count }}</button>
</template>
`;

const MAIN_JS = `import { createApp } from 'vue';
import App from './App.vue';
createApp(App, { greeting: 'hi' }).mount('#app');
`;

describe('M18 feasibility: a Vue SFC through Vite inside the runtime', () => {
  it('compiles and bundles a .vue app, and the dev server transforms it', async () => {
    if (!existsSync(NM)) {
      throw new Error('fixture missing: npm i vite vue @vitejs/plugin-vue esbuild-wasm@0.21.5 in /tmp/v18');
    }
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.mkdir('/project/node_modules', { recursive: true });
    loadDir(vfs, NM, '/project/node_modules');

    const w = (p: string, s: string) => {
      const dir = p.split('/').slice(0, -1).join('/');
      if (dir) vfs.mkdir(dir, { recursive: true });
      vfs.writeFile(p, new TextEncoder().encode(s));
    };

    w('/project/package.json', JSON.stringify({ name: 'p', version: '1.0.0', type: 'module' }));
    w(
      '/project/index.html',
      `<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>`,
    );
    w('/project/src/App.vue', APP_VUE);
    w('/project/src/main.js', MAIN_JS);

    w(
      '/project/m18.mjs',
      `
        import { build, createServer, version } from 'vite';
        import vue from '@vitejs/plugin-vue';
        import * as esbuild from 'esbuild';
        import fs from 'fs';
        import http from 'http';

        function get(path) {
          return new Promise(function (resolve, reject) {
            http.get({ host: '127.0.0.1', port: 5178, path: path }, function (res) {
              var body = '';
              res.setEncoding('utf8');
              res.on('data', function (c) { body += c; });
              res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
            }).on('error', reject);
          });
        }

        (async function () {
          console.log('VITE ' + version);
          const wasm = fs.readFileSync('/project/node_modules/esbuild-wasm/esbuild.wasm');
          await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });

          // 1) production build of the SFC
          const out = await build({
            root: '/project',
            logLevel: 'silent',
            plugins: [vue()],
            build: { write: false, minify: false },
          });
          const res = Array.isArray(out) ? out[0] : out;
          const js = res.output.filter(function (c) { return c.type === 'chunk'; })[0];
          console.log('BUILD ' + JSON.stringify(res.output.map(function (c) { return c.fileName; })));
          console.log('BUILD-HAS-VUE ' + (js.code.indexOf('createElementBlock') !== -1));
          console.log('BUILD-HAS-TEMPLATE ' + (js.code.indexOf('count is') !== -1));

          // 2) the dev server transforms App.vue on demand
          const server = await createServer({
            root: '/project',
            logLevel: 'error',
            plugins: [vue()],
            optimizeDeps: { disabled: true },
            server: { host: '127.0.0.1', port: 5178, watch: null, hmr: false },
          });
          await server.listen(5178);
          const main = await get('/src/main.js');
          console.log('DEV-MAIN ' + main.status + ' bare-rewritten ' + (main.body.indexOf('/node_modules/vue/') !== -1));
          const appvue = await get('/src/App.vue');
          console.log('DEV-APPVUE ' + appvue.status + ' bytes=' + appvue.body.length);
          console.log('DEV-COMPILED ' + (appvue.body.indexOf('_createElementVNode') !== -1 || appvue.body.indexOf('createElementVNode') !== -1));
          console.log('DEV-NO-TEMPLATE-TAG ' + (appvue.body.indexOf('<template>') === -1));
          await server.close();
          console.log('DONE');
        })().catch(function (e) { console.log('FAILED ' + (e && e.stack ? e.stack : e)); });
      `,
    );

    const outArr: string[] = [];
    const errArr: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/m18.mjs'],
      installGlobals: false,
      onStdout: (c) => outArr.push(c),
      onStderr: (c) => errArr.push(c),
    });
    runtime.runMain('/project/m18.mjs');
    const done = () => outArr.join('').includes('DONE') || outArr.join('').includes('FAILED');
    for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => setTimeout(r, 100));

    const o = outArr.join('');
    // eslint-disable-next-line no-console
    console.error('OUT:\n' + o + '\nERR:\n' + errArr.join('').slice(0, 3000));
    expect(o).not.toContain('FAILED');
    expect(o).toContain('BUILD-HAS-VUE true');
    expect(o).toContain('BUILD-HAS-TEMPLATE true');
    expect(o).toContain('DEV-MAIN 200 bare-rewritten true');
    expect(o).toContain('DEV-COMPILED true');
    expect(o).toContain('DEV-NO-TEMPLATE-TAG true');
  }, 180000);
});
