import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * M91: `crypto.encapsulate` / `crypto.decapsulate` and the `ml-kem-*` key
 * types. `tools/crypto-kem-probe.cjs` runs unchanged on real Node and inside
 * web-node; the observation must match `test/fixtures/crypto-kem.json`
 * (recorded via `tools/crypto-kem-oracle.mjs`).
 */
async function runProbe(program: string): Promise<Record<string, unknown>> {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: () => {},
  });
  runtime.runMain('/project/index.js');

  let stdout = out.join('');
  for (let i = 0; i < 800 && !stdout.includes('__OBS__'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    stdout = out.join('');
  }
  const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
  expect(line, 'probe produced no observation line').toBeTruthy();
  return JSON.parse(line!.slice('__OBS__'.length)) as Record<string, unknown>;
}

describe('crypto.encapsulate/decapsulate (differential vs real Node)', () => {
  it('matches the oracle exactly', async () => {
    const program = fs.readFileSync('tools/crypto-kem-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-kem.json', 'utf8'));
    const observed = await runProbe(program);
    expect(observed).toEqual(expected);
  }, 120000);
});
