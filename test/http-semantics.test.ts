import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Differential test for `http`/`net` semantics.
 *
 * `tools/http-semantics-probe.cjs` is a single observation program that only
 * touches the public API. It is run on a real Node oracle (via
 * `tools/http-semantics-oracle.mjs`) to produce `test/fixtures/http-semantics.json`,
 * and here it runs unchanged inside web-node. The two JSON blobs must be equal
 * — that is the entire contract: same inputs, same observable outputs.
 */
describe('http semantics (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/http-semantics-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/http-semantics.json', 'utf8'));

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

    // The program's async half (server + client) settles on the host's timers.
    let stdout = out.join('');
    for (let i = 0; i < 200 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, 'probe produced no observation line').toBeTruthy();
    const actual = JSON.parse(line!.slice('__OBS__'.length));

    expect(actual).toEqual(expected);
  });
});
