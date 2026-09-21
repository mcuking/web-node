#!/usr/bin/env node
/**
 * Regenerates `test/fixtures/v8-corpus.json`: the expected `v8.serialize` bytes
 * for every entry in `test/fixtures/v8-corpus.mjs`, produced by a *real* Node.
 *
 * Run it with the oracle build so the expectations track the semantics the
 * vendored sources were taken from:
 *
 *   export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v26.9.0/installation/bin:$PATH"
 *   node tools/v8-corpus-oracle.mjs
 *
 * `test/v8-corpus.test.ts` replays the same list through the web-node runtime
 * and fails on any byte difference.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { corpus } from '../test/fixtures/v8-corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const entries = {};
for (const [name, value] of corpus()) {
  if (Object.hasOwn(entries, name)) throw new Error(`duplicate corpus name: ${name}`);
  entries[name] = v8.serialize(value).toString('hex');
}

const out = {
  generatedBy: `node ${process.version} (v8 ${process.versions.v8})`,
  wireFormatVersion: 15,
  entries,
};
writeFileSync(join(here, '..', 'test', 'fixtures', 'v8-corpus.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${Object.keys(entries).length} entries`);
