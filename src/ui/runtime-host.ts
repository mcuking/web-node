/**
 * The **runtime isolation host** (M149).
 *
 * This document is embedded by the app shell in an iframe on an independent
 * origin, and it is the *only* place the runtime runs. It hosts the runtime
 * worker(s) and is a transparent pipe between them and the parent:
 *
 *   app shell  ⇄  [this frame]  ⇄  runtime worker
 *
 * Why a separate origin: the runtime executes user code and owns the OPFS the
 * projects persist to. On the app shell's own origin that code could reach the
 * shell's cookies, storage and credentials; on its own origin it cannot. The
 * frame is **not** `credentialless`: a credentialless cross-origin frame gets an
 * ephemeral storage partition, which would discard that OPFS on every load.
 *
 * The frame also owns the HMR `BroadcastChannel` (`web-node-hmr:<port>`): the
 * dev server runs *here*, so the channel is scoped to this origin and the app
 * shell — a different origin — cannot hear it. Frames are relayed both ways over
 * the same bridge.
 *
 * It is a Vite HTML entry (`runtime-host.html`), so its asset URLs (the worker
 * bundle, the vendored sources, the wasm modules) are rewritten for the deploy
 * base automatically, and the same app served on the host subdomain resolves
 * them.
 */
import {
  HOST_TAG,
  isHostMessageOf,
  type HostToParent,
  type ParentToHost,
} from '../runtime-host-protocol';

const params = new URLSearchParams(location.search);
const base = normalizeBase(params.get('base'));

function normalizeBase(value: string | null): string {
  let b = value || '/';
  if (b.charAt(0) !== '/') b = '/' + b;
  if (b.charAt(b.length - 1) !== '/') b = b + '/';
  return b;
}

function toParent(msg: HostToParent): void {
  try {
    // The parent is the app shell; it validates this frame's origin on its side.
    window.parent.postMessage(msg, '*');
  } catch {
    /* parent gone */
  }
}

/**
 * Make sure this host document is cross-origin isolated, so `SharedArrayBuffer`
 * is available to the runtime (rspack's wasm threads and the FS-worker
 * persistence channel both need it).
 *
 * On a dev server the COOP/COEP headers are already present, so this returns
 * immediately. On a static host (a wildcard domain) they are not, and the
 * ServiceWorker adds them — but only after it controls the document, so the
 * first load is unisolated and we reload, exactly as the app shell does. The
 * reload count is capped so a host that can never isolate degrades instead of
 * looping.
 */
async function ensureIsolated(): Promise<boolean> {
  if (window.crossOriginIsolated) return true;
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register(base + 'sw.js', { scope: base });
    await navigator.serviceWorker.ready;
  } catch {
    return false;
  }
  if (window.crossOriginIsolated) return true;
  const key = '__wnHostReload';
  const tries = Number(sessionStorage.getItem(key) ?? '0');
  if (tries >= 4) return false; // give up; the runtime runs unisolated
  sessionStorage.setItem(key, String(tries + 1));
  location.reload();
  // The reload is in flight; never resolve so nothing else runs.
  return new Promise<boolean>(() => {});
}

const workers = new Map<string, Worker>();

function ensureWorker(name: string): Worker {
  let worker = workers.get(name);
  if (worker) return worker;
  // Both `new URL(...)` literals and both options objects are static on purpose:
  // Vite only rewrites a worker it can parse statically, and it rejects a
  // dynamic options object. Only two names exist — `''` (shared runtime) and
  // `web-node-build` (the throwaway build worker, which swaps to a read-only
  // store view by `self.name`).
  worker =
    name === 'web-node-build'
      ? new Worker(new URL('../worker/runtime.worker.ts', import.meta.url), {
          type: 'module',
          name: 'web-node-build',
        })
      : new Worker(new URL('../worker/runtime.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => toParent({ __wnHost: 'data', name, data: event.data });
  worker.onerror = (event) => toParent({ __wnHost: 'error', name, message: event.message });
  worker.onmessageerror = (event) =>
    toParent({ __wnHost: 'error', name, message: `message error: ${String(event.data)}` });
  workers.set(name, worker);
  return worker;
}

// HMR: the dev server publishes on this origin's channel; relay frames to the
// app shell so it can hand them to the preview that is showing that port.
const hmrChannels = new Map<number, BroadcastChannel>();

function hmrChannel(port: number): BroadcastChannel {
  let channel = hmrChannels.get(port);
  if (!channel) {
    channel = new BroadcastChannel(`web-node-hmr:${port}`);
    channel.onmessage = (event) => toParent({ __wnHost: 'hmr', port, frame: event.data });
    hmrChannels.set(port, channel);
  }
  return channel;
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as ParentToHost | undefined;
  if (!data || typeof data !== 'object' || !(HOST_TAG in data)) return;
  switch (data.__wnHost) {
    case 'boot': {
      ensureWorker(data.name);
      return;
    }
    case 'post': {
      const worker = workers.get(data.name);
      if (worker) worker.postMessage(data.data);
      return;
    }
    case 'terminate': {
      const worker = workers.get(data.name);
      if (worker) {
        worker.terminate();
        workers.delete(data.name);
      }
      return;
    }
    case 'hmr':
      if (typeof data.port === 'number') hmrChannel(data.port).postMessage(data.frame);
      return;
  }
});

async function start(): Promise<void> {
  const isolated = await ensureIsolated();
  // The app shell waits for this before it wires the bridge; `isolated` lets it
  // note when the runtime is running without cross-origin isolation.
  toParent({ __wnHost: 'up', isolated });
}

void start();
