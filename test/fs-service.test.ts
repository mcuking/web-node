import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { FsService, SNAPSHOT_FILE, type FileStore } from '../src/node-runtime/vfs/fs-service';
import {
  FS_OP_GET,
  FS_OP_LIST,
  FS_OP_PUT,
  FS_OP_STAT,
  decodeInfoBody,
  decodeListingBody,
  decodePut,
  decodeReadResult,
  encodePath,
  encodePut,
  type StoreEntry,
} from '../src/sync/fs-protocol';
import { SyncChannelError } from '../src/sync/sab-rpc';

/**
 * Chrome refuses to decode a view onto a `SharedArrayBuffer` (the buffer could
 * be detached under the decoder); Node allows it, so a plain test would never
 * notice. This makes the browser's restriction explicit.
 */
function withStrictTextDecoder<T>(run: () => T): T {
  const original = TextDecoder.prototype.decode;
  TextDecoder.prototype.decode = function (this: TextDecoder, input?: ArrayBufferView, options?: TextDecodeOptions) {
    if (input && input.buffer instanceof SharedArrayBuffer) {
      throw new TypeError('The provided ArrayBufferView value must not be shared.');
    }
    return original.call(this, input, options);
  };
  try {
    return run();
  } finally {
    TextDecoder.prototype.decode = original;
  }
}

/**
 * The FS worker's service layer (M120), driven against an in-memory store.
 *
 * The shell (`src/worker/fs.worker.ts`) only binds a port to this; every
 * decision worth testing is here. The store's own path handling is exercised by
 * the page end-to-end, where a real OPFS is available.
 */

class FakeStore implements FileStore {
  files = new Map<string, Uint8Array>();
  /** Directories are explicit, like OPFS: a path prefix alone does not make one. */
  dirs = new Set<string>();
  /** Writes in order — the snapshot layout is part of the contract. */
  writes: string[] = [];

  #makeParents(path: string): void {
    const parts = path.split('/').slice(0, -1);
    let cur = '';
    for (const part of parts) {
      cur = cur === '' ? part : `${cur}/${part}`;
      this.dirs.add(cur);
    }
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    this.writes.push(path);
    this.files.set(path, data.slice());
    this.#makeParents(path);
  }
  async putText(path: string, text: string): Promise<void> {
    await this.put(path, new TextEncoder().encode(text));
  }
  async has(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }
  async read(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return data.slice();
  }
  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.read(path));
  }
  async readOrNull(path: string): Promise<Uint8Array | null> {
    return this.files.get(path)?.slice() ?? null;
  }
  async info(path: string): Promise<{ type: 'file' | 'dir'; size: number } | null> {
    if (path === '') return { type: 'dir', size: 0 };
    const data = this.files.get(path);
    if (data) return { type: 'file', size: data.byteLength };
    if (this.dirs.has(path)) return { type: 'dir', size: 0 };
    return null;
  }
  async list(path: string): Promise<StoreEntry[] | null> {
    const info = await this.info(path);
    if (info === null || info.type !== 'dir') return null;
    const prefix = path === '' ? '' : `${path}/`;
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
  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.dirs.delete(path);
  }
  async clearAll(): Promise<void> {
    this.files.clear();
    this.dirs.clear();
    this.writes = [];
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function service(store = new FakeStore()) {
  return { store, service: new FsService(store) };
}

describe('fs protocol framing', () => {
  it('round-trips a path and arbitrary bytes', () => {
    const data = new Uint8Array([0, 255, 128, 10, 0]);
    const decoded = decodePut(encodePut('/project/src/a.js', data));
    expect(decoded.path).toBe('/project/src/a.js');
    expect(Array.from(decoded.data)).toEqual(Array.from(data));
  });

  it('survives a non-ASCII path', () => {
    const decoded = decodePut(encodePut('/project/文件.txt', new Uint8Array([1])));
    expect(decoded.path).toBe('/project/文件.txt');
  });

  it('decodes a payload that lives in shared memory', () => {
    withStrictTextDecoder(() => {
      const framed = encodePut('/project/a.txt', encoder.encode('hi'));
      const shared = new SharedArrayBuffer(framed.byteLength);
      new Uint8Array(shared).set(framed, 0);
      const decoded = decodePut(new Uint8Array(shared, 0, framed.byteLength));
      expect(decoded.path).toBe('/project/a.txt');
      expect(decoder.decode(decoded.data)).toBe('hi');
    });
  });
});

describe('fs service sync operations', () => {
  it('writes a file durably and strips the leading slash', async () => {
    const { store, service: fs } = service();
    const result = await fs.sync(FS_OP_PUT, encodePut('/project/a.txt', encoder.encode('hello')));
    expect(result.byteLength).toBe(0);
    expect(decoder.decode(store.files.get('project/a.txt'))).toBe('hello');
  });

  it('refuses an unknown operation', () => {
    expect(() => service().service.sync(99, new Uint8Array(0))).toThrow(SyncChannelError);
  });

  describe('reads', () => {
    async function seeded(): Promise<ReturnType<typeof service>> {
      const ctx = service();
      await ctx.service.sync(FS_OP_PUT, encodePut('/project/a.txt', encoder.encode('hello')));
      await ctx.service.sync(FS_OP_PUT, encodePut('/project/src/deep/b.js', encoder.encode('x')));
      return ctx;
    }

    const readResult = (bytes: Uint8Array) => decodeReadResult(bytes);

    it('returns a file body verbatim, including non-UTF-8 bytes', async () => {
      const { service: fs } = await seeded();
      await fs.sync(FS_OP_PUT, encodePut('/project/blob.bin', new Uint8Array([0, 255, 128])));
      const result = readResult(await fs.sync(FS_OP_GET, encodePath('/project/blob.bin')));
      expect(result.present).toBe(true);
      expect(Array.from(result.body)).toEqual([0, 255, 128]);
    });

    it('reports a missing file as absent rather than failing the call', async () => {
      const { service: fs } = await seeded();
      expect(readResult(await fs.sync(FS_OP_GET, encodePath('/project/nope'))).present).toBe(false);
      // A directory is not a file body either.
      expect(readResult(await fs.sync(FS_OP_GET, encodePath('/project/src'))).present).toBe(false);
    });

    it('answers stat with a type and a size, and nothing more', async () => {
      const { service: fs } = await seeded();
      const file = readResult(await fs.sync(FS_OP_STAT, encodePath('/project/a.txt')));
      expect(decodeInfoBody(file.body)).toEqual({ type: 'file', size: 5 });
      const dir = readResult(await fs.sync(FS_OP_STAT, encodePath('/project/src')));
      expect(decodeInfoBody(dir.body)).toEqual({ type: 'dir', size: 0 });
      expect(readResult(await fs.sync(FS_OP_STAT, encodePath('/project/missing'))).present).toBe(false);
    });

    it('lists one level, sorted, with sizes', async () => {
      const { service: fs } = await seeded();
      const result = readResult(await fs.sync(FS_OP_LIST, encodePath('/project')));
      expect(decodeListingBody(result.body)).toEqual([
        { name: 'a.txt', type: 'file', size: 5 },
        { name: 'src', type: 'dir', size: 0 },
      ]);
    });

    it('refuses to list something that is not a directory', async () => {
      const { service: fs } = await seeded();
      expect(readResult(await fs.sync(FS_OP_LIST, encodePath('/project/a.txt'))).present).toBe(false);
      expect(readResult(await fs.sync(FS_OP_LIST, encodePath('/project/gone'))).present).toBe(false);
    });

    it('hides the snapshot index from a root listing', async () => {
      const { service: fs } = await seeded();
      await fs.writeSnapshot(makeVfs().snapshot());
      const root = readResult(await fs.sync(FS_OP_LIST, encodePath('/')));
      expect(decodeListingBody(root.body).map((e) => e.name)).toEqual(['project']);
      // A user file with the same name, deeper down, stays visible.
      await fs.sync(FS_OP_PUT, encodePut('/project/.wvm.json', encoder.encode('mine')));
      const project = readResult(await fs.sync(FS_OP_LIST, encodePath('/project')));
      expect(decodeListingBody(project.body).map((e) => e.name)).toContain('.wvm.json');
    });
  });

  describe('deletes', () => {
    it('drops each path, deepest first, and tolerates ones already gone', async () => {
      const { store, service: fs } = service();
      await fs.writeSnapshot(makeVfs().snapshot());
      store.writes = [];
      await fs.async({ kind: 'delete', paths: ['/project/src', '/project/src/a.js', '/project/never'] });
      expect(store.files.has('project/src/a.js')).toBe(false);
      expect(store.files.has('project/blob.bin')).toBe(true);
    });

    it('removes a directory that still holds children', async () => {
      const { store, service: fs } = service();
      await fs.writeSnapshot(makeVfs().snapshot());
      // The child has to go first, or OPFS refuses to drop the directory.
      store.remove = async (path: string): Promise<void> => {
        if ([...store.files.keys()].some((k) => k.startsWith(`${path}/`))) {
          throw new Error('directory not empty');
        }
        store.files.delete(path);
        store.dirs.delete(path);
      };
      await fs.async({ kind: 'delete', paths: ['/project/src', '/project/src/a.js'] });
      expect(store.dirs.has('project/src')).toBe(false);
      expect(store.files.has('project/src/a.js')).toBe(false);
    });
  });
});

function makeVfs(): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project/src', { recursive: true });
  vfs.writeFile('/project/src/a.js', encoder.encode('export const a = 1;\n'));
  // Not valid UTF-8: the mirror has to be byte-exact, base64 or not.
  vfs.writeFile('/project/blob.bin', new Uint8Array([0, 255, 128]));
  return vfs;
}

describe('fs service snapshots', () => {
  it('writes the index first, then a file per entry', async () => {
    const { store, service: fs } = service();
    await fs.writeSnapshot(makeVfs().snapshot());
    expect(store.writes[0]).toBe(SNAPSHOT_FILE);
    expect([...store.writes].sort()).toEqual(['.wvm.json', 'project/blob.bin', 'project/src/a.js']);
    // Directories are index-only: OPFS makes them on demand.
    expect(store.files.has('project/src')).toBe(false);
  });

  it('mirrors binary contents byte-for-byte', async () => {
    const { store, service: fs } = service();
    await fs.writeSnapshot(makeVfs().snapshot());
    expect(Array.from(store.files.get('project/blob.bin')!)).toEqual([0, 255, 128]);
  });

  it('reloads what it wrote', async () => {
    const store = new FakeStore();
    const written = makeVfs().snapshot();
    await new FsService(store).writeSnapshot(written);
    const loaded = await new FsService(store).load();
    expect(loaded?.version).toBe(2);
    expect(loaded?.entries).toEqual(written);
  });

  it('still reads a v1 snapshot (a bare array of UTF-8 entries)', async () => {
    const store = new FakeStore();
    await store.putText(SNAPSHOT_FILE, JSON.stringify([{ path: '/a.txt', type: 'file', data: 'x' }]));
    const loaded = await new FsService(store).load();
    expect(loaded).toEqual({ version: 1, entries: [{ path: '/a.txt', type: 'file', data: 'x' }] });
  });

  it('treats a missing or unreadable index as an empty project', async () => {
    expect(await new FsService(new FakeStore()).load()).toBeNull();
    const broken = new FakeStore();
    await broken.putText(SNAPSHOT_FILE, 'not json');
    expect(await new FsService(broken).load()).toBeNull();
    const empty = new FakeStore();
    await empty.putText(SNAPSHOT_FILE, JSON.stringify({ v: 2 }));
    expect(await new FsService(empty).load()).toBeNull();
  });

  it('clears the store on request', async () => {
    const { store, service: fs } = service();
    await fs.writeSnapshot(makeVfs().snapshot());
    await fs.async({ kind: 'clear' });
    expect(store.files.size).toBe(0);
  });

  it('serves load through the async channel', async () => {
    const { service: fs } = service();
    await fs.writeSnapshot(makeVfs().snapshot());
    const loaded = (await fs.async({ kind: 'load' })) as { entries: Array<{ path: string }> };
    expect(loaded.entries.map((e) => e.path)).toEqual([
      '/project',
      '/project/blob.bin',
      '/project/src',
      '/project/src/a.js',
    ]);
  });
});
