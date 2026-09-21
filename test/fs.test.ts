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
    // The real `internal/fs/streams.js` is now vendored: fast-utf8-stream-style
    // ReadStream/WriteStream over the `fs` binding, not a web-node shim.
    expect(typeof fs.ReadStream).toBe('function');
    expect(typeof fs.WriteStream).toBe('function');
    let ws: any;
    await new Promise<void>((res, rej) => {
      ws = fs.createWriteStream('/project/log.txt');
      expect(ws).toBeInstanceOf(fs.WriteStream);
      ws.on('error', rej);
      ws.on('finish', () => res());
      ws.write('line-1\n');
      ws.end('line-2\n');
    });
    expect(ws.bytesWritten).toBe(14);
    expect(ws.path).toBe('/project/log.txt');
    expect(fs.readFileSync('/project/log.txt', 'utf8')).toBe('line-1\nline-2\n');

    // `{ start, end }` is inclusive, and `open` reports a numeric fd.
    const rs = fs.createReadStream('/project/log.txt', { start: 7, end: 11 });
    expect(rs).toBeInstanceOf(fs.ReadStream);
    const chunks: string[] = [];
    let openFd: unknown;
    await new Promise<void>((res, rej) => {
      rs.on('open', (fd: number) => { openFd = typeof fd; });
      rs.on('data', (c: any) => chunks.push(String(c)));
      rs.on('error', rej);
      rs.on('end', () => res());
    });
    expect(chunks.join('')).toBe('line-');
    expect(rs.bytesRead).toBe(5);
    expect(openFd).toBe('number');
  });

  it('streams a large file in highWaterMark chunks and pipes a byte-equal copy', async () => {
    const { fs } = boot();
    const big = new Uint8Array(200_000).fill(65);
    fs.writeFileSync('/project/big.bin', big);
    let total = 0;
    const sizes: number[] = [];
    await new Promise<void>((res, rej) => {
      const s = fs.createReadStream('/project/big.bin', { highWaterMark: 65536 });
      s.on('data', (c: any) => { total += c.length; sizes.push(c.length); });
      s.on('error', rej);
      s.on('end', () => res());
    });
    expect(total).toBe(200_000);
    // Backpressure is real over the VFS: never larger than one chunk.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(65536);
    await new Promise<void>((res, rej) => {
      const dest = fs.createWriteStream('/project/copy.bin');
      dest.on('error', rej);
      dest.on('finish', () => res());
      fs.createReadStream('/project/big.bin').pipe(dest);
    });
    expect(Array.from(fs.readFileSync('/project/copy.bin'))).toEqual(Array.from(big));
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

  it('opendir / Dir.streams the directory, sync and async (real fs_dir)', async () => {
    const { fs } = boot();
    fs.writeFileSync('/project/a.txt', 'hello');
    fs.mkdirSync('/project/d');
    const dir = fs.opendirSync('/project');
    const seen: string[] = [];
    let ent: any;
    while ((ent = dir.readSync()) !== null) {
      seen.push(`${ent.name}:${ent.isFile() ? 'f' : ent.isDirectory() ? 'd' : '?'}`);
    }
    expect(seen.sort()).toEqual(['a.txt:f', 'd:d']);
    dir.closeSync();
    expect(() => dir.readSync()).toThrow(
      expect.objectContaining({ code: 'ERR_DIR_CLOSED' }),
    );

    const dir2 = await new Promise<any>((res, rej) =>
      fs.opendir('/project', (e: any, d: any) => (e ? rej(e) : res(d))),
    );
    const names: string[] = [];
    for await (const e of dir2) names.push(e.name);
    expect(names.sort()).toEqual(['a.txt', 'd']);
  });

  it('watchFile polls the VFS and reports change / delete / recreate', async () => {
    const { fs } = boot();
    fs.writeFileSync('/project/a.txt', 'x');
    const events: string[] = [];
    const w = fs.watchFile('/project/a.txt', { interval: 30 }, (curr: any, prev: any) => {
      events.push(`${curr.size}<-${prev.size}`);
    });
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(70);
    fs.writeFileSync('/project/a.txt', 'hello');
    await wait(90);
    fs.unlinkSync('/project/a.txt');
    await wait(90);
    fs.writeFileSync('/project/a.txt', 'back');
    await wait(90);
    fs.unwatchFile('/project/a.txt');
    // Same shape as Node v26.9.0: edit, then delete reports a zeroed stat
    // against the last good one, then recreate reports against that same stat.
    expect(events).toEqual(['5<-1', '0<-5', '4<-5']);
    expect(w).toBeDefined();
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
