import type { BuiltinSpec, BuiltinInitContext } from './types';

/** `timers` builtin. */
export const timersSpec: BuiltinSpec = {
  id: 'timers',
  aliases: ['node:timers'],
  origin: 'web-node',
  init: (ctx: BuiltinInitContext) => {
    const binding = ctx.binding.timers;

    // Lazily loaded so `timers` does not depend on async_hooks at boot (Node's
    // own `internal/timers` requires it lazily for the same reason).
    let asyncHooks: {
      newAsyncId: () => number;
      getDefaultTriggerAsyncId: () => number;
      emitInit: (asyncId: number, type: string, triggerAsyncId: number, resource: unknown) => void;
      emitBefore: (asyncId: number, triggerAsyncId: number, resource: unknown) => void;
      emitAfter: (asyncId: number) => void;
      emitDestroy: (asyncId: number) => void;
    } | null = null;
    const hooks = () => (asyncHooks ??= ctx.require('internal/async_hooks') as typeof asyncHooks)!;

    class Timeout {
      _id: number;
      _kind: 'timeout' | 'interval' | 'immediate';
      _destroyed = false;
      _repeat: number | null;
      _callback: (...args: unknown[]) => void;
      /** `async_id_symbol` / `trigger_async_id_symbol`, as on a real Timeout. */
      _asyncId = -1;
      _triggerAsyncId = 0;

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
        if (this._asyncId > 0) hooks().emitDestroy(this._asyncId);
      }
    }

    /**
     * Create the async resource for a timer before it is scheduled, mirroring
     * `lib/internal/timers.js` (`emitInit(asyncId, 'Timeout', trigger, this)`).
     * This is what makes `async_hooks` and `AsyncLocalStorage` see timers.
     */
    function track(
      timeout: Timeout,
      type: 'Timeout' | 'Immediate',
      fire: (cb: () => void) => number,
      cb: () => void,
    ): number {
      const ah = hooks();
      const asyncId = ah.newAsyncId();
      const triggerAsyncId = timeout._triggerAsyncId || ah.getDefaultTriggerAsyncId();
      timeout._asyncId = asyncId;
      timeout._triggerAsyncId = triggerAsyncId;
      ah.emitInit(asyncId, type, triggerAsyncId, timeout);
      return fire(() => {
        ah.emitBefore(asyncId, triggerAsyncId, timeout);
        try {
          cb();
        } finally {
          ah.emitAfter(asyncId);
        }
        if (timeout._repeat === null) ah.emitDestroy(asyncId);
      });
    }

    function setTimeout(cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]): Timeout {
      const ah = hooks();
      const t = new Timeout(-1, 'timeout', cb, null);
      t._triggerAsyncId = ah.getDefaultTriggerAsyncId();
      t._id = track(t, 'Timeout', (wrapped) => binding.setTimeout(wrapped, ms ?? 1), () => cb(...args));
      return t;
    }
    function setInterval(cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]): Timeout {
      const ah = hooks();
      const t = new Timeout(-1, 'interval', cb, ms ?? 1);
      t._triggerAsyncId = ah.getDefaultTriggerAsyncId();
      t._id = track(t, 'Timeout', (wrapped) => binding.setInterval(wrapped, ms ?? 1), () => cb(...args));
      return t;
    }
    function setImmediate(cb: (...a: unknown[]) => void, ...args: unknown[]): Timeout {
      const ah = hooks();
      const t = new Timeout(-1, 'immediate', cb, null);
      t._triggerAsyncId = ah.getDefaultTriggerAsyncId();
      t._id = track(t, 'Immediate', (wrapped) => binding.setImmediate(wrapped), () => cb(...args));
      return t;
    }
    function clearTimeout(t?: Timeout | number): void {
      if (t === undefined) return;
      if (typeof t === 'number') binding.clearTimeout(t);
      else {
        t._destroyed = true;
        binding.clearTimeout(t._id);
        if (t._asyncId > 0) hooks().emitDestroy(t._asyncId);
      }
    }
    function clearInterval(t?: Timeout | number): void {
      if (t === undefined) return;
      if (typeof t === 'number') binding.clearInterval(t);
      else {
        t._destroyed = true;
        binding.clearInterval(t._id);
        if (t._asyncId > 0) hooks().emitDestroy(t._asyncId);
      }
    }
    function clearImmediate(t?: Timeout | number): void {
      if (t === undefined) return;
      if (typeof t === 'number') binding.clearImmediate(t);
      else {
        t._destroyed = true;
        binding.clearImmediate(t._id);
        if (t._asyncId > 0) hooks().emitDestroy(t._asyncId);
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
