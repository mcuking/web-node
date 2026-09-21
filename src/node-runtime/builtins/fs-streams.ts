import type { BuiltinSpec, BuiltinInitContext } from './types';

/**
 * `internal/fs/streams` — a web-node shim.
 *
 * Node's real `lib/internal/fs/streams.js` top-level `require('fs')`s back,
 * which our pre-instantiation loader cannot resolve (the `fs` module would
 * still be mid-evaluation). Rather than fight the cycle, `fs.ReadStream` /
 * `fs.WriteStream` are implemented here over the `fs` binding. The VFS is
 * synchronous, so a stream's `_read()`/`_write()` pull/push on demand, which
 * makes backpressure real rather than decorative.
 */

type StreamLike = {
  on(name: string, fn: (...a: never[]) => void): unknown;
  once(name: string, fn: (...a: never[]) => void): unknown;
  emit(name: string, ...args: unknown[]): boolean;
  push(chunk: unknown): boolean;
  destroy(err?: Error): unknown;
};

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

export const internalFsStreamsSpec: BuiltinSpec = {
  id: 'internal/fs/streams',
  origin: 'web-node',
  deps: ['buffer', 'stream', 'events'],
  init: (ctx: BuiltinInitContext) => {
    const binding = ctx.internalBinding('fs') as {
      openSync(p: string, f: string, m: number): number;
      closeSync(fd: number): void;
      readSync(fd: number, b: Uint8Array, o: number, l: number, p: number | null): number;
      writeSync(fd: number, b: Uint8Array, o: number, l: number, p: number | null): number;
    };
    const Buffer = (ctx.require('buffer') as {
      Buffer: typeof Uint8Array & { allocUnsafe(n: number): Uint8Array };
    }).Buffer;
    const { Readable, Writable } = ctx.require('stream') as {
      Readable: new (opts?: Record<string, unknown>) => StreamLike;
      Writable: new (opts?: Record<string, unknown>) => StreamLike;
    };
    const bindingCtx = ctx.binding;

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
        super({ highWaterMark: options.highWaterMark ?? DEFAULT_CHUNK });
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
        void this.#encoding;
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

    return {
      ReadStream,
      WriteStream,
      // `lib/fs.js` calls these to build the streams.
      createReadStream: (path: string, options?: ReadStreamOptions | string) => {
        const opts = typeof options === 'string' ? { encoding: options } : options ?? {};
        return new ReadStream(path, opts);
      },
      createWriteStream: (path: string, options?: WriteStreamOptions | string) => {
        const opts = typeof options === 'string' ? { encoding: options } : options ?? {};
        return new WriteStream(path, opts);
      },
    };
  },
};
