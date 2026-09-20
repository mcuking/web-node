import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';
import { getCompiledSource } from '../source-registry';

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
  ERR_AMBIGUOUS_ARGUMENT: 'The "%s" argument is ambiguous. %s',
  ERR_ASSERTION: '%s',
  ERR_CONSTRUCT_CALL_REQUIRED: 'Class constructor %s cannot be invoked without `new`',
  ERR_INVALID_THIS: 'Value of "this" must be of type %s',
  ERR_UNKNOWN_SIGNAL: 'Unknown signal: %s',
  ERR_SOCKET_BAD_PORT: 'Port should be %s. Received %s',
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
  ERR_AMBIGUOUS_ARGUMENT: TypeError,
  ERR_ASSERTION: Error,
  ERR_CONSTRUCT_CALL_REQUIRED: TypeError,
  ERR_INVALID_THIS: TypeError,
  ERR_INVALID_RETURN_VALUE: TypeError,
  ERR_UNKNOWN_SIGNAL: TypeError,
  ERR_SOCKET_BAD_PORT: RangeError,
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
  // `validatePort(name, port, allowZero = true)` picks the expected range by
  // whether zero is allowed (lib/internal/errors.js).
  ERR_SOCKET_BAD_PORT: (args) => {
    const [name, port, allowZero = true] = args as [string, unknown, boolean?];
    const range = allowZero ? '>= 0 && <= 65535' : '> 0 && <= 65535';
    return `Port should be ${range}. Received ${inspectArg(port)}`;
  },
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
  // Node exposes a `HideStackFramesError` companion on each code (used by
  // `internal/validators` so validation frames vanish from the stack). Our
  // runtime cannot rewrite captured stacks, so it aliases the same class.
  Object.defineProperty(NodeErr, 'HideStackFramesError', { value: NodeErr, configurable: true });
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
    // Node probes a real stack overflow once to learn this realm's error
    // name/message, then matches future errors against those. Kept faithful
    // (and cached), since `util.inspect` uses it to decide whether to print
    // or rethrow an error's stack.
    isStackOverflowError: (() => {
      let name: string | undefined;
      let message: string | undefined;
      return (err: unknown): boolean => {
        if (message === undefined) {
          try {
            const overflowStack = (): void => overflowStack();
            overflowStack();
          } catch (e) {
            name = (e as Error).name;
            message = (e as Error).message;
          }
        }
        return (
          err !== null &&
          typeof err === 'object' &&
          (err as Error).name === name &&
          (err as Error).message === message
        );
      };
    })(),
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
// internal/errors/error_source
// ---------------------------------------------------------------------------
//
// Node reconstructs the offending source line + expression from the *structured*
// error stack (a V8-internal `getErrorSourcePositions` binding, plus a source
// map lookup and a lazy acorn tokenizer). Userland cannot read those positions,
// so we approximate: read the CallSite of the frame the error was captured at
// and look the line text up in the compiled-source registry (see
// `source-registry.ts`, fed by the module loader / `compileCjs`). The result is
// the offending expression, e.g. `assert.ok(0)`.
//
// Difference from Node: we do not run a real tokenizer over the line, so a call
// embedded mid-expression yields the whole statement up to the `;`/matching `)`
// rather than the exact sub-expression.

export const internalErrorSourceSpec: BuiltinSpec = {
  id: 'internal/errors/error_source',
  origin: 'web-node',
  init: () => {
    interface StackFrame {
      getFileName?: () => string | null;
      getScriptNameOrSourceURL?: () => string | null;
      getLineNumber?: () => number | null;
      getColumnNumber?: () => number | null;
    }

    // `new Function(...)` wraps the body as
    //   function anonymous(<params>\n) {\n<body>\n}
    // so V8 reports body line N as N + 2. Both the vendored modules and user
    // modules are compiled that way, so every registry entry carries the offset.
    const FUNCTION_WRAPPER_LINES = 2;

    // Node reads V8's structured error positions; userland cannot. Instead we
    // read the CallSite of the frame that `Error.captureStackTrace(err, fn)`
    // targeted and look the line text up in the compiled-source registry.
    // The `error` handed in is always a throwaway object (assert's
    // `getErrMessage`), so mutating its `.stack` is harmless.
    function location(error: unknown): { sourceLine: string; startColumn: number } | undefined {
      if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return undefined;
      const ErrorCtor = Error as unknown as {
        prepareStackTrace?: (err: unknown, frames: unknown[]) => unknown;
      };
      const prev = ErrorCtor.prepareStackTrace;
      ErrorCtor.prepareStackTrace = (_err: unknown, frames: unknown[]) => frames;
      let frames: unknown;
      try {
        frames = (error as { stack?: unknown }).stack;
      } catch {
        frames = undefined;
      } finally {
        ErrorCtor.prepareStackTrace = prev;
      }
      const frame = Array.isArray(frames) ? (frames[0] as StackFrame | undefined) : undefined;
      if (!frame) return undefined;
      // `getFileName()` is null for `Function`-constructor scripts; the
      // `//# sourceURL=` tag shows up through `getScriptNameOrSourceURL()`.
      const file =
        (typeof frame.getScriptNameOrSourceURL === 'function' ? frame.getScriptNameOrSourceURL() : null) ??
        (typeof frame.getFileName === 'function' ? frame.getFileName() : null);
      const line = typeof frame.getLineNumber === 'function' ? frame.getLineNumber() : null;
      const col = typeof frame.getColumnNumber === 'function' ? frame.getColumnNumber() : null;
      const source = getCompiledSource(file);
      if (source === undefined || line === null || line < 1) return undefined;
      const sourceLine = source.split('\n')[line - 1 - FUNCTION_WRAPPER_LINES];
      if (sourceLine === undefined) return undefined;
      return { sourceLine, startColumn: col === null ? 0 : col - 1 };
    }

    // Walk left over the member-access chain so the reported expression keeps
    // its receiver (`assert.ok`, not `ok`), mirroring `getFirstExpression`.
    function expressionStart(line: string, startColumn: number): number {
      let i = startColumn;
      while (i > 0 && (line[i] === '(' || line[i] === ' ' || line[i] === '\t')) i--;
      while (i > 0) {
        const c = line[i - 1];
        if (/[A-Za-z0-9_$\].]/.test(c) || c === '?' || c === '[' || c === ')' || c === "'" || c === '"') i--;
        else break;
      }
      return i;
    }

    // End at the matching closing paren, or the first top-level `;`.
    function expressionEnd(line: string, startColumn: number): number {
      let depth = 0;
      for (let i = startColumn; i < line.length; i++) {
        const c = line[i];
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) return i + 1;
        } else if (c === ';' && depth === 0) return i;
      }
      return line.length;
    }

    return {
      getErrorSourceLocation: location,
      getErrorSourceExpression: (error: unknown) => {
        const loc = location(error);
        if (loc === undefined) return undefined;
        const { sourceLine, startColumn } = loc;
        const from = expressionStart(sourceLine, startColumn);
        const to = expressionEnd(sourceLine, startColumn);
        return sourceLine.slice(from, to).trim();
      },
    };
  },
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

    function removeColors(str: string): string {
      // eslint-disable-next-line no-control-regex
      return str.replace(/\u001b\[\d\d?m/g, '');
    }

    // `internal/util.js`'s `isError`: a native error, or anything for which
    // `Error[Symbol.hasInstance]` answers true (covers cross-realm errors).
    function isError(e: unknown): boolean {
      return (
        Object.prototype.toString.call(e) === '[object Error]' ||
        Function.prototype[Symbol.hasInstance].call(Error, e)
      );
    }

    // The built-in Array#join is slower than this hand-rolled loop, which is
    // why Node ships its own; `internal/util/inspect.js` imports it as `join`.
    function join(output: unknown[], separator: string): string {
      let str = '';
      if (output.length !== 0) {
        const lastIndex = output.length - 1;
        for (let i = 0; i < lastIndex; i++) {
          str += output[i];
          str += separator;
        }
        str += output[lastIndex];
      }
      return str;
    }

    return {
      isError,
      join,
      removeColors,
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
      // `internal/util.js`'s setOwnProperty: define a plain own property and
      // return the value so it can be used inline.
      setOwnProperty: <T>(obj: object, key: PropertyKey, value: T): T => {
        Object.defineProperty(obj, key, {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        });
        return value;
      },
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

// ---------------------------------------------------------------------------
// internal/bootstrap/realm
// ---------------------------------------------------------------------------
//
// Real `internal/bootstrap/realm.js` is the builtin registry itself; in this
// runtime the realm owns that table. The only thing the vendored source we
// ship reaches for is `BuiltinModule.exists(id)` (used while colouring stack
// frames), so we expose exactly that over the realm's public module list.

export const internalBootstrapRealmSpec: BuiltinSpec = {
  id: 'internal/bootstrap/realm',
  origin: 'web-node',
  init: (ctx: BuiltinInitContext) => ({
    BuiltinModule: {
      exists: (id: string): boolean =>
        typeof id === 'string' && ctx.builtinModuleIds.includes(id.startsWith('node:') ? id.slice(5) : id),
    },
  }),
};

// ---------------------------------------------------------------------------
// internal/url
// ---------------------------------------------------------------------------
//
// `internal/url` in Node carries the WHATWG implementation plus file-URL
// helpers. We already expose all of that on the `url` builtin, so the internal
// alias simply re-exports it. Loading is lazy in the vendored inspect code.

export const internalUrlSpec: BuiltinSpec = {
  id: 'internal/url',
  origin: 'web-node',
  init: (ctx: BuiltinInitContext) => ctx.require('url') as Record<string, unknown>,
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
