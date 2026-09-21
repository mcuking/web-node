import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Node's `vfs` module (lib/vfs.js + internal/vfs/*) running on our runtime.
 * The MemoryProvider-backed `VirtualFileSystem` is a full fs-shaped surface
 * (sync + callback + promise + streams + watch), so these check the behaviours
 * a real Node v26.9.0 build (`node --experimental-vfs`) produces.
 */
interface VfsModule {
  create(provider?: unknown, options?: unknown): VfsFs;
  VirtualFileSystem: unknown;
  VirtualProvider: unknown;
  MemoryProvider: unknown;
  RealFSProvider: new () => unknown;
  ZipProvider: new () => unknown;
}

interface VfsFs {
  writeFileSync(path: string, data: string | Uint8Array): void;
  readFileSync(path: string, opts?: string | { encoding?: string }): string | Uint8Array;
  statSync(path: string): { size: number; isFile(): boolean; isDirectory(): boolean };
  lstatSync(path: string): { isDirectory(): boolean };
  existsSync(path: string): boolean;
  mkdirSync(path: string, opts?: { recursive?: boolean }): string | undefined;
  mkdtempSync(prefix: string): string;
  readdirSync(path: string, opts?: { recursive?: boolean; withFileTypes?: boolean }): unknown;
  openSync(path: string, flags: string): number;
  closeSync(fd: number): void;
  readSync(fd: number, buf: Uint8Array, off: number, len: number, pos: number): number;
  writeSync(fd: number, buf: Uint8Array, off: number, len: number, pos: number): number;
  copyFileSync(src: string, dest: string): void;
  renameSync(src: string, dest: string): void;
  unlinkSync(path: string): void;
  appendFileSync(path: string, data: string): void;
  rmSync(path: string, opts?: { recursive?: boolean }): void;
  realpathSync(path: string): string;
  promises: {
    readFile(path: string, enc: string): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
  };
}

function bootVfs(): VfsModule {
  return boot().mod;
}

function boot(): { mod: VfsModule; Buffer: { from(s: string): Uint8Array } } {
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
    mod: runtime.realm.require('vfs') as unknown as VfsModule,
    Buffer: (runtime.realm.require('buffer') as { Buffer: { from(s: string): Uint8Array } })
      .Buffer,
  };
}

describe('vfs module', () => {
  it('exports the same names as Node (minus the two unsupported providers)', () => {
    const mod = bootVfs();
    expect(Object.keys(mod)).toEqual([
      'create',
      'VirtualFileSystem',
      'VirtualProvider',
      'MemoryProvider',
      'RealFSProvider',
      'ZipProvider',
    ]);
    // The providers we do not ship fail loudly instead of being undefined.
    expect(() => new mod.RealFSProvider()).toThrowError(
      /RealFSProvider is not supported/,
    );
    expect(() => new mod.ZipProvider()).toThrowError(/ZipProvider is not supported/);
  });
});

describe('VirtualFileSystem (matching node --experimental-vfs)', () => {
  it('reads and writes through the mounted provider', () => {
    const fs = bootVfs().create() as VfsFs;
    fs.writeFileSync('/a.txt', 'hello world');
    expect((fs.readFileSync('/a.txt', 'utf8') as string)).toBe('hello world');
    expect(fs.statSync('/a.txt').size).toBe(11);
    expect(fs.statSync('/a.txt').isFile()).toBe(true);
    expect(fs.statSync('/a.txt').isDirectory()).toBe(false);
  });

  it('walks directories recursively (both flat and with Dirents)', () => {
    const fs = bootVfs().create() as VfsFs;
    fs.mkdirSync('/d/e', { recursive: true });
    fs.writeFileSync('/d/e/f.txt', 'x');
    expect(fs.readdirSync('/d')).toEqual(['e']);
    expect(fs.readdirSync('/d', { recursive: true })).toEqual(['e', 'e/f.txt']);
    const dirents = fs.readdirSync('/d', { withFileTypes: true }) as Array<{
      name: string;
      isDirectory(): boolean;
    }>;
    expect(dirents.map((d) => `${d.name}:${d.isDirectory()}`)).toEqual(['e:true']);
  });

  it('round-trips a file descriptor', () => {
    const { mod, Buffer } = boot();
    const fs = mod.create() as VfsFs;
    const wfd = fs.openSync('/f.txt', 'w');
    fs.writeSync(wfd, Buffer.from('abcdef'), 0, 6, 0);
    fs.closeSync(wfd);
    const rfd = fs.openSync('/f.txt', 'r');
    const buf = new Uint8Array(3);
    expect(fs.readSync(rfd, buf, 0, 3, 1)).toBe(3);
    expect(String.fromCharCode(...buf)).toBe('bcd');
    fs.closeSync(rfd);
  });

  it('copies, renames, unlinks and appends', () => {
    const fs = bootVfs().create() as VfsFs;
    fs.writeFileSync('/a.txt', 'hello world');
    fs.copyFileSync('/a.txt', '/b.txt');
    expect(fs.readFileSync('/b.txt', 'utf8')).toBe('hello world');
    fs.renameSync('/b.txt', '/c.txt');
    expect(fs.existsSync('/b.txt')).toBe(false);
    expect(fs.existsSync('/c.txt')).toBe(true);
    fs.unlinkSync('/c.txt');
    expect(fs.existsSync('/c.txt')).toBe(false);
    fs.appendFileSync('/a.txt', '!');
    expect(fs.readFileSync('/a.txt', 'utf8')).toBe('hello world!');
  });

  it('reports realpath, mkdtemp, rm -r and directory stats', () => {
    const fs = bootVfs().create() as VfsFs;
    fs.writeFileSync('/a.txt', 'hi');
    expect(fs.realpathSync('/a.txt')).toBe('/a.txt');
    expect(fs.mkdtempSync('/tmp-')).toMatch(/^\/tmp-/);
    fs.mkdirSync('/sub');
    expect(fs.statSync('/sub').isDirectory()).toBe(true);
    expect(fs.lstatSync('/sub').isDirectory()).toBe(true);
    fs.rmSync('/sub', { recursive: true });
    expect(fs.existsSync('/sub')).toBe(false);
    // Nested recursive removal.
    fs.mkdirSync('/x/y/z', { recursive: true });
    fs.writeFileSync('/x/y/z/f', 'q');
    fs.rmSync('/x', { recursive: true });
    expect(fs.existsSync('/x')).toBe(false);
  });

  it('produces libuv-shaped errors', () => {
    const fs = bootVfs().create() as VfsFs;
    fs.writeFileSync('/a.txt', 'hi');
    try {
      fs.readFileSync('/missing');
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as { code: string; errno: number; message: string; name: string };
      expect(err.name).toBe('Error');
      expect(err.code).toBe('ENOENT');
      expect(err.errno).toBe(-2);
      expect(err.message).toBe("ENOENT: no such file or directory, open '/missing'");
    }
    try {
      fs.mkdirSync('/a.txt');
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as { code: string; message: string };
      expect(err.code).toBe('EEXIST');
      expect(err.message).toBe("EEXIST: file already exists, mkdir '/a.txt'");
    }
  });

  it('exposes a promise API', async () => {
    const fs = bootVfs().create() as VfsFs;
    await fs.promises.writeFile('/p.txt', 'promised');
    expect(await fs.promises.readFile('/p.txt', 'utf8')).toBe('promised');
    expect(await fs.promises.readdir('/')).toEqual(['p.txt']);
  });

  it('writes utf8 by byte length, not code-unit length', () => {
    const fs = bootVfs().create() as VfsFs;
    fs.writeFileSync('/u.txt', '\u4e2d\u6587');
    expect(fs.statSync('/u.txt').size).toBe(6);
  });
});
