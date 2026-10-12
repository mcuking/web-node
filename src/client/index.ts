import type { RuntimeInfo } from '../worker/runtime.worker';
import { previewPortFromHost } from '../ui/preview-url';
import { WorkerTransport, type RuntimeTransport } from './transport';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** One node of the VFS tree as the UI sees it. */
export interface TreeEntry {
  path: string;
  type: 'file' | 'dir';
}

export interface RuntimeEvents {
  /** `runId` is the id of the `run()` that produced the output (0 = runtime-level). */
  stdout: (data: string, runId: number) => void;
  stderr: (data: string, runId: number) => void;
  exit: (code: number, runId: number) => void;
  ready: (info: RuntimeInfo) => void;
  /** Worker-clock ms when the deferred WASM codecs finished loading (M107). */
  deferredReady: (ms: number) => void;
  /** Worker-clock ms when the lazy vendored-source tier finished loading (M126). */
  vendoredReady: (ms: number) => void;
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
  /** Specs requested via `installDeps({ add })`, with what was saved back. */
  added?: Array<{ name: string; version: string; savedAs: string }>;
}

/**
 * How a `RuntimeClient` obtains its transport. The default spawns a worker on
 * this origin; M149 passes a factory that relays through the cross-origin
 * runtime isolation frame instead. May be sync or async — messages sent before
 * it resolves are queued and flushed on attach.
 */
export type TransportFactory = (name: string) => RuntimeTransport | Promise<RuntimeTransport>;

/**
 * Main-thread facade over the runtime worker.
 *
 * This is the only surface the UI is allowed to use. Every request is
 * correlated by id; streams and lifecycle events are pushed. The worker itself
 * may live on this origin or behind the runtime isolation frame (M149); that is
 * entirely the transport's concern.
 */
export class RuntimeClient {
  #transport: RuntimeTransport | null = null;
  #queued: unknown[] = [];
  #pending = new Map<number, Pending>();
  #streams = new Map<number, (msg: StreamMessage) => void>();
  #nextId = 1;
  #listeners: Partial<RuntimeEvents> = {};

  constructor(opts: { name?: string; transportFactory?: TransportFactory } = {}) {
    const name = opts.name ?? '';
    const factory = opts.transportFactory ?? ((n: string) => new WorkerTransport(n));
    Promise.resolve(factory(name)).then(
      (transport) => this.#attach(transport),
      (err: unknown) => this.#listeners.stderr?.(`[transport error] ${String(err)}\n`, 0),
    );
  }

  #attach(transport: RuntimeTransport): void {
    this.#transport = transport;
    transport.onData = (data) => this.#onMessage(data as { id: number; type: string });
    transport.onError = (message) => this.#listeners.stderr?.(message, 0);
    const queued = this.#queued;
    this.#queued = [];
    for (const msg of queued) transport.post(msg);
  }

  #post(msg: unknown): void {
    if (this.#transport) this.#transport.post(msg);
    else this.#queued.push(msg);
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
        this.#listeners.stdout?.(String(msg.data), msg.id);
        return;
      case 'stderr':
        this.#listeners.stderr?.(String(msg.data), msg.id);
        return;
      case 'ready':
        this.#listeners.ready?.(msg.info as RuntimeInfo);
        break; // fall through: settle the pending init() promise
      case 'deferredReady':
        this.#listeners.deferredReady?.(Number(msg.ms));
        return;
      case 'vendoredReady':
        this.#listeners.vendoredReady?.(Number(msg.ms));
        return;
      case 'exit':
        this.#listeners.exit?.(Number(msg.code), msg.id);
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
      this.#post({ id, ...payload });
    });
  }

  init(): Promise<void> {
    return this.#request({ type: 'init' });
  }

  mount(files: Record<string, string>): Promise<string[]> {
    return this.#request({ type: 'mount', files });
  }

  /**
   * Start `entry` as the program. The returned `id` identifies every stdout /
   * stderr / exit message this run produces, so a caller can attribute output
   * to the context that started it — even after another run has begun.
   */
  run(entry?: string, opts: { oneShot?: boolean } = {}): { id: number; done: Promise<void> } {
    const id = this.#nextId++;
    const done = new Promise<void>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#post({ id, type: 'run', entry, oneShot: opts.oneShot });
    });
    return { id, done };
  }

  writeFile(path: string, contents: string): Promise<TreeEntry[]> {
    return this.#request({ type: 'writeFile', path, contents });
  }

  /** Create a directory (and its parents) in the VFS. */
  mkdir(path: string): Promise<TreeEntry[]> {
    return this.#request({ type: 'mkdir', path });
  }

  /**
   * Move/rename a file or directory; the destination's parents are created if
   * needed. Returns the tree afterwards.
   */
  rename(from: string, to: string): Promise<TreeEntry[]> {
    return this.#request({ type: 'rename', from, to });
  }

  /**
   * Delete a file, or a directory and everything under it. Returns the tree
   * afterwards.
   */
  remove(path: string): Promise<TreeEntry[]> {
    return this.#request({ type: 'remove', path });
  }

  /**
   * Copy a built-in template's sources into `target` (a new project root), so
   * the user can start a project from a known-good setup. Returns the tree.
   */
  scaffold(template: string, target: string, port?: number): Promise<TreeEntry[]> {
    return this.#request({ type: 'scaffold', template, target, port });
  }

  /** The whole VFS tree as `{ path, type }`. */
  tree(): Promise<TreeEntry[]> {
    return this.#request({ type: 'tree' });
  }

  /**
   * Mirror the in-memory tree to backing storage and resolve once it has landed.
   * Called before spawning a build worker so it restores the current source.
   */
  flush(): Promise<void> {
    return this.#request({ type: 'flush' });
  }

  /**
   * Release a project's file bytes from memory (the UI calls it when switching
   * projects). Returns the tree afterwards. Whether the files survive depends on
   * the storage backend; see the worker's `evict` handler.
   */
  evict(root: string): Promise<TreeEntry[]> {
    return this.#request({ type: 'evict', root });
  }

  readFile(path: string): Promise<string> {
    return this.#request({ type: 'readFile', path });
  }

  reset(): Promise<string[]> {
    return this.#request({ type: 'reset' });
  }

  /** Install the project's dependencies from the npm registry (milestone 4). */
  installDeps(opts: { cwd?: string; includeDev?: boolean; add?: string[]; save?: boolean } = {}): Promise<InstallResult> {
    return this.#request({
      type: 'npmInstall',
      cwd: opts.cwd,
      includeDev: opts.includeDev,
      add: opts.add,
      save: opts.save,
    });
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
    // A preview on its own subdomain (`<port>.localhost`, or `<port>.<domain>`
    // when a wildcard preview domain is configured) is a *different origin*, so
    // its ServiceWorker cannot post to this page directly: it relays through its
    // own bootstrap page, which forwards here over `postMessage`. Same message
    // shape, so it takes the same path from here on — but only if the sender is
    // really a preview origin for this app.
    const previewDomain = import.meta.env.VITE_WEB_NODE_PREVIEW_DOMAIN;
    window.addEventListener('message', (event: MessageEvent) => {
      const host = (() => {
        try {
          return new URL(event.origin).hostname;
        } catch {
          return '';
        }
      })();
      if (previewPortFromHost(host, previewDomain) === null) return;
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
    this.#post({
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
    this.#transport?.terminate();
  }
}
