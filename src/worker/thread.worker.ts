/// <reference lib="webworker" />
/**
 * A **real-thread worker** entry (M147, Phase B).
 *
 * The parent spawns one of these per `worker_threads.Worker` to get actual CPU
 * parallelism. This shell does the browser-only work — fetch the vendored
 * sources and native→WASM modules the fresh realm needs, wait for the init
 * message that carries the transferred ports — and hands off to
 * {@link bootstrapThread}, which builds the realm, installs the worker-side
 * `worker_threads` view and runs the entry.
 *
 * It is intentionally thin: everything testable lives in `bootstrapThread`.
 */

import { installVendored, vendoredCount } from '../node-runtime/vendored';
import { loadWasmModules, loadDeferredWasmModules } from '../node-runtime/wasm';
import { createEgress, type Egress } from '../node-runtime/net/egress';
import { bootstrapThread } from '../node-runtime/proc/thread-bootstrap';
import type { ThreadInitMessage, ThreadToParent } from '../sync/thread-protocol';

/** The thread-child bootstrap URL the emnapi adapters read (M125), for parity. */
(globalThis as { __webnodeWasiThreadChildUrl?: string }).__webnodeWasiThreadChildUrl =
  __WASI_THREAD_CHILD_URL__;

/** The same egress policy the main runtime worker uses (M122). */
function createThreadEgress(): Egress {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const scope = globalThis as { __WEB_NODE_EGRESS_PROXY__?: string; __WEB_NODE_TCP_PROXY__?: string };
  const proxy = scope.__WEB_NODE_EGRESS_PROXY__ || env.VITE_WEB_NODE_EGRESS_PROXY || undefined;
  const tcpProxy = scope.__WEB_NODE_TCP_PROXY__ || env.VITE_WEB_NODE_TCP_PROXY || undefined;
  return createEgress({
    fetch: globalThis.fetch.bind(globalThis) as unknown as Parameters<typeof createEgress>[0]['fetch'],
    proxy,
    ...(tcpProxy ? { tcpBridgeUrl: tcpProxy } : {}),
  } as Parameters<typeof createEgress>[0]);
}

/**
 * Fetch and install both vendored-source tiers. A thread boots its own realm, so
 * it needs the same sources the main worker has — but they are usually already
 * in the HTTP cache from the main worker's boot, so this is a cache hit, not a
 * second download.
 */
async function ensureVendored(): Promise<void> {
  if (vendoredCount() >= __VENDORED_MANIFEST__.length) return;
  const core = await fetch(__VENDORED_CORE_URL__);
  if (!core.ok) throw new Error(`vendored core sources: HTTP ${core.status}`);
  installVendored(await core.text());
  if (vendoredCount() >= __VENDORED_MANIFEST__.length) return;
  const rest = await fetch(__VENDORED_REST_URL__);
  if (!rest.ok) throw new Error(`vendored lazy sources: HTTP ${rest.status}`);
  installVendored(await rest.text());
}

let booted: Promise<void> | null = null;

async function boot(init: ThreadInitMessage): Promise<void> {
  await ensureVendored();
  await Promise.all([loadWasmModules(), loadDeferredWasmModules()]);
  bootstrapThread(init, { egress: createThreadEgress() });
}

self.addEventListener('message', (event: MessageEvent): void => {
  const init = event.data as ThreadInitMessage | undefined;
  if (!init || init.kind !== 'web-node:thread-init') return;
  const send = (frame: ThreadToParent): void => init.messagePort.postMessage(frame);
  // `self.onmessage` may fire again for a stray message; only boot once.
  if (booted !== null) return;
  booted = boot(init).catch((err: unknown) => {
    const error = err as Error;
    send({ t: 'error', message: error?.message ?? String(err), stack: error?.stack });
    send({ t: 'exit', code: 1 });
  });
});
