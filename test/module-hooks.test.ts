import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Differential test for `module` semantics — same pattern as
 * test/fs-errors.test.ts. `tools/module-hooks-probe.cjs` runs unchanged on real
 * Node (oracle -> test/fixtures/module-hooks.json via
 * tools/module-hooks-oracle.mjs) and inside web-node; the two JSON blobs must be
 * equal.
 *
 * It pins the synchronous loader hooks (`registerHooks`: deferred chains,
 * short-circuit resolve/load, the `shortCircuit` contract, `deregister`),
 * source-map registration + `findSourceMap`/`setSourceMapsSupport`,
 * `findPackageJSON`, and the loader-backed `Module._*` internals.
 */
describe('module hooks (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/module-hooks-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/module-hooks.json', 'utf8'));

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
    expect(line, `probe produced no observable line; stderr=${err.join('').slice(0, 500)}`).toBeTruthy();
    expect(JSON.parse(line!.slice('__OBS__'.length))).toEqual(expected);
  });
});
