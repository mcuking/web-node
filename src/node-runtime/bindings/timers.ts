import type { BindingContext, BindingFactory } from './context';

/**
 * `timers` binding: the event-loop timer surface. Kept small on purpose; the
 * `timers` builtin layers Node's public API on top.
 */
export const timersBinding: BindingFactory = (ctx: BindingContext) => {
  let nextId = 1;
  const active = new Map<number, ReturnType<typeof setTimeout>>();

  return {
    setTimeout: (cb: (...args: unknown[]) => void, after: number, ...args: unknown[]): number => {
      const id = nextId++;
      const handle = setTimeout(() => {
        active.delete(id);
        cb(...args);
      }, Math.max(1, after || 0));
      active.set(id, handle);
      return id;
    },
    clearTimeout: (id: number): void => {
      const h = active.get(id);
      if (h !== undefined) {
        clearTimeout(h);
        active.delete(id);
      }
    },
    setInterval: (cb: (...args: unknown[]) => void, repeat: number, ...args: unknown[]): number => {
      const id = nextId++;
      const handle = setInterval(() => cb(...args), Math.max(1, repeat || 0));
      active.set(id, handle);
      return id;
    },
    clearInterval: (id: number): void => {
      const h = active.get(id);
      if (h !== undefined) {
        clearInterval(h);
        active.delete(id);
      }
    },
    setImmediate: (cb: (...args: unknown[]) => void, ...args: unknown[]): number => {
      const id = nextId++;
      const handle = setTimeout(() => {
        active.delete(id);
        cb(...args);
      }, 0);
      active.set(id, handle);
      return id;
    },
    clearImmediate: (id: number): void => {
      const h = active.get(id);
      if (h !== undefined) {
        clearTimeout(h);
        active.delete(id);
      }
    },
    /** libuv-style high-resolution time source. */
    getLibuvNow: (): number => ctx.now(),
    /** Number of live timers; the runner uses this to decide if the loop is idle. */
    __activeCount: () => active.size,
  };
};
