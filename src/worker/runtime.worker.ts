/// <reference lib="webworker" />
import { NodeRuntime, ProcessExit } from '../node-runtime/runtime';
import { createEgress, type Egress } from '../node-runtime/net/egress';
import {
  MemoryVfs,
  OpfsPersistence,
  OpfsWorkerPersistence,
  readOnlyPersistence,
  type Persistence,
} from '../node-runtime/vfs';
import { beginGcPump } from '../node-runtime/gc-pump';
import { installVendored, vendoredCount } from '../node-runtime/vendored';
import { loadWasmModule } from '../node-runtime/wasm/lazy';
import { loadWasmModules, loadDeferredWasmModules, wasmModuleNames, DEFERRED_WASM_MODULES } from '../node-runtime/wasm';
import { DEMO_FILES, DEMO_VERSION } from '../demo-project';
import { scaffoldFiles } from './scaffold';

const decoder = new TextDecoder();

/**
 * The outbound-network transport for this worker (M122).
 *
 * A module worker is already same-origin with the page, so its `fetch` carries
 * the page's origin — that is the "host-sourced fetcher" half of WebContainer's
 * egress design, minus a separate worker whose only job is to hold the network.
 * A self-hosted CORS bridge can be supplied by the embedder (public proxy sites
 * are intentionally **not** hard-coded); `__WEB_NODE_EGRESS_PROXY__` and the
 * build-time `VITE_WEB_NODE_EGRESS_PROXY` are both honoured, first one wins.
 * A WebSocket raw-TCP bridge (`VITE_WEB_NODE_TCP_PROXY`) is optional and absent
 * by default, so `net.connect` to a public host keeps failing loudly.
 */
function createWorkerEgress(): Egress {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const scope = globalThis as {
    __WEB_NODE_EGRESS_PROXY__?: string;
    __WEB_NODE_TCP_PROXY__?: string;
  };
  const proxy = scope.__WEB_NODE_EGRESS_PROXY__ || env.VITE_WEB_NODE_EGRESS_PROXY || undefined;
  const tcpProxy = scope.__WEB_NODE_TCP_PROXY__ || env.VITE_WEB_NODE_TCP_PROXY || undefined;
  return createEgress({
    fetch: globalThis.fetch.bind(globalThis) as unknown as Parameters<typeof createEgress>[0]['fetch'],
    proxy,
    onFallback: (reason, url) => {
      // Keep it visible in the worker console: a silent fallback hides a broken
      // CORS assumption until it bites somewhere far away.
      console.warn('[web-node] egress direct attempt failed, retrying via proxy:', url, reason);
    },
    ...(tcpProxy ? { tcpBridgeUrl: tcpProxy } : {}),
  } as Parameters<typeof createEgress>[0]);
}

/**
 * Cold-start breakdown (M107), in ms on the **worker's** clock (its time origin
 * is worker creation, not the document). Reported back in the `ready` message so
 * the page can attribute the gap between worker spawn and runtime ready to a
 * specific phase: `vendoredMs` (fetch+parse the source bundle), `wasmMs`
 * (fetch+instantiate the native modules) and `realmMs` (build the realm).
 */
const bootAt = performance.now();
const bootPhases = { evalAt: Math.round(bootAt), vendoredMs: 0, wasmMs: 0, realmMs: 0 };

/**
 * Base-prefixed URL of the emnapi **thread-child** bootstrap (M125).
 *
 * `@emnapi/wasi-threads` spawns real threads by handing a real browser `Worker`
 * a compiled `WebAssembly.Module` + the shared memory; a `Worker` can only be
 * created from a URL, and only this worker knows the deploy's base path
 * (`__WASI_THREAD_CHILD_URL__` is a build-time define). Adapters that supply
 * `onCreateWorker` read this global instead of guessing the path. The asset is
 * produced by `tools/build-wasi-thread-child.mjs`.
 */
(globalThis as { __webnodeWasiThreadChildUrl?: string }).__webnodeWasiThreadChildUrl =
  __WASI_THREAD_CHILD_URL__;

/**
 * Fetch the **core** vendored-sources tier (M107 / M126) and install it.
 *
 * The core tier is everything `new NodeRuntime(...)` reads while booting (see
 * `plugins/vendored-source.ts`). It is emitted as a plain-text asset and preloaded
 * from `index.html`, so this request is usually already warm. In tests the sources
 * are populated synchronously, so this resolves immediately. The promise starts at
 * module-eval — as early as fetch can possibly go in the worker.
 */
const vendoredCoreReady: Promise<void> = (async (): Promise<void> => {
  if (vendoredComplete()) return;
  const res = await fetch(__VENDORED_CORE_URL__);
  if (!res.ok) throw new Error(`vendored core sources: HTTP ${res.status}`);
  installVendored(await res.text());
})().finally(() => {
  if (!bootPhases.vendoredMs) bootPhases.vendoredMs = Math.round(performance.now() - bootAt);
});

/**
 * Fetch the **lazy** vendored-sources tier (M126) in the background.
 *
 * These are the sources only user code reaches (`fs`, `crypto`, `http`, the web
 * streams, `node_modules`). They are **not** awaited at boot — the realm is built
 * from the core tier alone — but every request that can execute user code awaits
 * {@link ensureDeferredVendored} first, so a synchronous `require` can never run
 * against a source that is still in flight. `priority: 'low'` keeps it from
 * competing with the critical payloads for bandwidth.
 */
const vendoredRest: Promise<void> = (async (): Promise<void> => {
  if (vendoredComplete()) return;
  const res = await fetch(__VENDORED_REST_URL__, { priority: 'low' } as RequestInit);
  if (!res.ok) throw new Error(`vendored lazy sources: HTTP ${res.status}`);
  installVendored(await res.text());
})();

/** True once every file in the manifest is present (in tests: the eager glob). */
function vendoredComplete(): boolean {
  return vendoredCount() >= __VENDORED_MANIFEST__.length;
}

let vendoredRestReady: Promise<void> | null = null;
function ensureDeferredVendored(): Promise<void> {
  if (vendoredRestReady === null) {
    vendoredRestReady = vendoredRest.then(() => {
      post({ id: 0, type: 'vendoredReady', ms: Math.round(performance.now() - bootAt) });
    });
  }
  return vendoredRestReady;
}

// Kick the lazy prefetch off as soon as the module evaluates. The catch keeps a
// failed fire-and-forget load from being an unhandled rejection; a caller that
// awaits it (i.e. before running user code) still sees the failure.
void ensureDeferredVendored().catch(() => {});

/**
 * Fetch + instantiate the native→WASM modules (M115).
 *
 * Same rule as the vendored sources: they must be in place before the realm is
 * built, because the binding table is constructed synchronously and
 * `internalBinding('zlib')` & co. read their exports at module-eval. The bytes
 * arrive as separate hashed assets, so this costs a parallel download, not a JS
 * parse. Starts at module-eval — as early as it can go.
 */
/**
 * Fetch + instantiate the **boot-critical** native→WASM modules (M115).
 *
 * Same rule as the vendored sources: they must be in place before the realm is
 * built, because the binding table is constructed synchronously and
 * `internalBinding('zlib')` & co. read their exports at module-eval. The bytes
 * arrive as separate hashed assets, so this costs a parallel download, not a JS
 * parse. Starts at module-eval — as early as it can go. Since M107 this is only
 * the small set (`wn_stub`, `wn_zlib`); the codecs live in {@link ensureDeferredWasm}.
 */
const wasmReady: Promise<void> = loadWasmModules().finally(() => {
  if (!bootPhases.wasmMs) bootPhases.wasmMs = Math.round(performance.now() - bootAt);
});

/**
 * The big codecs (brotli / zstd / histogram) are **not** awaited at boot (M107).
 * The realm and the binding table never touch them, so they only need to be in
 * place before *user code runs*. They are prefetched in parallel with the
 * critical payloads but at `priority: 'low'`, so they use spare bandwidth
 * instead of competing for it; every request that can execute user code awaits
 * {@link ensureDeferredWasm} first, so a synchronous API can never run against a
 * module that is still in flight.
 */
let wasmDeferred: Promise<void> | null = null;
function ensureDeferredWasm(): Promise<void> {
  if (wasmDeferred === null) {
    wasmDeferred = (async () => {
      await loadDeferredWasmModules();
      // Report the moment (on the worker clock) so the page can show when the
      // codecs became usable — relative to `ready` this makes the deferral visible.
      post({ id: 0, type: 'deferredReady', ms: Math.round(performance.now() - bootAt) });
    })();
  }
  return wasmDeferred;
}

// Kick the prefetch off as soon as the module evaluates — as early as it can go.
// The catch keeps a failed fire-and-forget load from being an unhandled rejection;
// a caller that awaits it (i.e. before running user code) still sees the failure.
void ensureDeferredWasm().catch(() => {});

/**
 * Big native→WASM modules are **not** awaited at boot (M119): the OpenSSL
 * subset is ~2.3 MB and would undo M107's startup work. They stream in after
 * `wasmReady` resolves and light up the fast paths (`crypto/hash.ts`) as soon
 * as they land — the pure-JS fallbacks stay correct meanwhile. Failures are
 * swallowed on purpose: a missing lazy module is a slowdown, not a bug.
 */
void wasmReady.then(() => loadWasmModule('wn_openssl'));

/**
 * Runtime worker.
 *
 * Everything Node-flavoured happens here: the realm, the bindings, the VFS and
 * the user's code. The main thread only talks to it over a MessagePort.
 *
 * Why a worker (not the main thread):
 *  - user code can be CPU-heavy; the UI must stay responsive
 *  - OPFS sync access handles are worker-only
 *  - it is the natural home for future SharedArrayBuffer/Atomics syscalls
 */

type Request =
  | { id: number; type: 'init' }
  | { id: number; type: 'mount'; files: Record<string, string> }
  | { id: number; type: 'run'; entry?: string; oneShot?: boolean }
  | { id: number; type: 'writeFile'; path: string; contents: string }
  | { id: number; type: 'readFile'; path: string }
  | { id: number; type: 'mkdir'; path: string }
  | { id: number; type: 'rename'; from: string; to: string }
  | { id: number; type: 'remove'; path: string }
  | { id: number; type: 'tree' }
  | { id: number; type: 'flush' }
  | { id: number; type: 'evict'; root: string }
  | { id: number; type: 'scaffold'; template: string; target: string; port?: number }
  | { id: number; type: 'reset' }
  | { id: number; type: 'describe' }
  | { id: number; type: 'npmInstall'; cwd?: string; includeDev?: boolean; add?: string[]; save?: boolean }
  | {
      id: number;
      type: 'http';
      port: number;
      method: string;
      path: string;
      headers: Record<string, string>;
      body: ArrayBuffer | null;
    }
  | {
      id: number;
      type: 'httpStream';
      port: number;
      method: string;
      path: string;
      headers: Record<string, string>;
      body: ArrayBuffer | null;
    };

export interface RuntimeInfo {
  persistSupported: boolean;
  restored: boolean;
  /**
   * Which storage backend is live. `fs-worker` means `fs.fsyncSync` really
   * blocks until the bytes are in OPFS (M120); `direct` means persistence is
   * asynchronous and a sync flush is a no-op (no cross-origin isolation).
   */
  persistence: 'fs-worker' | 'direct' | 'none';
  files: string[];
  bindings: string[];
  /** 已加载的 native→WASM 模块（M115）。 */
  wasmModules: string[];
  /** 启动期后台加载的大模块（M107）——执行用户代码前保证就位。 */
  deferredWasmModules: string[];
  vendoredFiles: string[];
  /**
   * Cold-start phase breakdown (M107), all ms on the worker's clock. The page
   * adds `evalAt`+phase to the worker-spawn timestamp to get an absolute
   * figure; the phases are reported as durations so they stay meaningful.
   */
  timing: { evalAt: number; vendoredMs: number; wasmMs: number; realmMs: number };
}

type Response =
  | { id: number; type: 'ok'; result?: unknown }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'stdout'; data: string }
  | { id: number; type: 'stderr'; data: string }
  | { id: number; type: 'exit'; code: number }
  | { id: number; type: 'httpHead'; status: number; statusMessage: string; headers: Record<string, string | string[]> }
  | { id: number; type: 'httpChunk'; data: Uint8Array }
  | { id: number; type: 'httpEnd' }
  | { id: number; type: 'ready'; info: RuntimeInfo }
  | { id: number; type: 'deferredReady'; ms: number }
  | { id: number; type: 'vendoredReady'; ms: number };

/**
 * Storage backend.
 *
 * `OpfsWorkerPersistence` is preferred: it runs OPFS in a second worker so a
 * blocking `fsyncSync` can park the runtime worker in `Atomics.wait` while that
 * worker does the `await`ing. It needs cross-origin isolation (COOP/COEP) for
 * `SharedArrayBuffer`, which GitHub Pages does not send — there the direct
 * backend keeps working, just without a synchronous flush.
 */
const persistence: Persistence = (() => {
  const backend =
    OpfsWorkerPersistence.create({ rootName: 'web-node-project' }) ??
    new OpfsPersistence('web-node-project');
  // A dedicated **build** worker (M139) reads the store but never writes it: the
  // page spawns it to run one build and terminates it, then mounts the outputs
  // back into the main worker, which owns the store. Mirroring from here would
  // race the main worker's snapshot.
  return self.name === 'web-node-build' ? readOnlyPersistence(backend) : backend;
})();

const persistenceKind: RuntimeInfo['persistence'] =
  persistence.durable ? 'fs-worker' : OpfsPersistence.supported ? 'direct' : 'none';

let runtime: NodeRuntime | null = null;
let vfs: MemoryVfs | null = null;
/**
 * The run whose program is currently producing console output.
 *
 * A single realm has one `process.stdout`, so output cannot be tagged with the
 * *program* that wrote it — but tagging it with the most recent `run()` is
 * enough for the UI to keep each project's output apart, and far better than a
 * flat `id: 0` that made every line look like it belonged to whatever project
 * was on screen.
 */
let activeRunId = 0;
/** Release handle for the GC pump of the run in flight, if it is a one-shot one. */
let runPump: (() => void) | null = null;

function post(msg: Response): void {
  self.postMessage(msg);
}

function ensureDir(v: MemoryVfs, filePath: string): void {
  const idx = filePath.lastIndexOf('/');
  if (idx > 0) v.mkdir(filePath.slice(0, idx), { recursive: true });
}

/**
 * The whole tree as `{ path, type }`, **without pulling cold file bodies into
 * memory**.
 *
 * `snapshot()` by default materialises every cold file — it has to, for a
 * backend whose only copy is the tree. For a *listing* that is pure waste: the
 * paths are already implied by the structure index, and reading a whole
 * `node_modules` back just to print its names is exactly the churn that used to
 * blow the tab. When a synchronous read path exists, ask for the structure-only
 * snapshot: it still expands cold directories one level (so the paths are
 * complete) but leaves file bytes where they are.
 */
function listEntries(v: MemoryVfs): Array<{ path: string; type: 'file' | 'dir' }> {
  const dropColdBodies = persistence.readSource() !== null;
  return v
    .snapshot({ dropColdBodies })
    .map((s) => ({ path: s.path, type: s.type }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function listTree(v: MemoryVfs): string[] {
  return listEntries(v)
    .filter((e) => e.type === 'file')
    .map((e) => e.path);
}

function writeAll(v: MemoryVfs, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    ensureDir(v, path);
    v.writeFile(path, new TextEncoder().encode(contents));
  }
}

/**
 * Add demo files that a restored snapshot predates, without touching anything
 * the user already has (edits, installed `node_modules`, deleted files stay
 * put). A returning visitor whose OPFS snapshot was written before a release
 * that added demo files would otherwise never see them.
 */
function writeMissing(v: MemoryVfs, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    if (v.exists(path)) continue;
    ensureDir(v, path);
    v.writeFile(path, new TextEncoder().encode(contents));
  }
}

interface VirtualHttpResult {
  status: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
}

/**
 * Inbound request from the outside world (the ServiceWorker bridge).
 *
 * This is the *only* way a browser URL reaches a user's `http.createServer`:
 * SW → page → here → virtual network → the server the user bound.
 */
interface HttpStreamModule {
  _stream: (
    port: number,
    init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array },
    handlers: {
      onHead: (h: { status: number; statusMessage: string; headers: Record<string, string | string[]> }) => void;
      onData: (c: Uint8Array) => void;
      onEnd: () => void;
      onError: (e: Error) => void;
    },
  ) => void;
}

async function serveVirtualRequest(
  rt: NodeRuntime,
  req: { port: number; method: string; path: string; headers: Record<string, string>; body: ArrayBuffer | null },
): Promise<VirtualHttpResult & { body: Uint8Array }> {
  const http = rt.realm.require('http') as unknown as {
    _request: (
      port: number,
      init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array },
    ) => Promise<VirtualHttpResult>;
  };
  return http._request(req.port, {
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body ? new Uint8Array(req.body) : undefined,
  });
}

async function init(id: number): Promise<void> {
  // The core sources and wasm must be in place before the realm is built:
  // `require` is synchronous, and so is the `internalBinding()` table. The lazy
  // source tier is *not* awaited here (M126) — if the realm turns out to need a
  // file from it (a host difference), `buildRuntime` throws and we load it and
  // retry once.
  await Promise.all([vendoredCoreReady, wasmReady]);
  try {
    await buildRuntime(id);
  } catch (err) {
    if (err instanceof Error && /Vendored file .* is missing/.test(err.message)) {
      await ensureDeferredVendored();
      await buildRuntime(id);
      return;
    }
    throw err;
  }
}

async function buildRuntime(id: number): Promise<void> {
  const loaded = await persistence.load();

  // The read source decides how a restore is decoded. With one, the tree comes
  // back **cold**: the index (v3, or a v2 the FS worker can also read through)
  // names files, and the bytes are fetched from the mirror on first use — so a
  // large `node_modules` never has to fit in memory at boot. Without one (the
  // direct backend, which has no synchronous read path), bodies must already be
  // inline in the index and are decoded eagerly, because the tree is the only
  // copy. v1 predates both and kept text bodies inline, so it stays eager.
  const readSource = persistence.readSource();
  let hasRestored = Boolean(loaded && loaded.entries.length > 0);
  let v = hasRestored
    ? MemoryVfs.fromSnapshot(
        loaded!.entries,
        { cwd: '/project', cold: readSource !== null && loaded!.version >= 2 },
        loaded!.version >= 2 ? 'base64' : 'text',
      )
    : new MemoryVfs({ cwd: '/project' });

  // The marker records which demo release wrote the tree in the store.
  //
  // A restored tree may predate the current demo layout (M130 moved every
  // project into its own `/project/<id>` directory), and the structure index
  // then still lists files the byte mirror never received — a reader that finds
  // one gets a phantom. An *absent* marker is exactly that case: nothing before
  // this release wrote one. So a missing marker means start clean (one store
  // wipe beats pruning thousands of stale paths), while a marker that merely
  // names an older release means the demo sources changed and are rewritten in
  // place without touching anything the visitor created.
  // Wire the backing-store sinks onto the tree *before* the reconciliation
  // below reads it. On a restore the marker is a **cold** file, so reading it
  // needs the read source already installed; when the sink was wired only at the
  // end, the marker read came back empty and every durable boot wiped the store
  // (M139). A wipe replaces the tree, so re-wire whatever tree survives.
  const wireVfs = (target: MemoryVfs): MemoryVfs => {
    // Durable `fsync` rides this sink. Without a durable backend there is
    // nothing to wait for, so the sink stays unset and `fsync` degrades to a
    // no-op — the same answer a real filesystem gives when its writes sit in a
    // page cache.
    if (persistence.durable) target.setSyncSink((path, data) => persistence.sync(path, data));
    // The other half of M120: a lookup the memory tree misses can still reach
    // the store, synchronously. `null` from the direct backend leaves the tree
    // as the only source of truth, which is how this ran before.
    target.setReadSource(readSource);
    target.setDeletedSink((paths) => persistence.deleted(paths));
    return target;
  };
  wireVfs(v);

  const markerPath = '/project/.demo-version';
  const readMarker = (): string => {
    try {
      return v.exists(markerPath) ? new TextDecoder().decode(v.readFile(markerPath)).trim() : '';
    } catch {
      return '';
    }
  };
  const marker = hasRestored ? readMarker() : '';
  if (hasRestored && marker === '') {
    await persistence.clear();
    v = wireVfs(new MemoryVfs({ cwd: '/project' }));
    hasRestored = false; // the previous tree is gone; this is a fresh start
  }

  if (!hasRestored || marker !== String(DEMO_VERSION)) {
    writeAll(v, DEMO_FILES);
    ensureDir(v, markerPath);
    v.writeFile(markerPath, new TextEncoder().encode(String(DEMO_VERSION)));
  } else {
    writeMissing(v, DEMO_FILES);
  }

  vfs = v;
  runtime = new NodeRuntime({
    vfs: v,
    argv: ['/project/index.js'],
    env: { NODE_ENV: 'development', WEB_NODE: '1' },
    installGlobals: true,
    egress: createWorkerEgress(),
    onStdout: (data) => post({ id: activeRunId, type: 'stdout', data }),
    onStderr: (data) => post({ id: activeRunId, type: 'stderr', data }),
  });

  persistence.schedule(v);

  bootPhases.realmMs = Math.round(performance.now() - bootAt);

  post({
    id,
    type: 'ready',
    info: {
      persistSupported: OpfsPersistence.supported,
      restored: hasRestored,
      persistence: persistenceKind,
      files: listTree(v),
      bindings: runtime.realm.bindingIds,
      wasmModules: wasmModuleNames(),
      deferredWasmModules: Object.keys(DEFERRED_WASM_MODULES).sort(),
      vendoredFiles: __VENDORED_MANIFEST__,
      timing: { ...bootPhases },
    },
  });
}

function run(id: number, entry?: string, oneShot = false): void {
  if (!runtime || !vfs) throw new Error('runtime not initialised');
  activeRunId = id;
  // A one-shot program (a build) compiles hundreds of modules with no idle gap
  // for V8's own heuristics; pump the collector while it runs to bound the peak
  // (M139). A server run is left alone — it would otherwise collect forever.
  if (oneShot) runPump = beginGcPump();
  const target = entry ?? '/project/index.js';
  try {
    runtime.runMain(target);
  } catch (err) {
    if (err instanceof ProcessExit) {
      persistence.schedule(vfs);
      stopRunPump();
      post({ id, type: 'exit', code: err.code });
      return;
    }
    stopRunPump();
    post({ id: 0, type: 'stderr', data: `\n${(err as Error).stack ?? String(err)}\n` });
    post({ id, type: 'error', message: (err as Error).message });
    return;
  }
  // The program is not over when its entry module returns: it is over when the
  // event loop has nothing left to run (Node stays alive for a pending timer, a
  // socket, a worker). Report the exit only once it has drained, or a run that
  // scheduled work past its last synchronous statement would look finished
  // while its callbacks and timers were still about to fire.
  void finishRun(id);
}

/** Stop the pump a one-shot run started, once and only once. */
function stopRunPump(): void {
  if (runPump) {
    runPump();
    runPump = null;
  }
}

async function finishRun(id: number): Promise<void> {
  if (!runtime || !vfs) return;
  await runtime.drain();
  persistence.schedule(vfs);
  stopRunPump();
  post({ id, type: 'exit', code: runtime.exitCode ?? 0 });
}

self.onmessage = async (event: MessageEvent<Request>): Promise<void> => {
  const req = event.data;
  try {
    switch (req.type) {
      case 'init':
        await init(req.id);
        return;
      case 'mount':
        if (!vfs) throw new Error('runtime not initialised');
        writeAll(vfs, req.files);
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listTree(vfs) });
        return;
      case 'run':
        await Promise.all([ensureDeferredVendored(), ensureDeferredWasm()]);
        run(req.id, req.entry, req.oneShot);
        return;
      case 'writeFile':
        if (!vfs) throw new Error('runtime not initialised');
        ensureDir(vfs, req.path);
        vfs.writeFile(req.path, new TextEncoder().encode(req.contents));
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listEntries(vfs) });
        return;
      case 'readFile':
        if (!vfs) throw new Error('runtime not initialised');
        post({ id: req.id, type: 'ok', result: new TextDecoder().decode(vfs.readFile(req.path)) });
        return;
      case 'mkdir':
        if (!vfs) throw new Error('runtime not initialised');
        vfs.mkdir(req.path, { recursive: true });
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listEntries(vfs) });
        return;
      case 'rename':
        if (!vfs) throw new Error('runtime not initialised');
        // Create the destination's parents first: the tree edits a path one
        // segment at a time, so a rename must not fail because a directory it
        // moves under does not exist yet.
        ensureDir(vfs, req.to);
        vfs.rename(req.from, req.to);
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listEntries(vfs) });
        return;
      case 'remove':
        if (!vfs) throw new Error('runtime not initialised');
        // `recursive` so a folder goes with everything under it; `force` so a
        // concurrent delete (or a path already gone) is not an error.
        vfs.rm(req.path, { recursive: true, force: true });
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listEntries(vfs) });
        return;
      case 'tree':
        if (!vfs) throw new Error('runtime not initialised');
        post({ id: req.id, type: 'ok', result: listEntries(vfs) });
        return;
      case 'flush':
        // Mirror the in-memory tree to the store and resolve once it has landed.
        // The page calls this before spawning a build worker so that worker
        // restores the *current* source, not a debounced older snapshot.
        if (!vfs) throw new Error('runtime not initialised');
        await persistence.flush(vfs);
        post({ id: req.id, type: 'ok' });
        return;
      case 'evict': {
        if (!vfs) throw new Error('runtime not initialised');
        // Free the bytes a project was holding. With a synchronous read path
        // (the FS-worker backend) the tree keeps its structure and pulls a body
        // back on demand, so this is non-destructive — the files are still
        // listed and still readable. Without one the tree is the only copy, so
        // the heavy dependency tree is dropped outright; step 1 of every project
        // reinstalls it, and the alternative is keeping gigabytes resident.
        if (persistence.readSource() === null) {
          const modules = req.root.replace(/\/+$/, '') + '/node_modules';
          if (vfs.exists(modules)) vfs.rm(modules, { recursive: true, force: true });
        } else {
          // Mirror first. A body may only be dropped once the store holds it,
          // and the snapshot is debounced — so without this a switch could
          // discard bytes that were written but never made durable.
          await persistence.flush(vfs);
          vfs.evictBodies(req.root);
        }
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listEntries(vfs) });
        return;
      }
      case 'scaffold': {
        // Copy a built-in template's files into a new project directory, so the
        // user can start from a working Vite/webpack/rspack/Node setup. Only the
        // embedded demo sources are copied (never `node_modules`); the new
        // project installs its own deps as step 1.
        if (!vfs) throw new Error('runtime not initialised');
        const files = scaffoldFiles(req.template, req.target, req.port);
        if (!Object.keys(files).length) throw new Error(`unknown template: ${req.template}`);
        writeAll(vfs, files);
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listEntries(vfs) });
        return;
      }
      case 'reset':
        await persistence.clear();
        if (vfs) {
          writeAll(vfs, DEMO_FILES);
          ensureDir(vfs, '/project/.demo-version');
          vfs.writeFile('/project/.demo-version', new TextEncoder().encode(String(DEMO_VERSION)));
          persistence.schedule(vfs);
        }
        post({ id: req.id, type: 'ok', result: vfs ? listTree(vfs) : [] });
        return;
      case 'describe':
        if (!runtime) throw new Error('runtime not initialised');
        post({ id: req.id, type: 'ok', result: runtime.describe() });
        return;
      case 'npmInstall': {
        if (!runtime) throw new Error('runtime not initialised');
        await Promise.all([ensureDeferredVendored(), ensureDeferredWasm()]);
        const result = await runtime.installDependencies({
          cwd: req.cwd,
          includeDev: req.includeDev,
          add: req.add,
          save: req.save,
          onLog: (message) => post({ id: 0, type: 'stdout', data: message + '\n' }),
          // Lifecycle scripts run inside the install, and their output belongs in
          // the same terminal the install writes to.
          onOutput: (chunk, stream) =>
            post({ id: 0, type: stream === 'stdout' ? 'stdout' : 'stderr', data: decoder.decode(chunk) }),
        });
        if (vfs) persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result });
        return;
      }
      case 'http': {
        if (!runtime) throw new Error('runtime not initialised');
        await Promise.all([ensureDeferredVendored(), ensureDeferredWasm()]);
        const result = await serveVirtualRequest(runtime, req);
        post({ id: req.id, type: 'ok', result });
        return;
      }
      case 'httpStream': {
        if (!runtime) throw new Error('runtime not initialised');
        await Promise.all([ensureDeferredVendored(), ensureDeferredWasm()]);
        const http = runtime.realm.require('http') as unknown as HttpStreamModule;
        http._stream(
          req.port,
          {
            method: req.method,
            path: req.path,
            headers: req.headers,
            body: req.body ? new Uint8Array(req.body) : undefined,
          },
          {
            onHead: (h) =>
              post({
                id: req.id,
                type: 'httpHead',
                status: h.status,
                statusMessage: h.statusMessage,
                headers: h.headers,
              }),
            onData: (chunk) => post({ id: req.id, type: 'httpChunk', data: chunk }),
            onEnd: () => post({ id: req.id, type: 'httpEnd' }),
            onError: (err) => post({ id: req.id, type: 'error', message: err.message }),
          },
        );
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
    post({ id: 0, type: 'stderr', data: `[worker:${req.type}] ${message}${stack}\n` });
    post({ id: req.id, type: 'error', message });
  }
};
