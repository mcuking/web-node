// Generates test/fixtures/crypto-argon2.json from the shared observation
// program (tools/crypto-argon2-probe.cjs) on a real Node oracle.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const stdout = execFileSync(process.execPath, [join(here, 'crypto-argon2-probe.cjs')], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
if (!line) throw new Error('probe produced no observation line');
writeFileSync(
  join(root, 'test/fixtures/crypto-argon2.json'),
  JSON.stringify(JSON.parse(line.slice('__OBS__'.length)), null, 2) + '\n',
);
console.log('wrote test/fixtures/crypto-argon2.json');
