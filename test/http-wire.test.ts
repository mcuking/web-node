import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Differential test for `http`/`https` wire-level semantics — same pattern as
 * test/fs-errors.test.ts. `tools/http-wire-probe.cjs` runs unchanged on real
 * Node (oracle -> test/fixtures/http-wire.json via tools/http-wire-oracle.mjs)
 * and inside web-node; the two JSON blobs must be equal.
 *
 * A single runtime hosts both the server and the client (over the virtual
 * network). It pins request/response framing end-to-end: Content-Length vs
 * chunked, trailers, HEAD (headers without a body), 204, custom/removed headers,
 * status text, keep-alive reuse, and a full https pass. Ephemeral ports and the
 * volatile Date header are normalised out.
 */
describe('http wire differential (vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/http-wire-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/http-wire.json', 'utf8'));

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
    for (let i = 0; i < 400 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, `probe produced no observable line; stderr=${err.join('').slice(0, 500)}`).toBeTruthy();
    expect(JSON.parse(line!.slice('__OBS__'.length))).toEqual(expected);
  }, 30000);
});
