import type { BuiltinSpec, BuiltinInitContext } from './types';
import type { VirtualSocket } from '../net/network';
import type { VirtualNetwork } from '../net/network';
import { createAddressTypes, type AddressTypes, type NetAddressErrorCodes } from '../net/socket-address';
import { notImplemented } from '../errors';
import { ERRNO } from '../vfs/types';

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
      read(size?: number): unknown;
      end(cb?: () => void): void;
      destroy(error?: Error): void;
      setEncoding(enc: string): unknown;
    }

    const kAttached = Symbol('web-node.socket.side');
    // `Symbol.dispose` is not in this project's TS lib yet.
    const kDispose = (Symbol as unknown as { dispose: symbol }).dispose;

    // --- error + validation helpers (Node's internal/errors + validators) ---
    /** Node's `determineSpecificType`, used in ERR_INVALID_ARG_TYPE messages. */
    function describeType(value: unknown): string {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'function') return `function ${value.name}`;
      if (typeof value === 'object') {
        const ctor = (value as { constructor?: { name?: string } }).constructor;
        return ctor?.name ? `an instance of ${ctor.name}` : String(value);
      }
      let inspected = typeof value === 'string' ? `'${value}'` : String(value);
      if (inspected.length > 28) inspected = `${inspected.slice(0, 25)}...`;
      return `type ${typeof value} (${inspected})`;
    }

    function invalidArgType(name: string, expected: string, actual: unknown): TypeError {
      const err = new TypeError(
        `The "${name}" argument must be of type ${expected}. Received ${describeType(actual)}`,
      );
      (err as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
      return err;
    }

    function outOfRange(name: string, range: string, value: unknown): RangeError {
      const err = new RangeError(
        `The value of "${name}" is out of range. It must be ${range}. Received ${String(value)}`,
      );
      (err as { code?: string }).code = 'ERR_OUT_OF_RANGE';
      return err;
    }

    /** Node's `validateNumber` (internal/validators.js). */
    function validateNumber(value: unknown, name: string): void {
      if (typeof value !== 'number') {
        throw invalidArgType(name, 'number', value);
      }
    }

    function validateFunction(value: unknown, name: string): void {
      if (typeof value !== 'function') {
        throw invalidArgType(name, 'function', value);
      }
    }

    /** `internal/timers.js` TIMEOUT_MAX (a signed 32-bit millisecond count). */
    const TIMEOUT_MAX = 2 ** 31 - 1;

    /** Node's `getTimerDuration` (internal/timers.js). */
    function getTimerDuration(msecs: unknown, name: string): number {
      validateNumber(msecs, name);
      const value = msecs as number;
      if (value < 0 || !Number.isFinite(value)) {
        throw outOfRange(name, 'a non-negative finite number', value);
      }
      if (value > TIMEOUT_MAX) {
        emitTimeoutOverflowWarning(value);
        return TIMEOUT_MAX;
      }
      return value;
    }

    function emitTimeoutOverflowWarning(msecs: number): void {
      void msecs;
      try {
        const process = ctx.require('process') as {
          emitWarning?: (w: string, type: string) => void;
        };
        process.emitWarning?.(
          `${msecs} does not fit into a 32-bit signed integer.` +
            `\nTimer duration was truncated to ${TIMEOUT_MAX}.`,
          'TimeoutOverflowWarning',
        );
      } catch {
        // `process` unavailable during early boot; the clamp still holds.
      }
    }

    /**
     * The public `timers` module, resolved lazily (its own init would otherwise
     * overlap with `net`'s). Node's socket timeouts are ordinary unref'd
     * timers owned by the stream, so this is exactly the primitive needed.
     */
    type TimerHandle = { unref(): void };
    let timersModule:
      | {
          setTimeout: (fn: () => void, ms: number) => TimerHandle;
          clearTimeout: (handle: TimerHandle) => void;
        }
      | null = null;
    const timers = (): NonNullable<typeof timersModule> => {
      if (timersModule === null) {
        timersModule = ctx.require('timers') as NonNullable<typeof timersModule>;
      }
      return timersModule;
    };

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
      /** The unref'd stream timer `setTimeout` / `_unrefTimer` own (Node's `kTimeout`). */
      #timer: TimerHandle | null = null;
      #timeoutMs = 0;

      constructor(options?: { allowHalfOpen?: boolean }) {
        // Node's default is `allowHalfOpen: false` (a half-close ends both sides).
        super({ allowHalfOpen: options?.allowHalfOpen ?? false });
      }

      /**
       * Whether the socket is being destroyed with an error. `lib/net.js` owns
       * the 'close' event's `hadError` flag (it reads it off the failing
       * handle); here it is carried from `_destroy` into the stream's own
       * 'close'.
       */
      #hadError = false;

      /** @internal — inject `hadError` into the stream's 'close' event. */
      override emit(name: string, ...args: unknown[]): boolean {
        if (name === 'close') return super.emit('close', this.#hadError);
        return super.emit(name, ...args);
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
      _unrefTimer(): void {
        // The stream timer is already created unref'd (Node's
        // `reuseOrCreateUnrefTimeout`), so there is nothing to do here.
        this.#timer?.unref();
      }

      /** Arm (re-arming first) the single stream timer. */
      #armTimer(msecs: number): void {
        this.#clearTimer();
        const handle = timers().setTimeout(() => {
          this.#timer = null;
          this._onTimeout();
        }, msecs);
        // Node's socket timers never hold the loop open.
        handle.unref();
        this.#timer = handle;
      }

      /** Drop the pending timer, if any (Node's `clearTimeout(s[kTimeout])`). */
      #clearTimer(): void {
        if (this.#timer !== null) {
          timers().clearTimeout(this.#timer);
          this.#timer = null;
        }
      }

      /**
       * Restart the timer after read/write activity — libuv resets a handle's
       * timeout on I/O, which is why a busy socket never emits 'timeout'.
       */
      #refreshTimer(): void {
        if (this.#timeoutMs > 0) this.#armTimer(this.#timeoutMs);
      }

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
        // Writing is I/O activity: restart the idle timer.
        this.#refreshTimer();
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
          // Reading is I/O activity: restart the idle timer.
          this.#refreshTimer();
          // Feed the real Readable machinery so 'data'/'end'/'close' all follow
          // Node's stream lifecycle (and `setEncoding` is the stream's own).
          this.push(toBuffer(ctx, chunk));
        });
        vsock.onEnd(() => {
          // End the readable side; `allowHalfOpen: false` then ends the writable
          // side too, which drives the socket to 'close'.
          this.push(null);
          // net sockets read their handle continuously (Node's `_read` calls
          // `readStart`), so EOF is always observed — and 'end' emitted — even
          // when nothing consumes the readable side.
          this.read(0);
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
        // Node registers the connect callback as `once('connect')` *before*
        // dialing, so on success it runs ahead of listeners added afterwards and
        // on failure it never runs.
        if (typeof cb === 'function') this.once('connect' as never, cb as never);
        let vsock: VirtualSocket;
        try {
          vsock = network.dial(port);
        } catch (err) {
          // `connecting` stays true for the remainder of this tick (Node only
          // clears it when the failure surfaces), then the socket is destroyed —
          // which emits 'error' followed by 'close'. `
          ctx.binding.nextTick(() => {
            this.connecting = false;
            this.destroy(err as Error);
          });
          return this;
        }
        this._attach(vsock, 'client');
        this.connecting = false;
        ctx.binding.nextTick(() => {
          this.emit('connect');
          this.emit('ready');
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
        // `hadError` rides on the stream's own 'close' (emitted after 'error'
        // by the destroy machinery), mirroring lib/net.js.
        this.#hadError = err ? true : false;
        // Node clears the stream timer and drops the handle in `_destroy`; the
        // dropped handle is what makes `pending` report true once closed.
        this.#clearTimer();
        // The stream emits the error itself; passing it to the virtual socket
        // would fire `onError` and duplicate the 'error' event.
        this.#vsock?.destroy();
        this.#vsock = null;
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
      setTimeout(msecs: number, callback?: () => void): this {
        // /`setStreamTimeout` — a destroyed socket is a no-op, and `this.timeout`
        // is assigned *before* validation (so a bad value still lands there).
        if (this.destroyed) return this;
        this.timeout = msecs;
        const ms = getTimerDuration(msecs, 'msecs');
        this.#clearTimer();
        this.#timeoutMs = ms;
        if (ms === 0) {
          if (callback !== undefined) {
            validateFunction(callback, 'callback');
            this.removeListener('timeout' as never, callback as never);
          }
        } else {
          this.#armTimer(ms);
          if (callback !== undefined) {
            validateFunction(callback, 'callback');
            this.once('timeout' as never, callback as never);
          }
        }
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
      #closeEmitted = false;

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
            // A pending `close()` waits for the last connection to drain.
            this._emitCloseIfDrained();
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
        if (this.#closeEmitted || this.#listening || this.connections > 0) return;
        ctx.binding.nextTick(() => {
          if (this.#closeEmitted || this.#listening || this.connections > 0) return;
          this.#closeEmitted = true;
          this.emit('close');
        });
      }

      get listening(): boolean {
        return this.#listening;
      }

      close(cb?: (err?: Error) => void): this {
        // Node runs the callback from the 'close' event, which fires only after
        // the last live connection has drained.
        if (typeof cb === 'function') this.once('close' as never, cb as never);
        if (this.#listening) {
          network.unlisten(this.#port);
          this.#listening = false;
        }
        this._emitCloseIfDrained();
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
     * `net.BoundSocket` — Node's owned, pre-bound socket wrapper. A page has no
     * OS network stack, so this binds into web-node's virtual TCP layer: the
     * port is reserved synchronously (a conflicting bind throws EADDRINUSE just
     * like Node), `address()` reports the bound address, `close()` releases it,
     * and `fd()` returns `-1` exactly as Node does on platforms whose sockets
     * have no file descriptor. Unix-domain/pipe binds have no virtual
     * counterpart and stay loud.
     */
    class BoundSocket {
      #path: string | undefined;
      #host: string | undefined;
      #port = 0;
      #family: 'IPv4' | 'IPv6' | undefined;
      #released = false;

      constructor(options: Record<string, unknown> = {}) {
        const codes = (ctx.require('internal/errors') as { codes: NetAddressErrorCodes }).codes;
        const validators = ctx.require('internal/validators') as {
          validateObject: (v: unknown, name: string) => void;
          validateString: (v: unknown, name: string) => void;
          validateBoolean: (v: unknown, name: string) => void;
          validatePort: (v: unknown, name: string, allowZero?: boolean) => number;
        };
        validators.validateObject(options, 'options');

        if (options.path !== undefined) {
          if (
            options.host !== undefined ||
            options.port !== undefined ||
            options.ipv6Only !== undefined ||
            options.reusePort !== undefined
          ) {
            throw new codes.ERR_INVALID_ARG_VALUE(
              'options',
              options,
              'path is mutually exclusive with host, port, ipv6Only, and reusePort',
            );
          }
          validators.validateString(options.path, 'options.path');
          throw notImplemented(
            'api',
            'net.BoundSocket({ path })',
            'web-node has no unix-domain or named-pipe sockets to bind.',
          );
        }

        const port = validators.validatePort(options.port ?? 0, 'options.port');
        const ipv6Only = options.ipv6Only ?? false;
        validators.validateBoolean(ipv6Only, 'options.ipv6Only');
        const reusePort = options.reusePort ?? false;
        validators.validateBoolean(reusePort, 'options.reusePort');

        let host = options.host;
        let addressType: number;
        if (host === undefined || host === null) {
          host = ipv6Only ? '::' : '0.0.0.0';
          addressType = ipv6Only ? 6 : 4;
        } else {
          validators.validateString(host, 'options.host');
          addressType = isIP(host as string);
          if (addressType === 0) {
            throw new codes.ERR_INVALID_ARG_VALUE(
              'options.host',
              host,
              'must be a numeric IP address; net.BoundSocket does not perform DNS resolution',
            );
          }
        }

        const bindPort = port === 0 ? pickEphemeralPort(network) : port;
        try {
          network.listen(bindPort, (vsock) => {
            // A bound-but-unadopted port is not listening: drop any connection.
            (vsock as unknown as { close?: () => void }).close?.();
          });
        } catch {
          // libuv defers EADDRINUSE; Node forces it synchronously. So do we.
          const ExceptionWithHostPort = (
            ctx.require('internal/errors') as {
              ExceptionWithHostPort: new (
                err: number,
                syscall: string,
                address?: string,
                port?: number,
              ) => Error;
            }
          ).ExceptionWithHostPort;
          throw new ExceptionWithHostPort(ERRNO.EADDRINUSE, 'bind', host as string, bindPort);
        }
        this.#host = host as string;
        this.#port = bindPort;
        this.#family = addressType === 6 ? 'IPv6' : 'IPv4';
      }

      /** Capability signal: this build honours `{ path }` (it does not). */
      get isPipe(): boolean {
        return this.#path !== undefined;
      }

      address(): { address?: string; family?: string; port?: number } {
        if (this.#released) throw this.#adoptedError();
        return { address: this.#host, family: this.#family, port: this.#port };
      }

      fd(): number {
        if (this.#released) throw this.#adoptedError();
        // Node returns -1 where sockets have no OS file descriptor.
        return -1;
      }

      close(): void {
        if (this.#released) throw this.#adoptedError();
        network.unlisten(this.#port);
        this.#released = true;
      }

      [kDispose](): void {
        if (this.#released) return;
        network.unlisten(this.#port);
        this.#released = true;
      }

      #adoptedError(): Error {
        const codes = (ctx.require('internal/errors') as { codes: NetAddressErrorCodes }).codes;
        return new codes.ERR_SOCKET_HANDLE_ADOPTED();
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
      createConnection: (...args: unknown[]) => {
        const [options] = normalizeArgs(args);
        return new Socket(options as { allowHalfOpen?: boolean }).connect(...args);
      },
      connect: (...args: unknown[]) => {
        const [options] = normalizeArgs(args);
        return new Socket(options as { allowHalfOpen?: boolean }).connect(...args);
      },
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
