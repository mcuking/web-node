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
}

interface VirtualHttpResult {
  status: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
}

export interface InstallResult {
  packages: number;
  installed: Array<{ name: string; version: string; path: string }>;
  warnings: string[];
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
  #nextId = 1;
  #listeners: Partial<RuntimeEvents> = {};

  constructor() {
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
      const data = event.data as BridgeHttpRequest | undefined;
      if (!data || data.type !== 'web-node:http') return;
      const reply = event.ports[0];
      if (!reply) return;
      void this.#serveViaBridge(data).then(
        (result) => reply.postMessage(result),
        (err: unknown) => reply.postMessage({ error: err instanceof Error ? err.message : String(err) }),
      );
    });

    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      return true;
    } catch {
      return false;
    }
  }

  async #serveViaBridge(req: BridgeHttpRequest): Promise<VirtualHttpResult | { error: string }> {
    try {
      return await this.#request<VirtualHttpResult>({
        type: 'http',
        port: req.port,
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.body,
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  terminate(): void {
    this.#worker.terminate();
  }
}
