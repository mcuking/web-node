import type { RuntimeInfo } from '../worker/runtime.worker';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export interface RuntimeEvents {
  stdout: (data: string) => void;
  stderr: (data: string) => void;
  exit: (code: number) => void;
  ready: (info: RuntimeInfo) => void;
}

interface BridgeHttpRequest {
  type: 'web-node:http';
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: ArrayBuffer | null;
  stream?: boolean;
}

interface StreamMessage {
  id: number;
  type: 'httpHead' | 'httpChunk' | 'httpEnd' | 'error';
  status?: number;
  statusMessage?: string;
  headers?: Record<string, string | string[]>;
  data?: Uint8Array;
  message?: string;
}

export interface InstallResult {
  packages: number;
  installed: Array<{ name: string; version: string; path: string }>;
  warnings: string[];
  /** Packages reused from `package-lock.json` without re-resolving. */
  fromLockfile?: number;
  /** `.bin` command names linked into `node_modules/.bin`. */
  binLinks?: string[];
  /** Lifecycle events that ran, as `package@version event`. */
  lifecycle?: string[];
}

/**
 * Main-thread facade over the runtime worker.
 *
 * This is the only surface the UI is allowed to use. Every request is
 * correlated by id; streams and lifecycle events are pushed.
 */
export class RuntimeClient {
  #worker: Worker;
  #pending = new Map<number, Pending>();
  #streams = new Map<number, (msg: StreamMessage) => void>();
  #nextId = 1;
  #listeners: Partial<RuntimeEvents> = {};

  constructor() {
    // Boot timing handshake (M107): read by the page, harmless elsewhere.
    const boot = (globalThis as { __wnBoot?: { workerSpawnMs: number } }).__wnBoot;
    if (boot) boot.workerSpawnMs = Math.round(performance.now());
    this.#worker = new Worker(new URL('../worker/runtime.worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = (event: MessageEvent) => this.#onMessage(event.data);
    this.#worker.onerror = (event) => {
      this.#listeners.stderr?.(`[worker error] ${event.message}\n`);
    };
    this.#worker.onmessageerror = (event) => {
      this.#listeners.stderr?.(`[worker message error] ${String(event.data)}\n`);
    };
  }

  on<K extends keyof RuntimeEvents>(event: K, handler: RuntimeEvents[K]): void {
    this.#listeners[event] = handler;
  }

  #onMessage(msg: { id: number; type: string; [k: string]: unknown }): void {
    // Streaming HTTP responses are dispatched to their per-request handler and
    // never settle a promise.
    if (msg.type.startsWith('http')) {
      const stream = this.#streams.get(msg.id);
      if (stream) {
        stream(msg as unknown as StreamMessage);
        return;
      }
    }

    switch (msg.type) {
      case 'stdout':
        this.#listeners.stdout?.(String(msg.data));
        return;
      case 'stderr':
        this.#listeners.stderr?.(String(msg.data));
        return;
      case 'ready':
        this.#listeners.ready?.(msg.info as RuntimeInfo);
        break; // fall through: settle the pending init() promise
      case 'exit':
        this.#listeners.exit?.(Number(msg.code));
        break; // fall through: settle the pending run() promise
    }

    const pending = this.#pending.get(msg.id);
    if (!pending) return;
    this.#pending.delete(msg.id);
    if (msg.type === 'error') {
      pending.reject(new Error(String(msg.message)));
    } else if (msg.type === 'ready') {
      pending.resolve(msg.info);
    } else {
      pending.resolve(msg.result);
    }
  }

  #request<T>(payload: Record<string, unknown>): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#worker.postMessage({ id, ...payload });
    });
  }

  init(): Promise<void> {
    return this.#request({ type: 'init' });
  }

  mount(files: Record<string, string>): Promise<string[]> {
    return this.#request({ type: 'mount', files });
  }

  run(entry?: string): Promise<void> {
    return this.#request({ type: 'run', entry });
  }

  writeFile(path: string, contents: string): Promise<string[]> {
    return this.#request({ type: 'writeFile', path, contents });
  }

  readFile(path: string): Promise<string> {
    return this.#request({ type: 'readFile', path });
  }

  reset(): Promise<string[]> {
    return this.#request({ type: 'reset' });
  }

  /** Install the project's dependencies from the npm registry (milestone 4). */
  installDeps(opts: { cwd?: string; includeDev?: boolean } = {}): Promise<InstallResult> {
    return this.#request({ type: 'npmInstall', cwd: opts.cwd, includeDev: opts.includeDev });
  }

  describe(): Promise<{
    bindings: string[];
    modules: Array<{ id: string; origin: string; state: string }>;
    ports: number[];
  }> {
    return this.#request({ type: 'describe' });
  }

  /**
   * Register the ServiceWorker that turns browser requests to
   * `/preview/<port>/…` into virtual connections inside the runtime worker.
   * Safe to call when ServiceWorkers are unavailable — it just resolves false.
   */
  async installServiceWorkerBridge(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) return false;
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      this.#onRelayedRequest(event);
    });
    // A preview on its own subdomain (`<port>.localhost`) is a *different
    // origin*, so its ServiceWorker cannot post to this page directly: it relays
    // through its own bootstrap page, which forwards here over `postMessage`.
    // Same message shape, so it takes the same path from here on.
    window.addEventListener('message', (event: MessageEvent) => {
      const from = (() => {
        try {
          return new URL(event.origin).hostname;
        } catch {
          return '';
        }
      })();
      if (from !== location.hostname && !from.endsWith('.localhost')) return;
      this.#onRelayedRequest(event);
    });

    try {
      // Derive both from BASE_URL so the worker works from a sub-path too
      // (GitHub Pages serves the app from /web-node/, not the origin root).
      const base = import.meta.env.BASE_URL;
      await navigator.serviceWorker.register(base + 'sw.js', { scope: base });
      await navigator.serviceWorker.ready;
      return true;
    } catch {
      return false;
    }
  }

  /** Serve one bridged request (from a same-origin or subdomain preview). */
  #onRelayedRequest(event: MessageEvent): void {
    const data = event.data as BridgeHttpRequest | undefined;
    if (!data || data.type !== 'web-node:http') return;
    const reply = event.ports[0];
    if (!reply) return;
    this.#serveViaStream(data, reply);
  }

  /**
   * Relay one virtual request to the worker in streaming mode, forwarding the
   * head and every body chunk to the ServiceWorker as they arrive. That is what
   * makes `res.write()` / SSE / large files reach the browser incrementally
   * instead of as one blob.
   */
  #serveViaStream(req: BridgeHttpRequest, reply: MessagePort): void {
    const id = this.#nextId++;
    this.#streams.set(id, (msg) => {
      switch (msg.type) {
        case 'httpHead':
          reply.postMessage({
            type: 'head',
            status: msg.status,
            statusMessage: msg.statusMessage,
            headers: msg.headers,
          });
          return;
        case 'httpChunk':
          reply.postMessage({ type: 'chunk', data: msg.data });
          return;
        case 'httpEnd':
          this.#streams.delete(id);
          reply.postMessage({ type: 'end' });
          return;
        case 'error':
          this.#streams.delete(id);
          reply.postMessage({ type: 'error', message: msg.message });
          return;
      }
    });
    this.#worker.postMessage({
      id,
      type: 'httpStream',
      port: req.port,
      method: req.method,
      path: req.path,
      headers: req.headers,
      body: req.body,
    });
  }

  terminate(): void {
    this.#worker.terminate();
  }
}
