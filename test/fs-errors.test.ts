import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Differential test for `fs` *error shapes* — same pattern as
 * test/fs-semantics.test.ts. `tools/fs-errors-probe.cjs` runs unchanged on real
 * Node (oracle -> test/fixtures/fs-errors.json via tools/fs-errors-oracle.mjs)
 * and inside web-node; the two JSON blobs must be equal.
 *
 * It pins the tuple Node's own errors expose for every failing fs path:
 * `code`, `syscall`, `errno`, `path`, `dest`, `message`, `name`, plus the error
 * object's own property set and constructor name (`Error` for `UVException`,
 * `SystemError` for `E(code, msg, SystemError)` entries such as `ERR_FS_EISDIR`).
 */
describe('fs error shapes (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/fs-errors-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/fs-errors.json', 'utf8'));

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
