import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Differential test for `net` connection lifecycle + timeouts (M95).
 * `tools/net-lifecycle-probe.cjs` runs unchanged on real Node (oracle ->
 * test/fixtures/net-lifecycle.json) and inside web-node; the two JSON blobs
 * must be equal.
 */
describe('net lifecycle + timeout semantics (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/net-lifecycle-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/net-lifecycle.json', 'utf8'));

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
    for (let i = 0; i < 600 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, 'probe produced no observation line').toBeTruthy();
    const observed = JSON.parse(line!.slice('__OBS__'.length));
    expect(observed).toEqual(expected);
  }, 60000);
});
