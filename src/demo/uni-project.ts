/**
 * The uni-app project: an H5 build driven by the real uni-app CLI inside the
 * tab. uni-app is a cross-platform framework — one source tree compiles to H5,
 * mini-programs, native apps — and its toolchain is much heavier than the
 * bundler demos: it runs Vite with `@dcloudio/vite-plugin-uni`, which pulls in
 * the whole @dcloudio compiler stack.
 *
 * "Run build" produces a static H5 site under `dist/build/h5/` (index.html +
 * assets). Only H5 is offered: a mini-program target emits WeChat's `wxml`/
 * `wxss`, which nothing in a browser can run — that needs the WeChat devtools.
 *
 * Two things make this work where a plain Vite config would not:
 *   - Vite lets the CLI auto-discover `vite.config.mjs`, which means Vite
 *     bundles the config with esbuild. esbuild-wasm has no file system, so the
 *     runtime's esbuild ⇄ VFS bridge (`tooling/esbuild-bridge.ts`) is what lets
 *     that read the project — the bundler demos avoid the path entirely.
 *   - uni defaults to the terser minifier on a production build, and Vite runs
 *     terser in a `worker_threads` Worker (`eval: true`), which a tab cannot
 *     provide; `vite.config.mjs` selects esbuild instead.
 *
 * NOTE for maintainers: the embedded sources are TS template literals, so every
 * backtick / ${ / backslash is escaped on the way in. Keep the demo code free of
 * all three.
 */
export const UNI_PROJECT_FILES: Record<string, string> = {
  '/project/uni/build.mjs': `// uni build (H5) - compiles /project/uni to dist/build/h5 with the uni-app CLI
// running in the tab.
import fs from 'fs';
import path from 'path';

const ROOT = '/project/uni';
const NM = path.join(ROOT, 'node_modules');
const CLI = path.join(NM, '@dcloudio', 'vite-plugin-uni', 'bin', 'uni.js');

(async function () {
  console.log('-- uni build (h5) --');
  if (!fs.existsSync(path.join(NM, '@dcloudio', 'vite-plugin-uni'))) {
    console.log('uni-app     : not installed yet - run "Install deps" first');
    return;
  }

  // A build awaits host promises (WebAssembly.compile, Vite's own async work);
  // a pending promise does not keep the event loop alive, so a refed timer
  // keeps the runtime from judging the run idle before the build is done.
  const keepAlive = setInterval(function () {}, 1000);
  try {
    // A tab cannot load the native esbuild addon, so 'esbuild' is aliased to its
    // WASM build, which must be started explicitly before Vite runs.
    const esbuild = await import('esbuild');
    const wasm = fs.readFileSync(path.join(NM, 'esbuild-wasm', 'esbuild.wasm'));
    const t0 = Date.now();
    await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });
    console.log('esbuild     : wasm started in ' + (Date.now() - t0) + 'ms');

    // The CLI discovers the project (vite.config.mjs, src/pages.json, ...) from
    // the working directory, exactly as a real terminal run would.
    process.chdir(ROOT);
    process.env.UNI_PLATFORM = 'h5';
    process.env.NODE_ENV = 'production';
    process.argv = ['node', CLI, 'build'];

    const t1 = Date.now();
    await import(CLI);
    console.log('built in    : ' + (Date.now() - t1) + 'ms');
    console.log('written     : /project/uni/dist/build/h5/');
  } finally {
    clearInterval(keepAlive);
  }
})().catch(function (err) {
  console.log('uni build failed : ' + (err && err.stack ? err.stack : err));
});
`,
  '/project/uni/dev.mjs': `// uni-app H5 dev server, running entirely inside the tab. Pick "Run dev",
// then open the Preview tab and choose :5176.
//
// Unlike build.mjs, which runs the uni CLI, this drives Vite directly and
// imports the uni plugin itself. The reason is the file watcher: the CLI always
// installs a chokidar watcher (watch: {}), and chokidar cannot work in a tab
// (there is no inotify) - it spins scanning the whole tree through the VFS. The
// vite demo disables the watcher the same way (server.watch: null).
//
// As in the other dev servers here: a tab cannot load the native esbuild addon,
// so 'esbuild' is aliased to its WASM build, started explicitly below; and a
// ServiceWorker cannot proxy Vite's WebSocket, so HMR rides a BroadcastChannel.
import fs from 'fs';
import path from 'path';

const ROOT = '/project/uni';
const NM = path.join(ROOT, 'node_modules');
const PORT = 5176;
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

(async function () {
  console.log('-- uni dev (h5) --');
  if (!fs.existsSync(path.join(NM, '@dcloudio', 'vite-plugin-uni'))) {
    console.log('uni-app     : not installed yet - run "Install deps" first');
    return;
  }

  const esbuild = await import('esbuild');
  const wasm = fs.readFileSync(path.join(NM, 'esbuild-wasm', 'esbuild.wasm'));
  const t0 = Date.now();
  await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });
  console.log('esbuild     : wasm started in ' + (Date.now() - t0) + 'ms');

  // The CLI reads the project (pages.json, manifest.json, ...) from the working
  // directory and from these env vars; initEnv is where its runDev sets them.
  process.chdir(ROOT);
  process.env.UNI_PLATFORM = 'h5';
  process.env.NODE_ENV = 'development';
  const utils = await import('@dcloudio/vite-plugin-uni/dist/cli/utils.js');
  utils.initEnv('dev', { platform: 'h5' });

  const vite = await import('vite');
  const pluginMod = await import('@dcloudio/vite-plugin-uni');
  const uni = typeof pluginMod.default === 'function' ? pluginMod.default : pluginMod.default.default;

  const server = await vite.createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    plugins: [uni()],
    // No chokidar (see the header): a tab cannot watch the file system, and
    // chokidar spins if it tries.
    server: { host: '127.0.0.1', port: PORT, watch: null },
  });

  // Vite reads server.hot on every update, so swapping the reference is enough
  // to replace its WebSocket channel with the BroadcastChannel bridge.
  const bridge = createHmrBridge();
  server.hot = bridge;
  server.ws = bridge;

  await server.listen();

  console.log('listening   : http://127.0.0.1:' + PORT);
  console.log('hmr         : BroadcastChannel "' + HMR_CHANNEL + '" (no WebSocket)');
  console.log('preview     : open the Preview tab (:5176), then edit src/pages/index/index.vue');
})().catch(function (err) {
  console.log('uni dev failed : ' + (err && err.stack ? err.stack : err));
});
`,
  '/project/uni/vite.config.mjs': `// The uni-app Vite config.
//
// Imported by the uni CLI, which lets Vite discover this file (the bundler
// demos import their configs directly so Vite never has to read the file
// system; the runtime's esbuild bridge makes auto-discovery work here).
import uni from '@dcloudio/vite-plugin-uni';

export default {
  // uni uses terser for a production build by default, and Vite's terser runs
  // in a worker_threads Worker (eval: true) that a tab cannot spawn. esbuild's
  // minifier runs in-process.
  build: { minify: 'esbuild' },
  plugins: [uni()],
};
`,
  '/project/uni/index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>uni-app · web-node</title>
    <!--preload-links-->
    <!--app-context-->
  </head>
  <body>
    <div id="app"><!--app-html--></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  '/project/uni/package.json': `{
  "name": "uni-app",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "build:h5": "node build.mjs"
  },
  "dependencies": {
    "@dcloudio/uni-app": "3.0.0-5020620260917001",
    "@dcloudio/uni-components": "3.0.0-5020620260917001",
    "@dcloudio/uni-h5": "3.0.0-5020620260917001",
    "@dcloudio/uni-cli-shared": "3.0.0-5020620260917001",
    "@dcloudio/vite-plugin-uni": "3.0.0-5020620260917001",
    "vue": "^3.4.21",
    "vue-i18n": "^9.1.9",
    "vite": "5.2.8",
    "esbuild-wasm": "^0.20.2",
    "@rollup/wasm-node": "4.14.3"
  }
}
`,
  '/project/uni/src/main.js': `import { createSSRApp } from 'vue';
import App from './App.vue';

export function createApp() {
  const app = createSSRApp(App);
  return { app };
}
`,
  '/project/uni/src/App.vue': `<script>
export default {
  onLaunch: function () {
    console.log('App Launch');
  },
  onShow: function () {
    console.log('App Show');
  },
  onHide: function () {
    console.log('App Hide');
  },
};
</script>

<style>
/* Global styles shared by every page. */
</style>
`,
  '/project/uni/src/pages.json': `{
  "pages": [
    {
      "path": "pages/index/index",
      "style": { "navigationBarTitleText": "uni-app" }
    }
  ],
  "globalStyle": {
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "uni-app",
    "navigationBarBackgroundColor": "#F8F8F8",
    "backgroundColor": "#F8F8F8"
  }
}
`,
  '/project/uni/src/manifest.json': `{
  "name": "web-node-uni",
  "appid": "",
  "description": "uni-app H5, built in the browser tab",
  "versionName": "1.0.0",
  "versionCode": "100",
  "transformPx": false,
  "app-plus": {
    "usingComponents": true,
    "compilerVersion": 3,
    "splashscreen": { "alwaysShowBeforeRender": true, "waiting": true, "autoclose": true, "delay": 0 },
    "modules": {},
    "distribute": { "android": { "permissions": [] }, "ios": {}, "sdkConfigs": {} }
  },
  "quickapp": {},
  "mp-weixin": { "appid": "", "setting": { "urlCheck": false }, "usingComponents": true },
  "uniStatistics": { "enable": false },
  "vueVersion": "3"
}
`,
  '/project/uni/src/pages/index/index.vue': `<template>
  <view class="content">
    <view class="text-area">
      <text class="title">{{ greeting }}</text>
    </view>
    <button class="count" type="primary" @click="count++">count is {{ count }}</button>
    <text class="hint">Edit src/pages/index/index.vue and rebuild.</text>
  </view>
</template>

<script>
export default {
  data() {
    return {
      greeting: 'Hello from uni-app',
      count: 0,
    };
  },
};
</script>

<style>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 120rpx;
}

.title {
  font-size: 40rpx;
  color: #42b883;
}

.count {
  margin-top: 40rpx;
}

.hint {
  margin-top: 24rpx;
  font-size: 24rpx;
  color: #8f8f94;
}
</style>
`,
  '/project/uni/src/uni.scss': `/* uni-app global SCSS variables and styles. */
`,
};
