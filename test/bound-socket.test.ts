import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Differential test for `net.BoundSocket` (M102).
 * `tools/bound-socket-probe.cjs` runs unchanged on real Node (oracle ->
 * test/fixtures/bound-socket.json) and inside web-node; the two JSON blobs must
 * be equal.
 */
describe('net.BoundSocket (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', () => {
    const program = fs.readFileSync('tools/bound-socket-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/bound-socket.json', 'utf8'));

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

  it('fd() reports -1 (documented deviation: no OS file descriptor)', () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile(
      '/project/index.js',
      new TextEncoder().encode(
        [
          "const net = require('node:net');",
          "const b = new net.BoundSocket({ port: 0, host: '127.0.0.1' });",
          "console.log('FD', b.fd());",
          'b.close();',
        ].join('\n'),
      ),
    );
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: () => {},
    });
    runtime.runMain('/project/index.js');
    expect(out.join('')).toContain('FD -1');
  });
});
