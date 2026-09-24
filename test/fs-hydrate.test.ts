import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import type { ReadSource } from '../src/node-runtime/vfs/persistence';
import type { StoreEntry } from '../src/sync/fs-protocol';

/**
 * The in-memory tree reaching through to backing storage (M120).
 *
 * The tree is authoritative, so this only happens for paths it does not hold —
 * a file whose `fsync` landed while the debounced snapshot did not, or something
 * another context wrote into the shared OPFS tree. The store here is a plain
 * map that records every question it is asked, which is the point: how *many*
 * round trips a lookup costs is part of the contract, not an implementation
 * detail.
 */
class FakeSource implements ReadSource {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  /** Every call, in order — `info:/x`, `read:/x`, `list:/x`. */
  calls: string[] = [];

  addFile(path: string, text: string): void {
    const parts = path.split('/').slice(1, -1);
    let cur = '';
    for (const part of parts) {
      cur += `/${part}`;
      this.dirs.add(cur);
    }
    this.files.set(path, new TextEncoder().encode(text));
  }

  addDir(path: string): void {
    const parts = path.split('/').slice(1);
    let cur = '';
    for (const part of parts) {
      cur += `/${part}`;
      this.dirs.add(cur);
    }
  }

  info(path: string): { type: 'file' | 'dir'; size: number } | null {
    this.calls.push(`info:${path}`);
    if (path === '/') return { type: 'dir', size: 0 };
    const data = this.files.get(path);
    if (data) return { type: 'file', size: data.byteLength };
    if (this.dirs.has(path)) return { type: 'dir', size: 0 };
    return null;
  }

  read(path: string): Uint8Array {
    this.calls.push(`read:${path}`);
    const data = this.files.get(path);
    if (!data) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    return data.slice();
  }

  list(path: string): StoreEntry[] | null {
    this.calls.push(`list:${path}`);
    if (path === '/') {
      return [...this.dirs].filter((d) => d.split('/').length === 2).map((d) => ({ name: d.slice(1), type: 'dir' as const, size: 0 }));
    }
    if (!this.dirs.has(path)) return null;
    const prefix = `${path}/`;
    const out: StoreEntry[] = [];
    const seen = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === '' || rest.includes('/') || seen.has(rest)) continue;
      seen.add(rest);
      const child = this.files.get(prefix + rest);
      out.push({ name: rest, type: child ? 'file' : 'dir', size: child?.byteLength ?? 0 });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}

const decoder = new TextDecoder();

function storeOnly(): { vfs: MemoryVfs; source: FakeSource } {
  const source = new FakeSource();
  source.addFile('/project/only-in-store.txt', 'from the store');
  source.addFile('/project/kept/nested/deep.txt', 'deep');
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.setReadSource(source);
  return { vfs, source };
}

describe('reaching through to backing storage', () => {
  it('reads a file the tree never held', () => {
    const { vfs, source } = storeOnly();
    expect(decoder.decode(vfs.readFile('/project/only-in-store.txt'))).toBe('from the store');
    // The bytes are now in the tree, so the next read is free.
    expect(source.calls).toEqual(['info:/project/only-in-store.txt', 'read:/project/only-in-store.txt']);
    expect(decoder.decode(vfs.readFile('/project/only-in-store.txt'))).toBe('from the store');
    expect(source.calls).toHaveLength(2);
  });

  it('answers stat with the size the store reported, without reading the file', () => {
    const { vfs, source } = storeOnly();
    const stat = vfs.stat('/project/only-in-store.txt');
    expect(stat.type).toBe('file');
    expect(stat.size).toBe(14);
    expect(source.calls).toEqual(['info:/project/only-in-store.txt']);
  });

  it('sees a file inside a directory the tree never held', () => {
    const { vfs } = storeOnly();
    expect(vfs.exists('/project/kept/nested/deep.txt')).toBe(true);
    expect(decoder.decode(vfs.readFile('/project/kept/nested/deep.txt'))).toBe('deep');
  });

  it('lists a store-only directory, sizes included', () => {
    const { vfs, source } = storeOnly();
    expect(vfs.readdir('/project/kept')).toEqual([{ name: 'nested', type: 'dir' }]);
    // The listing is now in the tree; a second readdir does not ask again.
    const before = source.calls.length;
    expect(vfs.readdir('/project/kept')).toEqual([{ name: 'nested', type: 'dir' }]);
    expect(source.calls).toHaveLength(before);
  });

  it('reports what is genuinely absent', () => {
    const { vfs } = storeOnly();
    expect(vfs.exists('/project/nope.txt')).toBe(false);
    expect(() => vfs.readFile('/project/nope.txt')).toThrow(/ENOENT/);
    expect(() => vfs.stat('/project/nope.txt')).toThrow(/ENOENT/);
    expect(() => vfs.readdir('/project/nope')).toThrow(/ENOENT/);
  });

  it('still tells ENOENT from ENOTDIR when the blocking ancestor is in the store', () => {
    const { vfs } = storeOnly();
    // `/project/only-in-store.txt` is a file, so descending into it is ENOTDIR.
    expect(() => vfs.readFile('/project/only-in-store.txt/child')).toThrow(/ENOTDIR/);
    expect(() => vfs.stat('/project/only-in-store.txt/child')).toThrow(/ENOTDIR/);
  });

  it('converts a `read()` failure into a loud error, not empty bytes', () => {
    const { vfs } = storeOnly();
    vfs.stat('/project/only-in-store.txt');
    // The store said it was there; if the read then fails, that is a real error.
    vfs.setReadSource({
      info: () => ({ type: 'file', size: 3 }),
      read: () => {
        throw new Error('store exploded');
      },
      list: () => null,
    });
    expect(() => vfs.readFile('/project/other.txt')).toThrow(/store exploded/);
  });

  it('does not consult the store for paths the tree already holds', () => {
    const { vfs, source } = storeOnly();
    // A directory the tree knows lists only what the tree holds — reaching
    // through is for paths it has never seen, not a way to re-list a directory
    // whose contents are already the authority.
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('/project/local.txt', new TextEncoder().encode('local'));
    source.calls = [];
    expect(vfs.exists('/project/local.txt')).toBe(true);
    expect(vfs.stat('/project/local.txt').size).toBe(5);
    expect(vfs.readdir('/project')).toEqual([{ name: 'local.txt', type: 'file' }]);
    expect(source.calls).toEqual([]);
  });
});

describe('mutations on entries that came from the store', () => {
  it('appends to a store-only file instead of overwriting it with the tail', () => {
    const { vfs } = storeOnly();
    vfs.appendFile('/project/only-in-store.txt', new TextEncoder().encode('!'));
    expect(decoder.decode(vfs.readFile('/project/only-in-store.txt'))).toBe('from the store!');
  });

  it('copies a store-only file', () => {
    const { vfs } = storeOnly();
    vfs.copyFile('/project/only-in-store.txt', '/project/copy.txt');
    expect(decoder.decode(vfs.readFile('/project/copy.txt'))).toBe('from the store');
  });

  it('does not re-write a store-only file on fsync — it is already durable', () => {
    const { vfs } = storeOnly();
    const flushed: string[] = [];
    vfs.setSyncSink((path) => flushed.push(path));
    vfs.stat('/project/only-in-store.txt'); // hydrate it
    vfs.sync('/project/only-in-store.txt');
    expect(flushed).toEqual([]);
  });

  it('names every removed path, so the store can drop them too', () => {
    const { vfs } = storeOnly();
    const removed: string[][] = [];
    vfs.setDeletedSink((paths) => removed.push(paths));
    vfs.rm('/project/kept', { recursive: true });
    // `#materialize` first: a cold directory only knows that it exists, and the
    // store has to be told about the files underneath it.
    expect(removed).toEqual([['/project/kept', '/project/kept/nested', '/project/kept/nested/deep.txt']]);
  });

  it('names the old paths of a rename, after resolving the subtree', () => {
    const { vfs } = storeOnly();
    const removed: string[][] = [];
    vfs.setDeletedSink((paths) => removed.push(paths));
    vfs.rename('/project/kept', '/project/moved');
    expect(removed).toEqual([['/project/kept', '/project/kept/nested', '/project/kept/nested/deep.txt']]);
    expect(decoder.decode(vfs.readFile('/project/moved/nested/deep.txt'))).toBe('deep');
  });

  it('does not resurrect a removed store-only file', () => {
    const { vfs, source } = storeOnly();
    // The real store is what makes this true: a deletion has to reach it, or the
    // very next lookup would find the file again.
    vfs.setDeletedSink((paths) => {
      for (const path of paths) source.files.delete(path);
    });
    vfs.rm('/project/only-in-store.txt');
    expect(vfs.exists('/project/only-in-store.txt')).toBe(false);
    expect(() => vfs.readFile('/project/only-in-store.txt')).toThrow(/ENOENT/);
  });

  it('refuses to remove a non-empty directory when it is not recursive', () => {
    const { vfs } = storeOnly();
    expect(() => vfs.rm('/project/kept')).toThrow(/ENOTEMPTY/);
  });
});
