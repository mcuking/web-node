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
