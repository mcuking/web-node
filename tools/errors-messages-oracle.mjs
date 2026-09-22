// Oracle for the `internal/errors` message-text differential test.
//
// Runs under a real Node (`node --expose-internals tools/errors-messages-oracle.mjs`)
// and records the *raw message template* each code declares. `getMessage(code, [])`
// returns the stored template only when it is a plain string with no `%s`
// placeholders (`lib/internal/errors.js` asserts the argument count, and returns
// the template unformatted for zero args). Codes whose message is a function, or
// a string with placeholders, are skipped — the shim builds those with
// `CUSTOM_FORMATTERS`, so their text is not stored verbatim.
//
// `test/errors-messages.test.ts` compares the recorded templates against
// web-node's `ERROR_CODES`, catching drift such as a copy-paste swap between two
// sibling codes.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { codes, getMessage } = require('internal/errors');

const messages = {};
for (const code of Object.keys(codes)) {
  let zero;
  try {
    zero = getMessage(code, [], null);
  } catch {
    continue; // has placeholders / requires args
  }
  if (typeof zero !== 'string') continue;
  let withArg;
  try {
    withArg = getMessage(code, ['x'], null);
  } catch {
    withArg = undefined; // took no argument: a placeholder-free string template
  }
  if (withArg !== undefined) continue; // an arity-0 function message
  messages[code] = zero;
}

writeFileSync(
  new URL('../test/fixtures/errors-messages.json', import.meta.url),
  JSON.stringify(messages, null, 2) + '\n',
);
console.log(JSON.stringify(messages, null, 2));
