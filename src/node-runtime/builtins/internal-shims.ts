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
  // `lib/os.js` throws this from the checked-binding wrappers when a binding
  // returns `undefined` (i.e. it set `ctx` on failure). Our bindings never
  // fail, so the class exists for shape fidelity only.
  ERR_SYSTEM_ERROR: 'A system error occurred',
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
  ERR_OPERATION_FAILED: 'Operation failed: %s',
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
  ERR_NO_CRYPTO: 'Node.js is not compiled with OpenSSL crypto support',
  ERR_NO_TYPESCRIPT: 'Node.js is not compiled with TypeScript support',
  ERR_WEBASSEMBLY_NOT_SUPPORTED:
    'WebAssembly is not supported in this environment, but is required for %s',
  ERR_FALSY_VALUE_REJECTION: 'Promise was rejected with falsy value',
  ERR_INVALID_MIME_SYNTAX: 'The MIME syntax for a %s in "%s" is invalid',
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE: '%s',
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL:
    "Unexpected argument '%s'. This command does not take positional arguments",
  ERR_PARSE_ARGS_UNKNOWN_OPTION: "Unknown option '%s'",
  ERR_EVENT_RECURSION: 'The event "%s" is already being dispatched',
  ERR_MISSING_OPTION: '%s is required',
  ERR_CONSOLE_WRITABLE_STREAM: 'Console expects a writable stream instance for %s',
  ERR_INCOMPATIBLE_OPTION_PAIR: 'Option "%s" cannot be used in combination with option "%s"',
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
  ERR_NO_CRYPTO: Error,
  ERR_NO_TYPESCRIPT: Error,
  ERR_WEBASSEMBLY_NOT_SUPPORTED: Error,
  ERR_FALSY_VALUE_REJECTION: Error,
  ERR_INVALID_MIME_SYNTAX: TypeError,
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE: TypeError,
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL: TypeError,
  ERR_PARSE_ARGS_UNKNOWN_OPTION: TypeError,
  ERR_EVENT_RECURSION: Error,
  ERR_MISSING_OPTION: TypeError,
  ERR_CONSOLE_WRITABLE_STREAM: TypeError,
  ERR_INCOMPATIBLE_OPTION_PAIR: TypeError,
};

class NodeError extends Error {
  code: string;
  errno?: number;
  syscall?: string;
  address?: string;
  port?: number;
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
  // The `at <index>` suffix is only added when the invalid position is known.
  ERR_INVALID_MIME_SYNTAX: (args) => {
    const [production, str, invalidIndex] = args as [string, string, number];
    const suffix = invalidIndex !== -1 ? ` at ${invalidIndex}` : '';
    return `The MIME syntax for a ${production} in "${str}" is invalid${suffix}`;
  },
  ERR_PARSE_ARGS_UNKNOWN_OPTION: (args) => {
    const [option, allowPositionals] = args as [string, boolean];
    const suggest = allowPositionals
      ? `. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- ${JSON.stringify(option)}`
      : '';
    return `Unknown option '${option}'${suggest}`;
  },
};

/** Codes whose constructed error carries extra own properties beyond `code`. */
const CUSTOM_PROPS: Record<string, (err: Record<string, unknown>, args: unknown[]) => void> = {
  // Node keeps the rejected value on the error for callers to inspect.
  ERR_FALSY_VALUE_REJECTION: (err, args) => {
    err.reason = args[0];
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

/**
 * Codes declared with extra base classes in `lib/internal/errors.js` — i.e.
 * `E(code, message, Base, ...Extra)`. Node hangs each extra base off the code
 * class as `<Base.name>`, so `ERR_INVALID_STATE.TypeError` is a `TypeError` with
 * the same code/message. The WHATWG stream code reaches for exactly that
 * (`new ERR_INVALID_STATE.TypeError(...)` when a reader is already active).
 */
const ERROR_EXTRA_BASES: Record<string, ErrorConstructor[]> = {
  ERR_INVALID_STATE: [TypeError, RangeError],
  ERR_OPERATION_FAILED: [TypeError],
};

function makeErrorClass(
  code: string,
  Base: ErrorConstructor = (ERROR_BASES[code] ?? Error) as ErrorConstructor,
  attachExtraBases = true,
): new (...args: unknown[]) => Error {
  const initProps = CUSTOM_PROPS[code];
  class NodeErr extends Base {
    code = code;
    constructor(...args: unknown[]) {
      super(formatError(code, args));
      if (initProps) initProps(this as unknown as Record<string, unknown>, args);
    }
  }
  // Node keeps the built-in type's name on both the class and its instances.
  Object.defineProperty(NodeErr, 'name', { value: Base.name });
  // Node exposes a `HideStackFramesError` companion on each code (used by
  // `internal/validators` so validation frames vanish from the stack). Our
  // runtime cannot rewrite captured stacks, so it aliases the same class.
  Object.defineProperty(NodeErr, 'HideStackFramesError', { value: NodeErr, configurable: true });
  // The extra bases (`E(code, msg, Error, TypeError, ...)`).
  if (attachExtraBases) {
    for (const extra of ERROR_EXTRA_BASES[code] ?? []) {
      Object.defineProperty(NodeErr, extra.name, { value: makeErrorClass(code, extra, false) });
    }
  }
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
    // There is no libuv here, so no errno table: `uvErrmapGet` always misses and
    // callers fall back to Node's own `['UNKNOWN', 'unknown error']`. The error
    // classes below still carry the `errno`/`code`/`syscall` shape Node exposes.
    uvErrmapGet: () => undefined,
    /** `util._errnoException`'s backing class (lib/internal/errors.js). */
    ErrnoException: class ErrnoException extends NodeError {
      constructor(err: number, syscall: string, original?: string) {
        const code = String(err);
        super(code, original ? `${syscall} ${code} ${original}` : `${syscall} ${code}`);
        this.errno = err;
        this.syscall = syscall;
      }
    },
    /** The deprecated host-port variant, still imported by `lib/util.js`. */
    ExceptionWithHostPort: class ExceptionWithHostPort extends NodeError {
      constructor(err: number, syscall: string, address?: string, port?: number, additional?: string) {
        const code = String(err);
        let details = '';
        if (port && port > 0) details = ` ${address}:${port}`;
        else if (address) details = ` ${address}`;
        if (additional) details += ` - Local (${additional})`;
        super(code, `${syscall} ${code}${details}`);
        this.errno = err;
        this.syscall = syscall;
        this.address = address;
        if (port) this.port = port;
      }
    },
    /** The current host-port form (lib/internal/errors.js). */
    UVExceptionWithHostPort: class UVExceptionWithHostPort extends NodeError {
      constructor(err: number, syscall: string, address?: string, port?: number) {
        const code = 'UNKNOWN';
        const uvmsg = 'unknown error';
        let details = '';
        if (port && port > 0) details = ` ${address}:${port}`;
        else if (address) details = ` ${address}`;
        super(code, `${syscall} ${code}: ${uvmsg}${details}`);
        this.errno = err;
        this.syscall = syscall;
        this.address = address;
        if (port) this.port = port;
      }
    },
    // Node stores stack-decoration callbacks here and consults them from a real
    // `Error.prepareStackTrace`; we cannot install one globally, so this stays an
    // inert store that `decorateErrorStack` can write to without crashing.
    overrideStackTrace: new WeakMap(),
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

    // Compiled units are wrapped by `compileTagged` (a one-line indirect eval),
    // which — unlike `new Function` — does not shift line numbers, so a frame's
    // line is the source line as-is.
    const FUNCTION_WRAPPER_LINES = 0;

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
  // The permission model is a host-process concept; `internal/process/permission`
  // reads these to answer `isEnabled()`, and a tab never has them on.
  '--permission': false,
  '--permission-audit': false,
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
// internal/process/permission
// ---------------------------------------------------------------------------
//
// The permission model gates host-process operations (fs/net/child_process). A
// tab has no such model, so it is permanently *disabled* — which is exactly what
// `src/node_permission.cc` reports when `--permission` is off: `isEnabled()` is
// false and every scope check succeeds. `readline`'s history file writes go
// through `has('fs.write', path)`, which therefore always allows.

export const internalProcessPermissionSpec: BuiltinSpec = {
  id: 'internal/process/permission',
  origin: 'web-node',
  init: () => ({
    isEnabled: (): boolean => false,
    isAuditMode: (): boolean => false,
    has: (_scope: string, _reference?: unknown): boolean => true,
    drop: (_scope: string, _reference?: unknown): void => undefined,
    availableFlags: (): string[] => [
      '--allow-fs-read',
      '--allow-fs-write',
      '--allow-addons',
      '--allow-child-process',
      '--allow-net',
      '--allow-inspector',
      '--allow-wasi',
      '--allow-worker',
      '--allow-openssl-store',
    ],
  }),
};

// ---------------------------------------------------------------------------
// Unimplemented Node internals reached only by lazy feature paths
// ---------------------------------------------------------------------------
//
// `compose`, the Web Streams adapters and the experimental stream/iter bridge are
// all loaded on demand. They stay explicit throws so a caller that reaches them
// sees why, instead of a silent `undefined`.

// ---------------------------------------------------------------------------
// internal/worker/js_transferable
// ---------------------------------------------------------------------------
//
// ⏬ This is now the real vendored file (`lib/internal/worker/js_transferable.js`);
// see `vendored-builtins.ts`. The previous shim minted private symbols that nothing
// else could see; the real module stamps the transfer mode through the `util`
// binding's `transfer_mode_private_symbol` and wires `kClone`/`kTransfer` to the
// `symbols` binding, which is what the `messaging` binding keys off.

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
    // `markAsUntransferable` stamps a private symbol on the object and, for an
    // ArrayBuffer, also sets its "detach key" (the C++ `ArrayBuffer` detail the
    // serializer consults). We have no V8 detach key, so the private symbol is
    // the whole mechanism here; `structuredClone` is the host's and does not
    // read either, which is why the flag is advisory in this runtime.
    const untransferableObjectPrivateSymbol = Symbol('untransferable_object_private_symbol');
    return {
      FastBuffer: Buffer,
      markAsUntransferable: (object: unknown): void => {
        if ((typeof object !== 'object' && typeof object !== 'function') || object === null) {
          return; // A primitive is already untransferable.
        }
        try {
          (object as Record<symbol, unknown>)[untransferableObjectPrivateSymbol] = true;
        } catch {
          // Frozen objects are simply not marked, as in Node.
        }
      },
      isMarkedAsUntransferable: (object: unknown): boolean =>
        object !== null &&
        typeof object === 'object' &&
        (object as Record<symbol, unknown>)[untransferableObjectPrivateSymbol] !== undefined,
    };
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

// ---------------------------------------------------------------------------
// internal/histogram
// ---------------------------------------------------------------------------
//
// Node backs `createHistogram` / `monitorEventLoopDelay` / `timerify` with the
// native `Histogram` (a CBOR-exporting hdr_histogram plus a set of statistical
// tests). That is a substantial native surface with no browser equivalent, so
// it is **not** implemented here. The module still loads — `perf_hooks` and
// `internal/perf/timerify` destructure it at load time — but every histogram
// constructor throws a typed `NotImplementedError` on use.

const kDestroy = Symbol('kDestroy');
const kHandle = Symbol('kHandle');
const kSkipThrow = Symbol('kSkipThrow');

function histogramUnsupported(what: string): never {
  throw notImplemented('api', what, 'Histograms need the native hdr_histogram binding, which has no browser equivalent.');
}

/** Placeholder for `internal/histogram`'s native-backed `Histogram` class. */
class UnsupportedHistogram {
  constructor(skipThrowSymbol?: symbol) {
    if (skipThrowSymbol === kSkipThrow) return;
    histogramUnsupported('perf_hooks.createHistogram');
  }
}

class UnsupportedRecordableHistogram extends UnsupportedHistogram {}

export const internalHistogramSpec: BuiltinSpec = {
  id: 'internal/histogram',
  origin: 'web-node',
  init: () => ({
    Histogram: UnsupportedHistogram,
    RecordableHistogram: UnsupportedRecordableHistogram,
    ClonedHistogram: UnsupportedHistogram,
    ClonedRecordableHistogram: UnsupportedRecordableHistogram,
    isHistogram: (value: unknown): boolean =>
      typeof value === 'object' && value !== null && kHandle in value,
    kDestroy,
    kHandle,
    kSkipThrow,
    createHistogram: () => histogramUnsupported('perf_hooks.createHistogram'),
    importHistogram: () => histogramUnsupported('perf_hooks.importHistogram'),
  }),
};

/**
 * `internal/process/task_queues`.
 *
 * The real module owns the tick queue and drives V8's microtask queue from
 * C++. This runtime already schedules ticks itself, so the only surface the
 * vendored `internal/webstreams/*` group reaches for is `queueMicrotask` (it
 * uses it to keep spec-ordered continuations off the tick queue). Everything
 * else — `setTickCallback`, the promises hooks — stays with the runtime.
 */
export const internalProcessTaskQueuesSpec: BuiltinSpec = {
  id: 'internal/process/task_queues',
  origin: 'web-node',
  init: () => ({
    queueMicrotask: (fn: () => void): void => {
      if (typeof fn !== 'function') throw new TypeError('queueMicrotask requires a function');
      queueMicrotask(fn);
    },
  }),
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
  init: (ctx: BuiltinInitContext) => {
    const url = ctx.require('url') as Record<string, unknown> & {
      isURL?: (value: unknown) => boolean;
      fileURLToPath?: (value: unknown) => string;
    };
    return {
      ...url,
      // `internal/url`'s file-URL helper: pass a path through untouched, resolve
      // a `file:` URL to a path. Vendored `internal/fs/glob` reads it.
      toPathIfFileURL: (fileURLOrPath: unknown): unknown =>
        typeof url.isURL === 'function' && url.isURL(fileURLOrPath)
          ? url.fileURLToPath?.(fileURLOrPath)
          : fileURLOrPath,
    };
  },
};

// ---------------------------------------------------------------------------
// internal/events/symbols
// ---------------------------------------------------------------------------

export const internalEventsSymbolsSpec: BuiltinSpec = {
  id: 'internal/events/symbols',
  origin: 'web-node',
  init: () => ({
    kFirstEventParam: Symbol('kFirstEventParam'),
  }),
};

// ---------------------------------------------------------------------------
// internal/fs/utils  (only `DirentFromStats` is referenced, by internal/fs/glob)
// ---------------------------------------------------------------------------
//
// Our `fs` is a homegrown VFS layer, so the real `internal/fs/utils.js` (the
// 1200-line helper module that real `fs.js` sits on) does not apply here. The
// vendored glob walker only needs one export from it: `DirentFromStats`, a
// `Dirent` whose type predicates delegate to a `lstat`/`stat` result. Our stats
// objects already carry the full `isDirectory()`/`isFile()`/... surface, so the
// delegation is all that is required.

export const internalFsUtilsSpec: BuiltinSpec = {
  id: 'internal/fs/utils',
  origin: 'web-node',
  init: () => {
    type StatsLike = {
      isDirectory?: () => boolean;
      isFile?: () => boolean;
      isBlockDevice?: () => boolean;
      isCharacterDevice?: () => boolean;
      isSymbolicLink?: () => boolean;
      isFIFO?: () => boolean;
      isSocket?: () => boolean;
    };

    class Dirent {
      name: string;
      parentPath: string;

      constructor(name: string, path = '') {
        this.name = name;
        this.parentPath = path;
      }

      isDirectory(): boolean {
        return false;
      }

      isFile(): boolean {
        return false;
      }

      isBlockDevice(): boolean {
        return false;
      }

      isCharacterDevice(): boolean {
        return false;
      }

      isSymbolicLink(): boolean {
        return false;
      }

      isFIFO(): boolean {
        return false;
      }

      isSocket(): boolean {
        return false;
      }
    }

    class DirentFromStats extends Dirent {
      #stats: StatsLike;

      constructor(name: string, stats: StatsLike, path = '') {
        super(name, path);
        this.#stats = stats;
      }

      #ask(method: keyof StatsLike): boolean {
        const fn = this.#stats[method];
        return typeof fn === 'function' ? fn.call(this.#stats) : false;
      }

      override isDirectory(): boolean {
        return this.#ask('isDirectory');
      }

      override isFile(): boolean {
        return this.#ask('isFile');
      }

      override isBlockDevice(): boolean {
        return this.#ask('isBlockDevice');
      }

      override isCharacterDevice(): boolean {
        return this.#ask('isCharacterDevice');
      }

      override isSymbolicLink(): boolean {
        return this.#ask('isSymbolicLink');
      }

      override isFIFO(): boolean {
        return this.#ask('isFIFO');
      }

      override isSocket(): boolean {
        return this.#ask('isSocket');
      }
    }

    return { DirentFromStats };
  },
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

// ---------------------------------------------------------------------------
// internal/encoding
// ---------------------------------------------------------------------------
//
// `lib/util.js` exposes `TextEncoder`/`TextDecoder` through this module. Real
// `internal/encoding.js` is a full streaming decoder built on `internal/buffer`
// and the single-byte codec tables; the host realm already ships spec-compliant
// `TextEncoder`/`TextDecoder`, so those are re-exported directly.

export const internalEncodingSpec: BuiltinSpec = {
  id: 'internal/encoding',
  origin: 'web-node',
  init: () => ({
    TextEncoder,
    TextDecoder,
  }),
};

// ---------------------------------------------------------------------------
// internal/util/trace_sigint
// ---------------------------------------------------------------------------
//
// `util.setTraceSigInt` arms a native SIGINT watchdog for `--trace-sigint`; there
// is no signal surface here, so it is an inert no-op exactly like Node's when
// the flag is off.

export const internalTraceSigintSpec: BuiltinSpec = {
  id: 'internal/util/trace_sigint',
  origin: 'web-node',
  init: () => ({
    setTraceSigInt: (_enable: boolean): void => undefined,
  }),
};
