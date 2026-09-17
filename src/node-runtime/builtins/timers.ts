import type { BuiltinSpec, BuiltinInitContext } from './types';

/** `timers` builtin. */
export const timersSpec: BuiltinSpec = {
  id: 'timers',
  aliases: ['node:timers'],
  origin: 'web-node',
  init: (ctx: BuiltinInitContext) => {
    const binding = ctx.binding.timers;

    class Timeout {
      _id: number;
      _kind: 'timeout' | 'interval' | 'immediate';
      _destroyed = false;
      _repeat: number | null;
      _callback: (...args: unknown[]) => void;

      constructor(id: number, kind: Timeout['_kind'], callback: (...a: unknown[]) => void, repeat: number | null) {
        this._id = id;
        this._kind = kind;
        this._callback = callback;
        this._repeat = repeat;
      }
      refresh(): this {
        return this;
      }
      ref(): this {
        return this;
      }
      unref(): this {
        return this;
      }
      hasRef(): boolean {
        return !this._destroyed;
      }
      [Symbol.toPrimitive](): number {
        return this._id;
      }
      close(): void {
        this._destroyed = true;
        binding.clearTimeout(this._id);
      }
    }

    function setTimeout(cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]): Timeout {
      const id = binding.setTimeout(cb, ms ?? 1, ...args);
      return new Timeout(id, 'timeout', cb, null);
    }
    function setInterval(cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]): Timeout {
      const id = binding.setInterval(cb, ms ?? 1, ...args);
      return new Timeout(id, 'interval', cb, ms ?? 1);
    }
    function setImmediate(cb: (...a: unknown[]) => void, ...args: unknown[]): Timeout {
      const id = binding.setImmediate(cb, ...args);
      return new Timeout(id, 'immediate', cb, null);
    }
    function clearTimeout(t?: Timeout | number): void {
      if (t === undefined) return;
      if (typeof t === 'number') binding.clearTimeout(t);
      else {
        t._destroyed = true;
        binding.clearTimeout(t._id);
      }
    }
    function clearInterval(t?: Timeout | number): void {
      if (t === undefined) return;
      if (typeof t === 'number') binding.clearInterval(t);
      else {
        t._destroyed = true;
        binding.clearInterval(t._id);
      }
    }
    function clearImmediate(t?: Timeout | number): void {
      if (t === undefined) return;
      if (typeof t === 'number') binding.clearImmediate(t);
      else {
        t._destroyed = true;
        binding.clearImmediate(t._id);
      }
    }

    const promises = {
      setTimeout: (ms?: number, value?: unknown) => new Promise((resolve) => setTimeout(() => resolve(value), ms)),
      setImmediate: (value?: unknown) => new Promise((resolve) => setImmediate(() => resolve(value))),
      setInterval: async function* (ms?: number, value?: unknown) {
        while (true) {
          yield await new Promise((resolve) => setTimeout(() => resolve(value), ms));
        }
      },
      scheduler: {
        wait: (delay: number) => new Promise((resolve) => setTimeout(resolve, delay)),
        yield: () => new Promise((resolve) => setImmediate(resolve)),
      },
    };

    return { setTimeout, setInterval, setImmediate, clearTimeout, clearInterval, clearImmediate, promises, Timeout, _unrefActive: () => undefined, active: () => 0, enroll: () => undefined, unenroll: () => undefined };
  },
};
