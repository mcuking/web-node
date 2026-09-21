#!/usr/bin/env node
/**
 * Regenerates `test/fixtures/vm-corpus.json`: the answers a *real* Node gives
 * for every entry in `test/fixtures/vm-corpus.mjs`.
 *
 * Run it with the oracle build so the expectations track the semantics the
 * vendored sources were taken from:
 *
 *   export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v26.9.0/installation/bin:$PATH"
 *   node tools/vm-corpus-oracle.mjs
 *
 * `test/vm-corpus.test.ts` replays the same list through the web-node runtime
 * and fails on any difference.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runVmCorpus } from '../test/fixtures/vm-corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const out = {
  generatedBy: `node ${process.version}`,
  results: runVmCorpus(require('node:vm')),
};

writeFileSync(
  join(here, '..', 'test', 'fixtures', 'vm-corpus.json'),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(`wrote ${Object.keys(out.results).length} vm entries`);
