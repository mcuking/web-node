import type { RuntimeInfo } from '../worker/runtime.worker';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export interface RuntimeEvents {
  stdout: (data: string) => void;
  stderr: (data: string) => void;
  exit: (code: number) => void;
  ready: (info: RuntimeInfo) => void;
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

  describe(): Promise<{ bindings: string[]; modules: Array<{ id: string; origin: string; state: string }> }> {
    return this.#request({ type: 'describe' });
  }

  terminate(): void {
    this.#worker.terminate();
  }
}
