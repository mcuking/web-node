/**
 * A tiny in-process TCP lookalike.
 *
 * Node's network binding is `tcp_wrap`, backed by libuv and the OS kernel. A
 * browser tab has no socket syscall to hand, so we model the same *shape* in
 * pure TS: a port table plus duplex byte pipes.
 *
 * Everything above this file (`net`, `http`, and later `ws`) is written against
 * this interface, so a real transport can be swapped in later (SharedArrayBuffer
 * + a ServiceWorker, or a wasm libuv) without touching user-visible semantics.
 *
 * The ServiceWorker bridge (phase B) dials `VirtualNetwork.dial()` from the
 * outside, which is what makes `server.listen(3000)` reachable from a browser URL.
 */

export class VirtualSocket {
  readonly id: number;
  #peer: VirtualSocket | null = null;
  #dataCbs: Array<(chunk: Uint8Array) => void> = [];
  #endCbs: Array<() => void> = [];
  #closeCbs: Array<() => void> = [];
  #errorCbs: Array<(err: Error) => void> = [];
  #closed = false;
  #readableEnded = false;
  #remotePort: number;
  #localPort: number;

  constructor(id: number, localPort = 0, remotePort = 0) {
    this.id = id;
    this.#localPort = localPort;
    this.#remotePort = remotePort;
  }

  /** @internal — wiring is done by the network. */
  _pair(peer: VirtualSocket): void {
    this.#peer = peer;
  }

  /** @internal — ports are stamped so user code can read `localPort`/`remotePort`. */
  _stamp(localPort: number, remotePort: number): void {
    this.#localPort = localPort;
    this.#remotePort = remotePort;
  }

  get destroyed(): boolean {
    return this.#closed;
  }
  get readableEnded(): boolean {
    return this.#readableEnded;
  }
  get writableEnded(): boolean {
    return this.#closed;
  }
  get localPort(): number {
    return this.#localPort;
  }
  get remotePort(): number {
    return this.#remotePort;
  }

  onData(cb: (chunk: Uint8Array) => void): void {
    this.#dataCbs.push(cb);
  }
  onEnd(cb: () => void): void {
    this.#endCbs.push(cb);
  }
  onClose(cb: () => void): void {
    this.#closeCbs.push(cb);
  }
  onError(cb: (err: Error) => void): void {
    this.#errorCbs.push(cb);
  }

  /**
   * Push bytes to the peer. Delivery is always async (a real socket never calls
   * back synchronously), which keeps ordering realistic for user code that
   * writes a request and then awaits the response.
   */
  write(chunk: Uint8Array | string): boolean {
    if (this.#closed) return false;
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    const peer = this.#peer;
    if (!peer || peer.#closed) return false;
    queueMicrotask(() => peer._deliver(bytes));
    return true;
  }

  /** @internal */
  _deliver(bytes: Uint8Array): void {
    if (this.#closed) return;
    for (const cb of [...this.#dataCbs]) cb(bytes);
  }

  /** Half-close: flushes to the peer and signals EOF to its read side. */
  end(chunk?: Uint8Array | string): void {
    if (this.#closed) return;
    if (chunk !== undefined) this.write(chunk);
    const peer = this.#peer;
    queueMicrotask(() => {
      if (this.#closed) return;
      this.#readableEnded = true;
      for (const cb of [...this.#endCbs]) cb();
      peer?._remoteEnded();
    });
  }

  /** @internal — EOF arrived from the peer. */
  _remoteEnded(): void {
    if (this.#closed || this.#readableEnded) return;
    this.#readableEnded = true;
    for (const cb of [...this.#endCbs]) cb();
  }

  destroy(err?: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    const peer = this.#peer;
    if (err) for (const cb of [...this.#errorCbs]) cb(err);
    for (const cb of [...this.#closeCbs]) cb();
    // Tear the other half down too — this is a pipe, not half-open persistent.
    if (peer && !peer.#closed) queueMicrotask(() => peer.destroy());
  }

  /** @internal — close without notifying the peer (used by network.reset()). */
  _forceClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const cb of [...this.#closeCbs]) cb();
  }
}

export type ConnectionHandler = (socket: VirtualSocket) => void;

export class VirtualNetwork {
  #servers = new Map<number, ConnectionHandler>();
  #nextId = 1;

  /** Ports currently bound, ascending. */
  get ports(): number[] {
    return [...this.#servers.keys()].sort((a, b) => a - b);
  }

  isListening(port: number): boolean {
    return this.#servers.has(port);
  }

  /** Bind a port. Throws EADDRINUSE like `net.Server#listen`. */
  listen(port: number, handler: ConnectionHandler): void {
    if (this.#servers.has(port)) {
      throw Object.assign(new Error(`listen EADDRINUSE: address already in use :::${port}`), {
        code: 'EADDRINUSE',
        errno: -98,
        syscall: 'listen',
        port,
      });
    }
    this.#servers.set(port, handler);
  }

  unlisten(port: number): void {
    this.#servers.delete(port);
  }

  /**
   * Handle names for `process.getActiveResourcesInfo()`. A bound port is a
   * listening TCP handle (`TCPServerWrap`), the one resource here that keeps a
   * Node program from exiting. Connected sockets are intentionally not listed:
   * they are created lazily inside `dial()` and drive delivery through
   * microtasks, so they never hold the loop open the way a libuv handle does.
   */
  activeResources(): string[] {
    return Array.from({ length: this.#servers.size }, () => 'TCPServerWrap');
  }

  /**
   * Dial a bound port from the outside world (or from another part of the same
   * program). Returns the *client* half; the server's handler receives the other.
   */
  dial(port: number): VirtualSocket {
    const handler = this.#servers.get(port);
    if (!handler) {
      throw Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${port}`), {
        code: 'ECONNREFUSED',
        errno: -111,
        syscall: 'connect',
        address: '127.0.0.1',
        port,
      });
    }
    const client = new VirtualSocket(this.#nextId++, 0, port);
    const server = new VirtualSocket(this.#nextId++, port, 0);
    client._pair(server);
    server._pair(client);
    // `connection` fires on a later tick, exactly like a real accept().
    queueMicrotask(() => handler(server));
    return client;
  }

  /** Drop every binding and close live sockets. Called between program runs. */
  reset(): void {
    this.#servers.clear();
  }
}
