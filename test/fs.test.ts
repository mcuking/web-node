import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * The callback `fs` is now Node's real `lib/fs.js`. These check the surface a
 * real Node v26.9.0 build produces — sync, callback and promise forms, streams,
 * `cp`, and the VFS-backed `watch` — all over the VFS.
 */
function boot(): { fs: Record<string, any>; require: (id: string) => any } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return { fs: runtime.realm.require('fs') as Record<string, any>, require: (id) => runtime.realm.require(id) };
}

describe('fs (real lib/fs.js)', () => {
  it('exposes the full surface and shares fs.promises with fs/promises', () => {
    const { fs, require } = boot();
    for (const name of [
      'readFileSync',
      'writeFileSync',
      'statSync',
      'readdirSync',
      'cpSync',
      'createReadStream',
      'createWriteStream',
      'watch',
      'promises',
    ]) {
      expect(fs[name], name).toBeDefined();
    }
    expect(fs.promises).toBe(require('fs/promises'));
  });

  it('sync round-trip, stat, and readdir withFileTypes', () => {
    const { fs } = boot();
    fs.writeFileSync('/project/a.txt', 'hello');
    expect(fs.readFileSync('/project/a.txt', 'utf8')).toBe('hello');
    expect(fs.statSync('/project/a.txt').size).toBe(5);
    expect(fs.readdirSync('/project')).toEqual(['a.txt']);
    const [d] = fs.readdirSync('/project', { withFileTypes: true });
    expect(d.name).toBe('a.txt');
    expect(d.isFile()).toBe(true);
    expect(d.isDirectory()).toBe(false);
  });

  it('callback forms settle with the Node (err, result) shape', async () => {
    const { fs } = boot();
    await new Promise<void>((res, rej) =>
      fs.writeFile('/project/b.txt', 'cb', (e: any) => (e ? rej(e) : res())),
    );
    const data = await new Promise<string>((res, rej) =>
      fs.readFile('/project/b.txt', 'utf8', (e: any, d: any) => (e ? rej(e) : res(d))),
    );
    expect(data).toBe('cb');
    const stats = await new Promise<any>((res, rej) =>
      fs.stat('/project/b.txt', (e: any, s: any) => (e ? rej(e) : res(s))),
    );
    expect(stats.size).toBe(2);
  });

  it('cpSync copies a directory tree (and reports EISDIR without recursive)', () => {
    const { fs } = boot();
    fs.mkdirSync('/project/src/nested', { recursive: true });
    fs.writeFileSync('/project/src/x.txt', 'x');
    fs.writeFileSync('/project/src/nested/y.txt', 'y');
    expect(() => fs.cpSync('/project/src', '/project/bad')).toThrow(
      expect.objectContaining({ code: 'ERR_FS_EISDIR' }),
    );
    fs.cpSync('/project/src', '/project/dst', { recursive: true });
    expect(fs.readFileSync('/project/dst/x.txt', 'utf8')).toBe('x');
    expect(fs.readFileSync('/project/dst/nested/y.txt', 'utf8')).toBe('y');
  });

  it('createReadStream / createWriteStream move bytes over the VFS', async () => {
    const { fs } = boot();
    await new Promise<void>((res, rej) => {
      const ws = fs.createWriteStream('/project/log.txt');
      ws.on('error', rej);
      ws.on('close', () => res());
      ws.end('line-1\nline-2\n');
    });
    expect(fs.readFileSync('/project/log.txt', 'utf8')).toBe('line-1\nline-2\n');
    const chunks: string[] = [];
    await new Promise<void>((res, rej) => {
      const rs = fs.createReadStream('/project/log.txt');
      rs.on('data', (c: any) => chunks.push(String(c)));
      rs.on('error', rej);
      rs.on('end', () => res());
    });
    expect(chunks.join('')).toBe('line-1\nline-2\n');
  });

  it('watch reports one rename per whole-file write and per delete', () => {
    const { fs } = boot();
    fs.mkdirSync('/project/src/nested', { recursive: true });
    const seen: string[] = [];
    const w = fs.watch('/project/src', { recursive: true }, (event: string, filename: string) => {
      seen.push(`${event}:${filename}`);
    });
    fs.writeFileSync('/project/src/a.js', 'x');
    fs.writeFileSync('/project/src/nested/b.js', 'y');
    fs.writeFileSync('/project/outside.js', 'z');
    fs.rmSync('/project/src/a.js');
    w.close();
    fs.writeFileSync('/project/src/c.js', 'w');
    expect(seen).toEqual(['rename:a.js', 'rename:nested/b.js', 'rename:a.js']);
  });

  it('reports libuv-shaped ENOENT, byte-for-byte with Node v26.9.0', async () => {
    const { fs } = boot();
    let sync: any;
    try {
      fs.readFileSync('/project/nope');
    } catch (e) {
      sync = e;
    }
    expect(sync.name).toBe('Error');
    expect(sync.code).toBe('ENOENT');
    expect(sync.errno).toBe(-2);
    expect(sync.syscall).toBe('open');
    expect(sync.message).toBe("ENOENT: no such file or directory, open '/project/nope'");
    const cb: any = await new Promise((res) => fs.readFile('/project/nope', (e: any) => res(e)));
    expect(cb.code).toBe('ENOENT');
    expect(cb.errno).toBe(-2);
    expect(cb.message).toBe(sync.message);
  });
});
