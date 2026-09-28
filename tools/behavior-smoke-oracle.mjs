// Generates test/fixtures/behavior-smoke.json (M124) by running the shared
// behavioural smoke probe (tools/behavior-smoke-probe.cjs) on a real Node
// oracle. The same program runs inside web-node in
// test/behavior-smoke.test.ts; the JSON must match, barring documented
// deviations.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const stdout = execFileSync(process.execPath, [join(here, 'behavior-smoke-probe.cjs')], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
if (!line) throw new Error('probe produced no observation line');
const data = JSON.parse(line.slice('__OBS__'.length));
writeFileSync(join(root, 'test/fixtures/behavior-smoke.json'), JSON.stringify(data, null, 2) + '\n');
console.log('wrote test/fixtures/behavior-smoke.json (' + Object.keys(data).length + ' observations)');
