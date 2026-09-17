import type { BuiltinSpec, BuiltinInitContext } from './types';

/**
 * `fs` builtin — layered on `internalBinding('fs')`, which is itself layered on
 * the VFS. Sync APIs are the source of truth; callback APIs are deferred via
 * nextTick; `fs.promises` wraps the callback APIs in promises.
 */
export const fsSpec: BuiltinSpec = {
  id: 'fs',
  aliases: ['node:fs'],
  origin: 'web-node',
  deps: ['buffer'],
  init: (ctx: BuiltinInitContext) => {
    const binding = ctx.internalBinding('fs') as {
      openSync(p: string, f: string, m: number): number;
      closeSync(fd: number): void;
      readSync(fd: number, b: Uint8Array, o: number, l: number, p: number | null): number;
      writeSync(fd: number, b: Uint8Array, o: number, l: number, p: number | null): number;
      statSync(p: string): Record<string, unknown>;
      lstatSync(p: string): Record<string, unknown>;
      fstatSync(fd: number): Record<string, unknown>;
      existsSync(p: string): boolean;
      readFileSync(p: string): Uint8Array;
      writeFileSync(p: string, d: Uint8Array, f?: string): void;
      appendFileSync(p: string, d: Uint8Array): void;
      readdirSync(p: string, e?: unknown, withFileTypes?: boolean): Array<{ name: string; type: string }>;
      mkdirSync(p: string, o?: { recursive?: boolean; mode?: number }): void;
      rmdirSync(p: string, o?: { recursive?: boolean }): void;
      unlinkSync(p: string): void;
      renameSync(f: string, t: string): void;
      copyFileSync(f: string, t: string): void;
      chmodSync(p: string, m: number): void;
      accessSync(p: string): void;
      ftruncateSync(fd: number, l?: number): void;
      fsyncSync(): void;
      realpathSync(p: string): string;
      rmSync(p: string, o?: { recursive?: boolean; force?: boolean }): void;
    };

    const Buffer = (ctx.require('buffer') as { Buffer: typeof Uint8Array & { from: (v: unknown, e?: string) => Uint8Array } })
      .Buffer;
    const bindingCtx = ctx.binding;
    const vfs = bindingCtx.vfs;

    function toBuffer(data: Uint8Array): Uint8Array {
      return (Buffer as unknown as { from(v: unknown): Uint8Array }).from(data);
    }

    function coerceData(data: unknown, encoding?: string): Uint8Array {
      if (typeof data === 'string') {
        return (Buffer as unknown as { from(v: string, e?: string): Uint8Array }).from(data, encoding ?? 'utf8');
      }
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      throw new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView');
    }

    function finish(result: string | Uint8Array, encoding?: string | null): string | Uint8Array {
      if (typeof encoding === 'string' && encoding !== 'buffer') {
        return (result as Uint8Array).toString
          ? new TextDecoder(encoding === 'utf8' || encoding === 'utf-8' ? 'utf-8' : 'utf-8').decode(result as Uint8Array)
          : String(result);
      }
      return result;
    }

    function readFileSync(path: string, options?: string | { encoding?: string | null } | null): string | Uint8Array {
      const bytes = toBuffer(binding.readFileSync(path));
      const encoding = typeof options === 'string' ? options : options?.encoding ?? null;
      if (encoding) return (bytes as Uint8Array & { toString(e?: string): string }).toString(encoding);
      return bytes;
    }

    function writeFileSync(path: string, data: unknown, options?: string | { encoding?: string; flag?: string; mode?: number } | null): void {
      const flag = typeof options === 'string' ? 'w' : options?.flag ?? 'w';
      binding.writeFileSync(path, coerceData(data, typeof options === 'string' ? options : options?.encoding), flag);
    }

    function appendFileSync(path: string, data: unknown, options?: string | { encoding?: string } | null): void {
      binding.appendFileSync(path, coerceData(data, typeof options === 'string' ? options : options?.encoding));
    }

    function readdirSync(path: string, options?: string | { withFileTypes?: boolean; encoding?: string } | null): unknown[] {
      const withFileTypes = typeof options === 'object' && options !== null ? !!options.withFileTypes : false;
      const entries = binding.readdirSync(path, undefined, withFileTypes);
      if (withFileTypes) {
        return entries.map((e) => ({
          name: e.name,
          parentPath: path,
          path,
          isFile: () => e.type === 'file',
          isDirectory: () => e.type === 'dir',
          isSymbolicLink: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        }));
      }
      return entries.map((e) => e.name);
    }

    // --- callback wrappers ---
    function cb<T>(fn: () => T, callback?: (err: Error | null, r?: T) => void): void {
      bindingCtx.nextTick(() => {
        if (typeof callback !== 'function') return;
        try {
          callback(null, fn());
        } catch (err) {
          callback(err as Error);
        }
      });
    }

    const fs: Record<string, any> = {
      constants: {
        F_OK: 0,
        R_OK: 4,
        W_OK: 2,
        X_OK: 1,
        COPYFILE_EXCL: 1,
        O_RDONLY: 0,
        O_WRONLY: 1,
        O_RDWR: 2,
        O_CREAT: 64,
        O_EXCL: 128,
        O_TRUNC: 512,
        O_APPEND: 1024,
      },
      // sync
      readFileSync,
      writeFileSync,
      appendFileSync,
      existsSync: (p: string) => binding.existsSync(p),
      statSync: (p: string) => binding.statSync(p),
      lstatSync: (p: string) => binding.lstatSync(p),
      fstatSync: (fd: number) => binding.fstatSync(fd),
      readdirSync,
      mkdirSync: (p: string, o?: { recursive?: boolean; mode?: number }) => binding.mkdirSync(p, o),
      rmdirSync: (p: string, o?: { recursive?: boolean }) => binding.rmdirSync(p, o),
      unlinkSync: (p: string) => binding.unlinkSync(p),
      rmSync: (p: string, o?: { recursive?: boolean; force?: boolean }) => binding.rmSync(p, o),
      renameSync: (f: string, t: string) => binding.renameSync(f, t),
      copyFileSync: (f: string, t: string) => binding.copyFileSync(f, t),
      chmodSync: (p: string, m: number) => binding.chmodSync(p, m),
      accessSync: (p: string) => binding.accessSync(p),
      truncateSync: (p: string, len = 0) => {
        const fd = binding.openSync(p, 'r+', 0o666);
        try {
          binding.ftruncateSync(fd, len);
        } finally {
          binding.closeSync(fd);
        }
      },
      openSync: (p: string, f = 'r', m = 0o666) => binding.openSync(p, f, m),
      closeSync: (fd: number) => binding.closeSync(fd),
      readSync: (fd: number, b: Uint8Array, o = 0, l = b.byteLength - o, p: number | null = null) =>
        binding.readSync(fd, b, o, l, p),
      writeSync: (fd: number, b: Uint8Array, o = 0, l = b.byteLength - o, p: number | null = null) =>
        binding.writeSync(fd, b, o, l, p),
      realpathSync: (p: string) => binding.realpathSync(p),
      readFile: (p: string, o: unknown, c?: (e: Error | null, d?: unknown) => void) => {
        const callback = typeof o === 'function' ? (o as (e: Error | null, d?: unknown) => void) : c!;
        const options = typeof o === 'function' ? undefined : o;
        cb(() => readFileSync(p, options as never), callback);
      },
      writeFile: (p: string, data: unknown, o: unknown, c?: (e: Error | null) => void) => {
        const callback = typeof o === 'function' ? (o as (e: Error | null) => void) : c!;
        const options = typeof o === 'function' ? undefined : o;
        cb(() => writeFileSync(p, data, options as never), callback);
      },
      appendFile: (p: string, data: unknown, o: unknown, c?: (e: Error | null) => void) => {
        const callback = typeof o === 'function' ? (o as (e: Error | null) => void) : c!;
        cb(() => appendFileSync(p, data), callback);
      },
      stat: (p: string, c: (e: Error | null, s?: unknown) => void) => cb(() => binding.statSync(p), c),
      lstat: (p: string, c: (e: Error | null, s?: unknown) => void) => cb(() => binding.lstatSync(p), c),
      readdir: (p: string, o: unknown, c?: (e: Error | null, d?: unknown) => void) => {
        const callback = typeof o === 'function' ? (o as (e: Error | null, d?: unknown) => void) : c!;
        const options = typeof o === 'function' ? undefined : o;
        cb(() => readdirSync(p, options as never), callback);
      },
      mkdir: (p: string, o: unknown, c?: (e: Error | null) => void) => {
        const callback = typeof o === 'function' ? (o as (e: Error | null) => void) : c!;
        const options = typeof o === 'function' ? undefined : o;
        cb(() => binding.mkdirSync(p, options as never), callback);
      },
      rmdir: (p: string, o: unknown, c?: (e: Error | null) => void) => {
        const callback = typeof o === 'function' ? (o as (e: Error | null) => void) : c!;
        const options = typeof o === 'function' ? undefined : o;
        cb(() => binding.rmdirSync(p, options as never), callback);
      },
      unlink: (p: string, c: (e: Error | null) => void) => cb(() => binding.unlinkSync(p), c),
      rm: (p: string, o: unknown, c?: (e: Error | null) => void) => {
        const callback = typeof o === 'function' ? (o as (e: Error | null) => void) : c!;
        const options = typeof o === 'function' ? undefined : o;
        cb(() => binding.rmSync(p, options as never), callback);
      },
      rename: (f: string, t: string, c: (e: Error | null) => void) => cb(() => binding.renameSync(f, t), c),
      copyFile: (f: string, t: string, c: (e: Error | null) => void) => cb(() => binding.copyFileSync(f, t), c),
      chmod: (p: string, m: number, c: (e: Error | null) => void) => cb(() => binding.chmodSync(p, m), c),
      access: (p: string, m: unknown, c?: (e: Error | null) => void) => {
        const callback = typeof m === 'function' ? (m as (e: Error | null) => void) : c!;
        cb(() => binding.accessSync(p), callback);
      },
      exists: (p: string, c: (exists: boolean) => void) => cb(() => binding.existsSync(p), c as never),
      open: (p: string, f: unknown, m: unknown, c?: (e: Error | null, fd?: number) => void) => {
        const callback = typeof m === 'function' ? (m as (e: Error | null, fd?: number) => void) : c!;
        const mode = typeof m === 'number' ? m : 0o666;
        cb(() => binding.openSync(p, typeof f === 'string' ? f : 'r', mode), callback);
      },
      close: (fd: number, c: (e: Error | null) => void) => cb(() => binding.closeSync(fd), c),
      read: (fd: number, b: Uint8Array, o: number, l: number, pos: number | null, c: (e: Error | null, n?: number) => void) =>
        cb(() => binding.readSync(fd, b, o, l, pos), c),
      write: (fd: number, b: Uint8Array, o: number, l: number, pos: number | null, c: (e: Error | null, n?: number) => void) =>
        cb(() => binding.writeSync(fd, b, o, l, pos), c),
      realpath: (p: string, c: (e: Error | null, r?: string) => void) => cb(() => binding.realpathSync(p), c),
      watch: () => {
        throw new Error('fs.watch is not supported in web-node');
      },
      createReadStream: () => {
        throw new Error('fs.createReadStream is not supported in web-node (streams milestone pending)');
      },
      createWriteStream: () => {
        throw new Error('fs.createWriteStream is not supported in web-node (streams milestone pending)');
      },
    };

    // fs.promises
    const promises: Record<string, unknown> = {};
    type Cb<R> = (err: Error | null, r?: R) => void;
    const promisify =
      (fn: (...args: any[]) => void) =>
      (...args: any[]): Promise<any> =>
        new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, r?: unknown) => (err ? reject(err) : resolve(r)));
        });

    promises.readFile = promisify((...a: any[]) => (fs.readFile as (...x: any[]) => void)(...a));
    promises.writeFile = promisify((...a: any[]) => (fs.writeFile as (...x: any[]) => void)(...a));
    promises.appendFile = promisify((p: string, d: unknown, c: Cb<void>) => (fs.appendFile as (...x: any[]) => void)(p, d, undefined, c));
    promises.mkdir = promisify((...a: any[]) => (fs.mkdir as (...x: any[]) => void)(...a));
    promises.readdir = promisify((...a: any[]) => (fs.readdir as (...x: any[]) => void)(...a));
    promises.rmdir = promisify((...a: any[]) => (fs.rmdir as (...x: any[]) => void)(...a));
    promises.rm = promisify((...a: any[]) => (fs.rm as (...x: any[]) => void)(...a));
    promises.unlink = promisify((...a: any[]) => (fs.unlink as (...x: any[]) => void)(...a));
    promises.rename = promisify((...a: any[]) => (fs.rename as (...x: any[]) => void)(...a));
    promises.copyFile = promisify((...a: any[]) => (fs.copyFile as (...x: any[]) => void)(...a));
    promises.stat = promisify((...a: any[]) => (fs.stat as (...x: any[]) => void)(...a));
    promises.lstat = promisify((...a: any[]) => (fs.lstat as (...x: any[]) => void)(...a));
    promises.access = promisify((p: string, c: Cb<void>) => (fs.access as (...x: any[]) => void)(p, undefined, c));
    promises.chmod = promisify((...a: any[]) => (fs.chmod as (...x: any[]) => void)(...a));
    promises.open = promisify((...a: any[]) => (fs.open as (...x: any[]) => void)(...a));
    promises.realpath = promisify((...a: any[]) => (fs.realpath as (...x: any[]) => void)(...a));
    promises.constants = (fs as { constants: unknown }).constants;

    fs.promises = promises;
    void vfs;
    void finish;

    return fs;
  },
};
