import type { BindingContext, BindingFactory } from './context';

/** `util` binding: the low-level helpers Node's internal util code expects. */
export const utilBinding: BindingFactory = (ctx: BindingContext) => ({
  getOwnNonIndexProperties: (obj: object, filter?: number): (string | symbol)[] => {
    const keys = Object.keys(obj).concat(Object.getOwnPropertySymbols(obj) as never);
    void filter;
    return keys.filter((k) => {
      if (typeof k === 'string') {
        const i = Number(k);
        return !(Number.isInteger(i) && i >= 0 && String(i) === k);
      }
      return true;
    }) as (string | symbol)[];
  },
  getConstructorName: (obj: object): string => {
    if (obj === null || obj === undefined) return String(obj);
    const proto = Object.getPrototypeOf(obj);
    if (proto === null) return 'Object';
    const ctor = proto.constructor;
    if (!ctor) return 'Object';
    return ctor.name;
  },
  getExternalValue: () => 0n,
  getPromiseDetails: (v: unknown): unknown[] => {
    if (!(v instanceof Promise)) return [0];
    return [0];
  },
  getProxyDetails: () => undefined,
  previewEntries: () => undefined,
  isInsideNodeModules: () => false,
  shouldAbortOnUncaughtToggle: new Uint8Array(1),
  getCallSites: () => [],
  getHeapSnapshot: () => {
    throw new Error('heap snapshot is not supported in web-node');
  },
  getHeapStatistics: () => ({
    total_heap_size: 0,
    total_heap_size_executable: 0,
    total_physical_size: 0,
    total_available_size: 0,
    used_heap_size: 0,
    heap_size_limit: 0,
    malloced_memory: 0,
    peak_malloced_memory: 0,
    does_zap_garbage: 0,
    number_of_native_contexts: 0,
    number_of_detached_contexts: 0,
  }),
  getHeapSpaceStatistics: () => [],
  setPromiseHooks: () => undefined,
  getStringWidth: (str: string): number => str.length,
  sleep: () => {
    throw new Error('synchronous sleep is not available in web-node');
  },
  arrayBufferViewHasBuffer: (v: ArrayBufferView): boolean => v.buffer !== undefined,
  getOwnPropertyDescriptors: (o: object) => Object.getOwnPropertyDescriptors(o),
  noSideEffectsToString: (v: unknown) => String(v),
  getSystemErrorName: (err: number) => String(err),
  getDevToolsConfig: () => ({}),
  setTraceCategoryStateUpdateHandler: () => undefined,
  triggerUncaughtException: (err: Error) => {
    ctx.writeStderr((err && err.stack) || String(err));
    ctx.exit(1);
  },
});
