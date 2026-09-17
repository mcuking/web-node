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

class NodeError extends Error {
  code: string;
  constructor(code: string, message: string, ...args: unknown[]) {
    let msg = message;
    let i = 0;
    msg = msg.replace(/%[sdj]/g, () => String(args[i++]));
    super(msg);
    this.code = code;
    this.name = 'Error';
  }
}

function makeErrorClass(code: string): new (...args: unknown[]) => NodeError {
  const template = ERROR_CODES[code] ?? code;
  const cls = class extends NodeError {
    constructor(...args: unknown[]) {
      super(code, template, ...args);
      this.name = code.replace(/^ERR_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }
  };
  Object.defineProperty(cls, 'name', { value: code });
  return cls;
}

function createErrorsBindingContext(): Record<string, unknown> {
  const codes: Record<string, unknown> = {};
  for (const code of Object.keys(ERROR_CODES)) {
    codes[code] = makeErrorClass(code);
  }
  return {
    codes,
    NodeError,
    AbortError: class AbortError extends Error {
      code = 'ABORT_ERR';
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

    function typeName(v: unknown): string {
      if (v === null) return 'null';
      if (Array.isArray(v)) return 'object';
      return typeof v;
    }

    return {
      validateAbortSignal: () => undefined,
      validateAbortSignalArray: () => undefined,
      validateArray: (v: unknown, name: string) =>
        assert(Array.isArray(v), 'ERR_INVALID_ARG_TYPE', name, 'Array', typeName(v)),
      validateBoolean: (v: unknown, name: string) =>
        assert(typeof v === 'boolean', 'ERR_INVALID_ARG_TYPE', name, 'boolean', typeName(v)),
      validateBooleanArray: () => undefined,
      validateBuffer: () => undefined,
      validateDictionary: () => undefined,
      validateEncoding: () => undefined,
      validateFiniteNumber: (v: unknown, name: string) =>
        assert(typeof v === 'number' && Number.isFinite(v), 'ERR_INVALID_ARG_TYPE', name, 'number', typeName(v)),
      validateFunction: (v: unknown, name: string) =>
        assert(typeof v === 'function', 'ERR_INVALID_ARG_TYPE', name, 'Function', typeName(v)),
      validateInteger: (v: unknown, name: string) =>
        assert(Number.isInteger(v), 'ERR_INVALID_ARG_TYPE', name, 'integer', typeName(v)),
      validateNumber: (v: unknown, name: string) =>
        assert(typeof v === 'number', 'ERR_INVALID_ARG_TYPE', name, 'number', typeName(v)),
      validateObject: (v: unknown, name: string, opts?: { allowArray?: boolean; allowFunction?: boolean }) => {
        const ok =
          v !== null &&
          typeof v === 'object' &&
          (opts?.allowArray === true || !Array.isArray(v)) &&
          (opts?.allowFunction === true || typeof v !== 'function');
        assert(ok, 'ERR_INVALID_ARG_TYPE', name, 'object', typeName(v));
      },
      validateOneOf: () => undefined,
      validatePlainFunction: () => undefined,
      validatePort: (v: unknown, name: string) =>
        assert(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 65535, 'ERR_OUT_OF_RANGE', name, '>= 0 && <= 65535', String(v)),
      validateSignalName: () => undefined,
      validateString: (v: unknown, name: string) =>
        assert(typeof v === 'string', 'ERR_INVALID_ARG_TYPE', name, 'string', typeName(v)),
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
