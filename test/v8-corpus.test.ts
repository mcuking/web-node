import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { corpus } from './fixtures/v8-corpus.mjs';
import expected from './fixtures/v8-corpus.json';

/**
 * Byte-for-byte parity for `v8.serialize` across the whole corpus.
 *
 * `test/fixtures/v8-corpus.json` is written by `tools/v8-corpus-oracle.mjs`
 * running a real Node (oracle fnm v26.9.0) over `fixtures/v8-corpus.mjs`. This
 * test replays the identical list through the web-node runtime, so a
 * regression in the `serdes` binding — a wrong tag, a missed padding byte, a
 * mis-encoded varint — shows up as a byte difference rather than a passing
 * round-trip.
 */
function runtimes(): { serialize: (value: unknown) => Uint8Array } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('v8') as { serialize: (value: unknown) => Uint8Array };
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('v8.serialize matches a real Node byte for byte', () => {
  const entries = expected.entries as Record<string, string>;

  it('has an expectation for every corpus entry, and vice versa', () => {
    const names = (corpus() as [string, unknown][]).map(([name]) => name);
    expect(names.length).toBeGreaterThan(100);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(Object.keys(entries).sort());
  });

  it('produces the recorded bytes for each entry', () => {
    const { serialize } = runtimes();
    const mismatches: string[] = [];
    for (const [name, value] of corpus() as [string, unknown][]) {
      const actual = hex(serialize(value));
      if (actual !== entries[name]) {
        mismatches.push(`${name}\n  expected ${entries[name]}\n  actual   ${actual}`);
      }
    }
    expect(mismatches.join('\n')).toBe('');
  });

  it('round-trips every entry back to an equivalent value', () => {
    const { serialize, deserialize } = runtimes() as unknown as {
      serialize: (value: unknown) => Uint8Array;
      deserialize: (bytes: Uint8Array) => unknown;
    };
    for (const [name, value] of corpus() as [string, unknown][]) {
      const restored = deserialize(serialize(value));
      // Structural sanity: the same serialize output must appear again, which
      // is the strongest engine-independent statement we can make here.
      expect(hex(serialize(restored)), name).toBe(entries[name]);
    }
  });
});
