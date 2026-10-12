# M147 · Real threads for `worker_threads` (真并行)

> **Owed to**: the P0 item in `docs/webcontainer-gap-analysis.md` — WebContainer runs
> **1 process = 1 real Web Worker**, so its CPU work parallelises across cores;
> web-node's `worker_threads.Worker` is a **second module registry on the same
> event loop**, so a `jest-worker`/`terser` minify stays serial.
> **Goal**: give `worker_threads.Worker` a **real Web Worker** when the environment
> supports it (`crossOriginIsolated` ⇒ `SharedArrayBuffer`), and keep the current
> cooperative path as a **fallback** so nothing regresses where it does not.

## Why this is a milestone, not a patch

A real thread is a **separate JS realm**: it cannot inherit the parent's module
registry, its VFS objects, its bindings, or its `MessagePort` instances. Three
subsystems must be bridged across the thread boundary:

1. **Filesystem** — the worker script (`require`s its own modules, reads
   `node_modules`) needs the *same* tree the parent owns. The parent's
   in-memory `MemoryVfs` is authoritative, so the thread must reach it
   **synchronously** (module loading is sync).
2. **Messaging** — `parentPort`, `workerData`, `postMessage`, `stdin/stdout/stderr`,
   and **port transfer** cross realms.
3. **Lifecycle** — `online`/`message`/`error`/`exit`/`terminate`, exit codes,
   `unref`, and the "settle when idle" rule, all of which today rely on one
   shared event loop.

## Phases

### Phase A — synchronous VFS bridge  ⟨done 2026-10-12⟩
The correctness foundation every later phase needs, and the one piece that is
**fully testable today** (Node has real `MessageChannel` + `SharedArrayBuffer` +
`Atomics.wait`, so the two sides can be exercised in `vitest`).

- `src/sync/thread-protocol.ts` — op codes + `[u32 metaLen][meta JSON][body]`
  framing for the VFS bridge.
- `src/node-runtime/vfs/remote.ts` — `RemoteVfs implements Vfs`: the **thread
  side**, forwarding every op over a `SyncChannel`, reconstructing `VfsError`.
- `src/node-runtime/vfs/remote-server.ts` — `serveVfsChannel(port, control, vfs)`:
  the **parent side**, applying ops to the authoritative `MemoryVfs` and
  answering through shared memory. Reuses `serveSyncChannel` (M120).
- Tests: round-trip every `Vfs` op across a real `MessageChannel` + SAB, and
  assert error fidelity (`ENOENT`, `EISDIR`, `ENOTDIR`).

**Reuses** (no new machinery): `src/sync/sab-rpc.ts` (`SyncChannel` already parks
the caller in `Atomics.wait`; `serveSyncChannel` already serialises writers).

### Phase B — the thread worker shell + host gate  ⟨done 2026-10-12⟩
- `src/worker/thread.worker.ts` — a real worker entry that boots a `NodeRuntime`
  over a `RemoteVfs`, installs a worker-side `worker_threads` view, and runs the
  entry module. Bundled by Vite like `runtime.worker.ts` (same `define`s, the
  vendored/wasm plugins already apply to worker entries).
- `src/node-runtime/proc/real-worker.ts` — the parent-side `WorkerHandle` that
  spawns the real `Worker`, transfers a `MessagePort` + control SAB, and serves
  the VFS.
- `createWorkerHost` picks real vs cooperative on
  `crossOriginIsolated && typeof Worker === 'function'`, **falling back** otherwise.
- Lifecycle: `online`/`message`/`error`/`exit`/`terminate` bridged over a host
  `MessagePort`; `#activeWorkCount` counts the thread so `drain()` waits for it.

### Phase C — messaging parity  ⟨done 2026-10-12⟩
`parentPort` as a **realm-local `MessagePort`** driven by the host port (needs a
small binding hook), so `instanceof MessagePort`, `receiveMessageOnPort`, and
**transferring `MessagePort`s across the thread boundary** behave as in Node.
Until then: plain structured-clone payloads only, and a transfer → loud error.

Done: the messaging binding gained a cross-realm bridge (`src/sync/port-bridge.ts`
+ `Endpoint.bridge` / `__ports`). A port crossing the boundary becomes a *link
descriptor*; the origin keeps the group half and the peer gets a proxy. The
thread's `parentPort` is now a real realm `MessagePort` (auto-started, as Node
does). Verified by `test/port-bridge.test.ts` (two live realms). Remaining edges
(one message to both a local and a cross-thread port, or one transfer to several
cross-thread ports) throw loudly rather than guess.

### Phase D — memory & pool limits  ⟨done 2026-10-12⟩
Each thread boots its own realm (vendored sources + wasm). A 8–16-worker
`jest-worker` pool would multiply that. Options: share the compiled
`WebAssembly.Module`s, cap the pool, or lazily boot. Measure first.

Measured (real Chrome, CDP): **~4.95 MB JS heap per thread**; all six wasm
modules compile cold in **~3.3 ms total** (2.4 MB openssl = 1.93 ms). So sharing
compiled `WebAssembly.Module`s saves ~2 ms/thread — **ruled out by data**. The
multiplier is memory, so the lever shipped is a **concurrent real-thread cap**:
`createWorkerHost` tracks `liveRealThreads` and, past `maxRealThreads` (default
`navigator.hardwareConcurrency`, overridable via `__WEB_NODE_MAX_THREADS__`),
routes new `Worker`s to the cooperative path — correct, just not parallel.

## Risks

- **Deadlock surface**: the parent serves the thread's VFS on its event loop; if
  the parent is itself parked in `Atomics.wait` (an `fsyncSync`) the thread's
  call is delayed (not deadlocked) and bounded by the channel timeout
  (`DEFAULT_TIMEOUT_MS`). Documented, not hidden.
- **Realms ×2**: bundle size / boot cost of a second `NodeRuntime` per thread.
- **Port transfer across realms** is the sharpest edge (Phase C).

## Acceptance for the milestone

- A `worker_threads.Worker` doing CPU work runs on a **separate thread**: the
  parent's event-loop lag stays ~0 while the worker is busy (measurable), and the
  build's minify step uses >1 core.
- With `crossOriginIsolated === false` behaviour is **byte-identical to today**
  (cooperative path), verified by the existing worker tests.
