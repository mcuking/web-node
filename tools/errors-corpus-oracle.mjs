// Oracle for the `internal/errors` code-table differential test.
//
// Runs under a real Node (`node --expose-internals tools/errors-corpus-oracle.mjs`)
// and records how each code builds its error: the class `name`, the `code`, the
// formatted `message`, which built-in bases the instance matches, and any extra
// own properties. `test/errors-corpus.test.ts` replays the same calls through
// web-node's `internal/errors` shim and compares field by field.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { codes } = require('internal/errors');

// [code, args] — args chosen to match how the real call sites invoke them.
const CASES = [
  ['ERR_ACCESS_DENIED', ['Access to this API has been restricted', 'FileSystemRead', '/etc/shadow']],
  ['ERR_ARG_NOT_ITERABLE', ['foo']],
  ['ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', ['windowsHandle']],
  ['ERR_FS_WATCH_QUEUE_OVERFLOW', [16]],
  ['ERR_INVALID_RETURN_VALUE', ['instance of Promise', 'pipeline', { a: 1 }]],
  ['ERR_INVALID_RETURN_VALUE', ['a Buffer', 'transform', 'nope']],
  ['ERR_NO_TEMPORAL', []],
  ['ERR_PERFORMANCE_INVALID_TIMESTAMP', [5]],
  ['ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS', ['Option start must be a number']],
  ['ERR_USE_AFTER_CLOSE', ['readline']],
  // `E(code, msg, SystemError)` codes format from a *context* object and carry
  // `name: 'SystemError'`. `ERR_FS_CP_*` are thrown by the vendored `fs.cpSync`
  // path; `ERR_SYSTEM_ERROR` by `os.getPriority`/`os.setPriority`.
  ['ERR_FS_CP_EINVAL', [{ message: 'src and dest cannot be the same', path: '/a', dest: '/b', syscall: 'cp', code: 'EINVAL' }]],
  [
    'ERR_FS_CP_EEXIST',
    [{ message: 'dest already exists: /b', path: '/a', dest: '/b', syscall: 'cp', code: 'EEXIST' }],
  ],
  [
    'ERR_FS_CP_DIR_TO_NON_DIR',
    [{ message: 'cannot overwrite non-directory /b with directory /a', path: '/b', syscall: 'cp', code: 'EISDIR' }],
  ],
  [
    'ERR_FS_CP_NON_DIR_TO_DIR',
    [{ message: 'cannot overwrite directory /b with non-directory /a', path: '/b', syscall: 'cp', code: 'ENOTDIR' }],
  ],
  ['ERR_FS_CP_FIFO_PIPE', [{ message: 'cannot copy a FIFO pipe', path: '/a', syscall: 'cp', code: 'EINVAL' }]],
  ['ERR_FS_CP_SOCKET', [{ message: 'cannot copy a socket file: /b', path: '/a', syscall: 'cp', code: 'EINVAL' }]],
  [
    'ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY',
    [{ message: 'cannot overwrite /a with /b', path: '/b', syscall: 'cp', code: 'EINVAL' }],
  ],
  ['ERR_FS_CP_UNKNOWN', [{ message: 'cannot copy an unknown file type', path: '/a', syscall: 'cp', code: 'EINVAL' }]],
  ['ERR_FS_EISDIR', [{ message: 'is a directory: /a', path: '/a', syscall: 'cp', code: 'EISDIR' }]],
  [
    'ERR_SYSTEM_ERROR',
    [{ syscall: 'stat', code: 'ENOENT', message: 'no such file or directory', errno: -2, path: '/x' }],
  ],
  ['ERR_TTY_INIT_FAILED', [{ syscall: 'uv_tty_init', code: 'ENOTTY', message: 'inappropriate ioctl', errno: -25 }]],

  // Codes whose Node message is a *function* (not a `%s` template). These are
  // the ones a naive `%s` substitution gets wrong, so they are exercised with
  // argument vectors mirroring real call sites. `ERR_INVALID_ARG_TYPE` and a
  // few others already had formatters; the rest pin the ones added in M62.
  ['ERR_INVALID_ARG_TYPE', ['foo', 'string', 42]],
  ['ERR_INVALID_ARG_TYPE', ['opts', ['string', 'number'], true]],
  ['ERR_INVALID_ARG_VALUE', ['options.highWaterMark', -1]],
  ['ERR_INVALID_ARG_VALUE', ['name', 'x', 'must be a string']],
  ['ERR_UNHANDLED_ERROR', ['boom']],
  ['ERR_UNHANDLED_ERROR', []],
  ['ERR_BUFFER_OUT_OF_BOUNDS', ['offset']],
  ['ERR_BUFFER_OUT_OF_BOUNDS', []],
  ['ERR_INVALID_URL', ['http://[', 'http://base/']],
  ['ERR_INVALID_URL_SCHEME', ['file']],
  ['ERR_INVALID_URL_SCHEME', [['file', 'http']]],
  ['ERR_INVALID_FILE_URL_PATH', ['must not include encoded / characters', 'file:///a%2Fb']],
  ['ERR_OUT_OF_RANGE', ['len', '>= 0 && <= 100', 420]],
  ['ERR_OUT_OF_RANGE', ['hint', '> 0', 'nope']],
  ['ERR_MISSING_ARGS', ['a']],
  ['ERR_MISSING_ARGS', ['a', 'b']],
  ['ERR_MISSING_ARGS', [['a', 'b'], 'c']],
  ['ERR_MODULE_NOT_FOUND', ['x', '/base', false]],
  ['ERR_MODULE_NOT_FOUND', ['x', '/base', true]],
  ['ERR_UNSUPPORTED_ESM_URL_SCHEME', [{ protocol: 'ftp:' }, ['file', 'data']]],
  ['ERR_INTERNAL_ASSERTION', ['something failed']],
  ['ERR_SOCKET_BAD_PORT', ['port', 70000]],
  ['ERR_SOCKET_BAD_PORT', ['port', 0, false]],
  ['ERR_FALSY_VALUE_REJECTION', ['falsy']],
  ['ERR_INVALID_MIME_SYNTAX', ['script', 'x y', 1]],
  ['ERR_INVALID_MIME_SYNTAX', ['script', 'x y', -1]],
  ['ERR_PARSE_ARGS_UNKNOWN_OPTION', ['--foo', true]],
  ['ERR_PARSE_ARGS_UNKNOWN_OPTION', ['--foo', false]],
  ['ERR_WORKER_PATH', ['./relative/x.js']],
  ['ERR_WORKER_PATH', ['file:///x.js']],
  ['ERR_WORKER_INVALID_EXEC_ARGV', [['--a', '--b'], 'invalid execArgv flags']],
];

const describe = (code, args) => {
  const C = codes[code];
  if (typeof C !== 'function') return { code, built: false };
  let err;
  try {
    err = new C(...args);
  } catch (e) {
    return { code, args, threw: `${e.name}: ${e.message}` };
  }
  return {
    code,
    args,
    name: err.name,
    errorCode: err.code,
    message: err.message,
    isError: err instanceof Error,
    isTypeError: err instanceof TypeError,
    isRangeError: err instanceof RangeError,
    isSyntaxError: err instanceof SyntaxError,
    permutation: typeof C.TypeError === 'function',
    permutationNames: ['TypeError', 'RangeError', 'Error', 'TypeError'].filter((k) => typeof C[k] === 'function'),
    props: Object.fromEntries(
      Object.keys(err)
        .filter((k) => k !== 'code')
        .map((k) => [k, err[k]]),
    ),
    // The extra `E(code, msg, Base, ...Extra)` variants Node exposes as statics.
    extra: ['TypeError', 'RangeError'].reduce((acc, k) => {
      if (typeof C[k] === 'function') {
        const e = new C[k](...args);
        acc[k] = { name: e.name, code: e.code, message: e.message };
      }
      return acc;
    }, {}),
  };
};

const out = CASES.map(([code, args]) => describe(code, args));
writeFileSync(new URL('../test/fixtures/errors-corpus.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
