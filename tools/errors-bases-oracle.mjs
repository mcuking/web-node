// Oracle for the `internal/errors` *variant-base* differential test.
//
// `E(code, msg, Base, ...Extra)` attaches each extra base as a static on the
// generated class (e.g. `ERR_INVALID_ARG_VALUE.RangeError`). Call sites reach
// for those statics (`new ERR_INVALID_ARG_VALUE.RangeError(...)`), so a missing
// one is a latent "is not a constructor" crash — the same class of bug M58
// hunted for undefined message codes. This dumps, for every code Node defines,
// which of the four permutation bases it exposes.
//
//   node --expose-internals tools/errors-bases-oracle.mjs

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { codes } = require('internal/errors');

const PERMUTATIONS = ['TypeError', 'RangeError', 'SyntaxError', 'Error'];

const out = {};
for (const code of Object.keys(codes)) {
  const C = codes[code];
  if (typeof C !== 'function') continue;
  const bases = PERMUTATIONS.filter((k) => typeof C[k] === 'function');
  out[code] = bases;
}

writeFileSync(
  new URL('../test/fixtures/errors-bases.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(JSON.stringify(out, null, 2));
