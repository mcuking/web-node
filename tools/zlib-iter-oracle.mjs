// Generates test/fixtures/zlib-iter.json by running the shared observation
// program (tools/zlib-iter-probe.cjs) on a real Node oracle.
//
// The same program runs inside web-node in test/zlib-iter.test.ts; the two JSON
// blobs must be equal. `zlib/iter` is gated behind `--experimental-stream-iter`
// upstream; web-node always exposes it, so only the oracle needs the flag.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const stdout = execFileSync(
  process.execPath,
  ['--experimental-stream-iter', join(here, 'zlib-iter-probe.cjs')],
  { cwd: root, encoding: 'utf8' },
);
const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
if (!line) throw new Error('probe produced no observation line');
const data = line.slice('__OBS__'.length);
writeFileSync(join(root, 'test/fixtures/zlib-iter.json'), JSON.stringify(JSON.parse(data), null, 2) + '\n');
console.log('wrote test/fixtures/zlib-iter.json');
