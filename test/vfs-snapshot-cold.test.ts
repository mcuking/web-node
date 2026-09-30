import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
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
    // Bodies travel as raw bytes now (no base64 in-flight), and a cold entry is
    // still materialised rather than emitted empty.
    expect(entry!.data).toEqual(bytes);
    expect(entry!.data!.byteLength).toBeGreaterThan(0);
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
    expect(found['/d/a.txt']).toEqual(a);
    expect(found['/d/b.txt']).toEqual(b);
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
    expect(snap.find((e) => e.path === '/empty.txt')!.data).toEqual(new Uint8Array(0));
  });
});

describe('MemoryVfs.evictBodies', () => {
  it('drops bodies under a prefix, keeps the names, and re-reads from the store', () => {
    const bytes = new TextEncoder().encode('payload');
    let reads = 0;
    const source: ReadSource = {
      info: (path) =>
        path === '/project/app/a.txt'
          ? { type: 'file', size: bytes.length }
          : path === '/project' || path === '/project/app' || path === '/'
            ? { type: 'dir', size: 0 }
            : null,
      read: (path) => {
        reads++;
        if (path === '/project/app/a.txt') return bytes;
        throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
      },
      list: () => null,
    };
    const vfs = new MemoryVfs({ cwd: '/' });
    vfs.setReadSource(source);
    expect(vfs.readFile('/project/app/a.txt')).toEqual(bytes); // hydrate resident
    expect(reads).toBe(1);

    expect(vfs.evictBodies('/project/app')).toBe(1);
    // The structure survives: the name and its size are still known, with no
    // store round trip — that is the difference between eviction and deletion.
    expect(vfs.stat('/project/app/a.txt').size).toBe(bytes.length);
    expect(reads).toBe(1);
    // The body is gone from memory, so a read pulls it back.
    expect(new TextDecoder().decode(vfs.readFile('/project/app/a.txt'))).toBe('payload');
    expect(reads).toBe(2);
  });

  it('leaves bodies outside the prefix resident', () => {
    const enc = new TextEncoder();
    const calls: string[] = [];
    const source: ReadSource = {
      info: () => null,
      read: (path) => {
        calls.push(path);
        return enc.encode('?');
      },
      list: () => null,
    };
    const vfs = new MemoryVfs({ cwd: '/' });
    vfs.setReadSource(source);
    vfs.mkdir('/project', { recursive: true });
    vfs.mkdir('/other', { recursive: true });
    vfs.writeFile('/project/a.txt', enc.encode('A'));
    vfs.writeFile('/other/b.txt', enc.encode('B'));

    expect(vfs.evictBodies('/project')).toBe(1);
    // The outside file never left memory, so reading it asks the store nothing.
    expect(new TextDecoder().decode(vfs.readFile('/other/b.txt'))).toBe('B');
    expect(calls).toEqual([]);
  });

  it('is a no-op without a read source, so bytes never become unreachable', () => {
    const vfs = new MemoryVfs({ cwd: '/' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('/project/a.txt', new TextEncoder().encode('x'));
    expect(vfs.evictBodies('/project')).toBe(0);
    expect(new TextDecoder().decode(vfs.readFile('/project/a.txt'))).toBe('x');
  });
});
