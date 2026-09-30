import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs/memory';
import type { ReadSource } from '../src/node-runtime/vfs/persistence';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A minimal backing store: the file bodies the structure index leaves out. */
function readSourceOf(files: Record<string, string>): ReadSource {
  return {
    info: (path) => (files[path] === undefined ? null : { type: 'file', size: encoder.encode(files[path]).byteLength }),
    read: (path) => {
      if (files[path] === undefined) {
        const err = new Error(`ENOENT: ${path}`) as Error & { code?: string };
        err.code = 'ENOENT';
        throw err;
      }
      return encoder.encode(files[path]);
    },
    list: () => null,
  };
}

/**
 * The structure index a durable backend writes (M139): paths and sizes, no
 * bodies — the bytes stay in the mirror and are read back through the read
 * source. Emitted here from a real snapshot so the shape cannot drift.
 */
function structureIndex(vfs: MemoryVfs) {
  return vfs.snapshot({ dropColdBodies: true }).map((entry) =>
    entry.type === 'file'
      ? { path: entry.path, type: entry.type, mode: entry.mode, size: entry.size }
      : { path: entry.path, type: entry.type, mode: entry.mode },
  );
}

describe('cold restore reads through the backing store', () => {
  const buildTree = () => {
    const v = new MemoryVfs({ cwd: '/project' });
    v.mkdir('/project', { recursive: true });
    v.writeFile('/project/.demo-version', encoder.encode('4'));
    v.writeFile('/project/index.js', encoder.encode('console.log(1)'));
    return v;
  };

  it('a cold entry without a read source reads as empty (the M139 trap)', () => {
    const restored = MemoryVfs.fromSnapshot(structureIndex(buildTree()), { cwd: '/project', cold: true }, 'base64');
    // This is exactly the failure mode the worker hit: reading the marker
    // *before* the read source was wired returned '', so the reconciliation
    // thought the marker was absent and wiped the store on every boot.
    expect(decoder.decode(restored.readFile('/project/.demo-version'))).toBe('');
  });

  it('reads a cold body once the read source is installed', () => {
    const restored = MemoryVfs.fromSnapshot(structureIndex(buildTree()), { cwd: '/project', cold: true }, 'base64');
    restored.setReadSource(readSourceOf({ '/project/.demo-version': '4', '/project/index.js': 'console.log(1)' }));
    expect(decoder.decode(restored.readFile('/project/.demo-version'))).toBe('4');
    expect(decoder.decode(restored.readFile('/project/index.js'))).toBe('console.log(1)');
  });

  it('a cold body the store does not hold surfaces as ENOENT', () => {
    const restored = MemoryVfs.fromSnapshot(structureIndex(buildTree()), { cwd: '/project', cold: true }, 'base64');
    restored.setReadSource(readSourceOf({ '/project/index.js': 'x' }));
    expect(() => restored.readFile('/project/.demo-version')).toThrowError(/ENOENT/);
  });
});
