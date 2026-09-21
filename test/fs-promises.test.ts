import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `fs/promises` is now Node's real `lib/internal/fs/promises.js` (dispatched
 * through the VFS for mounted paths, our `fs` binding otherwise). These check
 * the behaviours a real Node v26.9.0 build produces for the common promise API.
 */
function boot(): {
  fsp: Record<string, any>;
  fs: Record<string, any>;
} {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return {
    fsp: runtime.realm.require('fs/promises') as Record<string, any>,
    fs: runtime.realm.require('fs') as Record<string, any>,
  };
}

describe('fs/promises (real lib/internal/fs/promises.js)', () => {
  it('is the same object as fs.promises', () => {
    const { fsp, fs } = boot();
    expect(fsp).toBe(fs.promises);
    for (const name of ['readFile', 'writeFile', 'stat', 'mkdir']) {
      expect(typeof fsp[name]).toBe('function');
    }
  });

  it('writeFile + readFile round-trip (string and Buffer)', async () => {
    const { fsp } = boot();
    await fsp.writeFile('/project/a.txt', 'hello world');
    expect(await fsp.readFile('/project/a.txt', 'utf8')).toBe('hello world');
    const buf = await fsp.readFile('/project/a.txt');
    expect(buf.byteLength).toBe(11);
    expect(buf.toString('utf8')).toBe('hello world');
    expect((await fsp.stat('/project/a.txt')).size).toBe(11);
    expect((await fsp.stat('/project/a.txt')).isFile()).toBe(true);
  });

  it('stat/lstat report the right type, and bigint stats work', async () => {
    const { fsp } = boot();
    await fsp.mkdir('/project/dir');
    expect((await fsp.stat('/project/dir')).isDirectory()).toBe(true);
    expect((await fsp.lstat('/project/dir')).isDirectory()).toBe(true);
    const big = await fsp.stat('/project/dir', { bigint: true });
    expect(typeof big.size).toBe('bigint');
  });

  it('mkdir (recursive), readdir (plain + withFileTypes) and rm', async () => {
    const { fsp } = boot();
    await fsp.mkdir('/project/d/e', { recursive: true });
    await fsp.writeFile('/project/d/e/f.txt', 'x');
    expect(await fsp.readdir('/project/d')).toEqual(['e']);
    const dirents = await fsp.readdir('/project/d', { withFileTypes: true });
    expect(dirents.map((d: any) => `${d.name}:${d.isDirectory()}`)).toEqual(['e:true']);
    await fsp.rm('/project/d', { recursive: true, force: true });
    expect(await fsp.stat('/project/d').catch((e: any) => e.code)).toBe('ENOENT');
  });

  it('rename, copyFile and unlink', async () => {
    const { fsp } = boot();
    await fsp.writeFile('/project/a.txt', 'one');
    await fsp.rename('/project/a.txt', '/project/b.txt');
    expect(await fsp.readFile('/project/b.txt', 'utf8')).toBe('one');
    await fsp.copyFile('/project/b.txt', '/project/c.txt');
    expect(await fsp.readFile('/project/c.txt', 'utf8')).toBe('one');
    await fsp.unlink('/project/b.txt');
    expect(await fsp.stat('/project/b.txt').catch((e: any) => e.code)).toBe('ENOENT');
  });

  it('appendFile and access', async () => {
    const { fsp } = boot();
    await fsp.writeFile('/project/app.txt', 'a');
    await fsp.appendFile('/project/app.txt', 'b');
    expect(await fsp.readFile('/project/app.txt', 'utf8')).toBe('ab');
    await expect(fsp.access('/project/app.txt')).resolves.toBeUndefined();
    await expect(fsp.access('/project/missing')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('FileHandle open/read/write/close', async () => {
    const { fsp } = boot();
    await fsp.writeFile('/project/fh.txt', 'abcdef');
    const fh = await fsp.open('/project/fh.txt', 'r+');
    const buf = new Uint8Array(3);
    const { bytesRead } = await fh.read(buf, 0, 3, 0);
    expect(bytesRead).toBe(3);
    expect(String.fromCharCode(...buf)).toBe('abc');
    const { bytesWritten } = await fh.write('XY', 0, 'utf8');
    expect(bytesWritten).toBe(2);
    await fh.close();
    expect(await fsp.readFile('/project/fh.txt', 'utf8')).toBe('XYcdef');
  });

  it('throws the libuv-shaped ENOENT', async () => {
    const { fsp } = boot();
    const err: any = await fsp.readFile('/project/nope.txt').catch((e: any) => e);
    expect(err.code).toBe('ENOENT');
    expect(err.errno).toBe(-2);
    expect(err.message).toBe("ENOENT: no such file or directory, open '/project/nope.txt'");
  });
});
