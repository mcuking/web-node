import type { BindingContext, BindingFactory } from './context';
import { getStringWidth } from './misc';
import { triggerUncaughtException } from './uncaught';

/**
 * `util` binding: the low-level helpers Node's internal util code expects.
 *
 * `constants` mirrors the three blocks `src/node_util.cc` publishes on this
 * binding: V8 promise states, the exit-info field indices, and V8 property
 * filters (values read off `deps/v8/include/v8-promise.h` and `v8-object.h`).
 *
 * Three introspection helpers cannot be reproduced faithfully from JS and are
 * documented as approximations:
 *   - `getProxyDetails` always returns `undefined` (a Proxy is undetectable
 *     from JS), so inspected proxies print as ordinary objects.
 *   - `getPromiseDetails` reports `kPending` for every promise (V8 will not
 *     expose a promise's state synchronously), so settled promises inspect as
 *     `Promise { <pending> }`. Non-promises return `undefined`, like V8.
 *   - `previewEntries` yields nothing for a Map/Set *iterator* (V8 reads the
 *     iterator's internal next-index; JS cannot), so `[Map Entries] { … }`
 *     prints as an empty `[Map Iterator] { }`.
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

/**
 * `privateSymbols` are minted once per binding table so a given embedder symbol
 * is the same object everywhere it is read (Node hands out fixed C++ symbols).
 */
const PRIVATE_SYMBOLS = {
  arrow_message_private_symbol: Symbol('arrow_message_private_symbol'),
  decorated_private_symbol: Symbol('decorated_private_symbol'),
  // `internal/vm.js`'s `isContext` reads this off a contextified object, and the
  // `contextify` binding's `makeContext` writes it (the name matches
  // `src/env_properties.h`).
  contextify_context_private_symbol: Symbol('node:contextify:context'),
  // The embedder option id a compiled script/function carries; the `contextify`
  // binding accepts but does not act on it.
  host_defined_option_symbol: Symbol('node:host_defined_option_symbol'),
  // `internal/worker/js_transferable`'s `markTransferMode` writes the transfer
  // mode here; the `data` accessor of a marked object reads it back.
  transfer_mode_private_symbol: Symbol('transfer_mode_private_symbol'),
  // `internal/buffer.js`'s `markAsUntransferable` writes this to flag an object
  // whose backing store must not be moved out of the current agent.
  untransferable_object_private_symbol: Symbol('untransferable_object_private_symbol'),
};

const isArrayIndex = (key: string): boolean => {
  const i = Number(key);
  return Number.isInteger(i) && i >= 0 && String(i) === key;
};

/** Node's `trim_spaces`: strip leading/trailing spaces, tabs and newlines. */
function trimSpaces(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && (input[start] === ' ' || input[start] === '\t' || input[start] === '\n')) start++;
  while (end > start && (input[end - 1] === ' ' || input[end - 1] === '\t' || input[end - 1] === '\n')) end--;
  return input.slice(start, end);
}

/**
 * A direct port of `Dotenv::ParseContent` (src/node_dotenv.cc) backing
 * `util.parseEnv`. Kept faithful so our dotenv parsing matches Node's:
 * comments, the `export ` prefix, `'`/`"`/backtick quoting, `\n` expansion in
 * double quotes, trailing `#` comments on bare values, and last-wins duplicates.
 */
export function parseEnv(input: string): Record<string, string> {
  const store: Record<string, string> = Object.create(null) as Record<string, string>;
  let content = input.replace(/\r/g, '');
  content = trimSpaces(content);
  while (content.length > 0) {
    // Skip empty lines and comments.
    if (content[0] === '\n' || content[0] === '#') {
      const nl = content.indexOf('\n');
      content = nl !== -1 ? content.slice(nl + 1) : '';
      continue;
    }
    // First `=` or newline in a single pass.
    let eqOrNl = -1;
    for (let k = 0; k < content.length; k++) {
      if (content[k] === '=' || content[k] === '\n') {
        eqOrNl = k;
        break;
      }
    }
    if (eqOrNl === -1 || content[eqOrNl] === '\n') {
      if (eqOrNl !== -1) {
        content = trimSpaces(content.slice(eqOrNl + 1));
        continue;
      }
      break;
    }
    let key = trimSpaces(content.slice(0, eqOrNl));
    content = content.slice(eqOrNl + 1);

    // `KEY=` (no value, end of line) stores an empty string.
    if (content.length === 0 || content[0] === '\n') {
      store[key] = '';
      continue;
    }
    content = trimSpaces(content);
    if (key.length === 0) continue;
    if (key.startsWith('export ')) key = trimSpaces(key.slice(7));
    if (content.length === 0) {
      store[key] = '';
      break;
    }

    // Double-quoted values expand `\n` into real newlines.
    if (content[0] === '"') {
      const closing = content.indexOf('"', 1);
      if (closing !== -1) {
        const value = content.slice(1, closing).replace(/\\n/g, '\n');
        store[key] = value;
        const nl = content.indexOf('\n', closing + 1);
        content = nl !== -1 ? content.slice(nl + 1) : '';
        continue;
      }
    }

    if (content[0] === "'" || content[0] === '"' || content[0] === '`') {
      const quote = content[0];
      const closing = content.indexOf(quote, 1);
      if (closing === -1) {
        const nl = content.indexOf('\n');
        if (nl !== -1) {
          store[key] = content.slice(0, nl);
          content = content.slice(nl + 1);
        } else {
          store[key] = content;
          break;
        }
      } else {
        store[key] = content.slice(1, closing);
        const nl = content.indexOf('\n', closing + 1);
        content = nl !== -1 ? content.slice(nl + 1) : '';
        continue;
      }
    } else {
      const nl = content.indexOf('\n');
      if (nl !== -1) {
        let value = content.slice(0, nl);
        const hash = value.indexOf('#');
        if (hash !== -1) value = value.slice(0, hash);
        store[key] = trimSpaces(value);
        content = content.slice(nl + 1);
      } else {
        let value = content;
        const hash = value.indexOf('#');
        if (hash !== -1) value = content.slice(0, hash);
        store[key] = trimSpaces(value);
        content = '';
      }
    }
    content = trimSpaces(content);
  }
  return store;
}

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
    // `BaseObject::TransferMode` (src/base_object.h). `markTransferMode` ORs
    // these into the private transfer-mode slot.
    kDisallowCloneAndTransfer: 0,
    kTransferable: 1 << 0,
    kCloneable: 1 << 1,
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
  getPromiseDetails: (v: unknown): unknown => (v instanceof Promise ? [kPending, undefined] : undefined),
  getProxyDetails: () => undefined,
  /**
   * A partial preview of a collection's entries, used by `util.inspect` for
   * Map/Set/WeakMap/WeakSet and iterators. Map yields `[k, v]` pairs, Set and
   * Array yield their values, and weak collections yield nothing (they are
   * not enumerable). With `slowPath` the caller also learns whether the
   * entries are key/value pairs. A Map/Set *iterator* has no readable
   * position from JS, so it previews as empty (see the file header).
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
  shouldAbortOnUncaughtToggle: ctx.uncaughtCapture.shouldAbortOnUncaught,
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
  // Real Node keeps `getStringWidth` on the `icu` binding, not `util`; this is
  // the same function so the two can never disagree.
  getStringWidth,
  // Node blocks the thread here (`uv_sleep`); `Atomics.wait` is the closest
  // thing JS offers and is available inside our worker / the test harness.
  sleep: (msec: number): void => {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, msec);
  },
  // Handed to `lib/internal/util.js`; the two symbols are stable per process.
  privateSymbols: PRIVATE_SYMBOLS,
  constructSharedArrayBuffer: (byteLength: number): SharedArrayBuffer => new SharedArrayBuffer(byteLength),
  // There are no file descriptors here; internal callers only use this to pick
  // a read path, so reporting a regular file is the honest, inert answer.
  guessHandleType: (_fd: number): string => 'FILE',
  /**
   * Port of `node::DefineLazyProperties` (src/node_util.cc): define one lazy
   * data property per key whose getter requires `id` and reads `mod[key]`,
   * caching the result after first access (matching V8's lazy data property).
   */
  defineLazyProperties: (
    target: object,
    id: string,
    keys: string[],
    enumerable = true,
  ): void => {
    for (const key of keys) {
      let resolved = false;
      let cached: unknown;
      Object.defineProperty(target, key, {
        enumerable,
        configurable: true,
        get(): unknown {
          if (!resolved) {
            const mod = ctx.requireBuiltin?.(id) as Record<string, unknown> | undefined;
            if (mod === undefined) {
              throw new Error(`internalBinding('util').defineLazyProperties: no require for ${id}`);
            }
            cached = mod[key];
            resolved = true;
          }
          return cached;
        },
      });
    }
  },
  parseEnv,
  arrayBufferViewHasBuffer: (v: ArrayBufferView): boolean => v.buffer !== undefined,
  getOwnPropertyDescriptors: (o: object) => Object.getOwnPropertyDescriptors(o),
  noSideEffectsToString: (v: unknown) => String(v),
  getSystemErrorName: (err: number) => String(err),
  getDevToolsConfig: () => ({}),
  setTraceCategoryStateUpdateHandler: () => undefined,
  triggerUncaughtException: (err: unknown, fromPromise?: boolean) =>
    triggerUncaughtException(ctx, err, fromPromise),
});
