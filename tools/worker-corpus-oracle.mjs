#!/usr/bin/env node
/**
 * Regenerates `test/fixtures/worker-corpus.json`: the answers a *real* Node
 * gives for every entry in `test/fixtures/worker-corpus.mjs` — a real thread per
 * worker.
 *
 * Run it with the oracle build so the expectations track the semantics the
 * runtime emulates:
 *
 *   export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v26.9.0/installation/bin:$PATH"
 *   node tools/worker-corpus-oracle.mjs
 *
 * `test/worker-corpus.test.ts` replays the same list through the web-node
 * runtime (its cooperative worker) and fails on any difference.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runWorkerCorpus, WORKER_FILES } from '../test/fixtures/worker-corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const dir = mkdtempSync(join(tmpdir(), 'web-node-worker-corpus-'));
try {
  for (const [name, contents] of Object.entries(WORKER_FILES)) {
    writeFileSync(join(dir, name), contents);
  }
  const out = {
    generatedBy: `node ${process.version}`,
    results: await runWorkerCorpus(require('node:worker_threads'), {
      pathFor: (name) => join(dir, name),
    }),
  };
  writeFileSync(
    join(here, '..', 'test', 'fixtures', 'worker-corpus.json'),
    `${JSON.stringify(out, null, 2)}\n`,
  );
  console.log(`wrote ${Object.keys(out.results).length} worker entries`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
