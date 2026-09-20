import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';

/**
 * Shims for the `internal/*` modules that our vendored Node source depends on.
 *
 * These are deliberately small: they implement only the surface the vendored
 * files actually import, and every unimplemented path throws loudly instead of
 * silently returning `undefined`.
 */

// ---------------------------------------------------------------------------
// internal/errors
// ---------------------------------------------------------------------------

export const ERROR_CODES: Record<string, string> = {
  ERR_INVALID_ARG_TYPE: 'The "%s" argument must be of type %s. Received %s',
  ERR_STREAM_NULL_VALUES: 'May not write null values to stream',
  ERR_MULTIPLE_CALLBACK: 'Callback called multiple times',
  ERR_STREAM_PREMATURE_CLOSE: 'Premature close',
  ERR_INVALID_ARG_VALUE: 'The argument \'%s\' is invalid. Received %s',
  ERR_INVALID_URI: 'URI malformed',
  ERR_OUT_OF_RANGE: 'The value of "%s" is out of range. It must be %s. Received %s',
  ERR_INVALID_STATE: 'Invalid state: %s',
  ERR_MISSING_ARGS: 'The "%s" argument must be specified',
  ERR_UNKNOWN_FILE_EXTENSION: 'Unknown file extension "%s" for %s',
  ERR_MODULE_NOT_FOUND: 'Cannot find module \'%s\' imported from %s',
  ERR_UNSUPPORTED_ESM_URL_SCHEME: 'Only file and data URLs are supported by the default ESM loader. Received protocol \'%s\'',
  ERR_WEB_NODE_NOT_IMPLEMENTED: '[web-node] %s is not implemented.',
};

/**
 * Node's `ERR_*` classes extend the matching built-in error type, and keep that
 * type's `name`; the code lives on `.code` only
 * (`new Readable({highWaterMark:-1})` is a `TypeError` whose `.code` is
 * `ERR_INVALID_ARG_VALUE`).
 */
const ERROR_BASES: Record<string, ErrorConstructor> = {
  ERR_INVALID_ARG_TYPE: TypeError,
  ERR_INVALID_ARG_VALUE: TypeError,
  ERR_OUT_OF_RANGE: RangeError,
  ERR_INVALID_URI: TypeError,
  ERR_MISSING_ARGS: TypeError,
  ERR_STREAM_NULL_VALUES: TypeError,
  ERR_MULTIPLE_CALLBACK: Error,
  ERR_STREAM_PREMATURE_CLOSE: Error,
  ERR_UNKNOWN_FILE_EXTENSION: TypeError,
  ERR_UNSUPPORTED_ESM_URL_SCHEME: TypeError,
};

class NodeError extends Error {
  code: string;
  constructor(code: string, message: string, ...args: unknown[]) {
    let i = 0;
    super(message.replace(/%[sdj]/g, () => String(args[i++])));
    this.code = code;
  }
}

/** A couple of codes format their message conditionally rather than by template. */
function inspectArg(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'bigint') return `${value}n`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

const CUSTOM_FORMATTERS: Record<string, (args: unknown[]) => string> = {
  // Node: "The property 'options.highWaterMark' is invalid. Received -1" —
  // 'property' whenever the name looks like a dotted path, else 'argument'.
  ERR_INVALID_ARG_VALUE: (args) => {
    const [name, value, reason] = args as [string, unknown, string?];
    const type = String(name).includes('.') ? 'property' : 'argument';
    return `The ${type} '${name}' ${reason ?? 'is invalid'}. Received ${inspectArg(value)}`;
  },
  ERR_INVALID_ARG_TYPE: formatInvalidArgType,
};

function formatError(code: string, args: unknown[]): string {
  const formatter = CUSTOM_FORMATTERS[code];
  if (formatter) return formatter(args);
  const template = ERROR_CODES[code] ?? code;
  let i = 0;
  return template.replace(/%[sdj]/g, () => String(args[i++]));
}

const CLASS_LIKE = /^[A-Z][a-zA-Z0-9]*$/;
// Node reads these expected-type strings as primitives; anything class-shaped
// ("Array", "Iterable") is phrased as "an instance of" instead.
const PRIMITIVE_TYPES = [
  'string',
  'function',
  'number',
  'object',
  'Function',
  'Object',
  'boolean',
  'bigint',
  'symbol',
];

function formatList(list: string[], conjunction: 'and' | 'or' = 'and'): string {
  switch (list.length) {
    case 0:
      return '';
    case 1:
      return `${list[0]}`;
    case 2:
      return `${list[0]} ${conjunction} ${list[1]}`;
    case 3:
      return `${list[0]}, ${list[1]}, ${conjunction} ${list[2]}`;
    default:
      return `${list.slice(0, -1).join(', ')}, ${conjunction} ${list[list.length - 1]}`;
  }
}

/** Describe a received value the way Node's `determineSpecificType` does. */
function determineSpecificType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  switch (typeof value) {
    case 'bigint':
      return `type bigint (${String(value)}n)`;
    case 'number':
      if (value === 0) return Object.is(value, -0) ? 'type number (-0)' : 'type number (0)';
      if (Number.isNaN(value)) return 'type number (NaN)';
      if (value === Infinity) return 'type number (Infinity)';
      if (value === -Infinity) return 'type number (-Infinity)';
      return `type number (${String(value)})`;
    case 'boolean':
      return value ? 'type boolean (true)' : 'type boolean (false)';
    case 'symbol':
      return `type symbol (${String(value)})`;
    case 'function':
      return `function ${(value as { name?: string }).name ?? ''}`;
    case 'string': {
      let s = value as string;
      if (s.length > 28) s = `${s.slice(0, 25)}...`;
      return s.includes("'") ? `type string (${JSON.stringify(s)})` : `type string ('${s}')`;
    }
    default: {
      const ctor = (value as { constructor?: { name?: string } }).constructor;
      const name = ctor && typeof ctor.name === 'string' ? ctor.name : '';
      return name ? `an instance of ${name}` : String(value);
    }
  }
}

/** Node's full `ERR_INVALID_ARG_TYPE` builder (lib/internal/errors.js). */
function formatInvalidArgType(args: unknown[]): string {
  const [name, expectedRaw, actual] = args as [string, string | string[], unknown];
  const expected = Array.isArray(expectedRaw) ? expectedRaw.slice() : [expectedRaw];

  let msg = 'The ';
  if (name.endsWith(' argument')) {
    msg += `${name} `;
  } else {
    const type = name.includes('.') ? 'property' : 'argument';
    msg += `"${name}" ${type} `;
  }
  msg += 'must be ';

  const types: string[] = [];
  const instances: string[] = [];
  const other: string[] = [];
  for (const value of expected) {
    if (value !== null && typeof value === 'object') {
      other.push((value as { name?: string }).name ?? String(value));
    } else if (PRIMITIVE_TYPES.includes(value)) {
      types.push(value.toLowerCase());
    } else if (CLASS_LIKE.test(value)) {
      instances.push(value);
    } else {
      other.push(value);
    }
  }

  if (instances.length > 0) {
    const pos = types.indexOf('object');
    if (pos !== -1) {
      types.splice(pos, 1);
      instances.push('Object');
    }
  }

  if (types.length > 0) {
    msg += `${types.length > 1 ? 'one of type' : 'of type'} ${formatList(types, 'or')}`;
    if (instances.length > 0 || other.length > 0) msg += ' or ';
  }
  if (instances.length > 0) {
    msg += `an instance of ${formatList(instances, 'or')}`;
    if (other.length > 0) msg += ' or ';
  }
  if (other.length > 0) {
    if (other.length > 1) {
      msg += `one of ${formatList(other, 'or')}`;
    } else {
      if (other[0].toLowerCase() !== other[0]) msg += 'an ';
      msg += `${other[0]}`;
    }
  }

  return `${msg}. Received ${determineSpecificType(actual)}`;
}

function makeErrorClass(code: string): new (...args: unknown[]) => Error {
  const Base = (ERROR_BASES[code] ?? Error) as ErrorConstructor;
  class NodeErr extends Base {
    code = code;
    constructor(...args: unknown[]) {
      super(formatError(code, args));
    }
  }
  // Node keeps the built-in type's name on both the class and its instances.
  Object.defineProperty(NodeErr, 'name', { value: Base.name });
  return NodeErr as unknown as new (...args: unknown[]) => Error;
}

function createErrorsBindingContext(): Record<string, unknown> {
  const codes: Record<string, unknown> = {};
  for (const code of Object.keys(ERROR_CODES)) {
    codes[code] = makeErrorClass(code);
  }
  return {
    codes,
    NodeError,
    // Node's AbortError keeps the DOMException-style name and message.
    AbortError: class AbortError extends Error {
      code = 'ABORT_ERR';
      name = 'AbortError';
      constructor(message: string = 'The operation was aborted') {
        super(message);
      }
    },
    hideStackFrames: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
    aggregateTwoErrors: (innerError: unknown, outerError: unknown) => outerError ?? innerError,
    isErrorStackTraceLimitWritable: () => false,
    uvException: (e: { errno?: number; code?: string; syscall?: string; path?: string; message?: string }) =>
      new NodeError(e.code ?? 'EIO', e.message ?? 'Unknown error'),
    errnoException: (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    exceptionWithHostPort: (err: unknown) => err,
    connResetException: (msg: string) => new NodeError('ECONNRESET', msg),
    setErrorSource: () => undefined,
  };
}

export const internalErrorsSpec: BuiltinSpec = {
  id: 'internal/errors',
  origin: 'web-node',
  init: () => createErrorsBindingContext(),
};

// ---------------------------------------------------------------------------
// internal/validators
// ---------------------------------------------------------------------------

export const internalValidatorsSpec: BuiltinSpec = {
  id: 'internal/validators',
  origin: 'web-node',
  init: (ctx: BuiltinInitContext) => {
    const codes = (ctx.require('internal/errors') as { codes: Record<string, new (...a: unknown[]) => Error> }).codes;

    function assert(cond: unknown, code: string, ...args: unknown[]): void {
      if (!cond) {
        const Ctor = codes[code];
        throw Ctor ? new Ctor(...args) : new Error(String(code));
      }
    }

    return {
      validateAbortSignal: () => undefined,
      validateAbortSignalArray: () => undefined,
      validateArray: (v: unknown, name: string) =>
        assert(Array.isArray(v), 'ERR_INVALID_ARG_TYPE', name, 'Array', v),
      validateBoolean: (v: unknown, name: string) =>
        assert(typeof v === 'boolean', 'ERR_INVALID_ARG_TYPE', name, 'boolean', v),
      validateBooleanArray: () => undefined,
      validateBuffer: () => undefined,
      validateDictionary: () => undefined,
      validateEncoding: () => undefined,
      validateFiniteNumber: (v: unknown, name: string) =>
        assert(typeof v === 'number' && Number.isFinite(v), 'ERR_INVALID_ARG_TYPE', name, 'number', v),
      validateFunction: (v: unknown, name: string) =>
        assert(typeof v === 'function', 'ERR_INVALID_ARG_TYPE', name, 'Function', v),
      validateInteger: (v: unknown, name: string) =>
        assert(Number.isInteger(v), 'ERR_INVALID_ARG_TYPE', name, 'integer', v),
      validateNumber: (v: unknown, name: string) =>
        assert(typeof v === 'number', 'ERR_INVALID_ARG_TYPE', name, 'number', v),
      validateObject: (v: unknown, name: string, opts?: { allowArray?: boolean; allowFunction?: boolean }) => {
        const ok =
          v !== null &&
          typeof v === 'object' &&
          (opts?.allowArray === true || !Array.isArray(v)) &&
          (opts?.allowFunction === true || typeof v !== 'function');
        assert(ok, 'ERR_INVALID_ARG_TYPE', name, 'Object', v);
      },
      validateOneOf: () => undefined,
      validatePlainFunction: () => undefined,
      validatePort: (v: unknown, name: string) =>
        assert(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 65535, 'ERR_OUT_OF_RANGE', name, '>= 0 && <= 65535', String(v)),
      validateSignalName: () => undefined,
      validateString: (v: unknown, name: string) =>
        assert(typeof v === 'string', 'ERR_INVALID_ARG_TYPE', name, 'string', v),
      validateStringArray: () => undefined,
      validateStringWithoutNullBytes: () => undefined,
      validateThisInternalField: () => undefined,
      validateUndefined: () => undefined,
      validateUnion: () => undefined,
      validateLinkHeaderValue: () => undefined,
      validateIgnoreOption: () => undefined,
      validateAbortSignalOnly: () => undefined,
    };
  },
  deps: ['internal/errors'],
};

// ---------------------------------------------------------------------------
// internal/util
// ---------------------------------------------------------------------------

export const internalUtilSpec: BuiltinSpec = {
  id: 'internal/util',
  origin: 'web-node',
  init: () => {
    function getLazy(initializer: () => unknown): () => unknown {
      let value: unknown;
      let initialized = false;
      return function lazyValue() {
        if (!initialized) {
          value = initializer();
          initialized = true;
        }
        return value;
      };
    }

    function once<T extends (...args: never[]) => unknown>(callback: T): T {
      let called = false;
      let value: unknown;
      return function onceWrapper(this: unknown, ...args: never[]) {
        if (!called) {
          called = true;
          value = callback.apply(this, args);
        }
        return value;
      } as unknown as T;
    }

    function deprecate<T extends (...args: never[]) => unknown>(fn: T, _msg: string, _code?: string): T {
      return fn;
    }

    return {
      kEmptyObject: Object.freeze({}),
      isWindows: false,
      isMacOS: false,
      isLinux: true,
      getLazy,
      once,
      deprecate,
      deprecateProperty: () => undefined,
      normalizeEncoding: (enc?: string): string | undefined => (enc ? String(enc).toLowerCase() : enc),
      isArrayBufferView: (v: unknown): boolean => ArrayBuffer.isView(v),
      isInsideNodeModules: () => false,
      getCallerLocation: () => undefined,
      getSystemErrorName: (code: number) => String(code),
      isErrorLike: (v: unknown) => v instanceof Error,
      getStringWidth: (s: string) => s.length,
      defineLazyProperties: () => undefined,
      SideEffectFreeRegExpPrototypeSymbolReplace: (r: RegExp, s: string, v: string) => s.replace(r, v),
      Buffer: undefined,
      customInspectSymbol: Symbol.for('nodejs.util.inspect.custom'),
      promisify: undefined,
      isPromise: (v: unknown) => v instanceof Promise,
      isRegExp: (v: unknown) => v instanceof RegExp,
      toUSVString: (s: string) => s,
    };
  },
};

// ---------------------------------------------------------------------------
// internal/fs/glob  (only `matchGlobPattern` is referenced, lazily)
// ---------------------------------------------------------------------------

export const internalFsGlobSpec: BuiltinSpec = {
  id: 'internal/fs/glob',
  origin: 'web-node',
  init: () => ({
    matchGlobPattern: (): never => {
      throw notImplemented('api', 'path.matchesGlob', 'Glob matching is outside the MVP whitelist.');
    },
    globSync: (): never => {
      throw notImplemented('api', 'fs.globSync', 'Glob matching is outside the MVP whitelist.');
    },
  }),
};

// ---------------------------------------------------------------------------
// internal/async_hooks
// ---------------------------------------------------------------------------
//
// The runtime has no async-context tracking, so `enabledHooksExist()` is always
// false and `AsyncResource` degrades to running its callback synchronously. That
// is exactly the branch vendored code takes when hooks are off, so callers that
// guard on `enabledHooksExist()` stay correct.

export const internalAsyncHooksSpec: BuiltinSpec = {
  id: 'internal/async_hooks',
  origin: 'web-node',
  init: () => {
    class AsyncResource {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
      runInAsyncScope<T>(fn: (...args: unknown[]) => T, thisArg?: unknown, ...args: unknown[]): T {
        return fn.apply(thisArg, args);
      }
      emitDestroy(): this {
        return this;
      }
      asyncId(): number {
        return 0;
      }
      triggerAsyncId(): number {
        return 0;
      }
    }
    return {
      AsyncResource,
      enabledHooksExist: () => false,
      hasAsyncHooks: () => false,
      getHookArrays: () => [[], [], [], [], [], []],
      asyncWrapProviders: new Map<string, number>(),
    };
  },
};

// ---------------------------------------------------------------------------
// internal/async_context_frame
// ---------------------------------------------------------------------------
//
// There is no continuation-preserved embedder data here, so `current()` is
// always undefined and the getter/setter are inert. Vendored code guards on
// `AsyncContextFrame.current() || enabledHooksExist()`, which is false, so this
// only has to answer the probe honestly.

export const internalAsyncContextFrameSpec: BuiltinSpec = {
  id: 'internal/async_context_frame',
  origin: 'web-node',
  init: () => ({
    current: (): undefined => undefined,
    has: (): boolean => false,
    get: (): undefined => undefined,
    set: (): undefined => undefined,
    setContinuationPreservedEmbedderData: (): undefined => undefined,
  }),
};

// ---------------------------------------------------------------------------
// internal/events/abort_listener
// ---------------------------------------------------------------------------
//
// Same contract as Node's (lib/internal/events/abort_listener.js), written
// against the host's native AbortSignal. `kResistStopPropagation` is a Node
// DOM-shim detail and is not needed for a real browser AbortSignal.

export const internalAbortListenerSpec: BuiltinSpec = {
  id: 'internal/events/abort_listener',
  origin: 'web-node',
  deps: ['internal/errors', 'internal/validators'],
  init: (ctx: BuiltinInitContext) => {
    const errors = ctx.require('internal/errors') as {
      codes: Record<string, new (...args: unknown[]) => Error>;
    };
    const validators = ctx.require('internal/validators') as {
      validateAbortSignal: (s: unknown, name: string) => void;
      validateFunction: (f: unknown, name: string) => void;
    };

    // `Symbol.dispose` is a well-known symbol the TS lib here does not declare yet.
    const kDispose = (Symbol as unknown as { dispose: symbol }).dispose;

    function addAbortListener(signal: AbortSignal, listener: () => void): { [k: symbol]: () => void } {
      if (signal === undefined) {
        throw new errors.codes.ERR_INVALID_ARG_TYPE('signal', 'AbortSignal', signal);
      }
      validators.validateAbortSignal(signal, 'signal');
      validators.validateFunction(listener, 'listener');

      let removeEventListener: (() => void) | undefined;
      if (signal.aborted) {
        queueMicrotask(() => listener());
      } else {
        signal.addEventListener('abort', listener, { once: true });
        removeEventListener = () => signal.removeEventListener('abort', listener);
      }
      return {
        [kDispose]() {
          removeEventListener?.();
        },
      };
    }

    return { addAbortListener };
  },
};
