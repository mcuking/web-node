import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { FsService, SNAPSHOT_FILE, type FileStore } from '../src/node-runtime/vfs/fs-service';
import { FS_OP_PUT, encodePut, decodePut } from '../src/sync/fs-protocol';
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
  /** Writes in order — the snapshot layout is part of the contract. */
  writes: string[] = [];

  async put(path: string, data: Uint8Array): Promise<void> {
    this.writes.push(path);
    this.files.set(path, data.slice());
  }
  async putText(path: string, text: string): Promise<void> {
    await this.put(path, new TextEncoder().encode(text));
  }
  async has(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async read(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return data.slice();
  }
  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.read(path));
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async clearAll(): Promise<void> {
    this.files.clear();
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
});

describe('fs service snapshots', () => {
  function makeVfs(): MemoryVfs {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project/src', { recursive: true });
    vfs.writeFile('/project/src/a.js', encoder.encode('export const a = 1;\n'));
    // Not valid UTF-8: the mirror has to be byte-exact, base64 or not.
    vfs.writeFile('/project/blob.bin', new Uint8Array([0, 255, 128]));
    return vfs;
  }

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
