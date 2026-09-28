/* eslint-disable */
/* prettier-ignore */
/**
 * web-node drop-in for `@rspack/binding-wasm32-wasi/rspack.wasi.cjs` (M125).
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * `rspack.wasi.cjs` spawns its Rust threads with `worker_threads.Worker` loading
 * `wasi-worker.mjs`. In web-node that is a *cooperative* worker in the same
 * realm, so the child never actually runs while the parent is blocked on
 * `Atomics.wait` — the runtime wedges. web-node *can* run real threads (a real
 * browser `Worker` + `SharedArrayBuffer` + `Atomics`), but a real worker is a
 * separate realm: it cannot read the VFS, and it cannot resolve bare specifiers.
 *
 * So this adapter supplies its own `onCreateWorker` that hands emnapi a real
 * browser `Worker` loading the pre-bundled thread-child bootstrap
 * (`public/wasi-thread-child.js`). Filesystem calls from the child are proxied
 * back over the message port and served on web-node's `fs` — i.e. the VFS — so
 * the child sees exactly the same files the build does. Everything else mirrors
 * the generated file: a `node:wasi` host, a 2 GB fixed shared memory (rspack
 * requires `initial == maximum`), and the same export surface.
 *
 * Usage (from inside a web-node project):
 *
 *     RSPACK_BINDING=/project/webnode-binding.cjs
 *     (or `require.resolve('web-node-rspack-binding')` if you place it on disk)
 *
 * Requirements: `crossOriginIsolated` (for `SharedArrayBuffer`) and a real
 * `Worker` global — both true in a web-node runtime worker.
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

// Serves the thread-child's `__fs__` requests on web-node's `fs` (the VFS).
const __onFsMessage = __createOnMessageForFsProxy(__nodeFs);

// rspack allocates 2 GB fixed shared memory (initial == maximum ⇒ memory.grow
// disabled). Needs crossOriginIsolated; web-node's dev server sets COOP/COEP.
const __sharedMemory = new WebAssembly.Memory({ initial: 32768, maximum: 32768, shared: true });

const __wasmPath = (function () {
  const local = __nodePath.join(__dirname, 'rspack.wasm32-wasi.wasm');
  if (__nodeFs.existsSync(local)) return local;
  // Resolve via the package's own entry rather than the `.wasm` file directly:
  // `require.resolve` on a bare `.wasm` path relies on the loader's extension
  // handling, whereas resolving an existing `.json` is unremarkable.
  const pkgJson = require.resolve('@rspack/binding-wasm32-wasi/package.json');
  return __nodePath.join(__nodePath.dirname(pkgJson), 'rspack.wasm32-wasi.wasm');
})();

/**
 * Wrap a real browser Worker in the `worker_threads.Worker` surface that
 * `@emnapi/wasi-threads` drives: `postMessage` / `onmessage` / `on` / `unref` /
 * `terminate`, plus the plain fields emnapi reads and writes
 * (`whenLoaded`, `loaded`, `__emnapi_tid`).
 *
 * One port, two consumers: the fs proxy (`__fs__` frames) and emnapi
 * (`__emnapi__` frames). In Node mode emnapi registers via `on('message', …)`
 * and bridges to `onmessage`; we therefore dispatch through the listeners when
 * present and fall back to `onmessage` otherwise — never both, or emnapi would
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
