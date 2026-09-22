import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';
import { getCompiledSource } from '../source-registry';
import { ERRNO, ERRNO_DESC } from '../vfs/types';

/**
 * libuv's errno table, keyed by the negative errno — the same pairs the `uv`
 * binding exposes via `getErrorMap()` (see `bindings/misc.ts`). `internal/util`'s
 * `uvErrmapGet` and the libuv-shaped error classes in this file read it.
 */
const UV_ERRMAP = new Map<number, [string, string]>();
for (const [name, errno] of Object.entries(ERRNO)) {
  UV_ERRMAP.set(errno, [name, ERRNO_DESC[name] ?? 'unknown error']);
}

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
  ERR_BUFFER_OUT_OF_BOUNDS: 'Attempt to access memory outside buffer bounds',
  ERR_BUFFER_TOO_LARGE: 'Cannot create a Buffer larger than %s bytes',
  ERR_INVALID_BUFFER_SIZE: 'Buffer size must be a multiple of %s',
  ERR_DUPLICATE_STARTUP_SNAPSHOT_MAIN_FUNCTION: 'Deserialize main function is already configured.',
  ERR_NOT_BUILDING_SNAPSHOT: 'Operation cannot be invoked when not building startup snapshot',
  ERR_NOT_SUPPORTED_IN_SNAPSHOT: '%s is not supported in startup snapshot',
  ERR_INVALID_ARG_VALUE: 'The argument \'%s\' is invalid. Received %s',
  ERR_INVALID_URI: 'URI malformed',
  ERR_INVALID_URL: 'Invalid URL',
  ERR_INVALID_URL_SCHEME: 'The URL must be of scheme %s',
  ERR_INVALID_FILE_URL_HOST: 'File URL host must be "localhost" or empty on %s',
  ERR_INVALID_FILE_URL_PATH: 'File URL path %s',
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
  ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET:
    '`process.setupUncaughtExceptionCapture()` was called while a capture callback was already active',
  ERR_WEB_NODE_NOT_IMPLEMENTED: '[web-node] %s is not implemented.',
  ERR_AMBIGUOUS_ARGUMENT: 'The "%s" argument is ambiguous. %s',
  ERR_ASSERTION: '%s',
  ERR_CONSTRUCT_CALL_REQUIRED: 'Class constructor %s cannot be invoked without `new`',
  ERR_INVALID_THIS: 'Value of "this" must be of type %s',
  ERR_UNKNOWN_SIGNAL: 'Unknown signal: %s',
  ERR_SOCKET_BAD_PORT: 'Port should be %s. Received %s',
  ERR_INVALID_ADDRESS: 'Invalid socket address',
  ERR_CRYPTO_ENGINE_UNKNOWN: 'Engine "%s" was not found',
  ERR_INVALID_HTTP_TOKEN: '%s must be a valid HTTP token ["%s"]',
  ERR_HTTP_INVALID_HEADER_VALUE: 'Invalid value "%s" for header "%s"',
  ERR_HTTP_HEADERS_SENT: 'Cannot %s headers after they are sent to the client',
  ERR_HTTP_CONTENT_LENGTH_MISMATCH:
    "Response body's content-length of %s byte(s) does not match the content-length of %s byte(s) set in header",
  ERR_HTTP_INVALID_STATUS_CODE: 'Invalid status code: %s',
  ERR_INVALID_CHAR: 'Invalid character in %s',
  ERR_NO_CRYPTO: 'Node.js is not compiled with OpenSSL crypto support',
  ERR_NO_TYPESCRIPT: 'Node.js is not compiled with TypeScript support',
  ERR_WEBASSEMBLY_NOT_SUPPORTED:
    'WebAssembly is not supported in this environment, but is required for %s',
  ERR_FALSY_VALUE_REJECTION: 'Promise was rejected with falsy value',
  ERR_FS_FILE_TOO_LARGE: 'File size (%s) is greater than 2 GiB',
  ERR_FS_CP_DIR_TO_NON_DIR: 'Cannot overwrite non-directory with directory',
  ERR_FS_CP_NON_DIR_TO_DIR: 'Cannot overwrite directory with non-directory',
  ERR_FS_CP_EEXIST: 'Target already exists',
  ERR_FS_CP_EINVAL: 'Invalid src or dest',
  ERR_FS_CP_FIFO_PIPE: 'Cannot copy a FIFO pipe',
  ERR_FS_CP_SOCKET: 'Cannot copy a socket file',
  ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY: 'Cannot overwrite symlink in subdirectory of self',
  ERR_FS_CP_UNKNOWN: 'Cannot copy an unknown file type',
  ERR_FS_EISDIR: 'Path is a directory',
  ERR_DIR_CLOSED: 'Directory handle was closed',
  ERR_DIR_CONCURRENT_OPERATION:
    'Cannot do synchronous work on directory handle with concurrent asynchronous operations',
  ERR_INVALID_MIME_SYNTAX: 'The MIME syntax for a %s in "%s" is invalid',
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE: '%s',
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL:
    "Unexpected argument '%s'. This command does not take positional arguments",
  ERR_PARSE_ARGS_UNKNOWN_OPTION: "Unknown option '%s'",
  ERR_EVENT_RECURSION: 'The event "%s" is already being dispatched',
  ERR_MISSING_OPTION: '%s is required',
  ERR_CONSOLE_WRITABLE_STREAM: 'Console expects a writable stream instance for %s',
  ERR_INCOMPATIBLE_OPTION_PAIR: 'Option "%s" cannot be used in combination with option "%s"',
  ERR_INVALID_CURSOR_POS: 'Cannot set cursor row without setting its column',
  ERR_INVALID_FD: '"fd" must be a positive integer: %s',
  ERR_INVALID_FD_TYPE: 'Unsupported fd type: %s',
  ERR_TTY_INIT_FAILED: 'TTY initialization failed',
  ERR_CONTEXT_NOT_INITIALIZED: 'context used is not initialized',
  // Message body lives in CUSTOM_FORMATTERS (it is built conditionally).
  ERR_WORKER_PATH:
    'The worker script or module filename must be an absolute path or a relative path starting with \'./\' or \'../\'.',
  ERR_WORKER_INVALID_EXEC_ARGV: 'Initiated Worker with %s: %s',
  ERR_WORKER_NOT_RUNNING: 'Worker instance not running',
  // Referenced via `internal/errors` by vendored modules (fs, webstreams, perf,
  // readline) and by user code that reaches those paths. Keep adding any code a
  // vendored/`src` file destructures, or `codes.X` is `undefined` at the call
  // site and `new` throws "is not a constructor".
  // Message body lives in CUSTOM_FORMATTERS (it is the caller's own sentence).
  ERR_ACCESS_DENIED: '%s',
  ERR_ARG_NOT_ITERABLE: '%s must be iterable',
  ERR_FEATURE_UNAVAILABLE_ON_PLATFORM:
    'The feature %s is unavailable on the current platform' +
    ', which is being used to run Node.js',
  ERR_FS_WATCH_QUEUE_OVERFLOW: 'fs.watch() queued more than %d events',
  ERR_NO_TEMPORAL: 'Temporal is not supported in this environment',
  ERR_PERFORMANCE_INVALID_TIMESTAMP: '%d is not a valid timestamp',
  ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS: '%s',
  ERR_USE_AFTER_CLOSE: '%s was closed',
  // Message body lives in CUSTOM_FORMATTERS; listed here so the class exists.
  ERR_INVALID_RETURN_VALUE: 'Expected %s to be returned from the "%s" function but got %s.',
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
  ERR_INVALID_URI: URIError,
  ERR_FS_FILE_TOO_LARGE: RangeError,
  ERR_INVALID_URL: TypeError,
  ERR_INVALID_URL_SCHEME: TypeError,
  ERR_INVALID_FILE_URL_HOST: TypeError,
  ERR_INVALID_FILE_URL_PATH: TypeError,
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
  ERR_BUFFER_OUT_OF_BOUNDS: RangeError,
  ERR_BUFFER_TOO_LARGE: RangeError,
  ERR_INVALID_BUFFER_SIZE: RangeError,
  ERR_DUPLICATE_STARTUP_SNAPSHOT_MAIN_FUNCTION: Error,
  ERR_NOT_BUILDING_SNAPSHOT: Error,
  ERR_NOT_SUPPORTED_IN_SNAPSHOT: Error,
  ERR_UNKNOWN_FILE_EXTENSION: TypeError,
  ERR_UNSUPPORTED_ESM_URL_SCHEME: Error,
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
  ERR_INVALID_HTTP_TOKEN: TypeError,
  ERR_HTTP_INVALID_HEADER_VALUE: TypeError,
  ERR_HTTP_HEADERS_SENT: Error,
  ERR_HTTP_CONTENT_LENGTH_MISMATCH: Error,
  ERR_HTTP_INVALID_STATUS_CODE: RangeError,
  ERR_INVALID_CHAR: TypeError,
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL: TypeError,
  ERR_PARSE_ARGS_UNKNOWN_OPTION: TypeError,
  ERR_EVENT_RECURSION: Error,
  ERR_MISSING_OPTION: TypeError,
  ERR_CONSOLE_WRITABLE_STREAM: TypeError,
  ERR_INCOMPATIBLE_OPTION_PAIR: TypeError,
  ERR_INVALID_CURSOR_POS: TypeError,
  ERR_INVALID_FD: RangeError,
  ERR_INVALID_FD_TYPE: TypeError,
  ERR_CONTEXT_NOT_INITIALIZED: Error,
  ERR_WORKER_PATH: TypeError,
  ERR_WORKER_INVALID_EXEC_ARGV: Error,
  ERR_WORKER_NOT_RUNNING: Error,
  ERR_ARG_NOT_ITERABLE: TypeError,
  ERR_FEATURE_UNAVAILABLE_ON_PLATFORM: TypeError,
  ERR_PERFORMANCE_INVALID_TIMESTAMP: TypeError,
  ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS: TypeError,
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

/** Node's `addNumericalSeparator`: groups digits with `_` from the right. */
function addNumericalSeparator(val: string): string {
  let res = '';
  let i = val.length;
  const start = val[0] === '-' ? 1 : 0;
  for (; i >= start + 4; i -= 3) {
    res = `_${val.slice(i - 3, i)}${res}`;
  }
  return `${val.slice(0, i)}${res}`;
}

const CUSTOM_FORMATTERS: Record<string, (args: unknown[]) => string> = {
  // These three are *function* messages in Node that ignore extra arguments for
  // the message (they only set own properties). As plain `%s` templates the
  // real `util.format` would append the leftover arguments, so they need an
  // explicit formatter.
  ERR_INVALID_URL: () => 'Invalid URL',
  ERR_FALSY_VALUE_REJECTION: () => 'Promise was rejected with falsy value',
  ERR_INVALID_FILE_URL_PATH: (args) => `File URL path ${args[0]}`,
  // Node: `ERR_BUFFER_OUT_OF_BOUNDS('offset')` reads '"offset" is outside of
  // buffer bounds'; with no name it is the plain memory-bounds sentence.
  ERR_BUFFER_OUT_OF_BOUNDS: (args) => {
    const name = args[0] as string | undefined;
    return name ? `"${name}" is outside of buffer bounds` : 'Attempt to access memory outside buffer bounds';
  },
  // Node: "The property 'options.highWaterMark' is invalid. Received -1" —
  // 'property' whenever the name looks like a dotted path, else 'argument'.
  ERR_INVALID_ARG_VALUE: (args) => {
    const [name, value, reason] = args as [string, unknown, string?];
    const type = String(name).includes('.') ? 'property' : 'argument';
    return `The ${type} '${name}' ${reason ?? 'is invalid'}. Received ${inspectArg(value)}`;
  },
  // `ERR_INVALID_CHAR(name, field = undefined)`: appends the quoted field only
  // when one was given (default arg keeps `Function#length` at 1).
  ERR_INVALID_CHAR: (args) => {
    const [name, field] = args as [string, string?];
    let msg = `Invalid character in ${name}`;
    if (field !== undefined) msg += ` ["${field}"]`;
    return msg;
  },
  ERR_INVALID_ARG_TYPE: formatInvalidArgType,
  // `ERR_ACCESS_DENIED(message, permission = '', resource = '')`: the message is
  // the caller's own sentence (no template), and permission/resource ride along
  // as own properties (see CUSTOM_PROPS).
  ERR_ACCESS_DENIED: (args) => String(args[0]),
  ERR_INVALID_RETURN_VALUE: (args) => {
    const [input, name, value] = args as [string, string, unknown];
    return `Expected ${input} to be returned from the "${name}" function but got ${determineSpecificType(value)}.`;
  },
  // `ERR_INVALID_URL_SCHEME(expected)`: one scheme, or a pair of them.
  ERR_INVALID_URL_SCHEME: (args) => {
    let expected = args[0] as string | string[];
    if (typeof expected === 'string') expected = [expected];
    const res =
      expected.length === 2
        ? `one of scheme ${expected[0]} or ${expected[1]}`
        : `of scheme ${expected[0]}`;
    return `The URL must be ${res}`;
  },
  // Node's builder drops the parenthesised detail when nothing was passed.
  ERR_UNHANDLED_ERROR: (args) =>
    args.length === 0 || args[0] === undefined ? 'Unhandled error.' : `Unhandled error. (${String(args[0])})`,
  // `validatePort(name, port, allowZero = true)` (lib/internal/errors.js):
  // lowercase name, `and`, an exclusive `< 65536` bound, and the received value
  // rendered through `determineSpecificType` with a trailing period.
  ERR_SOCKET_BAD_PORT: (args) => {
    const [name, port, allowZero = true] = args as [string, unknown, boolean?];
    const operator = allowZero ? '>=' : '>';
    return `${name} should be ${operator} 0 and < 65536. Received ${determineSpecificType(port)}.`;
  },
  // `ERR_OUT_OF_RANGE(str, range, input, replaceDefaultBoolean = false)`. The
  // received value goes through `inspect` (so strings are quoted) with
  // `addNumericalSeparator` grouping large integers; `replaceDefaultBoolean`
  // swaps the whole sentence for the caller's own.
  ERR_OUT_OF_RANGE: (args) => {
    const str = args[0] as string;
    const range = args[1] as string;
    const input = args[2];
    const replaceDefaultBoolean = (args[3] as boolean | undefined) ?? false;
    const msg = replaceDefaultBoolean ? str : `The value of "${str}" is out of range.`;
    let received: string;
    if (typeof input === 'number' && Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
      received = addNumericalSeparator(String(input));
    } else if (typeof input === 'bigint') {
      received = String(input);
      if (input > 2n ** 32n || input < -(2n ** 32n)) received = addNumericalSeparator(received);
      received += 'n';
    } else {
      received = lazyUtilInspect()?.inspect(input) ?? inspectArg(input);
    }
    return `${msg} It must be ${range}. Received ${received}`;
  },
  // `ERR_MISSING_ARGS(...args)`: each name is quoted (an array becomes
  // `"a" or "b"`), the list is joined with `formatList`, and the noun is
  // pluralised for more than one argument.
  ERR_MISSING_ARGS: (args) => {
    const wrap = (a: unknown): string => `"${a}"`;
    const mapped = args.map((a) => (Array.isArray(a) ? a.map(wrap).join(' or ') : wrap(a)));
    return `The ${formatList(mapped)} argument${args.length > 1 ? 's' : ''} must be specified`;
  },
  // `ERR_MODULE_NOT_FOUND(path, base, exactUrl)`: says "module" only when an
  // explicit URL was given, otherwise "package".
  ERR_MODULE_NOT_FOUND: (args) => {
    const [path, base, exactUrl] = args as [string, string, unknown];
    return `Cannot find ${exactUrl ? 'module' : 'package'} '${path}' imported from ${base}`;
  },
  // `ERR_UNSUPPORTED_ESM_URL_SCHEME(url, supported)`. The win32 sentence does
  // not apply in a browser tab.
  ERR_UNSUPPORTED_ESM_URL_SCHEME: (args) => {
    const [url, supported] = args as [{ protocol: string }, string[]];
    return (
      'Only URLs with a scheme in: ' +
      `${formatList(supported)} are supported by the default ESM loader. ` +
      `Received protocol '${url.protocol}'`
    );
  },
  // `ERR_INTERNAL_ASSERTION(message)`: the caller's message is prepended to a
  // fixed two-line advisory (or is the whole message when none was given).
  ERR_INTERNAL_ASSERTION: (args) => {
    const message = args[0] as string | undefined;
    const suffix =
      'This is caused by either a bug in Node.js ' +
      'or incorrect usage of Node.js internals.\n' +
      'Please open an issue with this stack trace at ' +
      'https://github.com/nodejs/node/issues\n';
    return message === undefined ? suffix : `${message}\n${suffix}`;
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
  // `ERR_WORKER_PATH(filename)`: the advice about wrapping URL-shaped inputs is
  // appended only when the path looks like a file:// or data: URL (lib/internal/errors.js).
  ERR_WORKER_PATH: (args) => {
    const filename = String(args[0]);
    return (
      'The worker script or module filename must be an absolute path or a ' +
      "relative path starting with './' or '../'." +
      (filename.startsWith('file://') ? ' Wrap file:// URLs with `new URL`.' : '') +
      (filename.startsWith('data:text/javascript') ? ' Wrap data: URLs with `new URL`.' : '') +
      ` Received "${filename}"`
    );
  },
  // `ERR_WORKER_INVALID_EXEC_ARGV(errors, msg = 'invalid execArgv flags')`.
  ERR_WORKER_INVALID_EXEC_ARGV: (args) => {
    const [list, msg = 'invalid execArgv flags'] = args as [ArrayLike<unknown>, string?];
    return `Initiated Worker with ${msg}: ${Array.prototype.join.call(list, ', ')}`;
  },
};

/** Codes whose constructed error carries extra own properties beyond `code`. */
const CUSTOM_PROPS: Record<string, (err: Record<string, unknown>, args: unknown[]) => void> = {
  // Node keeps the rejected value on the error for callers to inspect.
  ERR_FALSY_VALUE_REJECTION: (err, args) => {
    err.reason = args[0];
  },
  // `ERR_INVALID_URL(input, base?)` carries the offending input and, when a
  // base was in play, that too — the message itself is just "Invalid URL".
  ERR_INVALID_URL: (err, args) => {
    err.input = args[0];
    if (args[1] != null) err.base = args[1];
  },  // `ERR_INVALID_FILE_URL_PATH(reason, input)` carries the offending input on
  // the error.
  ERR_INVALID_FILE_URL_PATH: (err, args) => {
    err.input = args[1];
  },
  // `ERR_MODULE_NOT_FOUND(path, base, exactUrl)` sets a stringified `url` when
  // an explicit URL was supplied (lib/internal/errors.js).
  ERR_MODULE_NOT_FOUND: (err, args) => {
    if (args[2]) err.url = `${args[2]}`;
  },
  // `ERR_ACCESS_DENIED` carries the permission and resource it was denied for.
  ERR_ACCESS_DENIED: (err, args) => {
    err.permission = args[1] ?? '';
    err.resource = args[2] ?? '';
  },
};

function formatError(code: string, args: unknown[]): string {
  const formatter = CUSTOM_FORMATTERS[code];
  if (formatter) return formatter(args);
  const template = ERROR_CODES[code] ?? code;
  // Node builds string-message codes with `util.format(msg, ...args)` (via
  // `lazyInternalUtilInspect()` in `makeNodeErrorWithCode`). Use the vendored
  // real `util.format` so `%d`/`%j`/`%o`/`%s`-with-object all match, and only
  // fall back to naive `%s` substitution if that module is not reachable yet
  // (e.g. an error thrown while `internal/util/inspect` is still loading).
  const inspect = lazyUtilInspect();
  if (inspect && typeof inspect.format === 'function') {
    return inspect.format(template, ...args);
  }
  let i = 0;
  return template.replace(/%[sdj]/g, () => String(args[i++]));
}

/**
 * `internal/util/inspect`'s `format`/`inspect`, resolved lazily and cached.
 *
 * Node's `internal/errors` does the same (`lazyInternalUtilInspect()`): it may
 * not require that module at init time because the two sit on a load-time cycle
 * (`inspect.js` requires `internal/errors`). We record a resolver when the
 * errors module is materialized and only invoke it while formatting.
 */
type UtilInspectModule = {
  format: (...args: unknown[]) => string;
  inspect: (value: unknown, options?: unknown) => string;
};
let resolveUtilInspect: (() => UtilInspectModule) | null = null;
let cachedUtilInspect: UtilInspectModule | null = null;

function lazyUtilInspect(): UtilInspectModule | null {
  if (cachedUtilInspect) return cachedUtilInspect;
  if (!resolveUtilInspect) return null;
  try {
    const mod = resolveUtilInspect();
    if (mod && typeof mod.format === 'function') cachedUtilInspect = mod;
    return mod;
  } catch {
    return null;
  }
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

function formatList(list: ArrayLike<unknown>, conjunction: 'and' | 'or' = 'and'): string {
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
      // Node reaches the list methods via `Array.prototype.*.call`, which stays
      // generic when the argument is not a real array — mirror that.
      return `${Array.prototype.join.call(
        Array.prototype.slice.call(list, 0, -1),
        ', ',
      )}, ${conjunction} ${list[list.length - 1]}`;
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
  // `E('ERR_INVALID_ARG_VALUE', …, TypeError, RangeError)`: the RangeError
  // variant is what the range-checking call sites reach for.
  ERR_INVALID_ARG_VALUE: [RangeError],
  // `E('ERR_INVALID_RETURN_VALUE', …, TypeError, RangeError)`: the RangeError
  // variant is the one `internal/streams/iter` reaches for.
  ERR_INVALID_RETURN_VALUE: [RangeError],
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

const kIsNodeError = Symbol('kIsNodeError');

/**
 * `SystemError` (lib/internal/errors.js) — the class behind `E(code, msg,
 * SystemError)` entries. Its message is assembled from the error *context*
 * (`${prefix}: ${syscall} returned ${code} (${message})`) rather than from
 * `%s` placeholders.
 */
class SystemError extends Error {
  code: string = '';
  constructor(key: string, context: Record<string, unknown>) {
    super();
    const prefix = ERROR_CODES[key] ?? key;
    let message = `${prefix}: ${context.syscall} returned ` + `${context.code} (${context.message})`;
    if (context.path !== undefined) message += ` ${context.path}`;
    if (context.dest !== undefined) message += ` => ${context.dest}`;
    this.code = key;
    Object.defineProperties(this, {
      [kIsNodeError]: { value: true, enumerable: false, configurable: true },
      name: { value: 'SystemError', enumerable: false, writable: true, configurable: true },
      message: { value: message, enumerable: false, writable: true, configurable: true },
      info: { value: context, enumerable: true, configurable: true },
      errno: {
        get: () => context.errno,
        set: (value: number | undefined) => {
          context.errno = value;
        },
        enumerable: true,
        configurable: true,
      },
      syscall: {
        get: () => context.syscall,
        set: (value: string) => {
          context.syscall = value;
        },
        enumerable: true,
        configurable: true,
      },
    });
    if (context.path !== undefined) {
      Object.defineProperty(this, 'path', {
        get: () => (context.path != null ? String(context.path) : context.path),
        set: (value: unknown) => {
          context.path = value ? String(value) : undefined;
        },
        enumerable: true,
        configurable: true,
      });
    }
    if (context.dest !== undefined) {
      Object.defineProperty(this, 'dest', {
        get: () => (context.dest != null ? String(context.dest) : context.dest),
        set: (value: unknown) => {
          context.dest = value ? String(value) : undefined;
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

/** Codes `lib/internal/errors.js` declares with the `SystemError` base. */
const SYSTEM_ERROR_CODES: Record<string, true> = {
  ERR_FS_CP_DIR_TO_NON_DIR: true,
  ERR_FS_CP_EEXIST: true,
  ERR_FS_CP_EINVAL: true,
  ERR_FS_CP_FIFO_PIPE: true,
  ERR_FS_CP_NON_DIR_TO_DIR: true,
  ERR_FS_CP_SOCKET: true,
  ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY: true,
  ERR_FS_CP_UNKNOWN: true,
  ERR_FS_EISDIR: true,
  ERR_SYSTEM_ERROR: true,
  ERR_TTY_INIT_FAILED: true,
};

function makeSystemErrorWithCode(key: string): new (ctx: Record<string, unknown>) => Error {
  class NodeSystemError extends SystemError {
    constructor(ctx: Record<string, unknown>) {
      super(key, ctx);
    }
  }
  // `E(code, msg, SystemError, HideStackFramesError)` (`ERR_FS_EISDIR`,
  // `ERR_SYSTEM_ERROR`) exposes the hide-stack-frames companion on the class;
  // `os.js` reaches for `ERR_SYSTEM_ERROR.HideStackFramesError`. As with the
  // regular codes we cannot rewrite captured stacks, so it aliases the class.
  Object.defineProperty(NodeSystemError, 'HideStackFramesError', {
    value: NodeSystemError,
    configurable: true,
  });
  return NodeSystemError as unknown as new (ctx: Record<string, unknown>) => Error;
}

function createErrorsBindingContext(ctx: BuiltinInitContext): Record<string, unknown> {
  // `internal/errors` and `internal/util/inspect` form a load-time cycle; this
  // is the resolver `formatError` uses to reach the real `util.format`.
  resolveUtilInspect = () => ctx.require('internal/util/inspect') as UtilInspectModule;
  const codes: Record<string, unknown> = {};
  for (const code of Object.keys(ERROR_CODES)) {
    codes[code] = makeErrorClass(code);
  }
  // `SystemError`-based codes format their message from a *context*, not from
  // `%s` placeholders (`lib/internal/errors.js`'s `makeSystemErrorWithCode`):
  // `E(code, msg, SystemError)` for every `ERR_FS_CP_*`/`ERR_FS_EISDIR`/
  // `ERR_SYSTEM_ERROR`/`ERR_TTY_INIT_FAILED`. Building them through
  // `makeErrorClass` instead would leave `name` at 'Error' and the message at
  // the bare prefix, dropping the `: {syscall} returned {code} ({message})`
  // suffix the call sites rely on.
  for (const code of Object.keys(SYSTEM_ERROR_CODES)) {
    codes[code] = makeSystemErrorWithCode(code);
  }
  return {
    codes,
    SystemError,
    kIsNodeError,
    NodeError,
    // Node's AbortError keeps the DOMException-style name and message.
    AbortError: class AbortError extends Error {
      code = 'ABORT_ERR';
      name = 'AbortError';
      constructor(message: string = 'The operation was aborted') {
        super(message);
      }
    },
    // `hideStackFrames` wraps a validator and records the raw function on
    // `.withoutStackTrace`, the escape hatch `internal/fs/*` uses to validate
    // without paying the stack-hiding cost. We cannot rewrite captured stacks,
    // so the wrapper is transparent — but the property must exist.
    hideStackFrames: <T extends (...args: never[]) => unknown>(fn: T): T => {
      const wrapped = ((...args: never[]) => fn(...args)) as T & { withoutStackTrace?: T };
      wrapped.withoutStackTrace = fn;
      return wrapped as T;
    },
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
    // libuv's errno table (`src/uv.cc`'s `getErrorMap`): the same name/description
    // pairs the `uv` binding exposes, so `new UVException({...})` and
    // `util._errnoException` produce exact libuv-shaped messages.
    uvErrmapGet: (errno: number): [string, string] | undefined =>
      UV_ERRMAP.get(errno),
    /** The libuv-shaped error (lib/internal/errors.js). */
    UVException: class UVException extends Error {
      code: string;
      errno: number;
      syscall: string;
      path?: string;
      dest?: string;

      constructor(ctx: {
        errno: number;
        syscall: string;
        path?: string | Uint8Array;
        dest?: string | Uint8Array;
        message?: string;
        [key: string]: unknown;
      }) {
        const [code, uvmsg] = UV_ERRMAP.get(ctx.errno) ?? ['UNKNOWN', 'unknown error'];
        let message = `${code}: ${ctx.message || uvmsg}, ${ctx.syscall}`;
        let path: string | undefined;
        let dest: string | undefined;
        if (ctx.path) {
          path = ctx.path.toString();
          message += ` '${path}'`;
        }
        if (ctx.dest) {
          dest = ctx.dest.toString();
          message += ` -> '${dest}'`;
        }
        super(message);
        for (const prop of Object.keys(ctx)) {
          if (prop === 'message' || prop === 'path' || prop === 'dest') continue;
          (this as Record<string, unknown>)[prop] = ctx[prop];
        }
        this.name = 'Error';
        this.code = code;
        this.errno = ctx.errno;
        this.syscall = ctx.syscall;
        if (path) this.path = path;
        if (dest) this.dest = dest;
      }
    },
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
  init: (ctx) => createErrorsBindingContext(ctx),
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
  // The runtime always exposes the iterable streams API (`stream/iter`); a tab
  // has no flag surface, so report the flag as on. `internal/streams/readable`
  // checks it before installing `toAsyncStreamable`, and the classic↔iter
  // interop in `internal/streams/iter/classic` relies on that symbol.
  '--experimental-stream-iter': true,
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
  // `--experimental-vm-modules` gates `vm.SourceTextModule` and the
  // `importModuleDynamically` callback in `lib/internal/vm.js`. The runtime does
  // not ship the ESM vm bridge, so the flag is off (its absence would make
  // `getOptionValue` throw the moment a custom callback is passed).
  '--experimental-vm-modules': false,
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

// ---------------------------------------------------------------------------
// internal/buffer
// ---------------------------------------------------------------------------
//
// ⏬ This is now the real vendored file (`lib/internal/buffer.js`), running on
// the JS `buffer` binding (`bindings/buffer.ts`). `worker_threads` and the
// worker messaging surface read `markAsUntransferable`/`isMarkedAsUntransferable`
// from it. See the `internal/buffer` spec in `vendored-builtins.ts`.

// ---------------------------------------------------------------------------
// internal/blob
// ---------------------------------------------------------------------------
//
// ⏬ This is now the real vendored file (`lib/internal/blob.js`, plus
// `lib/internal/file.js` for `File`); they run on the JS `blob` binding
// (`bindings/blob.ts`).

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
// Node's `internal/url` is 1754 lines of WHATWG `URL`/`URLSearchParams` built on
// the native Ada parser (`internalBinding('url')`: `parse`/`update`/`canParse`/
// `domainToASCII`/...). Reproducing Ada in JS is out of scope, so this shim is a
// **bridge to the host's own spec-compliant classes** and reimplements only the
// file-URL / options helpers on top of them. The vendored `lib/url.js` (the real
// `url` module) is written against exactly this surface.
//
// The helpers deliberately mirror Node's own algorithms:
//   - `pathToFileURL` uses `src/node_url.cc`'s `EncodePathChars` table (the RFC
//     1738 "unsafe" set) and then hands the encoded string to the host parser.
//   - `fileURLToPath` follows `getPathFromURLPosix` (reject a non-empty
//     hostname and any `%2f`, then `decodeURIComponent` the pathname).
//   - `domainToASCII`/`domainToUnicode` lean on the host parser's UTS#46 host
//     normalization and the vendored `punycode` for the `xn--` decode.

export const internalUrlSpec: BuiltinSpec = {
  id: 'internal/url',
  origin: 'web-node',
  init: (ctx: BuiltinInitContext) => {
    const errors = ctx.require('internal/errors') as {
      codes: Record<string, new (...args: unknown[]) => Error>;
    };

    // `src/node_url.cc`'s lookup table: the ASCII code points `pathToFileURL`
    // percent-encodes. Everything above `~` is passed through untouched.
    const PATH_ENCODE: Record<number, string> = {
      0: '%00',
      9: '%09',
      10: '%0A',
      13: '%0D',
      32: '%20',
      34: '%22',
      35: '%23',
      37: '%25',
      63: '%3F',
      91: '%5B',
      92: '%5C',
      93: '%5D',
      94: '%5E',
      124: '%7C',
      126: '%7E',
    };

    const encodePathChars = (input: string): string => {
      let out = 'file://';
      for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        if (code > 126) {
          out += input[i];
          continue;
        }
        out += PATH_ENCODE[code] ?? input[i];
      }
      return out;
    };

    const isURL = (self: unknown): boolean => {
      const u = self as { href?: unknown; protocol?: unknown; auth?: unknown; path?: unknown } | null;
      return Boolean(u && u.href && u.protocol && u.auth === undefined && u.path === undefined);
    };
    const isURLInstance = (value: unknown): boolean =>
      typeof value === 'object' && value !== null && value instanceof URL;

    const fileURLToPath = (input: string | URL, options: { windows?: boolean } = {}): string => {
      let url: URL;
      if (typeof input === 'string') {
        url = new URL(input);
      } else if (isURL(input)) {
        url = input as URL;
      } else {
        throw new errors.codes.ERR_INVALID_ARG_TYPE('path', ['string', 'URL'], input);
      }
      if (url.protocol !== 'file:') {
        throw new errors.codes.ERR_INVALID_URL_SCHEME('file');
      }
      const windows = options?.windows ?? false;
      if (windows) {
        // Windows file URLs have no counterpart in the POSIX-shaped VFS; be loud.
        throw notImplemented('api', 'url.fileURLToPath({ windows: true })');
      }
      if (url.hostname !== '') {
        const platform = (ctx.require('process') as { platform: string }).platform;
        throw new errors.codes.ERR_INVALID_FILE_URL_HOST(platform);
      }
      const pathname = url.pathname;
      for (let n = 0; n < pathname.length; n++) {
        if (pathname[n] === '%') {
          const third = pathname.charCodeAt(n + 2) | 0x20;
          if (pathname[n + 1] === '2' && third === 102) {
            throw new errors.codes.ERR_INVALID_FILE_URL_PATH('must not include encoded / characters', url);
          }
        }
      }
      return pathname.includes('%') ? decodeURIComponent(pathname) : pathname;
    };

    const fileURLToPathBuffer = (input: string | URL, options: { windows?: boolean } = {}): unknown => {
      const { Buffer } = ctx.require('buffer') as { Buffer: { from(value: string): unknown } };
      return Buffer.from(fileURLToPath(input, options));
    };

    const pathToFileURL = (filepath: string, options: { windows?: boolean } = {}): URL => {
      if (options?.windows) {
        throw new errors.codes.ERR_INVALID_ARG_VALUE('path', filepath, 'Windows paths are unsupported');
      }
      const path = ctx.require('path') as { resolve(...parts: string[]): string };
      // Resolve relative paths against the runtime's own cwd (the VFS one), not
      // whatever `path.resolve` would fall back to.
      const cwd = (ctx.require('process') as { cwd(): string }).cwd();
      const resolved = path.resolve(cwd, filepath);
      // Node adds a trailing slash back that `path.resolve` stripped, when the
      // caller passed one.
      const endsWithSep = filepath.length > 1 && filepath[filepath.length - 1] === '/';
      const withSep =
        endsWithSep && resolved[resolved.length - 1] !== '/' ? `${resolved}/` : resolved;
      return new URL(encodePathChars(withSep));
    };

    const toPathIfFileURL = (fileURLOrPath: unknown): unknown =>
      isURL(fileURLOrPath) ? fileURLToPath(fileURLOrPath as URL) : fileURLOrPath;

    const urlToHttpOptions = (input: URL): Record<string, unknown> => {
      const { hostname, pathname, port, username, password, search } = input;
      const options: Record<string, unknown> = {
        __proto__: null,
        ...input,
        protocol: input.protocol,
        hostname: hostname && hostname[0] === '[' ? hostname.slice(1, -1) : hostname,
        hash: input.hash,
        search,
        pathname,
        path: `${pathname || ''}${search || ''}`,
        href: input.href,
      };
      if (port !== '') options.port = Number(port);
      if (username || password) options.auth = `${decodeURIComponent(username)}:${decodeURIComponent(password)}`;
      return options;
    };

    const domainToASCII = (domain: unknown): string => {
      const input = `${domain}`;
      if (input === '') return '';
      try {
        return new URL(`ws://${input}`).hostname;
      } catch {
        return '';
      }
    };
    const domainToUnicode = (domain: unknown): string => {
      const input = `${domain}`;
      const labels = input.split('.');
      let changed = false;
      const punycode = ctx.require('punycode') as { toUnicode(value: string): string };
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].startsWith('xn--')) {
          try {
            labels[i] = punycode.toUnicode(labels[i]);
            changed = true;
          } catch {
            /* keep the ASCII label */
          }
        }
      }
      return changed ? labels.join('.') : input;
    };

    // `internal/url.js`'s legacy-protocol sets (used by `lib/url.js`'s parser).
    const unsafeProtocol = new Set(['javascript', 'javascript:']);
    const hostlessProtocol = new Set(['javascript', 'javascript:']);
    const slashedProtocol = new Set([
      'http',
      'http:',
      'https',
      'https:',
      'ftp',
      'ftp:',
      'gopher',
      'gopher:',
      'file',
      'file:',
      'ws',
      'ws:',
      'wss',
      'wss:',
    ]);

    return {
      URL,
      URLSearchParams,
      URLPattern: (globalThis as { URLPattern?: unknown }).URLPattern,
      URLParse: (input: string, base?: string): string | null => {
        try {
          return new URL(input, base).href;
        } catch {
          return null;
        }
      },
      pathToFileURL,
      fileURLToPath,
      fileURLToPathBuffer,
      toPathIfFileURL,
      urlToHttpOptions,
      domainToASCII,
      domainToUnicode,
      isURL,
      isURLInstance,
      unsafeProtocol,
      hostlessProtocol,
      slashedProtocol,
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
// internal/fs/rimraf
// ---------------------------------------------------------------------------
//
// Node's own rimraf (`lib/internal/fs/rimraf.js`) drives the *callback* `fs`
// module with `Buffer` paths on the thread pool. A browser tab has neither the
// thread pool nor a callback-fs that takes Buffer paths, so the module is a
// thin VFS-native implementation with the same contract
// (`{ rimraf, rimrafPromises }`). `internal/fs/promises`'s `rm` only reaches for
// `rimrafPromises`, which it hands a validated path + options.

export const internalFsRimrafSpec: BuiltinSpec = {
  id: 'internal/fs/rimraf',
  origin: 'web-node',
  deps: ['fs', 'path'],
  init: (ctx: BuiltinInitContext) => {
    const fs = ctx.require('fs') as {
      lstatSync(path: string): { isDirectory(): boolean };
      readdirSync(path: string): string[];
      rmdirSync(path: string): void;
      unlinkSync(path: string): void;
    };
    const { join } = ctx.require('path') as { join(...parts: string[]): string };

    const rmTree = (path: string, recursive: boolean): void => {
      const stats = fs.lstatSync(path);
      if (!stats.isDirectory()) {
        fs.unlinkSync(path);
        return;
      }
      if (!recursive) {
        // Errors with `ENOTEMPTY` when the directory still has entries.
        fs.rmdirSync(path);
        return;
      }
      for (const name of fs.readdirSync(path)) {
        rmTree(join(path, name), true);
      }
      fs.rmdirSync(path);
    };

    const rimrafPromises = async (
      path: unknown,
      options: { recursive?: boolean; force?: boolean } = {},
    ): Promise<void> => {
      try {
        rmTree(String(path), !!options.recursive);
      } catch (err) {
        if (options.force && (err as { code?: string }).code === 'ENOENT') return;
        throw err;
      }
    };

    const rimraf = (
      path: unknown,
      options: { recursive?: boolean; force?: boolean },
      callback: (err: Error | null) => void,
    ): void => {
      rimrafPromises(path, options).then(
        () => callback(null),
        (err: Error) => callback(err),
      );
    };

    return { rimraf, rimrafPromises };
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
  init: () => {
    // `internal/blob.js` and `internal/webworker.js` decode bytes through a
    // shared decoder; the host realm has a real `TextDecoder`, so a plain memo
    // matches Node's `getUtf8Decoder` (a lazily-created singleton).
    let utf8Decoder: TextDecoder | undefined;
    return {
      TextEncoder,
      TextDecoder,
      getUtf8Decoder: (): TextDecoder => (utf8Decoder ??= new TextDecoder()),
      getEncodingFromLabel: (label: string): string | undefined => {
        try {
          return new TextDecoder(label).encoding;
        } catch {
          return undefined;
        }
      },
    };
  },
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

// ---------------------------------------------------------------------------
// internal/heap_utils
// ---------------------------------------------------------------------------
//
// The real module defines `HeapSnapshotStream` (a `Readable` fed by V8's heap
// walker) and `getHeapSnapshotOptions`. A page cannot walk its own heap, so the
// stream and `queryObjects` throw; the options normalizer is real, because
// `lib/v8.js` runs it before it ever reaches the native call.

/** V8's own validation and `Uint8Array([+exposeInternals, +exposeNumericValues])`. */
function getHeapSnapshotOptions(options: unknown = {}): Uint8Array {
  const { exposeInternals = false, exposeNumericValues = false } = (options ?? {}) as {
    exposeInternals?: unknown;
    exposeNumericValues?: unknown;
  };
  return new Uint8Array([Number(!!exposeInternals), Number(!!exposeNumericValues)]);
}

export const internalHeapUtilsSpec: BuiltinSpec = {
  id: 'internal/heap_utils',
  origin: 'web-node',
  init: () => ({
    getHeapSnapshotOptions,
    HeapSnapshotStream: class HeapSnapshotStream {
      constructor() {
        throw notImplemented(
          'api',
          'v8.getHeapSnapshot',
          'A heap snapshot needs V8\'s heap walker, which is not exposed to page JavaScript.',
        );
      }
    },
    queryObjects: (): never => {
      throw notImplemented(
        'api',
        'v8.queryObjects',
        'Enumerating a constructor\'s live objects needs V8\'s heap, which is not exposed to page JavaScript.',
      );
    },
  }),
};
