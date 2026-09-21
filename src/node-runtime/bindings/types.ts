import type { BindingFactory } from './context';

/**
 * `types` binding: mirrors the surface of `src/node_types.cc` (`VALUE_METHOD_MAP`
 * plus `isAnyArrayBuffer` / `isBoxedPrimitive`), which `internal/util/types.js`
 * spreads before layering its own `TypedArray` tag checks on top.
 *
 * Deliberately kept to the native surface: the typed-array family and
 * `isArrayBufferView` / `isTypedArray` are defined in the JS module.
 *
 * Two predicates cannot be reproduced exactly in a tab and are documented as
 * such: `isProxy` (no way to detect a Proxy from JS) and `isExternal` (no
 * external values exist here).
 */
const tagOf = (v: unknown): string => Object.prototype.toString.call(v);
const isBigIntObject = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && tagOf(v) === '[object BigInt]';

export const typesBinding: BindingFactory = () => ({
  isAnyArrayBuffer: (v: unknown): boolean =>
    v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
  isArgumentsObject: (v: unknown): boolean => tagOf(v) === '[object Arguments]',
  isArrayBuffer: (v: unknown): boolean => v instanceof ArrayBuffer,
  isAsyncFunction: (v: unknown): boolean => {
    // V8's `IsAsyncFunction` covers both `async function` and
    // `async function*` (an async generator satisfies both this and
    // `isGeneratorFunction`). `Object.prototype.toString` tells them apart.
    const tag = tagOf(v);
    return tag === '[object AsyncFunction]' || tag === '[object AsyncGeneratorFunction]';
  },
  isBigIntObject,
  isBooleanObject: (v: unknown): boolean => v instanceof Boolean,
  isBoxedPrimitive: (v: unknown): boolean =>
    v instanceof Number || v instanceof String || v instanceof Boolean || v instanceof Symbol || isBigIntObject(v),
  isDate: (v: unknown): boolean => v instanceof Date,
  isExternal: (): boolean => false,
  // V8's `SharedFunctionInfo::is_generator()` is true for both sync and async
  // generators, so `async function*` is a generator function too — that is why
  // `util.inspect` labels it `[AsyncGeneratorFunction: name]`.
  isGeneratorFunction: (v: unknown): boolean => {
    const tag = tagOf(v);
    return tag === '[object GeneratorFunction]' || tag === '[object AsyncGeneratorFunction]';
  },
  isGeneratorObject: (v: unknown): boolean => {
    const tag = tagOf(v);
    return tag === '[object Generator]' || tag === '[object AsyncGenerator]';
  },
  isMap: (v: unknown): boolean => v instanceof Map,
  isMapIterator: (v: unknown): boolean => tagOf(v) === '[object Map Iterator]',
  isModuleNamespaceObject: (v: unknown): boolean => tagOf(v) === '[object Module]',
  isNativeError: (v: unknown): boolean => v instanceof Error,
  isNumberObject: (v: unknown): boolean => v instanceof Number,
  isPromise: (v: unknown): boolean => v instanceof Promise,
  isProxy: (): boolean => false,
  isRegExp: (v: unknown): boolean => v instanceof RegExp,
  isSet: (v: unknown): boolean => v instanceof Set,
  isSetIterator: (v: unknown): boolean => tagOf(v) === '[object Set Iterator]',
  isSharedArrayBuffer: (v: unknown): boolean =>
    typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer,
  isStringObject: (v: unknown): boolean => v instanceof String,
  isSymbolObject: (v: unknown): boolean => typeof v === 'object' && v !== null && tagOf(v) === '[object Symbol]',
  isWeakMap: (v: unknown): boolean => v instanceof WeakMap,
  isWeakSet: (v: unknown): boolean => v instanceof WeakSet,
});
