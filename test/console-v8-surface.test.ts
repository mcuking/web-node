import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Surface differential for `console` + `v8` (M105): the probe runs unchanged on
 * real Node (oracle -> test/fixtures/console-v8-surface.json) and in web-node.
 */
describe('console + v8 surface (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', () => {
    const program = fs.readFileSync('tools/console-v8-surface-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/console-v8-surface.json', 'utf8'));
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
    const line = out.join('').split('\n').find((l) => l.startsWith('__OBS__ '));
    expect(line, 'probe did not emit __OBS__').toBeTruthy();
    expect(JSON.parse(line!.slice('__OBS__ '.length))).toEqual(expected);
  });
});
