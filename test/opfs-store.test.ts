import { describe, expect, it } from 'vitest';
import { OpfsFileStore } from '../src/node-runtime/vfs/opfs-store';

/**
 * A minimal in-memory OPFS. Faithful in the one way this test cares about: a
 * directory handle whose entry has been removed is *dead* — creating children
 * through it throws `NotFoundError`, exactly like the real File System Access
 * API. That is what makes a stale cached handle a real bug rather than a leak.
 */
type FileNode = { kind: 'file'; name: string; bytes: Uint8Array; dead: boolean };
type DirNode = { kind: 'dir'; name: string; dead: boolean; children: Map<string, Node> };
type Node = DirNode | FileNode;

function dirNode(name: string): DirNode {
  return { kind: 'dir', name, dead: false, children: new Map() };
}

function assertLive(node: Node): void {
  if (node.dead) {
    const err = new Error('A requested file or directory could not be found');
    err.name = 'NotFoundError';
    throw err;
  }
}

function fakeHandle(node: Node): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: node.name,
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      assertLive(node);
      if (node.kind !== 'dir') throw Object.assign(new Error('not a dir'), { name: 'TypeMismatchError' });
      let child = node.children.get(name);
      if (!child) {
        if (!opts?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        child = dirNode(name);
        node.children.set(name, child);
      }
      return fakeHandle(child);
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      assertLive(node);
      if (node.kind !== 'dir') throw Object.assign(new Error('not a dir'), { name: 'TypeMismatchError' });
      let child = node.children.get(name);
      if (!child) {
        if (!opts?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        child = { kind: 'file', name, bytes: new Uint8Array(), dead: false };
        node.children.set(name, child);
      }
      if (child.kind !== 'file') throw Object.assign(new Error('is dir'), { name: 'TypeMismatchError' });
      return {
        kind: 'file',
        name,
        async getFile() {
          return { size: child.kind === 'file' ? child.bytes.length : 0 } as File;
        },
        async createSyncAccessHandle() {
          assertLive(child);
          const data = child as Extract<Node, { kind: 'file' }>;
          return {
            async getSize() { return data.bytes.length; },
            async truncate(n: number) { data.bytes = new Uint8Array(n); },
            async write(buf: Uint8Array, o: { at: number }) {
              const end = o.at + buf.length;
              const next = new Uint8Array(Math.max(end, data.bytes.length));
              next.set(data.bytes);
              next.set(buf, o.at);
              data.bytes = next;
              return buf.length;
            },
            async read(buf: Uint8Array, o: { at: number }) {
              const slice = data.bytes.subarray(o.at, o.at + buf.length);
              buf.set(slice);
              return slice.length;
            },
            async flush() {},
            async close() {},
          } as unknown as FileSystemSyncAccessHandle;
        },
      } as unknown as FileSystemFileHandle;
    },
    async removeEntry(name: string, opts?: { recursive?: boolean }) {
      assertLive(node);
      if (node.kind !== 'dir') throw Object.assign(new Error('not a dir'), { name: 'TypeMismatchError' });
      const child = node.children.get(name);
      if (!child) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      if (child.kind === 'dir' && child.children.size > 0 && !opts?.recursive) {
        throw Object.assign(new Error('dir not empty'), { name: 'InvalidModificationError' });
      }
      child.dead = true;
      node.children.delete(name);
    },
    async *entries() {
      assertLive(node);
      if (node.kind !== 'dir') return;
      for (const [name, child] of node.children) yield [name, { kind: child.kind, name }] as [string, FileSystemHandle];
    },
  } as unknown as FileSystemDirectoryHandle;
}

function makeStore(): { store: OpfsFileStore; root: DirNode } {
  const root = dirNode('web-node');
  const provider = { getDirectory: async () => fakeHandle(root) };
  return { store: new OpfsFileStore('web-node', provider), root };
}

describe('OpfsFileStore directory-handle cache', () => {
  it('writes and reads back', async () => {
    const { store } = makeStore();
    await store.put('/a/b/c.txt', new TextEncoder().encode('hello'));
    expect(await store.readText('/a/b/c.txt')).toBe('hello');
  });

  // The sync layer deletes deepest-first (see `fs-service.ts` `#delete`): OPFS
  // refuses to drop a non-empty directory, so a child always goes before its
  // parent, and each directory is empty by the time its own `remove` lands.
  const removeTree = async (store: OpfsFileStore, paths: string[]) => {
    for (const p of [...paths].sort((a, b) => b.length - a.length)) await store.remove(p);
  };

  it('does NOT let a stale cached handle break a write after delete + recreate', async () => {
    const { store, root } = makeStore();
    // Warm the cache with the parent chain for /a/b.
    await store.put('/a/b/c.txt', new TextEncoder().encode('one'));
    // Delete the whole subtree. A cache that survived the delete would still hold
    // dead handles for /a and /a/b.
    await removeTree(store, ['/a', '/a/b', '/a/b/c.txt']);
    expect(root.children.has('a')).toBe(false);
    // Recreate the same paths. With stale handles this throws NotFoundError.
    await expect(store.put('/a/b/d.txt', new TextEncoder().encode('two'))).resolves.toBeUndefined();
    expect(await store.readText('/a/b/d.txt')).toBe('two');
  });

  it('removes a whole subtree deepest-first', async () => {
    const { store, root } = makeStore();
    await store.put('/a/b/c.txt', new TextEncoder().encode('x'));
    await removeTree(store, ['/a', '/a/b', '/a/b/c.txt']);
    expect(root.children.has('a')).toBe(false);
    expect(await store.has('/a/b/c.txt')).toBe(false);
    expect(await store.has('/a')).toBe(false);
  });

  it('invalidate only affects the removed subtree', async () => {
    const { store } = makeStore();
    await store.put('/keep/x.txt', new TextEncoder().encode('k'));
    await store.put('/drop/y.txt', new TextEncoder().encode('d'));
    await removeTree(store, ['/drop', '/drop/y.txt']);
    expect(await store.readText('/keep/x.txt')).toBe('k');
    // `/keep` handle was never invalidated, so writing again must still work.
    await expect(store.put('/keep/z.txt', new TextEncoder().encode('z'))).resolves.toBeUndefined();
    expect(await store.has('/drop')).toBe(false);
  });
});
