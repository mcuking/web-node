import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * M90.9: the `crypto.getHashes()` surface must match real Node exactly, and
 * every name it lists must be computable. The fixture is recorded from a real
 * Node (tools/crypto-gets-hashes-oracle.mjs); we deliberately compare against
 * that list rather than our own, so a name we forget to register shows up as a
 * missing entry instead of being invisible.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('crypto') as any;
}

describe('crypto.getHashes parity', () => {
  const fixture = JSON.parse(fs.readFileSync('test/fixtures/crypto-gets-hashes.json', 'utf8')) as {
    hashes: string[];
    digests: Record<string, string>;
  };

  it('lists exactly the same names as real Node', () => {
    const crypto = boot();
    const ours = crypto.getHashes();
    const expected = [...fixture.hashes].sort();
    expect(ours).toEqual(expected);
    expect(ours).toEqual([...ours].sort());
  });

  it('computes every listed name identically to real Node', () => {
    const crypto = boot();
    for (const name of fixture.hashes) {
      const digest = crypto.createHash(name).update('abc').digest('hex');
      expect(digest, name).toBe(fixture.digests[name]);
    }
  });
});
