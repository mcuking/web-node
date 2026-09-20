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
  ERR_ASYNC_CALLBACK: '%s must be a function',
  ERR_ASYNC_TYPE: 'Invalid name for async "type": %s',
  ERR_INVALID_ASYNC_ID: 'Invalid %s value: %s',
  ERR_STREAM_NULL_VALUES: 'May not write null values to stream',
  ERR_MULTIPLE_CALLBACK: 'Callback called multiple times',
  ERR_STREAM_PREMATURE_CLOSE: 'Premature close',
  ERR_METHOD_NOT_IMPLEMENTED: 'The %s method is not implemented',
  ERR_STREAM_ITER_MISSING_FLAG: 'The stream/iter API requires the --experimental-stream-iter flag',
  ERR_STREAM_PUSH_AFTER_EOF: 'stream.push() after EOF',
  ERR_STREAM_UNSHIFT_AFTER_END_EVENT: 'stream.unshift() after end event',
  ERR_UNHANDLED_ERROR: 'Unhandled error. (%s)',
  ERR_UNKNOWN_ENCODING: 'Unknown encoding: %s',
  ERR_INVALID_ARG_VALUE: 'The argument \'%s\' is invalid. Received %s',
  ERR_INVALID_URI: 'URI malformed',
  ERR_OUT_OF_RANGE: 'The value of "%s" is out of range. It must be %s. Received %s',
  ERR_INVALID_STATE: 'Invalid state: %s',
  ERR_MISSING_ARGS: 'The "%s" argument must be specified',
  ERR_UNKNOWN_FILE_EXTENSION: 'Unknown file extension "%s" for %s',
  ERR_MODULE_NOT_FOUND: 'Cannot find module \'%s\' imported from %s',
  ERR_UNSUPPORTED_ESM_URL_SCHEME: 'Only file and data URLs are supported by the default ESM loader. Received protocol \'%s\'',
  ERR_ILLEGAL_CONSTRUCTOR: 'Illegal constructor',
  ERR_STREAM_ALREADY_FINISHED: 'Cannot call %s after a stream was finished',
  ERR_STREAM_CANNOT_PIPE: 'Cannot pipe, not readable',
  ERR_STREAM_DESTROYED: 'Cannot call %s after a stream was destroyed',
  ERR_STREAM_UNABLE_TO_PIPE: 'Cannot pipe to a closed or destroyed stream',
  ERR_STREAM_WRITE_AFTER_END: 'write after end',
  ERR_INTERNAL_ASSERTION: '%s',
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
  ERR_ASYNC_CALLBACK: TypeError,
  ERR_ASYNC_TYPE: TypeError,
  ERR_INVALID_ASYNC_ID: RangeError,
  ERR_INVALID_ARG_VALUE: TypeError,
  ERR_OUT_OF_RANGE: RangeError,
  ERR_INVALID_URI: TypeError,
  ERR_MISSING_ARGS: TypeError,
  ERR_STREAM_NULL_VALUES: TypeError,
  ERR_MULTIPLE_CALLBACK: Error,
  ERR_STREAM_PREMATURE_CLOSE: Error,
  ERR_METHOD_NOT_IMPLEMENTED: Error,
  ERR_STREAM_ITER_MISSING_FLAG: TypeError,
  ERR_STREAM_PUSH_AFTER_EOF: Error,
  ERR_STREAM_UNSHIFT_AFTER_END_EVENT: Error,
  ERR_UNHANDLED_ERROR: Error,
  ERR_UNKNOWN_ENCODING: TypeError,
  ERR_UNKNOWN_FILE_EXTENSION: TypeError,
  ERR_UNSUPPORTED_ESM_URL_SCHEME: TypeError,
  ERR_ILLEGAL_CONSTRUCTOR: TypeError,
  ERR_STREAM_ALREADY_FINISHED: Error,
  ERR_STREAM_CANNOT_PIPE: Error,
  ERR_STREAM_DESTROYED: Error,
  ERR_STREAM_UNABLE_TO_PIPE: Error,
  ERR_STREAM_WRITE_AFTER_END: Error,
  ERR_INTERNAL_ASSERTION: Error,
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
  ERR_INVALID_RETURN_VALUE: (args) => {
    const [input, name, value] = args as [string, string, unknown];
    return `Expected ${input} to be returned from the "${name}" function but got ${determineSpecificType(value)}.`;
  },
  // Node's builder drops the parenthesised detail when nothing was passed.
  ERR_UNHANDLED_ERROR: (args) =>
    args.length === 0 || args[0] === undefined ? 'Unhandled error.' : `Unhandled error. (${String(args[0])})`,
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
    // events.js builds its "leak detected" warning through these two.
    genericNodeError: (message: string, errorProperties?: Record<string, unknown>): Error =>
      Object.assign(new Error(message), errorProperties),
    kEnhanceStackBeforeInspector: Symbol('kEnhanceStackBeforeInspector'),
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
  init: (ctx) => {
    // `encodingsMap` / `normalizeEncoding` are Node's own (lib/internal/util.js):
    // `StringDecoder` canonicalizes the encoding name and then stores the
    // numeric code pulled from the binding. Kept faithful so the vendored
    // `string_decoder.js` behaves exactly like the real one.
    const { encodings } = ctx.internalBinding('string_decoder') as { encodings: string[] };
    const encodingsMap: Record<string, number> = { __proto__: null } as unknown as Record<string, number>;
    for (let i = 0; i < encodings.length; ++i) encodingsMap[encodings[i]] = i;

    function normalizeEncoding(enc?: string): string | undefined {
      if (enc == null || enc === 'utf8' || enc === 'utf-8') return 'utf8';
      switch (enc.length) {
        case 4:
          if (enc === 'UTF8') return 'utf8';
          if (enc === 'ucs2' || enc === 'UCS2') return 'utf16le';
          enc = enc.toLowerCase();
          if (enc === 'utf8') return 'utf8';
          if (enc === 'ucs2') return 'utf16le';
          break;
        case 3:
          if (enc === 'hex' || enc === 'HEX' || enc.toLowerCase() === 'hex') return 'hex';
          break;
        case 5:
          if (enc === 'ascii') return 'ascii';
          if (enc === 'ucs-2') return 'utf16le';
          if (enc === 'UTF-8') return 'utf8';
          if (enc === 'ASCII') return 'ascii';
          if (enc === 'UCS-2') return 'utf16le';
          enc = enc.toLowerCase();
          if (enc === 'utf-8') return 'utf8';
          if (enc === 'ascii') return 'ascii';
          if (enc === 'ucs-2') return 'utf16le';
          break;
        case 6:
          if (enc === 'base64') return 'base64';
          if (enc === 'latin1' || enc === 'binary') return 'latin1';
          if (enc === 'BASE64') return 'base64';
          if (enc === 'LATIN1' || enc === 'BINARY') return 'latin1';
          enc = enc.toLowerCase();
          if (enc === 'base64') return 'base64';
          if (enc === 'latin1' || enc === 'binary') return 'latin1';
          break;
        case 7:
          if (enc === 'utf16le' || enc === 'UTF16LE' || enc.toLowerCase() === 'utf16le') return 'utf16le';
          break;
        case 8:
          if (enc === 'utf-16le' || enc === 'UTF-16LE' || enc.toLowerCase() === 'utf-16le') return 'utf16le';
          break;
        case 9:
          if (enc === 'base64url' || enc === 'BASE64URL' || enc.toLowerCase() === 'base64url') return 'base64url';
          break;
        default:
          if (enc === '') return 'utf8';
      }
      return undefined;
    }

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
      // Node's in-place removal used by EventEmitter's listener lists.
      spliceOne: (list: unknown[], index: number): void => {
        for (let i = index; i + 1 < list.length; i++) list[i] = list[i + 1];
        list.pop();
      },
      // Node renames functions for error/stack readability (internal/util.js).
      assignFunctionName: <T>(name: string | symbol, fn: T, descriptor?: object): T => {
        const label =
          typeof name === 'string' ? name : `[${String((name as symbol).description)}]`;
        Object.defineProperty(fn as object, 'name', {
          writable: false,
          enumerable: false,
          configurable: true,
          ...descriptor,
          value: label,
        });
        return fn;
      },
      isWindows: false,
      isMacOS: false,
      isLinux: true,
      getLazy,
      once,
      deprecate,
      deprecateProperty: () => undefined,
      // `domain` keeps a ref-counted weak handle to each Domain; it only needs
      // get/incRef/decRef, so a plain WeakRef wrapper matches Node's shape.
      WeakReference: class WeakReference<T extends object> {
        #weak: WeakRef<T>;
        #strong: T | null = null;
        #refCount = 0;
        constructor(object: T) {
          this.#weak = new WeakRef(object);
        }
        incRef(): number {
          this.#refCount++;
          if (this.#refCount === 1) {
            const derefed = this.#weak.deref();
            if (derefed !== undefined) this.#strong = derefed;
          }
          return this.#refCount;
        }
        decRef(): number {
          this.#refCount--;
          if (this.#refCount === 0) this.#strong = null;
          return this.#refCount;
        }
        get(): T | undefined {
          return this.#weak.deref();
        }
        destroy(): void {
          this.#strong = null;
          this.#refCount = 0;
        }
      },
      normalizeEncoding,
      encodingsMap,
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
      // `lib/stream.js` tags `pipeline`/`finished` with `promisify.custom`
      // so `util.promisify(pipeline)` yields the promises form. Only the
      // marker is consulted here, so the callable itself stays a stub.
      promisify: Object.assign((fn: unknown) => fn, {
        custom: Symbol.for('nodejs.util.promisify.custom'),
      }),
      isPromise: (v: unknown) => v instanceof Promise,
      isRegExp: (v: unknown) => v instanceof RegExp,
      toUSVString: (s: string) => s,
    };
  },
};

// ---------------------------------------------------------------------------
// internal/options
// ---------------------------------------------------------------------------
//
// The runtime is not driven by CLI flags, so every option reads as its default
// (a boolean flag is off). Only the flags vendored source actually probes need
// to answer; anything else is an unknown option and throws, like Node would.

const OPTION_DEFAULTS: Record<string, unknown> = {
  '--experimental-stream-iter': false,
  '--experimental-stream-iter-compat': false,
  // The browser tab cannot switch to `AsyncContextFrame`; the default
  // (async_hooks-based) AsyncLocalStorage is the one we ship.
  '--async-context-frame': false,
  '--no-deprecation': false,
  '--trace-deprecation': false,
  '--throw-deprecation': false,
  '--pending-deprecation': false,
};

export const internalOptionsSpec: BuiltinSpec = {
  id: 'internal/options',
  origin: 'web-node',
  init: () => ({
    getOptionValue: (name: string): unknown => {
      if (name in OPTION_DEFAULTS) return OPTION_DEFAULTS[name];
      throw notImplemented('api', `getOptionValue('${name}')`, 'The runtime is not configurable by CLI flags.');
    },
    getOptions: () => OPTION_DEFAULTS,
  }),
};

// ---------------------------------------------------------------------------
// internal/util/debuglog
// ---------------------------------------------------------------------------
//
// `NODE_DEBUG=stream` based logging has no equivalent here, so `debuglog()`
// returns the same inert function Node does when the section is not enabled
// (callers invoke it as `debug(...)` and move on).

export const internalDebuglogSpec: BuiltinSpec = {
  id: 'internal/util/debuglog',
  origin: 'web-node',
  init: () => {
    const noop = (): void => undefined;
    return {
      // Node never invokes the callback while the section is disabled; it only
      // hands over the live logger once logging is first switched on.
      debuglog: (_section: string, _cb?: (fn: () => void) => void): ((...a: unknown[]) => void) => {
        const logger = (..._args: unknown[]): void => undefined;
        Object.defineProperty(logger, 'enabled', { value: false, configurable: true, enumerable: true });
        return logger;
      },
      format: (): string => '',
    };
  },
};

// ---------------------------------------------------------------------------
// Unimplemented Node internals reached only by lazy feature paths
// ---------------------------------------------------------------------------
//
// `compose`, the Web Streams adapters and the experimental stream/iter bridge are
// all loaded on demand. They stay explicit throws so a caller that reaches them
// sees why, instead of a silent `undefined`.

// ---------------------------------------------------------------------------
// internal/abort_controller
// ---------------------------------------------------------------------------
//
// Node's real internal/abort_controller.js is built on its own EventTarget,
// webidl converters and js_transferable plumbing — none of which exist here.
// The host realm already provides spec-compliant AbortController/AbortSignal, so
// we re-export those under Node's module id.

export const internalAbortControllerSpec: BuiltinSpec = {
  id: 'internal/abort_controller',
  origin: 'web-node',
  deps: ['internal/errors', 'internal/validators'],
  init: (ctx: BuiltinInitContext) => {
    const errors = ctx.require('internal/errors') as {
      codes: Record<string, new (...args: unknown[]) => Error>;
    };
    const AbortSignalCtor = AbortSignal;
    return {
      AbortController,
      AbortSignal,
      // Node's `aborted(signal, resource)` resolves once the signal aborts.
      aborted: async (signal: AbortSignal, resource: unknown): Promise<void> => {
        if (signal === undefined || !('aborted' in Object(signal))) {
          throw new errors.codes.ERR_INVALID_ARG_TYPE('signal', 'AbortSignal', signal);
        }
        if (resource === undefined) {
          throw new errors.codes.ERR_INVALID_ARG_TYPE('resource', 'Object', resource);
        }
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      transferableAbortSignal: (signal: AbortSignal) => signal,
      transferableAbortController: () => new AbortController(),
      _AbortSignalCtor: AbortSignalCtor,
    };
  },
};

// ---------------------------------------------------------------------------
// internal/buffer
// ---------------------------------------------------------------------------
//
// Node's FastBuffer is a bare Uint8Array subclass constructed from
// `(arrayBuffer, byteOffset, length)`. That is the only shape vendored source
// (`lib/stream.js` `_uint8ArrayToBuffer`) asks for.

export const internalBufferSpec: BuiltinSpec = {
  id: 'internal/buffer',
  origin: 'web-node',
  deps: ['buffer'],
  init: (ctx: BuiltinInitContext) => {
    // Node's `Buffer` extends `FastBuffer`, so a chunk funneled through
    // `_uint8ArrayToBuffer` still answers `Buffer.isBuffer() === true`. Reuse
    // the runtime's own Buffer class to keep that invariant (and its methods).
    const { Buffer } = ctx.require('buffer') as { Buffer: new (...args: never[]) => Uint8Array };
    return { FastBuffer: Buffer };
  },
};

// ---------------------------------------------------------------------------
// internal/util/types
// ---------------------------------------------------------------------------
//
// The typed-array predicates Node builds over V8 intrinsics, expressed against
// the host's ArrayBuffer.isView + Object.prototype.toString classification.

export const internalUtilTypesSpec: BuiltinSpec = {
  id: 'internal/util/types',
  origin: 'web-node',
  init: () => {
    const tag = (v: unknown): string | undefined =>
      ArrayBuffer.isView(v) ? Object.prototype.toString.call(v).slice(8, -1) : undefined;
    const is = (name: string) => (v: unknown): boolean => tag(v) === name;
    return {
      isArrayBufferView: (v: unknown): boolean => ArrayBuffer.isView(v),
      isTypedArray: (v: unknown): boolean => tag(v) !== undefined && tag(v) !== 'DataView',
      isDataView: is('DataView'),
      isUint8Array: is('Uint8Array'),
      isUint8ClampedArray: is('Uint8ClampedArray'),
      isUint16Array: is('Uint16Array'),
      isUint32Array: is('Uint32Array'),
      isInt8Array: is('Int8Array'),
      isInt16Array: is('Int16Array'),
      isInt32Array: is('Int32Array'),
      isFloat16Array: is('Float16Array'),
      isFloat32Array: is('Float32Array'),
      isFloat64Array: is('Float64Array'),
      isBigInt64Array: is('BigInt64Array'),
      isBigUint64Array: is('BigUint64Array'),
      // `diagnostics_channel` reads this to decide whether a subscription's
      // result should be awaited; Node keeps it here too.
      isPromise: (v: unknown): boolean => v instanceof Promise,
    };
  },
};

// ---------------------------------------------------------------------------
// internal/assert
// ---------------------------------------------------------------------------

export const internalAssertSpec: BuiltinSpec = {
  id: 'internal/assert',
  origin: 'web-node',
  deps: ['internal/errors'],
  init: (ctx: BuiltinInitContext) => {
    const codes = (ctx.require('internal/errors') as {
      codes: Record<string, new (...args: unknown[]) => Error>;
    }).codes;
    const fail = (message?: string): never => {
      throw new codes.ERR_INTERNAL_ASSERTION(message);
    };
    const assert = (value: unknown, message?: string): void => {
      if (!value) fail(message);
    };
    return Object.assign(assert, { fail }) as unknown as Record<string, unknown>;
  },
};

// ---------------------------------------------------------------------------
// internal/blob
// ---------------------------------------------------------------------------
//
// Only `isBlob` is read by the lazily-loaded duplexify path; the host realm's
// Blob is the real thing.

export const internalBlobSpec: BuiltinSpec = {
  id: 'internal/blob',
  origin: 'web-node',
  init: () => ({
    isBlob: (value: unknown): boolean =>
      typeof Blob !== 'undefined' && value instanceof Blob,
  }),
};

export const internalWebStreamsAdaptersSpec: BuiltinSpec = {
  id: 'internal/webstreams/adapters',
  origin: 'web-node',
  init: () =>
    new Proxy(
      {},
      {
        get: (): never => {
          throw notImplemented('api', 'Readable.fromWeb / toWeb', 'Web Stream adapters are outside the MVP whitelist.');
        },
      },
    ),
};

export const internalStreamIterSpec: BuiltinSpec = {
  id: 'internal/streams/iter/classic',
  origin: 'web-node',
  init: () =>
    new Proxy(
      {},
      {
        get: (): never => {
          throw notImplemented('api', 'stream/iter', 'The --experimental-stream-iter API is not implemented.');
        },
      },
    ),
};

export const internalStreamIterTypesSpec: BuiltinSpec = {
  id: 'internal/streams/iter/types',
  origin: 'web-node',
  init: () =>
    new Proxy(
      {},
      {
        get: (): never => {
          throw notImplemented('api', 'stream/iter', 'The --experimental-stream-iter API is not implemented.');
        },
      },
    ),
};

// ---------------------------------------------------------------------------
// internal/util/inspect
// ---------------------------------------------------------------------------
//
// Node's inspect lives in its own 2000-line module. The vendored files that want
// it (events.js, and the stream sources next) only format short values for error
// messages, so this reuses the runtime's public `util.inspect`.

export const internalUtilInspectSpec: BuiltinSpec = {
  id: 'internal/util/inspect',
  origin: 'web-node',
  deps: ['util'],
  init: (ctx: BuiltinInitContext) => {
    const util = ctx.require('util') as { inspect: (v: unknown, o?: unknown) => string };
    return {
      inspect: (value: unknown, opts?: unknown): string => util.inspect(value, opts),
      // Used to elide a run of repeated stack frames; `null` just means "no run".
      identicalSequenceRange: (): null => null,
      formatWithOptions: (_o: unknown, f: string, ...a: unknown[]): string =>
        [f, ...a].map((x) => (typeof x === 'string' ? x : util.inspect(x))).join(' '),
    };
  },
};

// ---------------------------------------------------------------------------
// internal/event_target
// ---------------------------------------------------------------------------
//
// There is no Web `EventTarget` in this realm yet; callers gate on
// `isEventTarget()` anyway, so answering `false` keeps their non-EventTarget
// path (the common one) intact.

export const internalEventTargetSpec: BuiltinSpec = {
  id: 'internal/event_target',
  origin: 'web-node',
  init: () => ({
    isEventTarget: (): boolean => false,
    kEvents: Symbol('kEvents'),
    kResistStopPropagation: Symbol('kResistStopPropagation'),
    // Used by the stream operators to hold a weak reference to the resource
    // that should keep an abort listener alive. We keep it as a plain marker.
    kWeakHandler: Symbol('kWeakHandler'),
  }),
};

export const internalEventsSymbolsSpec: BuiltinSpec = {
  id: 'internal/events/symbols',
  origin: 'web-node',
  init: () => ({
    kFirstEventParam: Symbol('kFirstEventParam'),
  }),
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
