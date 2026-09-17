import type { BuiltinSpec, BuiltinInitContext } from './types';
import type { VirtualSocket } from '../net/network';
import type { VirtualNetwork } from '../net/network';

/**
 * `net` builtin — a TS equivalent implementation over the virtual network.
 *
 * This is deliberately *not* vendored `lib/net.js`: real Node's net.js is built
 * on streams, `async_wrap`, `stream_base_commons` and `tcp_wrap`, which drags in
 * dozens of files. We implement the observable surface user code actually
 * touches (Server/Socket events + read/write) directly on VirtualSocket, and
 * mark the module `origin: 'web-node'` so `describe()` never claims otherwise.
 */
export const netSpec: BuiltinSpec = {
  id: 'net',
  aliases: ['node:net'],
  origin: 'web-node',
  deps: ['events'],
  init: (ctx: BuiltinInitContext) => {
    const { EventEmitter } = ctx.require('events') as { EventEmitter: new () => EmitterLike };
    const network = ctx.binding.network;

    interface EmitterLike {
      on(name: string, fn: (...a: never[]) => void): unknown;
      emit(name: string, ...args: unknown[]): boolean;
      once(name: string, fn: (...a: never[]) => void): unknown;
      removeListener(name: string, fn: (...a: never[]) => void): unknown;
    }

    const kAttached = Symbol('web-node.socket.side');

    class Socket extends (EventEmitter as new () => EmitterLike) {
      connecting = false;
      destroyed = false;
      pending = false;
      readyState = 'closed';
      remoteAddress = '127.0.0.1';
      remoteFamily = 'IPv4';
      remotePort = 0;
      localAddress = '127.0.0.1';
      localPort = 0;
      bytesRead = 0;
      bytesWritten = 0;
      bufferSize = 0;
      timeout = 0;

      #vsock: VirtualSocket | null = null;
      #encoding: string | null = null;

      /** @internal */
      _attach(vsock: VirtualSocket, side: 'client' | 'server'): void {
        this.#vsock = vsock;
        (this as unknown as Record<symbol, unknown>)[kAttached] = side;
        this.remotePort = vsock.remotePort;
        this.localPort = vsock.localPort;
        this.readyState = 'open';
        vsock.onData((chunk) => {
          this.bytesRead += chunk.byteLength;
          this.emit('data', this.#encoding ? new TextDecoder(this.#encoding).decode(chunk) : toBuffer(ctx, chunk));
        });
        vsock.onEnd(() => {
          this.readyState = 'readOnly';
          this.emit('end');
        });
        vsock.onClose(() => this.#onClose());
        vsock.onError((err) => this.emit('error', err));
      }

      #onClose(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.readyState = 'closed';
        this.emit('close', false);
      }

      /** Dial a virtual port. Mirrors `socket.connect(port[, host][, cb])`. */
      connect(port: number, host?: string | (() => void), cb?: () => void): this {
        if (typeof host === 'function') {
          cb = host;
          host = undefined;
        }
        this.connecting = true;
        this.readyState = 'opening';
        let vsock: VirtualSocket;
        try {
          vsock = network.dial(port);
        } catch (err) {
          this.connecting = false;
          this.readyState = 'closed';
          this.destroyed = true;
          ctx.binding.nextTick(() => this.emit('error', err as Error));
          return this;
        }
        this._attach(vsock, 'client');
        this.connecting = false;
        ctx.binding.nextTick(() => {
          this.emit('connect');
          if (typeof cb === 'function') cb();
        });
        return this;
      }

      write(data: unknown, enc?: unknown, cb?: () => void): boolean {
        if (typeof enc === 'function') {
          cb = enc as () => void;
          enc = undefined;
        }
        const vsock = this.#vsock;
        if (!vsock || this.destroyed) {
          const err = Object.assign(new Error('This socket has been ended by the other party'), { code: 'EPIPE' });
          if (typeof cb === 'function') ctx.binding.nextTick(() => (cb as (e: Error) => void)(err));
          else ctx.binding.nextTick(() => this.emit('error', err));
          return false;
        }
        const bytes = toBytes(data);
        this.bytesWritten += bytes.byteLength;
        vsock.write(bytes);
        if (typeof cb === 'function') ctx.binding.nextTick(cb as () => void);
        return true;
      }

      end(data?: unknown, enc?: unknown, cb?: () => void): this {
        if (typeof data === 'function') {
          cb = data as () => void;
          data = undefined;
        } else if (typeof enc === 'function') {
          cb = enc as () => void;
          enc = undefined;
        }
        if (data !== undefined) this.write(data);
        this.readyState = 'readOnly';
        this.#vsock?.end();
        if (typeof cb === 'function') ctx.binding.nextTick(cb as () => void);
        return this;
      }

      destroy(err?: Error): this {
        if (this.destroyed) return this;
        this.#vsock?.destroy(err);
        if (!this.#vsock) this.#onClose();
        return this;
      }

      setEncoding(enc: string): this {
        this.#encoding = enc;
        return this;
      }

      setNoDelay(): this {
        return this;
      }
      setKeepAlive(): this {
        return this;
      }
      setTimeout(ms: number, cb?: () => void): this {
        this.timeout = ms;
        if (typeof cb === 'function') this.once('timeout', cb as never);
        return this;
      }
      ref(): this {
        return this;
      }
      unref(): this {
        return this;
      }
      address(): { address: string; family: string; port: number } {
        return { address: this.localAddress, family: 'IPv4', port: this.localPort };
      }

      /** Total queued bytes — always 0 here, writes go straight to the pipe. */
      get writableLength(): number {
        return 0;
      }
      get readableLength(): number {
        return 0;
      }
    }

    class Server extends (EventEmitter as new () => EmitterLike) {
      listening = false;
      maxConnections = Infinity;
      connections = 0;

      #port = 0;
      #host = '127.0.0.1';

      constructor(connectionListener?: (socket: Socket) => void) {
        super();
        if (typeof connectionListener === 'function') this.on('connection', connectionListener as never);
      }

      listen(...args: unknown[]): this {
        let port = 0;
        let host = '127.0.0.1';
        let cb: (() => void) | undefined;

        if (typeof args[0] === 'object' && args[0] !== null) {
          const opts = args[0] as { port?: number; host?: string };
          port = opts.port ?? 0;
          host = opts.host ?? host;
          if (typeof args[1] === 'function') cb = args[1] as () => void;
        } else {
          port = typeof args[0] === 'number' ? args[0] : Number(args[0] ?? 0);
          let i = 1;
          if (typeof args[i] === 'string') host = args[i++] as string;
          if (typeof args[i] === 'number') i++; // backlog, ignored
          if (typeof args[i] === 'function') cb = args[i] as () => void;
        }

        if (port === 0) port = pickEphemeralPort(network);
        this.#port = port;
        this.#host = host;

        try {
          network.listen(port, (vsock) => {
            this.connections++;
            const socket = new Socket();
            socket.once('close' as never, () => {
              this.connections--;
            });
            socket._attach(vsock, 'server');
            this.emit('connection', socket);
          });
        } catch (err) {
          ctx.binding.nextTick(() => this.emit('error', err as Error));
          return this;
        }

        this.listening = true;
        ctx.binding.nextTick(() => {
          this.emit('listening');
          if (typeof cb === 'function') cb();
        });
        return this;
      }

      close(cb?: (err?: Error) => void): this {
        if (this.listening) network.unlisten(this.#port);
        this.listening = false;
        ctx.binding.nextTick(() => {
          this.emit('close');
          if (typeof cb === 'function') cb();
        });
        return this;
      }

      address(): { address: string; family: string; port: number } | null {
        if (!this.listening) return null;
        return { address: this.#host, family: 'IPv4', port: this.#port };
      }

      ref(): this {
        return this;
      }
      unref(): this {
        return this;
      }
      getConnections(cb: (err: Error | null, count: number) => void): void {
        ctx.binding.nextTick(() => cb(null, this.connections));
      }
    }

    function pickEphemeralPort(network: VirtualNetwork): number {
      for (let i = 0; i < 200; i++) {
        const candidate = 30000 + Math.floor(Math.random() * 10000);
        if (!network.isListening(candidate)) return candidate;
      }
      throw new Error('EADDRINUSE: could not find a free ephemeral port');
    }

    function toBytes(data: unknown): Uint8Array {
      if (typeof data === 'string') return new TextEncoder().encode(data);
      if (data instanceof Uint8Array) return data;
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer, ArrayBuffer, or Array');
    }

    function toBuffer(ctx: BuiltinInitContext, bytes: Uint8Array): unknown {
      const { Buffer } = ctx.require('buffer') as { Buffer: { from(b: Uint8Array): unknown } };
      return Buffer.from(bytes);
    }

    function isIP(input: unknown): number {
      if (typeof input !== 'string') return 0;
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(input)) return 4;
      if (input.includes(':')) return 6;
      return 0;
    }

    return {
      Server,
      Socket,
      createServer: (connectionListener?: (socket: Socket) => void) => new Server(connectionListener),
      createConnection: (port: number, host?: string, cb?: () => void) => new Socket().connect(port, host, cb),
      connect: (port: number, host?: string, cb?: () => void) => new Socket().connect(port, host, cb),
      isIP,
      isIPv4: (v: unknown) => isIP(v) === 4,
      isIPv6: (v: unknown) => isIP(v) === 6,
      default: { Server, Socket },
      /** Non-standard, for tests + the ServiceWorker bridge. */
      _network: network,
    };
  },
};
