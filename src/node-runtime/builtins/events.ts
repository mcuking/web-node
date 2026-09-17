import type { BuiltinSpec } from './types';

/** `events` builtin — EventEmitter. */
export const eventsSpec: BuiltinSpec = {
  id: 'events',
  aliases: ['node:events'],
  origin: 'web-node',
  init: () => {
    const errorMonitor = Symbol.for('events.errorMonitor');
    const kRejection = Symbol.for('nodejs.rejection');

    interface Listener {
      fn: (...args: unknown[]) => void;
      once: boolean;
    }

    class EventEmitter {
      #events = new Map<string | symbol, Listener[]>();
      #maxListeners = 10;
      static captureRejections = false;
      static defaultMaxListeners = 10;

      static getEventListeners(emitter: EventEmitter, name: string | symbol): ((...a: unknown[]) => void)[] {
        const list = emitter.#events.get(name);
        return list ? list.map((l) => l.fn) : [];
      }

      static listenerCount(emitter: EventEmitter, name: string | symbol): number {
        return emitter.#events.get(name)?.length ?? 0;
      }

      static once(emitter: EventEmitter, name: string): Promise<unknown[]> {
        return new Promise((resolve) => {
          emitter.once(name, (...args: unknown[]) => resolve(args));
        });
      }

      static on(emitter: EventEmitter, name: string): AsyncIterableIterator<unknown[]> {
        const queue: unknown[][] = [];
        let resolveNext: ((v: IteratorResult<unknown[]>) => void) | null = null;
        emitter.on(name, (...args: unknown[]) => {
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r({ value: args, done: false });
          } else {
            queue.push(args);
          }
        });
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          next(): Promise<IteratorResult<unknown[]>> {
            if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
        };
      }

      #add(name: string | symbol, fn: (...a: unknown[]) => void, once: boolean, prepend: boolean): this {
        if (typeof fn !== 'function') throw new TypeError('The "listener" argument must be of type function');
        const list = this.#events.get(name) ?? [];
        const item: Listener = { fn, once };
        if (prepend) list.unshift(item);
        else list.push(item);
        this.#events.set(name, list);
        return this;
      }

      on(name: string | symbol, fn: (...a: unknown[]) => void): this {
        return this.#add(name, fn, false, false);
      }
      addListener(name: string | symbol, fn: (...a: unknown[]) => void): this {
        return this.on(name, fn);
      }
      once(name: string | symbol, fn: (...a: unknown[]) => void): this {
        return this.#add(name, fn, true, false);
      }
      prependListener(name: string | symbol, fn: (...a: unknown[]) => void): this {
        return this.#add(name, fn, false, true);
      }
      prependOnceListener(name: string | symbol, fn: (...a: unknown[]) => void): this {
        return this.#add(name, fn, true, true);
      }

      #remove(name: string | symbol, fn: (...a: unknown[]) => void): this {
        const list = this.#events.get(name);
        if (!list) return this;
        const idx = list.findIndex((l) => l.fn === fn);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.#events.delete(name);
        return this;
      }

      removeListener(name: string | symbol, fn: (...a: unknown[]) => void): this {
        return this.#remove(name, fn);
      }
      off(name: string | symbol, fn: (...a: unknown[]) => void): this {
        return this.#remove(name, fn);
      }

      removeAllListeners(name?: string | symbol): this {
        if (name === undefined) this.#events.clear();
        else this.#events.delete(name);
        return this;
      }

      emit(name: string | symbol, ...args: unknown[]): boolean {
        if (name === 'error') {
          const monitor = this.#events.get(errorMonitor);
          if (monitor) for (const l of [...monitor]) l.fn(...args);
        }
        const list = this.#events.get(name);
        if (!list || list.length === 0) {
          if (name === 'error') {
            const err = args[0];
            throw err instanceof Error ? err : new Error('Unhandled error' + (err ? `. (${String(err)})` : ''));
          }
          return false;
        }
        for (const l of [...list]) {
          if (l.once) this.#remove(name, l.fn);
          l.fn.apply(this, args);
        }
        return true;
      }

      listeners(name: string | symbol): ((...a: unknown[]) => void)[] {
        return (this.#events.get(name) ?? []).map((l) => l.fn);
      }
      rawListeners(name: string | symbol): ((...a: unknown[]) => void)[] {
        return this.listeners(name);
      }
      listenerCount(name: string | symbol): number {
        return this.#events.get(name)?.length ?? 0;
      }
      eventNames(): (string | symbol)[] {
        return [...this.#events.keys()];
      }
      setMaxListeners(n: number): this {
        this.#maxListeners = n;
        return this;
      }
      getMaxListeners(): number {
        return this.#maxListeners;
      }
    }

    // Node exposes the internal error monitor + capture-rejection symbol.
    Object.defineProperty(EventEmitter, 'errorMonitor', { value: errorMonitor, enumerable: true });
    Object.defineProperty(EventEmitter.prototype, 'kCapture', { value: Symbol.for('nodejs.kCapture') });
    void kRejection;

    // Node's `events` module *is* the EventEmitter constructor, with the named
    // exports hung off it as properties (`module.exports = EventEmitter`).
    // Bundled code does `import EventEmitter from 'events'` and then
    // `class X extends EventEmitter`, so the module value must be callable.
    const mod = EventEmitter as unknown as Record<string, unknown>;
    mod.EventEmitter = EventEmitter;
    mod.default = EventEmitter;
    mod.once = EventEmitter.once;
    mod.on = EventEmitter.on;
    mod.getEventListeners = EventEmitter.getEventListeners;
    mod.listenerCount = EventEmitter.listenerCount;
    mod.captureRejectionSymbol = kRejection;
    mod.EventEmitterAsyncResource = EventEmitter;
    return mod;
  },
};
