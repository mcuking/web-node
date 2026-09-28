// Entry for the emnapi **thread child** (M125 · 第二增量).
//
// A napi-rs / emnapi `wasm32-wasi` package spawns real threads via wasi-threads:
// `@emnapi/wasi-threads` builds the child thread by handing a *worker* the
// compiled `WebAssembly.Module` + the shared memory, and the child runs this
// bootstrap. In Node that worker is `worker_threads.Worker` loading
// `wasi-worker.mjs`; in the browser it is a real `Worker` loading
// `wasi-worker-browser.mjs`.
//
// web-node cannot use either file verbatim: the Node one needs the full Node
// runtime (`node:fs`/`node:wasi`/`node:worker_threads`) inside the child, and the
// browser one ships as bare-specifier ESM that a real worker cannot resolve. So
// we bundle the browser variant into a single self-contained ESM module (below)
// and serve it as a same-origin asset. The child talks to the parent over the
// message port; filesystem calls are proxied back to the parent's `fs` (which is
// the web-node VFS) via `createFsProxy`, so the child never needs a filesystem of
// its own.
//
// This file is bundled by `tools/build-wasi-thread-child.mjs` — see the header
// there for why it is generated rather than imported.
import { instantiateNapiModuleSync, MessageHandler, WASI, createFsProxy } from '@napi-rs/wasm-runtime';
import { memfsExported as memfs } from '@napi-rs/wasm-runtime/fs';

// `createFsProxy` answers each filesystem call by JSON-encoding the *parent's*
// return value. Functions cannot survive JSON, so the proxy records the
// constructor's name on the payload and the decoder restores the prototype via
// `memfs[ctor]`. That only works when the parent's value was produced by memfs'
// own classes. Here the parent is web-node's `fs` (the VFS), whose `Stats` is a
// `deprecate()` wrapper — not a memfs class — so nothing matches and stats
// arrive as bare objects without `isFile()`/`isBlockDevice()`. (Real Node's
// `fs.Stats` is the same wrapper, which is why the Node child uses `node:fs`
// directly and never hits this.)
//
// Repair it on the consuming side: after any stats-returning call, re-point the
// value at memfs' `Stats.prototype`. The wire payload still carries every
// numeric field (`mode` included), so the restored methods classify correctly.
const statsProto = memfs.Stats && memfs.Stats.prototype;

function repairStats(value) {
  if (statsProto && value && typeof value === 'object' && typeof value.isFile !== 'function') {
    try {
      Object.setPrototypeOf(value, statsProto);
    } catch {
      // A frozen/foreign object stays as-is; the caller sees the plain shape.
    }
  }
  return value;
}

const STATS_METHODS = new Set(['statSync', 'lstatSync', 'fstatSync']);

const rawFs = createFsProxy(memfs);

const fs = new Proxy(rawFs, {
  get(target, prop) {
    const value = target[prop];
    if (typeof value === 'function' && STATS_METHODS.has(prop)) {
      return function (...args) {
        return repairStats(value.apply(target, args));
      };
    }
    return value;
  },
});

const errorOutputs = [];

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    const wasi = new WASI({
      fs,
      preopens: { '/': '/' },
      print: function () {
        console.log.apply(console, arguments);
      },
      printErr: function () {
        console.error.apply(console, arguments);
        errorOutputs.push([...arguments]);
      },
    });
    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        };
      },
    });
  },
  onError(error) {
    postMessage({ type: 'error', error, errorOutputs });
    errorOutputs.length = 0;
  },
});

globalThis.onmessage = function (e) {
  handler.handle(e);
};
