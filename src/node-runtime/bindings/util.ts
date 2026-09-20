import type { BindingContext, BindingFactory } from './context';

/**
 * `util` binding: the low-level helpers Node's internal util code expects.
 *
 * `constants` mirrors the three blocks `src/node_util.cc` publishes on this
 * binding: V8 promise states, the exit-info field indices, and V8 property
 * filters (values read off `deps/v8/include/v8-promise.h` and `v8-object.h`).
 *
 * Two introspection helpers cannot be reproduced faithfully from JS and are
 * documented as approximations:
 *   - `getProxyDetails` always returns `undefined` (a Proxy is undetectable
 *     from JS), so inspected proxies print as ordinary objects.
 *   - `getPromiseDetails` always reports `kPending` (V8 will not expose a
 *     promise's state synchronously), so settled promises inspect as
 *     `Promise { <pending> }`.
 */
const ALL_PROPERTIES = 0;
const ONLY_WRITABLE = 1;
const ONLY_ENUMERABLE = 2;
const ONLY_CONFIGURABLE = 4;
const SKIP_STRINGS = 8;
const SKIP_SYMBOLS = 16;
const kPending = 0;
const kFulfilled = 1;
const kRejected = 2;

const isArrayIndex = (key: string): boolean => {
  const i = Number(key);
  return Number.isInteger(i) && i >= 0 && String(i) === key;
};

export const utilBinding: BindingFactory = (ctx: BindingContext) => ({
  constants: {
    kPending,
    kFulfilled,
    kRejected,
    kExiting: 0,
    kExitCode: 1,
    kHasExitCode: 2,
    ALL_PROPERTIES,
    ONLY_WRITABLE,
    ONLY_ENUMERABLE,
    ONLY_CONFIGURABLE,
    SKIP_STRINGS,
    SKIP_SYMBOLS,
  },
  /**
   * Own, non-index property keys, honouring the V8 property-filter bits the
   * vendored inspect code passes (`ONLY_ENUMERABLE`, `SKIP_STRINGS`,
   * `SKIP_SYMBOLS`). String keys come before symbol keys, matching V8.
   */
  getOwnNonIndexProperties: (obj: object, filter = ALL_PROPERTIES): (string | symbol)[] => {
    const result: (string | symbol)[] = [];
    const onlyEnumerable = (filter & ONLY_ENUMERABLE) !== 0;
    const skipStrings = (filter & SKIP_STRINGS) !== 0;
    const skipSymbols = (filter & SKIP_SYMBOLS) !== 0;
    const enumerable = Object.prototype.propertyIsEnumerable;
    if (!skipStrings) {
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (isArrayIndex(key)) continue;
        if (onlyEnumerable && !enumerable.call(obj, key)) continue;
        result.push(key);
      }
    }
    if (!skipSymbols) {
      for (const sym of Object.getOwnPropertySymbols(obj)) {
        if (onlyEnumerable && !enumerable.call(obj, sym)) continue;
        result.push(sym);
      }
    }
    return result;
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
  getPromiseDetails: (v: unknown): unknown[] => (v instanceof Promise ? [kPending, undefined] : [kPending]),
  getProxyDetails: () => undefined,
  /**
   * A partial preview of a collection's entries, used by `util.inspect` for
   * Map/Set/WeakMap/WeakSet and iterators. Map yields `[k, v]` pairs, Set and
   * Array yield their values, and weak collections yield nothing (they are
   * not enumerable). With `slowPath` the caller also learns whether the
   * entries are key/value pairs.
   */
  previewEntries: (value: unknown, slowPath?: boolean): unknown => {
    const entries: unknown[] = [];
    let isKeyValue = false;
    if (value instanceof Map) {
      for (const [k, v] of value) entries.push([k, v]);
      isKeyValue = true;
    } else if (value instanceof Set) {
      for (const v of value) entries.push(v);
    } else if (Array.isArray(value)) {
      entries.push(...value.slice(0, 100));
    }
    return slowPath ? [entries, isKeyValue] : entries;
  },
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
