import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { decodeBase64, encodeBase64 } from '../src/node-runtime/vfs/base64';
import type { ReadSource } from '../src/node-runtime/vfs/persistence';

/**
 * Snapshotting a tree that was partly hydrated from backing storage (M120).
 *
 * A *cold* entry is one the read source confirmed but nobody has read this
 * session: it carries a size, not bytes. If `snapshot()` encoded it as-is the
 * payload would be empty, and the persistence layer's mirror write
 * (`createSyncAccessHandle` → `truncate(0)` → `write`) would overwrite the real
 * file on disk with **zero bytes**. Only files a session never touches are at
 * risk, so the corruption is silent and looks random. The snapshot has to pull
 * the bytes in first.
 */

function store(files: Record<string, Uint8Array>): ReadSource {
  return {
    info: (path) => {
      if (path in files) return { type: 'file', size: files[path].length };
      const prefix = path === '/' ? '/' : path + '/';
      const isDir = Object.keys(files).some((f) => f.startsWith(prefix));
      return isDir ? { type: 'dir', size: 0 } : null;
    },
    read: (path) => {
      const data = files[path];
      if (!data) throw new Error(`no such file: ${path}`);
      return data;
    },
    list: () => null,
  };
}

describe('MemoryVfs.snapshot with cold (un-hydrated) entries', () => {
  it('materialises a cold file instead of snapshotting it as empty', () => {
    const bytes = new TextEncoder().encode('the real contents, not nothing');
    const vfs = new MemoryVfs({ cwd: '/' });
    vfs.setReadSource(store({ '/big.txt': bytes }));

    // `stat` hydrates the entry cold: size is known, bytes are not.
    expect(vfs.stat('/big.txt').size).toBe(bytes.length);

    const snap = vfs.snapshot();
    const entry = snap.find((e) => e.path === '/big.txt');
    expect(entry, 'the file must still be in the snapshot').toBeDefined();
    expect(entry!.data).toBe(encodeBase64(bytes));
    expect(decodeBase64(entry!.data!)).toEqual(bytes);
    expect(entry!.data).not.toBe('');
  });

  it('materialises a cold directory and its cold children', () => {
    const a = new TextEncoder().encode('A');
    const b = new TextEncoder().encode('BB');
    const source: ReadSource = {
      info: (path) =>
        path === '/d' || path === '/d/a.txt' || path === '/d/b.txt'
          ? path === '/d'
            ? { type: 'dir', size: 0 }
            : { type: 'file', size: (path === '/d/a.txt' ? a : b).length }
          : null,
      read: (path) => (path === '/d/a.txt' ? a : b),
      list: (path) =>
        path === '/d'
          ? [
              { name: 'a.txt', type: 'file', size: a.length },
              { name: 'b.txt', type: 'file', size: b.length },
            ]
          : null,
    };
    const vfs = new MemoryVfs({ cwd: '/' });
    vfs.setReadSource(source);

    // Hydrate the directory cold (its children are not even known yet).
    expect(vfs.readdir('/d').map((d) => d.name)).toEqual(['a.txt', 'b.txt']);

    const snap = vfs.snapshot();
    const found = Object.fromEntries(snap.filter((e) => e.type === 'file').map((e) => [e.path, e.data]));
    expect(found['/d/a.txt']).toBe(encodeBase64(a));
    expect(found['/d/b.txt']).toBe(encodeBase64(b));
  });

  it('drops a cold entry whose bytes are gone, rather than writing an empty file', () => {
    const vfs = new MemoryVfs({ cwd: '/' });
    vfs.setReadSource({
      info: () => ({ type: 'file', size: 5 }),
      read: () => {
        throw new Error('ENOENT');
      },
      list: () => null,
    });
    vfs.stat('/gone.txt');
    const snap = vfs.snapshot();
    expect(snap.find((e) => e.path === '/gone.txt')).toBeUndefined();
  });

  it('still snapshots a genuinely empty file as empty', () => {
    const vfs = new MemoryVfs({ cwd: '/' });
    vfs.writeFile('/empty.txt', new Uint8Array(0));
    const snap = vfs.snapshot();
    expect(snap.find((e) => e.path === '/empty.txt')!.data).toBe('');
  });
});
