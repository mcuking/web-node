#!/usr/bin/env node
/**
 * Regenerates `test/fixtures/tty-corpus.json`: the expected `getColorDepth` /
 * `hasColors` answers for every entry in `test/fixtures/tty-corpus.mjs`,
 * produced by a *real* Node.
 *
 * Run it with the oracle build so the expectations track the semantics the
 * vendored sources were taken from:
 *
 *   export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v26.9.0/installation/bin:$PATH"
 *   node tools/tty-corpus-oracle.mjs
 *
 * `test/tty-corpus.test.ts` replays the same list through the web-node runtime
 * and fails on any difference.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tty from 'node:tty';
import { colorDepthCases, hasColorsCases } from '../test/fixtures/tty-corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// `WriteStream.prototype.getColorDepth`/`hasColors` are the real
// `internal/tty` functions; going through the prototype reaches them without
// needing a terminal (which a CI machine does not have).
const { getColorDepth, hasColors } = tty.WriteStream.prototype;

const depth = {};
for (const [name, env] of colorDepthCases()) {
  if (Object.hasOwn(depth, name)) throw new Error(`duplicate corpus name: ${name}`);
  depth[name] = getColorDepth(env);
}

const colors = {};
for (const [name, args] of hasColorsCases()) {
  if (Object.hasOwn(colors, name)) throw new Error(`duplicate corpus name: ${name}`);
  colors[name] = hasColors(...args);
}

const out = {
  generatedBy: `node ${process.version}`,
  getColorDepth: depth,
  hasColors: colors,
};
writeFileSync(join(here, '..', 'test', 'fixtures', 'tty-corpus.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${Object.keys(depth).length} depth + ${Object.keys(colors).length} hasColors entries`);
