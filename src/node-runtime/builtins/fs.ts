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
  deps: ['buffer', 'stream', 'events'],
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

    const Buffer = (ctx.require('buffer') as {
      Buffer: typeof Uint8Array & {
        from: (v: unknown, e?: string) => Uint8Array;
        allocUnsafe: (n: number) => Uint8Array;
      };
    }).Buffer;
    const { Readable, Writable } = ctx.require('stream') as {
      Readable: new (opts?: Record<string, unknown>) => StreamLike;
      Writable: new (opts?: Record<string, unknown>) => StreamLike;
    };

    interface StreamLike {
      on(name: string, fn: (...a: never[]) => void): unknown;
      once(name: string, fn: (...a: never[]) => void): unknown;
      emit(name: string, ...args: unknown[]): boolean;
      push(chunk: unknown): boolean;
      destroy(err?: Error): unknown;
    }

    const bindingCtx = ctx.binding;
    const vfs = bindingCtx.vfs;

    // `fs.watch` is a projection of VFS change events. A browser tab has no
    // inotify, so the only edits we can see are the ones written through this
    // VFS — which, for everything inside the runtime, is all of them.
    const { EventEmitter } = ctx.require('events') as {
      EventEmitter: new () => { on(name: string, fn: (...a: unknown[]) => void): unknown; emit(name: string, ...a: unknown[]): boolean };
    };
    type WatcherBase = { on(name: string, fn: (...a: unknown[]) => void): unknown; emit(name: string, ...a: unknown[]): boolean };
    class FSWatcher extends (EventEmitter as unknown as new () => WatcherBase) {
      #unsubscribe: (() => void) | null = null;
      #options: Record<string, unknown> = {};
      /** @internal — wired by `watch()`. */
      _attach(unsubscribe: () => void, options: Record<string, unknown>): void {
        this.#unsubscribe = unsubscribe;
        this.#options = options;
      }
      close(): void {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
      }
      ref(): this {
        return this;
      }
      unref(): this {
        return this;
      }
      get options(): Record<string, unknown> {
        return this.#options;
      }
    }

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

    // --- streams (fs.ReadStream / fs.WriteStream) ---

    const DEFAULT_CHUNK = 64 * 1024;

    function toBytes(data: unknown): Uint8Array {
      if (typeof data === 'string') return new TextEncoder().encode(data);
      if (data instanceof Uint8Array) return data;
      if (ArrayBuffer.isView(data)) {
        const v = data as ArrayBufferView;
        return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      }
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer');
    }

    interface ReadStreamOptions {
      flags?: string;
      mode?: number;
      start?: number;
      end?: number;
      highWaterMark?: number;
      autoClose?: boolean;
      encoding?: string;
    }

    interface WriteStreamOptions {
      flags?: string;
      mode?: number;
      start?: number;
      highWaterMark?: number;
      autoClose?: boolean;
      encoding?: string;
    }

    /**
     * `fs.createReadStream`. The VFS is synchronous, so `_read()` pulls the next
     * chunk on demand — which makes backpressure real rather than decorative:
     * a slow consumer simply stops calling `_read()`.
     */
    class ReadStream extends (Readable as new (opts?: Record<string, unknown>) => StreamLike) {
      path: string;
      fd: number | null = null;
      bytesRead = 0;
      pending = true;
      closed = false;

      #pos: number;
      #endPos: number;
      #chunkSize: number;
      #autoClose: boolean;
      #encoding: string | null;

      constructor(path: string, options: ReadStreamOptions = {}) {
        super({
          highWaterMark: options.highWaterMark ?? DEFAULT_CHUNK,
        });
        this.path = path;
        this.#pos = options.start ?? 0;
        this.#endPos = options.end ?? Number.POSITIVE_INFINITY;
        this.#chunkSize = options.highWaterMark ?? DEFAULT_CHUNK;
        this.#autoClose = options.autoClose !== false;
        this.#encoding = options.encoding ?? null;
      }

      _read(size: number): void {
        if (this.closed) {
          this.push(null);
          return;
        }
        if (this.fd === null) {
          try {
            this.fd = binding.openSync(this.path, 'r', 0o666);
          } catch (err) {
            this.destroy(err as Error);
            return;
          }
          this.pending = false;
          const fd = this.fd;
          bindingCtx.nextTick(() => {
            this.emit('open', fd);
            this.emit('ready');
          });
        }

        const want = Math.max(1, Math.min(this.#chunkSize, size > 0 ? size : this.#chunkSize));
        const remaining = this.#endPos - this.#pos + 1;
        if (remaining <= 0) {
          this.push(null);
          this.close();
          return;
        }
        const buf = Buffer.allocUnsafe(Math.min(want, remaining));
        let n: number;
        try {
          n = binding.readSync(this.fd, buf, 0, buf.byteLength, this.#pos);
        } catch (err) {
          this.destroy(err as Error);
          return;
        }
        if (n === 0) {
          this.push(null);
          this.close();
          return;
        }
        this.#pos += n;
        this.bytesRead += n;
        this.push(buf.subarray(0, n));
      }

      close(cb?: () => void): void {
        if (this.fd !== null) {
          try {
            binding.closeSync(this.fd);
          } catch {
            /* already closed */
          }
          this.fd = null;
        }
        this.closed = true;
        if (typeof cb === 'function') bindingCtx.nextTick(cb);
      }

      _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        if (this.#autoClose) this.close();
        cb(err);
      }
    }

    /** `fs.createWriteStream` — one `writeSync` per chunk, `finish` after `_final`. */
    class WriteStream extends (Writable as new (opts?: Record<string, unknown>) => StreamLike) {
      path: string;
      fd: number | null = null;
      bytesWritten = 0;
      pending = true;
      closed = false;

      #flags: string;
      #mode: number;
      #pos: number | null;
      #autoClose: boolean;

      constructor(path: string, options: WriteStreamOptions = {}) {
        super({ highWaterMark: options.highWaterMark ?? DEFAULT_CHUNK });
        this.path = path;
        this.#flags = options.flags ?? 'w';
        this.#mode = options.mode ?? 0o666;
        this.#pos = typeof options.start === 'number' ? options.start : null;
        this.#autoClose = options.autoClose !== false;
      }

      #ensureOpen(): void {
        if (this.fd !== null) return;
        this.fd = binding.openSync(this.path, this.#flags, this.#mode);
        this.pending = false;
        const fd = this.fd;
        bindingCtx.nextTick(() => {
          this.emit('open', fd);
          this.emit('ready');
        });
      }

      _write(chunk: unknown, _enc: string, cb: (err?: Error | null) => void): void {
        try {
          this.#ensureOpen();
          const bytes = toBytes(chunk);
          const n = binding.writeSync(this.fd as number, bytes, 0, bytes.byteLength, this.#pos);
          this.bytesWritten += n;
          if (this.#pos !== null) this.#pos += n;
          cb(null);
        } catch (err) {
          cb(err as Error);
        }
      }

      close(cb?: () => void): void {
        if (this.fd !== null) {
          try {
            binding.closeSync(this.fd);
          } catch {
            /* already closed */
          }
          this.fd = null;
        }
        this.closed = true;
        if (typeof cb === 'function') bindingCtx.nextTick(cb);
      }

      _final(cb: (err?: Error | null) => void): void {
        if (this.#autoClose) this.close();
        cb(null);
      }

      _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        if (this.#autoClose) this.close();
        cb(err);
      }
    }

    function createReadStream(path: string, options?: ReadStreamOptions | string): ReadStream {
      const opts = typeof options === 'string' ? { encoding: options } : options ?? {};
      if (typeof path !== 'string') throw new TypeError('The "path" argument must be of type string');
      return new ReadStream(path, opts);
    }

    function createWriteStream(path: string, options?: WriteStreamOptions | string): WriteStream {
      const opts = typeof options === 'string' ? { encoding: options } : options ?? {};
      if (typeof path !== 'string') throw new TypeError('The "path" argument must be of type string');
      return new WriteStream(path, opts);
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
      // Node exposes `fs.realpathSync.native` (a faster C++ path). Bundlers
      // feature-detect it (`fs.realpathSync.native ?? fs.realpathSync`).
      realpathSync: Object.assign((p: string) => binding.realpathSync(p), {
        native: (p: string) => binding.realpathSync(p),
      }),
      // `fs.openAsBlob(path[, options])` (lib/fs.js): an fd-backed Blob that
      // is read incrementally. Every byte source here is memory resident, so
      // it resolves to a Blob over the file's bytes. The promise wrapper
      // matches Node (it leaves room for an async implementation later).
      openAsBlob: (p: string, options: { type?: string } = {}) => {
        const { createBlobFromFilePath } = ctx.require('internal/blob') as {
          createBlobFromFilePath: (path: string, opts: { type?: string }) => unknown;
        };
        return Promise.resolve(createBlobFromFilePath(vfs.resolve(p), { type: options?.type }));
      },
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
      // Glob matching is the vendored real `internal/fs/glob.js` (the walker plus
      // the bundled minimatch matcher). Loaded lazily: at init time `fs` is still
      // being built and the module requires `fs` / `fs/promises` back.
      glob: (pattern: string, options?: unknown, callback?: (err: Error | null, matches?: string[]) => void) => {
        let cb = callback;
        let opts = options;
        if (typeof options === 'function') {
          cb = options as (err: Error | null, matches?: string[]) => void;
          opts = undefined;
        }
        if (typeof cb !== 'function') {
          throw new TypeError('The "callback" argument must be of type function');
        }
        const done = cb;
        const { Glob } = ctx.require('internal/fs/glob') as {
          Glob: new (p: string, o?: unknown) => { glob: () => AsyncIterable<string> };
        };
        void (async () => {
          const out: string[] = [];
          for await (const entry of new Glob(pattern, opts).glob()) out.push(entry);
          return out;
        })().then(
          (res) => done(null, res),
          (err: Error) => done(err),
        );
      },
      globSync: (pattern: string, options?: unknown): string[] => {
        const { Glob } = ctx.require('internal/fs/glob') as {
          Glob: new (p: string, o?: unknown) => { globSync: () => string[] };
        };
        return new Glob(pattern, options).globSync();
      },
      watch: (p: string, options?: unknown, listener?: unknown) => {
        const opts = typeof options === 'function' ? undefined : (options as { recursive?: boolean } | undefined);
        const callback = (typeof options === 'function' ? options : listener) as
          | ((eventType: string, filename: string | null) => void)
          | undefined;
        const target = vfs.resolve(p);
        const isDir = (() => {
          try {
            return vfs.stat(target).type === 'dir';
          } catch {
            return false;
          }
        })();
        const scope = target === '/' ? '/' : target + '/';
        const emitter = new FSWatcher();
        const unsubscribe = vfs.subscribe((change) => {
          if (change.path !== target && !change.path.startsWith(scope)) return;
          // Node reports `rename` for create/delete and `change` for edits; for a
          // directory the filename is the basename that moved.
          const filename = isDir
            ? change.path === target
              ? ''
              : change.path.slice(scope.length)
            : (target.split('/').pop() ?? '');
          const eventType = change.type === 'change' ? 'change' : 'rename';
          callback?.(eventType, filename);
          emitter.emit('change', eventType, filename);
        });
        emitter._attach(unsubscribe, { recursive: !!opts?.recursive, path: target, isDir });
        return emitter;
      },
      createReadStream,
      createWriteStream,
      ReadStream,
      WriteStream,
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
    promises.glob = async function* (pattern: string, options?: unknown): AsyncGenerator<string> {
      const { Glob } = ctx.require('internal/fs/glob') as {
        Glob: new (p: string, o?: unknown) => { glob: () => AsyncIterable<string> };
      };
      yield* new Glob(pattern, options).glob();
    };

    fs.promises = promises;
    void vfs;
    void finish;

    return fs;
  },
};
