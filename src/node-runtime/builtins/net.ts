import type { BuiltinSpec, BuiltinInitContext } from './types';
import type { VirtualSocket } from '../net/network';
import type { VirtualNetwork } from '../net/network';
import { createAddressTypes, type AddressTypes, type NetAddressErrorCodes } from '../net/socket-address';
import { notImplemented } from '../errors';

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
  arity: { Server: 2, Socket: 1, Stream: 1, connect: 0, createConnection: 0, createServer: 2, _createServerHandle: 5, _normalizeArgs: 1 },
  deps: ['events'],
  init: (ctx: BuiltinInitContext) => {
    const { EventEmitter } = ctx.require('events') as { EventEmitter: new () => EmitterLike };
    // net.Socket is a Duplex in Node; extending the vendored stream.Duplex gives
    // us the whole readable/writable/duplex surface (pipe, pause, resume, …)
    // instead of a hand-rolled subset.
    const { Duplex } = ctx.require('stream') as { Duplex: new (opts?: unknown) => EmitterLike };
    const network = ctx.binding.network;

    interface EmitterLike {
      on(name: string, fn: (...a: never[]) => void): unknown;
      emit(name: string, ...args: unknown[]): boolean;
      once(name: string, fn: (...a: never[]) => void): unknown;
      removeListener(name: string, fn: (...a: never[]) => void): unknown;
    }

    /** The slice of `stream.Duplex` the Socket surface reads. */
    interface StreamLike extends EmitterLike {
      readonly readable: boolean;
      readonly writable: boolean;
      readonly writableLength: number;
      readonly writableFinished: boolean;
      readonly destroyed: boolean;
      push(chunk: unknown): boolean;
      end(cb?: () => void): void;
      destroy(error?: Error): void;
      setEncoding(enc: string): unknown;
    }

    const kAttached = Symbol('web-node.socket.side');

    class Socket extends (Duplex as new (opts?: unknown) => StreamLike) {
      connecting = false;
      /** Set only by `setTimeout` (Node leaves it absent otherwise). */
      declare timeout: number | undefined;

      #vsock: VirtualSocket | null = null;
      #encoding: string | null = null;
      #peername: { address?: string; family?: string; port?: number } | undefined;
      #sockname: { address?: string; family?: string; port?: number } | undefined;
      #bytesRead = 0;
      #bytesWritten = 0;
      #setTOS: number | undefined;

      constructor(options?: { allowHalfOpen?: boolean }) {
        // Node's default is `allowHalfOpen: false` (a half-close ends both sides).
        super({ allowHalfOpen: options?.allowHalfOpen ?? false });
      }

      // --- Node's prototype accessors (lib/net.js) --------------------------
      /** @internal — the virtual socket stands in for the native handle. */
      get _handle(): VirtualSocket | null {
        return this.#vsock;
      }
      set _handle(handle: VirtualSocket | null) {
        this.#vsock = handle;
      }

      /** @internal */
      get _connecting(): boolean {
        return this.connecting;
      }

      get pending(): boolean {
        return !this.#vsock || this.connecting;
      }

      get readyState(): string {
        if (this.connecting) return 'opening';
        if (this.readable && this.writable) return 'open';
        if (this.readable && !this.writable) return 'readOnly';
        if (!this.readable && this.writable) return 'writeOnly';
        return 'closed';
      }

      get bufferSize(): number | undefined {
        if (this.#vsock) return this.writableLength;
        return undefined;
      }

      get bytesRead(): number {
        return this.#bytesRead;
      }

      get bytesWritten(): number {
        return this.#bytesWritten;
      }

      /** @internal — Node returns the handle's dispatched count. */
      get _bytesDispatched(): number {
        return this.#bytesWritten;
      }

      get remoteAddress(): string | undefined {
        return this._getpeername().address;
      }
      get remoteFamily(): string | undefined {
        return this._getpeername().family;
      }
      get remotePort(): number | undefined {
        return this._getpeername().port;
      }
      get localAddress(): string | undefined {
        return this._getsockname().address;
      }
      get localPort(): number | undefined {
        return this._getsockname().port;
      }
      get localFamily(): string | undefined {
        return this._getsockname().family;
      }

      /** @internal */
      _getpeername(): { address?: string; family?: string; port?: number } {
        return this.#peername ?? {};
      }

      /** @internal */
      _getsockname(): { address?: string; family?: string; port?: number } {
        return this.#sockname ?? {};
      }

      /** @internal — the timer is owned by the host; nothing to unreference. */
      _unrefTimer(): void {}

      /** @internal */
      _onTimeout(): void {
        this.emit('timeout');
      }

      getTypeOfService(): number {
        return this.#setTOS ?? 0;
      }

      setTypeOfService(tos: unknown): this {
        if (typeof tos !== 'number' || Number.isNaN(tos)) {
          throw new TypeError('The "tos" argument must be of type number');
        }
        if (!Number.isInteger(tos) || tos < 0 || tos > 255) {
          throw new RangeError(
            `The value of "tos" is out of range. It must be >= 0 and <= 255. Received ${tos}`,
          );
        }
        this.#setTOS = tos;
        return this;
      }

      resetAndDestroy(): this {
        if (!this.#vsock) {
          this.destroy(Object.assign(new Error('Socket is closed'), { code: 'ERR_SOCKET_CLOSED' }));
        } else if (this.connecting) {
          this.once('connect' as never, () => this._reset());
        } else {
          this._reset();
        }
        return this;
      }

      /** @internal */
      _reset(): void {
        this.destroy();
      }

      destroySoon(): void {
        if (this.writable) this.end();
        if (this.writableFinished) this.destroy();
        else this.once('finish' as never, () => this.destroy());
      }

      /** @internal — the low-level write path Node's `_write` funnels into. */
      _writeGeneric(
        writev: boolean,
        data: unknown,
        _encoding: string,
        cb: (err?: Error | null) => void,
      ): void {
        const vsock = this.#vsock;
        if (!vsock) {
          cb(Object.assign(new Error('This socket has been ended by the other party'), { code: 'EPIPE' }));
          return;
        }
        const chunks = writev ? (data as Uint8Array[]) : [data as Uint8Array];
        for (const chunk of chunks) {
          const bytes = toBytes(chunk);
          this.#bytesWritten += bytes.byteLength;
          vsock.write(bytes);
        }
        cb();
      }

      /** @internal */
      _attach(vsock: VirtualSocket, side: 'client' | 'server'): void {
        this.#vsock = vsock;
        (this as unknown as Record<symbol, unknown>)[kAttached] = side;
        this.#peername = { address: '127.0.0.1', family: 'IPv4', port: vsock.remotePort };
        this.#sockname = { address: '127.0.0.1', family: 'IPv4', port: vsock.localPort };
        vsock.onData((chunk) => {
          this.#bytesRead += chunk.byteLength;
          // Feed the real Readable machinery so 'data'/'end'/'close' all follow
          // Node's stream lifecycle (and `setEncoding` is the stream's own).
          this.push(toBuffer(ctx, chunk));
        });
        vsock.onEnd(() => {
          // End the readable side; `allowHalfOpen: false` then ends the writable
          // side too, which drives the socket to 'close'.
          this.push(null);
        });
        vsock.onClose(() => {
          // Abrupt closes (peer destroy) still need the 'close' event.
          if (!this.destroyed) this.destroy();
        });
        vsock.onError((err) => this.emit('error', err));
      }

      /** Dial a virtual port. Mirrors `socket.connect(port[, host][, cb])` and
       * `socket.connect(options[, cb])`. */
      connect(...args: unknown[]): this {
        const [options, cb] = normalizeArgs(args);
        const port = Number(options.port);
        this.connecting = true;
        let vsock: VirtualSocket;
        try {
          vsock = network.dial(port);
        } catch (err) {
          this.connecting = false;
          ctx.binding.nextTick(() => this.emit('error', err as Error));
          return this;
        }
        this._attach(vsock, 'client');
        this.connecting = false;
        ctx.binding.nextTick(() => {
          this.emit('connect');
          this.emit('ready');
          if (typeof cb === 'function') cb();
        });
        return this;
      }

      // --- stream plumbing ---------------------------------------------------
      /** @internal */
      _read(): void {
        // Incoming bytes are pushed straight from the virtual socket; nothing to
        // pull. Present so the Duplex machinery has a `_read` to call.
      }

      /** @internal */
      _write(chunk: Uint8Array, enc: string, cb: (err?: Error | null) => void): void {
        this._writeGeneric(false, chunk, enc, cb);
      }

      /** @internal */
      _final(cb: (err?: Error | null) => void): void {
        this.#vsock?.end();
        cb();
      }

      /** @internal */
      _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        this.#vsock?.destroy(err ?? undefined);
        cb(err);
      }

      setEncoding(enc: string): this {
        this.#encoding = enc;
        (super.setEncoding as (e: string) => unknown).call(this, enc);
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
      address(): { address?: string; family?: string; port?: number } {
        return this._getsockname();
      }
    }

    class Server extends (EventEmitter as new () => EmitterLike) {
      /** Node leaves this `undefined` until the caller sets it. */
      maxConnections: number | undefined;
      connections = 0;
      /** @internal — live sockets, so http.Server can close them by policy. */
      _sockets = new Set<Socket>();

      #port = 0;
      #host = '127.0.0.1';
      #listening = false;

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

        try {
          this._listen2(host, port, undefined, undefined, undefined, undefined);
        } catch (err) {
          ctx.binding.nextTick(() => this.emit('error', err as Error));
          return this;
        }

        ctx.binding.nextTick(() => {
          this.emit('listening');
          if (typeof cb === 'function') cb();
        });
        return this;
      }

      /**
       * @internal — Node binds and tunes the native handle here. We open the
       * matching virtual port instead, which is all the surface requires.
       */
      _listen2(
        address: string,
        port: number,
        _addressType?: unknown,
        _backlog?: unknown,
        _fd?: unknown,
        _flags?: unknown,
      ): void {
        this.#host = address;
        this.#port = port;
        network.listen(port, (vsock) => {
          this.connections++;
          const socket = new Socket();
          this._sockets.add(socket);
          socket.once('close' as never, () => {
            this.connections--;
            this._sockets.delete(socket);
          });
          socket._attach(vsock, 'server');
          this.emit('connection', socket);
        });
        this.#listening = true;
      }

      /** @internal — cluster workers are unavailable here. */
      _setupWorker(): never {
        throw notImplemented(
          'api',
          'net.Server._setupWorker',
          'Cluster workers are not available in web-node.',
        );
      }

      /** @internal — Node emits 'close' once the last connection drains. */
      _emitCloseIfDrained(): void {
        if (this.#listening || this.connections > 0) return;
        ctx.binding.nextTick(() => {
          if (!this.#listening && this.connections === 0) this.emit('close');
        });
      }

      get listening(): boolean {
        return this.#listening;
      }

      close(cb?: (err?: Error) => void): this {
        if (this.#listening) network.unlisten(this.#port);
        this.#listening = false;
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

    /**
     * `net.BoundSocket` — Node's owned, pre-bound socket wrapper. Binding a real
     * address needs the OS network stack, which a page does not have, so the
     * class exists with its full member surface but refuses to construct.
     */
    class BoundSocket {
      constructor() {
        throw notImplemented(
          'api',
          'net.BoundSocket',
          'Binding a real address needs the OS network stack, which is not available in web-node.',
        );
      }
      address(): never {
        throw notImplemented('api', 'net.BoundSocket.address', 'net.BoundSocket is unavailable in web-node.');
      }
      close(): never {
        throw notImplemented('api', 'net.BoundSocket.close', 'net.BoundSocket is unavailable in web-node.');
      }
      get fd(): never {
        throw notImplemented('api', 'net.BoundSocket.fd', 'net.BoundSocket is unavailable in web-node.');
      }
      get isPipe(): never {
        throw notImplemented('api', 'net.BoundSocket.isPipe', 'net.BoundSocket is unavailable in web-node.');
      }
    }

    /**
     * Node's `normalizeArgs`: an (options | path | port[, host][, cb]) argument
     * list becomes `[options, cb]`.
     */
    function normalizeArgs(
      args: readonly unknown[],
    ): [Record<string, unknown>, ((...a: unknown[]) => void) | null] {
      if (args.length === 0) return [{}, null];
      const arg0 = args[0];
      let options: Record<string, unknown> = {};
      if (typeof arg0 === 'object' && arg0 !== null) {
        options = arg0 as Record<string, unknown>;
      } else if (typeof arg0 === 'string' && Number.isNaN(Number(arg0))) {
        options.path = arg0;
      } else {
        options.port = arg0;
        if (args.length > 1 && typeof args[1] === 'string') options.host = args[1];
      }
      const cb = args[args.length - 1];
      if (typeof cb !== 'function') return [options, null];
      return [options, cb as (...a: unknown[]) => void];
    }

    /** `net._createServerHandle` — binds a native server handle (no OS here). */
    function createServerHandle(): never {
      throw notImplemented(
        'api',
        'net._createServerHandle',
        'A server handle needs the OS network stack, which is not available in web-node.',
      );
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

    // `SocketAddress` / `BlockList` come from a TS stand-in for the native
    // `block_list` binding; the error codes and `util.inspect` it uses live in
    // other builtins, resolved on first touch so `require('net')` stays cheap.
    let addrTypes: AddressTypes | null = null;
    const addressTypes = (): AddressTypes => {
      if (addrTypes === null) {
        const codes = (ctx.require('internal/errors') as { codes: NetAddressErrorCodes }).codes;
        let inspect: ((value: unknown) => string) | undefined;
        try {
          inspect = (ctx.require('internal/util/inspect') as { inspect: (v: unknown) => string })
            .inspect;
        } catch {
          inspect = undefined;
        }
        addrTypes = createAddressTypes(codes, inspect);
      }
      return addrTypes;
    };

    // `net.getDefaultAutoSelectFamily*` — process-wide knobs. Node's defaults.
    let autoSelectFamily = true;
    let autoSelectFamilyAttemptTimeout = 500;

    return {
      Server,
      Socket,
      /** Legacy alias: `net.Stream === net.Socket`. */
      Stream: Socket,
      BoundSocket,
      _createServerHandle: createServerHandle,
      _normalizeArgs: normalizeArgs,
      get SocketAddress() {
        return addressTypes().SocketAddress;
      },
      get BlockList() {
        return addressTypes().BlockList;
      },
      createServer: (connectionListener?: (socket: Socket) => void) => new Server(connectionListener),
      createConnection: (...args: unknown[]) => new Socket().connect(...args),
      connect: (...args: unknown[]) => new Socket().connect(...args),
      isIP,
      isIPv4: (v: unknown) => isIP(v) === 4,
      isIPv6: (v: unknown) => isIP(v) === 6,
      getDefaultAutoSelectFamily: () => autoSelectFamily,
      setDefaultAutoSelectFamily: (value: boolean) => {
        autoSelectFamily = Boolean(value);
      },
      getDefaultAutoSelectFamilyAttemptTimeout: () => autoSelectFamilyAttemptTimeout,
      setDefaultAutoSelectFamilyAttemptTimeout: (value: number) => {
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
          throw new RangeError('Attempt timeout must be a positive integer.');
        }
        autoSelectFamilyAttemptTimeout = value;
      },
      default: { Server, Socket },
      /** Non-standard, for tests + the ServiceWorker bridge. */
      _network: network,
    };
  },
};
