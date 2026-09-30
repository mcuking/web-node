/**
 * The rspack project: a Rust bundler compiled to wasm32-wasi, running on a
 * real Worker thread pool, with the binding adapter that makes it work.
 *
 * NOTE for maintainers: the embedded sources are TS template literals,
 * so every backtick / ${ / backslash is escaped on the way in. Keep the
 * demo code free of all three (use separate console.log('') calls instead of
 * a newline escape).
 */
export const RSPACK_PROJECT_FILES: Record<string, string> = {
  '/project/rspack/build.mjs': `// rspack build - a one-shot production build of /project/rspack into dist/.
//
// rspack's native addon cannot load in a tab, so the build uses the
// wasm32-wasi binding via our drop-in adapter (webnode-binding.cjs), which
// hands the Rust thread pool a *real* browser Worker while the filesystem
// stays on web-node's VFS.
import fs from 'fs';
import path from 'path';
import config from './rspack.config.mjs';

const ROOT = '/project/rspack';
const NM = path.join(ROOT, 'node_modules');

// @rspack/core loads its binding the moment it is required, so the path must
// be set before the (dynamic) import below runs.
process.env.RSPACK_BINDING = path.join(ROOT, 'webnode-binding.cjs');

(async function () {
  console.log('-- rspack build --');
  if (!fs.existsSync(path.join(NM, '@rspack', 'core'))) {
    console.log('rspack      : not installed yet - run "Install deps" first');
    return;
  }
  const mod = await import('@rspack/core');
  const { rspack } = mod.default || mod;
  console.log('tool        : rspack (Rust -> wasm32-wasi, real Worker threads)');

  const compiler = rspack({ ...config, mode: 'production', optimization: { minimize: true } });

  // The build runs on real Worker threads, which web-node's active-handle
  // counter cannot see; keep the process alive with a refed timer until rspack
  // calls back, or the runtime would judge the run idle and exit early.
  const keepAlive = setInterval(function () {}, 1000);
  const t0 = Date.now();

  await new Promise(function (resolve) {
    compiler.run(function (err, stats) {
      clearInterval(keepAlive);
      if (err) {
        console.log('rspack      : ' + (err && err.message ? err.message : err));
        process.exitCode = 1;
        return resolve();
      }
      const info = stats.toJson({ all: false, errors: true, warnings: true });
      if (info.errors && info.errors.length) {
        for (const e of info.errors) console.log('rspack error: ' + (e.message || e));
        process.exitCode = 1;
        return resolve();
      }
      console.log('compiled in : ' + (Date.now() - t0) + ' ms');
      try {
        const out = fs.readFileSync(path.join(ROOT, 'dist', 'bundle.js'), 'utf8');
        console.log('written     : /project/rspack/dist/bundle.js (' + out.length + ' bytes)');
        console.log('head        : ' + out.slice(0, 120));
      } catch (e) {
        console.log('output      : (unreadable) ' + e.message);
      }
      resolve();
    });
  });
})().catch(function (err) {
  console.log('rspack build failed : ' + (err && err.message ? err.message : err));
});
`,
  '/project/rspack/dev.mjs': `// rspack dev server: rspack watches /project/rspack/src and this serves the
// bundle over the virtual TCP layer, pushing a full-reload on every rebuild
// over the same BroadcastChannel bridge Vite HMR uses (public/sw.js swaps the
// preview's loopback WebSocket for it).
import fs from 'fs';
import path from 'path';
import http from 'http';
import config from './rspack.config.mjs';

const ROOT = '/project/rspack';
const NM = path.join(ROOT, 'node_modules');
const DIST = path.join(ROOT, 'dist');
const PORT = 5175;

// @rspack/core loads its binding the moment it is required, so the path must
// be set before the (dynamic) import below runs.
process.env.RSPACK_BINDING = path.join(ROOT, 'webnode-binding.cjs');

function createReloadBridge() {
  const channel = new BroadcastChannel('web-node-hmr:' + PORT);
  const clients = new Set();
  channel.onmessage = function (event) {
    const msg = event.data;
    if (!msg) return;
    if (msg.t === 'open') {
      clients.add(msg.id);
      channel.postMessage({ t: 'open', id: msg.id });
      console.log('client      : preview connected (' + clients.size + ' client/s)');
    } else if (msg.t === 'close') {
      clients.delete(msg.id);
    }
  };
  return {
    get size() { return clients.size; },
    send(payload) {
      const data = JSON.stringify(payload);
      clients.forEach(function (id) { channel.postMessage({ t: 'message', id: id, data: data }); });
    },
    close() { clients.clear(); channel.close(); },
  };
}

// The preview document has no dev client of its own, so inject one: it opens a
// loopback WebSocket (which public/sw.js routes onto the channel above) and
// reloads when told the bundle changed.
function injectReloadClient(html) {
  const client =
    '<script>(function(){try{var live=false;' +
    'var ws=new WebSocket("ws://127.0.0.1:' + PORT + '/__webnode_live__");' +
    'ws.onopen=function(){live=true;};' +
    'ws.onmessage=function(e){try{var m=JSON.parse(e.data);if(m&&m.type==="full-reload")location.reload();}catch(x){}};' +
    'ws.onclose=function(){if(live)setTimeout(function(){location.reload();},400);};' +
    '}catch(e){}})();' + '<' + '/script>';
  return html.includes('</body>') ? html.replace('</body>', client + '</body>') : html + client;
}

function serve(port) {
  return http.createServer(function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(injectReloadClient(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
      return;
    }
    if (url.pathname === '/bundle.js') {
      const file = path.join(DIST, 'bundle.js');
      if (!fs.existsSync(file)) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end('building...');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(file));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
}

(async function () {
  console.log('-- rspack dev --');
  if (!fs.existsSync(path.join(NM, '@rspack', 'core'))) {
    console.log('rspack      : not installed yet - run "Install deps" first');
    return;
  }
  const mod = await import('@rspack/core');
  const { rspack } = mod.default || mod;
  console.log('tool        : rspack (Rust -> wasm32-wasi, real Worker threads)');

  const compiler = rspack({
    ...config,
    mode: 'development',
    devtool: false,
    // dist/ is this build's own output; without this the write of bundle.js is
    // itself a change event, and rspack rebuilds forever.
    watchOptions: { ignored: /[\\\\/]dist[\\\\/]/ },
  });
  const bridge = createReloadBridge();
  const server = serve(PORT);

  let builds = 0;
  const watching = compiler.watch({}, function (err, stats) {
    if (err) { console.log('rspack      : ' + err.message); return; }
    const info = stats.toJson({ all: false, errors: true });
    if (info.errors && info.errors.length) {
      console.log('rspack      : build failed');
      for (const e of info.errors) console.log('rspack error: ' + (e.message || e));
      return;
    }
    builds++;
    let size = 0;
    try { size = fs.statSync(path.join(DIST, 'bundle.js')).size; } catch (e) {}
    console.log('rspack      : ' + (builds === 1 ? 'built' : 'rebuilt') + ' bundle.js (' + size + ' bytes)');
    if (builds > 1) {
      console.log('reload      : full-reload -> ' + bridge.size + ' client/s');
      bridge.send({ type: 'full-reload', path: '*' });
    }
  });

  server.listen(PORT, function () {
    console.log('listening   : http://127.0.0.1:' + PORT);
    console.log('watching    : /project/rspack/src (VFS events -> rebuild -> reload)');
    console.log('preview     : open the Preview tab (:5175), then edit src/message.mjs');
  });
  server.on('close', function () {
    watching.close(function () {});
    bridge.close();
  });
})().catch(function (err) {
  console.log('rspack dev failed : ' + (err && err.message ? err.message : err));
});
`,
  '/project/rspack/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rspack + React app · web-node</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.6 ui-monospace, Menlo, monospace; background: #0b0e14; color: #d7dee9; }
      .card { text-align: center; }
      h1 { margin: 0 0 12px; font-size: 24px; color: #f0a45b; }
      button { font: inherit; padding: 8px 16px; border: 1px solid #f0a45b; border-radius: 8px; background: #2b1d10; color: #f0a45b; cursor: pointer; }
      .hint { margin-top: 16px; color: #7b8798; font-size: 13px; }
    </style>
  </head>
  <body>
    <!-- React mounts here; rspack (a Rust bundler compiled to wasm32-wasi,
         running on a real Worker thread pool) bundles src/ in the tab. -->
    <div id="root"></div>
    <script src="bundle.js"></script>
  </body>
</html>
`,
  '/project/rspack/package.json': `{
  "name": "rspack-app",
  "private": true,
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "dev": "node dev.mjs",
    "build": "node build.mjs"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@rspack/core": "2.2.7",
    "@rspack/binding-wasm32-wasi": "2.2.7"
  }
}
`,
  '/project/rspack/rspack.config.mjs': `// The project lives at a fixed path in the demo, so the root is a constant
// rather than __dirname (this file is ESM).
const ROOT = '/project/rspack';

export default {
  context: ROOT,
  entry: { main: './src/main.mjs' },
  output: { path: ROOT + '/dist', filename: 'bundle.js' },
};
`,
  '/project/rspack/src/main.mjs': `import React from 'react';
import { createRoot } from 'react-dom/client';
import { greet } from './message.mjs';

// React, written without JSX on purpose: a browser tab has no transpiler, so
// the demo calls React.createElement directly. It is the same React - same
// hooks, same component model - in plain JavaScript rspack can bundle as-is.
const h = React.createElement;

function App() {
  const [count, setCount] = React.useState(0);
  return h(
    'main',
    { className: 'card' },
    h('h1', null, greet('rspack')),
    h('button', { type: 'button', onClick: () => setCount(count + 1) }, 'count is ' + count),
    h('p', { className: 'hint' }, 'Packed by rspack (Rust to wasm) in the browser. Edit src/message.mjs and save.'),
  );
}

createRoot(document.getElementById('root')).render(h(App));
`,
  '/project/rspack/src/message.mjs': `export function greet(who) {
  return 'Hello from ' + who + ', packed by a Rust bundler in the browser';
}
`,
  '/project/rspack/webnode-binding.cjs': `/* eslint-disable */
/* prettier-ignore */
/**
 * web-node drop-in for '@rspack/binding-wasm32-wasi/rspack.wasi.cjs' (M125).
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * 'rspack.wasi.cjs' spawns its Rust threads with 'worker_threads.Worker' loading
 * 'wasi-worker.mjs'. In web-node that is a *cooperative* worker in the same
 * realm, so the child never actually runs while the parent is blocked on
 * 'Atomics.wait' — the runtime wedges. web-node *can* run real threads (a real
 * browser 'Worker' + 'SharedArrayBuffer' + 'Atomics'), but a real worker is a
 * separate realm: it cannot read the VFS, and it cannot resolve bare specifiers.
 *
 * So this adapter supplies its own 'onCreateWorker' that hands emnapi a real
 * browser 'Worker' loading the pre-bundled thread-child bootstrap
 * ('public/wasi-thread-child.js'). Filesystem calls from the child are proxied
 * back over the message port and served on web-node's 'fs' — i.e. the VFS — so
 * the child sees exactly the same files the build does. Everything else mirrors
 * the generated file: a 'node:wasi' host, a 2 GB fixed shared memory (rspack
 * requires 'initial == maximum'), and the same export surface.
 *
 * Usage (from inside a web-node project):
 *
 *     RSPACK_BINDING=/project/webnode-binding.cjs
 *     (or 'require.resolve('web-node-rspack-binding')' if you place it on disk)
 *
 * Requirements: 'crossOriginIsolated' (for 'SharedArrayBuffer') and a real
 * 'Worker' global — both true in a web-node runtime worker.
 */
'use strict';

const __nodeFs = require('node:fs');
const __nodePath = require('node:path');
const { WASI: __nodeWASI } = require('node:wasi');

const {
  createOnMessage: __createOnMessageForFsProxy,
  getDefaultContext: __emnapiGetDefaultContext,
  instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime');

const __rootDir = __nodePath.parse(process.cwd()).root;

// Where to load the child bootstrap from. The runtime worker publishes the
// base-prefixed asset URL as a global; resolve it against the worker's own
// location so it works under GitHub Pages' sub-path too.
const __childUrl = (function () {
  const fromGlobal = globalThis.__webnodeWasiThreadChildUrl;
  const fromEnv = process.env.__WEBNODE_WASI_THREAD_CHILD_URL;
  const raw = typeof fromGlobal === 'string' && fromGlobal ? fromGlobal : fromEnv;
  if (typeof raw === 'string' && raw) {
    const base = (globalThis.location && globalThis.location.href) || undefined;
    return base ? new URL(raw, base).href : raw;
  }
  throw new Error(
    'web-node: cannot resolve the emnapi thread-child URL — neither ' +
      'globalThis.__webnodeWasiThreadChildUrl nor __WEBNODE_WASI_THREAD_CHILD_URL is set.',
  );
})();

const __wasi = new __nodeWASI({
  version: 'preview1',
  env: process.env,
  preopens: { [__rootDir]: __rootDir },
});

const __emnapiContext = __emnapiGetDefaultContext();

// Serves the thread-child's '__fs__' requests on web-node's 'fs' (the VFS).
const __onFsMessage = __createOnMessageForFsProxy(__nodeFs);

// rspack allocates 2 GB fixed shared memory (initial == maximum ⇒ memory.grow
// disabled). Needs crossOriginIsolated; web-node's dev server sets COOP/COEP.
const __sharedMemory = new WebAssembly.Memory({ initial: 32768, maximum: 32768, shared: true });

const __wasmPath = (function () {
  const local = __nodePath.join(__dirname, 'rspack.wasm32-wasi.wasm');
  if (__nodeFs.existsSync(local)) return local;
  // Resolve via the package's own entry rather than the '.wasm' file directly:
  // 'require.resolve' on a bare '.wasm' path relies on the loader's extension
  // handling, whereas resolving an existing '.json' is unremarkable.
  const pkgJson = require.resolve('@rspack/binding-wasm32-wasi/package.json');
  return __nodePath.join(__nodePath.dirname(pkgJson), 'rspack.wasm32-wasi.wasm');
})();

/**
 * Wrap a real browser Worker in the 'worker_threads.Worker' surface that
 * '@emnapi/wasi-threads' drives: 'postMessage' / 'onmessage' / 'on' / 'unref' /
 * 'terminate', plus the plain fields emnapi reads and writes
 * ('whenLoaded', 'loaded', '__emnapi_tid').
 *
 * One port, two consumers: the fs proxy ('__fs__' frames) and emnapi
 * ('__emnapi__' frames). In Node mode emnapi registers via 'on('message', …)'
 * and bridges to 'onmessage'; we therefore dispatch through the listeners when
 * present and fall back to 'onmessage' otherwise — never both, or emnapi would
 * see every frame twice.
 */
function __createThreadWorker() {
  const DEBUG = process.env.WEBNODE_RSPACK_DEBUG;
  if (DEBUG) console.log('[wn-rspack] spawn thread worker ' + __childUrl);
  const native = new Worker(__childUrl, { type: 'module' });
  const listeners = { message: [], error: [], detachedExit: [] };
  let onMessage;
  let onError;

  const worker = {
    __emnapi_tid: undefined,
    postMessage: (msg) => native.postMessage(msg),
    terminate: () => native.terminate(),
    unref() {},
    ref() {},
    on(event, cb) {
      (listeners[event] || (listeners[event] = [])).push(cb);
      return worker;
    },
    get onmessage() {
      return onMessage;
    },
    set onmessage(fn) {
      onMessage = fn;
    },
    get onerror() {
      return onError;
    },
    set onerror(fn) {
      onError = fn;
    },
  };

  native.onmessage = (e) => {
    if (DEBUG) console.log('[wn-rspack] frame ' + __frameKind(e.data));
    if (DEBUG && e.data && e.data.type === 'error') {
      const err = e.data.error;
      console.log('[wn-rspack] CHILD_ERR ' + (err && (err.stack || err.message) ? (err.stack || err.message) : String(err)));
      if (e.data.errorOutputs && e.data.errorOutputs.length) {
        console.log('[wn-rspack] CHILD_STDERR ' + JSON.stringify(e.data.errorOutputs).slice(0, 1500));
      }
    }
    __onFsMessage(e); // serve the child's filesystem ops on the VFS (synchronous)
    if (listeners.message.length) {
      for (const cb of listeners.message) cb(e.data);
    } else if (onMessage) {
      onMessage(e);
    }
  };
  native.onerror = (e) => {
    if (DEBUG) console.log('[wn-rspack] worker error ' + (e && (e.message || e.type)));
    if (listeners.error.length) {
      for (const cb of listeners.error) cb(e);
    } else if (onError) {
      onError(e);
    }
  };

  return worker;
}

const { napiModule } = __emnapiInstantiateNapiModuleSync(__nodeFs.readFileSync(__wasmPath), {
  context: __emnapiContext,
  asyncWorkPoolSize: (function () {
    const fromEnv = Number(process.env.NAPI_RS_ASYNC_WORK_POOL_SIZE ?? process.env.UV_THREADPOOL_SIZE);
    return fromEnv > 0 ? fromEnv : 4;
  })(),
  reuseWorker: true,
  wasi: __wasi,
  onCreateWorker: () => __createThreadWorker(),
  overwriteImports(importObject) {
    importObject.env = {
      ...importObject.env,
      ...importObject.napi,
      ...importObject.emnapi,
      memory: __sharedMemory,
    };
    return importObject;
  },
  beforeInit({ instance }) {
    for (const name of Object.keys(instance.exports)) {
      if (name.startsWith('__napi_register__')) instance.exports[name]();
    }
  },
});

const __exports = napiModule.exports;
module.exports = __exports;
for (const key of Object.keys(__exports)) module.exports[key] = __exports[key];

/** Debug helper: classify a worker frame (fs proxy vs emnapi control). */
function __frameKind(data) {
  if (!data || typeof data !== 'object') return typeof data;
  if (data.__fs__) return 'fs';
  if (data.__emnapi__) return 'emnapi';
  return Object.keys(data).slice(0, 6).join(',');
}
`,
};
