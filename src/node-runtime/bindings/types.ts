import type { BindingFactory } from './context';

/** `types` binding: the low-level predicates Node internal code relies on. */
export const typesBinding: BindingFactory = () => ({
  isAnyArrayBuffer: (v: unknown): boolean =>
    v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
  isArgumentsObject: (v: unknown): boolean => Object.prototype.toString.call(v) === '[object Arguments]',
  isArrayBuffer: (v: unknown): boolean => v instanceof ArrayBuffer,
  isAsyncFunction: (v: unknown): boolean => typeof v === 'function' && v.constructor?.name === 'AsyncFunction',
  isBigInt64Array: (v: unknown): boolean => v instanceof BigInt64Array,
  isBigUint64Array: (v: unknown): boolean => v instanceof BigUint64Array,
  isBooleanObject: (v: unknown): boolean => v instanceof Boolean,
  isBoxedPrimitive: (v: unknown): boolean =>
    v instanceof Boolean || v instanceof Number || v instanceof String || typeof v === 'bigint' || v instanceof Symbol,
  isDataView: (v: unknown): boolean => v instanceof DataView,
  isDate: (v: unknown): boolean => v instanceof Date,
  isExternal: () => false,
  isFloat16Array: () => false,
  isFloat32Array: (v: unknown): boolean => v instanceof Float32Array,
  isFloat64Array: (v: unknown): boolean => v instanceof Float64Array,
  isGeneratorFunction: (v: unknown): boolean => typeof v === 'function' && v.constructor?.name === 'GeneratorFunction',
  isGeneratorObject: (v: unknown): boolean => Object.prototype.toString.call(v) === '[object Generator]',
  isInt8Array: (v: unknown): boolean => v instanceof Int8Array,
  isInt16Array: (v: unknown): boolean => v instanceof Int16Array,
  isInt32Array: (v: unknown): boolean => v instanceof Int32Array,
  isMap: (v: unknown): boolean => v instanceof Map,
  isMapIterator: (v: unknown): boolean => Object.prototype.toString.call(v) === '[object Map Iterator]',
  isModuleNamespaceObject: (v: unknown): boolean => Object.prototype.toString.call(v) === '[object Module]',
  isNativeError: (v: unknown): boolean => v instanceof Error,
  isNumberObject: (v: unknown): boolean => v instanceof Number,
  isPromise: (v: unknown): boolean => v instanceof Promise || Object.prototype.toString.call(v) === '[object Promise]',
  isProxy: () => false,
  isRegExp: (v: unknown): boolean => v instanceof RegExp,
  isSet: (v: unknown): boolean => v instanceof Set,
  isSetIterator: (v: unknown): boolean => Object.prototype.toString.call(v) === '[object Set Iterator]',
  isSharedArrayBuffer: (v: unknown): boolean =>
    typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer,
  isStringObject: (v: unknown): boolean => v instanceof String,
  isSymbolObject: (v: unknown): boolean => Object.prototype.toString.call(v) === '[object Symbol]',
  isTypedArray: (v: unknown): boolean => ArrayBuffer.isView(v) && !(v instanceof DataView),
  isUint8Array: (v: unknown): boolean => v instanceof Uint8Array,
  isUint8ClampedArray: (v: unknown): boolean => v instanceof Uint8ClampedArray,
  isUint16Array: (v: unknown): boolean => v instanceof Uint16Array,
  isUint32Array: (v: unknown): boolean => v instanceof Uint32Array,
  isWeakMap: (v: unknown): boolean => v instanceof WeakMap,
  isWeakSet: (v: unknown): boolean => v instanceof WeakSet,
  isWasmModuleObject: (v: unknown): boolean =>
    typeof WebAssembly !== 'undefined' && v instanceof WebAssembly.Module,
  isWasmMemoryObject: (v: unknown): boolean =>
    typeof WebAssembly !== 'undefined' && v instanceof WebAssembly.Memory,
  isWasmInstanceObject: (v: unknown): boolean =>
    typeof WebAssembly !== 'undefined' && v instanceof WebAssembly.Instance,
});
