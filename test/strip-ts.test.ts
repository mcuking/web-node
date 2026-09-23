import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Differential test for `module.stripTypeScriptTypes` (strip-only) — same
 * pattern as test/module-hooks.test.ts. `tools/strip-ts-probe.cjs` runs
 * unchanged on real Node (oracle -> test/fixtures/strip-ts.json) and inside
 * web-node; the two JSON blobs must be equal byte-for-byte.
 *
 * The corpus pins: type annotations / `as` / `satisfies` / non-null `!` /
 * modifier erasure (position-preserving blanking), type-only declarations,
 * generic parameters and arguments, the `<` disambiguation (comparison vs type
 * arguments), arrow parameters, and the option/argument validation surface.
 */
describe('stripTypeScriptTypes (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/strip-ts-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/strip-ts.json', 'utf8'));

    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
    const out: string[] = [];
    const err: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: (c) => err.push(c),
    });
    runtime.runMain('/project/index.js');

    let stdout = out.join('');
    for (let i = 0; i < 200 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, `probe produced no observable line; stderr=${err.join('').slice(0, 800)}`).toBeTruthy();
    const actual = JSON.parse(line!.slice('__OBS__'.length));

    // Report the first differing case with a readable diff before failing.
    const exp = expected.results as Array<{ id: string }>;
    const act = actual.results as Array<{ id: string }>;
    expect(act.length).toBe(exp.length);
    for (let i = 0; i < exp.length; i++) {
      expect(act[i], `case ${exp[i].id}`).toEqual(exp[i]);
    }
  });
});
