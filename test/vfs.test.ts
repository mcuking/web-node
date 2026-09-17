import { describe, expect, it } from 'vitest';
import { MemoryVfs, VfsError } from '../src/node-runtime/vfs';

describe('MemoryVfs', () => {
  it('writes and reads files', () => {
    const vfs = new MemoryVfs();
    vfs.writeFile('/a.txt', new TextEncoder().encode('hello'));
    expect(new TextDecoder().decode(vfs.readFile('/a.txt'))).toBe('hello');
    expect(vfs.stat('/a.txt').size).toBe(5);
    expect(vfs.stat('/a.txt').type).toBe('file');
  });

  it('resolves relative paths against cwd', () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('a.txt', new TextEncoder().encode('x'));
    expect(vfs.exists('/project/a.txt')).toBe(true);
  });

  it('creates nested dirs recursively and lists children', () => {
    const vfs = new MemoryVfs();
    vfs.mkdir('/a/b/c', { recursive: true });
    expect(vfs.stat('/a/b/c').type).toBe('dir');
    expect(vfs.readdir('/a').map((d) => d.name)).toEqual(['b']);
  });

  it('throws ENOENT for missing files', () => {
    const vfs = new MemoryVfs();
    expect(() => vfs.readFile('/nope')).toThrowError(VfsError);
    try {
      vfs.readFile('/nope');
    } catch (err) {
      expect((err as VfsError).code).toBe('ENOENT');
    }
  });

  it('rm -r removes a subtree', () => {
    const vfs = new MemoryVfs();
    vfs.mkdir('/x/y', { recursive: true });
    vfs.writeFile('/x/y/z.txt', new Uint8Array());
    vfs.rm('/x', { recursive: true });
    expect(vfs.exists('/x')).toBe(false);
  });

  it('rmdir on a non-empty dir requires recursive', () => {
    const vfs = new MemoryVfs();
    vfs.mkdir('/x/y', { recursive: true });
    expect(() => vfs.rm('/x')).toThrowError(VfsError);
  });

  it('rename moves files and subtrees', () => {
    const vfs = new MemoryVfs();
    vfs.mkdir('/d', { recursive: true });
    vfs.writeFile('/d/f.txt', new TextEncoder().encode('1'));
    vfs.rename('/d', '/e');
    expect(vfs.exists('/d')).toBe(false);
    expect(new TextDecoder().decode(vfs.readFile('/e/f.txt'))).toBe('1');
  });

  it('appends in order', () => {
    const vfs = new MemoryVfs();
    vfs.writeFile('/log', new TextEncoder().encode('a'));
    vfs.appendFile('/log', new TextEncoder().encode('b'));
    expect(new TextDecoder().decode(vfs.readFile('/log'))).toBe('ab');
  });

  it('round-trips through a snapshot', () => {
    const vfs = new MemoryVfs();
    vfs.mkdir('/p/q', { recursive: true });
    vfs.writeFile('/p/q/f.txt', new TextEncoder().encode('data'));
    const restored = MemoryVfs.fromSnapshot(vfs.snapshot());
    expect(new TextDecoder().decode(restored.readFile('/p/q/f.txt'))).toBe('data');
  });
});
