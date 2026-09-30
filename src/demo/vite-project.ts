/**
 * The Vite project: a Vue 3 single-file component, built and served by the
 * real Vite inside the tab. "Run dev" starts the dev server (HMR over the
 * preview bridge); "Run build" produces dist/.
 *
 * NOTE for maintainers: the embedded sources are TS template literals,
 * so every backtick / ${ / backslash is escaped on the way in. Keep the
 * demo code free of all three (use separate console.log('') calls instead of
 * a newline escape).
 */
export const VITE_PROJECT_FILES: Record<string, string> = {
  '/project/vite/build.mjs': `// vite build - bundles /project/vite into dist/ with the real Vite, in the tab.
import fs from 'fs';
import path from 'path';

const ROOT = '/project/vite';
const NM = path.join(ROOT, 'node_modules');

(async function () {
  console.log('-- vite build --');
  if (!fs.existsSync(path.join(NM, 'vite'))) {
    console.log('vite        : not installed yet - run "Install deps" first');
    return;
  }

  // Build steps await host promises (WebAssembly.compile, Vite's own async
  // work). A pending promise does not keep the event loop alive, so without a
  // refed timer the runtime would judge the run idle and report it finished
  // before the build was done.
  const keepAlive = setInterval(function () {}, 1000);
  try {
    const vite = await import('vite');
    const { default: vue } = await import('@vitejs/plugin-vue');
    console.log('tool        : vite v' + vite.version + ' (running in the tab)');

    const esbuild = await import('esbuild');
    const wasm = fs.readFileSync(path.join(NM, 'esbuild-wasm', 'esbuild.wasm'));
    const t0 = Date.now();
    await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });
    console.log('esbuild     : wasm started in ' + (Date.now() - t0) + 'ms');

    const t1 = Date.now();
    const result = await vite.build({
      root: ROOT,
      // Relative asset URLs so the built site also works from a sub-path.
      base: './',
      logLevel: 'silent',
      plugins: [vue()],
      build: { write: false, minify: false },
    });
    const bundle = Array.isArray(result) ? result[0] : result;

    for (const chunk of bundle.output) {
      const dest = path.join(ROOT, 'dist', chunk.fileName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, chunk.type === 'asset' ? String(chunk.source) : chunk.code);
    }
    console.log('built in    : ' + (Date.now() - t1) + 'ms');
    console.log('written     : /project/vite/dist/');
    for (const chunk of bundle.output) console.log('  ' + chunk.fileName);
  } finally {
    clearInterval(keepAlive);
  }
})().catch(function (err) {
  console.log('vite build failed : ' + (err && err.message ? err.message : err));
});
`,
  '/project/vite/dev.mjs': `// Vite dev server, running entirely inside the tab. Pick "Run dev", then open
// the Preview tab and choose :5173.
//
// Two things are special about running Vite here:
//   1. Vite reaches for the *native* esbuild addon. A tab cannot load one, so
//      the runtime aliases 'esbuild' to its WASM build, which must be started
//      explicitly before Vite runs.
//   2. Vite's watcher is chokidar, which wants inotify. A tab has no inotify,
//      so we watch the virtual file system ourselves and forward the events
//      into Vite's watcher - that is where the HMR pipeline is wired up.
import fs from 'fs';
import path from 'path';

const ROOT = '/project/vite';
const SRC = path.join(ROOT, 'src');
const NM = path.join(ROOT, 'node_modules');
const PORT = 5173;

// A ServiceWorker cannot proxy a WebSocket (fetch never sees the upgrade), so
// Vite's HMR socket is unreachable through the preview bridge. The preview
// iframe is same-origin with this worker, though, so the bridge (public/sw.js)
// swaps the socket for a BroadcastChannel. Vite still *computes* the updates;
// we only carry them. One channel per port, so two dev servers never collide.
const HMR_CHANNEL = 'web-node-hmr:' + PORT;

function createHmrBridge() {
  const channel = new BroadcastChannel(HMR_CHANNEL);
  const clients = new Set();
  let onConnection = null;
  channel.onmessage = function (event) {
    const msg = event.data;
    if (!msg) return;
    if (msg.t === 'open') {
      clients.add(msg.id);
      channel.postMessage({ t: 'open', id: msg.id });
      // Vite's client waits for "connected" before flushing queued updates.
      channel.postMessage({ t: 'message', id: msg.id, data: JSON.stringify({ type: 'connected' }) });
      console.log('hmr         : preview connected (' + clients.size + ' client/s)');
      if (onConnection) onConnection({ send: function () {} }, {});
    } else if (msg.t === 'send') {
      let parsed = null;
      try { parsed = JSON.parse(msg.data); } catch (e) {}
      if (parsed && parsed.type === 'ping') {
        channel.postMessage({ t: 'message', id: msg.id, data: JSON.stringify({ type: 'pong' }) });
      }
    } else if (msg.t === 'close') {
      clients.delete(msg.id);
    }
  };
  // The shape Vite treats as its HMR server (what createWebSocketServer returns).
  return {
    name: 'web-node-hmr',
    get clients() { return clients; },
    send(payload) {
      const data = JSON.stringify(payload);
      clients.forEach(function (id) { channel.postMessage({ t: 'message', id: id, data: data }); });
    },
    on(event, fn) { if (event === 'connection') onConnection = fn; },
    off(event, fn) { if (event === 'connection' && onConnection === fn) onConnection = null; },
    listen() {},
    close() { clients.clear(); channel.close(); },
    handleUpgrade() {},
  };
}

function vfsWatchPlugin() {
  return {
    name: 'web-node-vfs-watch',
    configureServer(server) {
      // Each watcher reports paths relative to its own base, so keep the base
      // with the watcher - joining a root-relative name onto SRC would invent a
      // path like src/src/index.html.
      const forward = function (base) {
        return function (eventType, filename) {
          if (!filename) return;
          const name = String(filename);
          if (name.indexOf('node_modules') !== -1 || name.indexOf('dist') !== -1) return;
          console.log('vfs-change  : ' + eventType + ' ' + name);
          server.watcher.emit(eventType === 'change' ? 'change' : 'add', path.join(base, name));
        };
      };
      // Sources (recursive) plus index.html at the project root. node_modules
      // and dist are filtered out so an install never floods the HMR pipeline.
      const watchers = [
        fs.watch(SRC, { recursive: true }, forward(SRC)),
        fs.watch(ROOT, {}, forward(ROOT)),
      ];
      if (server.httpServer) {
        server.httpServer.on('close', function () { watchers.forEach(function (w) { try { w.close(); } catch (e) {} }); });
      }
      console.log('watching    : ' + SRC + ' (VFS events -> Vite HMR)');
    },
  };
}

(async function () {
  console.log('-- vite dev --');
  if (!fs.existsSync(path.join(NM, 'vite'))) {
    console.log('vite        : not installed yet - run "Install deps" first');
    return;
  }
  const vite = await import('vite');
  const { default: vue } = await import('@vitejs/plugin-vue');
  console.log('tool        : vite v' + vite.version + ' dev server (in the tab)');

  const esbuild = await import('esbuild');
  const wasm = fs.readFileSync(path.join(NM, 'esbuild-wasm', 'esbuild.wasm'));
  const t0 = Date.now();
  await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });
  console.log('esbuild     : wasm started in ' + (Date.now() - t0) + 'ms');

  const server = await vite.createServer({
    root: ROOT,
    logLevel: 'error',
    plugins: [vue(), vfsWatchPlugin()],
    // Vite pre-bundles bare deps with esbuild, and esbuild-wasm has no file
    // system (its reads throw "not implemented on js"). Turn pre-bundling off
    // so Vite serves the dependencies' own ESM sources from node_modules.
    optimizeDeps: { disabled: true },
    server: {
      host: '127.0.0.1',
      port: PORT,
      // No chokidar (see vfsWatchPlugin); HMR stays on but rides our bridge.
      watch: null,
      hmr: { protocol: 'ws', host: '127.0.0.1', port: PORT },
    },
  });

  // Vite reads server.hot on every update, so swapping the reference is enough
  // to replace its WebSocket channel with the BroadcastChannel bridge.
  const bridge = createHmrBridge();
  server.hot = bridge;
  server.ws = bridge;

  await server.listen();

  console.log('listening   : http://127.0.0.1:' + PORT);
  console.log('hmr         : BroadcastChannel "' + HMR_CHANNEL + '" (no WebSocket)');
  console.log('preview     : open the Preview tab (:5173), then edit src/App.vue');
})().catch(function (err) {
  console.log('vite dev failed : ' + (err && err.message ? err.message : err));
});
`,
  '/project/vite/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vite app · web-node</title>
  </head>
  <body>
    <!-- The app mounts here. Edit this file or anything under src/ and save:
         the dev server hot-updates the preview in place. -->
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  '/project/vite/package.json': `{
  "name": "vite-app",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node dev.mjs",
    "build": "node build.mjs"
  },
  "dependencies": {
    "vue": "^3.5.0",
    "vite": "^5.4.0",
    "@vitejs/plugin-vue": "^5.2.0",
    "esbuild-wasm": "^0.21.5",
    "@rollup/wasm-node": "^4.63.3"
  }
}
`,
  '/project/vite/src/App.vue': `<script setup>
import { ref } from 'vue';

defineProps({ greeting: { type: String, default: 'Hello' } });
const count = ref(0);
</script>

<template>
  <main class="card">
    <h1>{{ greeting }}</h1>
    <button type="button" @click="count++">count is {{ count }}</button>
    <p class="hint">Edit this file (or src/message.js) and save — Vite hot-updates it in place.</p>
  </main>
</template>
`,
  '/project/vite/src/main.js': `import { createApp } from 'vue';
import App from './App.vue';
import { greet } from './message.js';
import './style.css';

// App.vue is compiled by @vitejs/plugin-vue; the greeting comes from the plain
// module beside it. That split is deliberate: HMR can hot-swap message.js for
// us (see below), but it cannot patch a value already passed into a component.
const app = createApp(App, { greeting: greet('vite') });
app.mount('#app');

// Accept updates to message.js and remount with the new greeting - no full
// reload, so the counter keeps its value.
if (import.meta.hot) {
  import.meta.hot.accept('./message.js', (mod) => {
    app.unmount();
    createApp(App, { greeting: mod.greet('vite') }).mount('#app');
  });
}
`,
  '/project/vite/src/message.js': `export function greet(who) {
  return 'Hello from ' + who + ', compiled in the browser';
}
`,
  '/project/vite/src/style.css': `:root {
  color-scheme: dark;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font: 16px/1.6 ui-monospace, Menlo, monospace;
  background: #0b0e14;
  color: #d7dee9;
}

.card {
  text-align: center;
}

h1 {
  margin: 0 0 12px;
  font-size: 24px;
  color: #5ef1a5;
}

button {
  font: inherit;
  padding: 8px 16px;
  border: 1px solid #5ef1a5;
  border-radius: 8px;
  background: #17301f;
  color: #5ef1a5;
  cursor: pointer;
}

.hint {
  margin-top: 16px;
  color: #7b8798;
  font-size: 13px;
}
`,
};
