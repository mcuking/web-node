/**
 * The IPC channel behind `child_process.fork()`.
 *
 * There is no OS pipe here: both ends of the channel live in the same realm, so
 * "serialization" is observable only through the transformation applied to a
 * message on the way across. That is enough to be faithful, because real Node
 * ships exactly one default transformation for `fork` — **JSON** — and offers V8
 * structured clone behind `serialization: 'advanced'`:
 *
 *   - `'json'` (the default) is `JSON.parse(JSON.stringify(message))`, so a
 *     Buffer arrives as `{ type: 'Buffer', data: [...] }`, a `Date` as an ISO
 *     string, an `undefined` property is dropped, and a circular structure
 *     throws synchronously from `send()`.
 *   - `'advanced'` is `structuredClone`, so a Buffer, `Map`, `Set` or `Date`
 *     survives and a function throws `<fn> could not be cloned.` — both
 *     measured against Node v26.9.0.
 *
 * Delivery is a host macrotask, which is what makes the ordering match Node: a
 * message cannot be delivered before the code that sent it has returned, so a
 * parent that does `child.send(x)` and then `child.on('message', ...)` never
 * loses the race.
 *
 * Each end owns the state the other end cannot see: whether it is still
 * connected, whether it is ref'd, and its listeners. `disconnect()` is mirrored
 * on both ends because a closed channel is closed for both sides.
 */

/** `serialization` for a forked child's channel (Node's two modes). */
export type Serialization = 'json' | 'advanced';

/** Node's error for a send/`disconnect` on a channel that is already closed. */
export class IpcChannelClosedError extends Error {
  code = 'ERR_IPC_CHANNEL_CLOSED';
  constructor(message = 'Channel closed') {
    super(message);
    // Node reports this as a plain `Error` whose `code` carries the meaning.
    this.name = 'Error';
  }
}

/** `child.send()` with no argument: Node refuses rather than sending nothing. */
export class IpcMissingArgsError extends Error {
  code = 'ERR_MISSING_ARGS';
  constructor(message = 'The "message" argument must be specified') {
    super(message);
    this.name = 'TypeError';
  }
}

/** A send handle (socket/server/handle) cannot cross this channel. */
export class IpcHandleUnsupportedError extends Error {
  code = 'ERR_WEB_NODE_NOT_IMPLEMENTED';
  constructor(what: string) {
    super(`${what} cannot be sent over a web-node IPC channel: there is no OS socket here, so there is no handle to hand over.`);
    this.name = 'NotImplementedError';
  }
}

export interface IpcEndpoint {
  /** False once either end has disconnected, or the channel was closed. */
  readonly connected: boolean;
  /** Whether an open channel still counts as live work for its process. */
  readonly refd: boolean;
  /**
   * Serialize and hand a message to the other end. Throws synchronously when the
   * message cannot be serialized, returns `false` (and reports an error
   * asynchronously) when the channel is closed.
   */
  send(message: unknown, callback?: (err: Error | null) => void): boolean;
  /** Close the channel for both ends. Idempotent. */
  disconnect(): void;
  onMessage(cb: (message: unknown) => void): () => void;
  onDisconnect(cb: () => void): () => void;
  onError(cb: (err: Error) => void): () => void;
  ref(): void;
  unref(): void;
}

export interface IpcChannelPair {
  /** The parent's end (`subprocess` / `subprocess.channel`). */
  parent: IpcEndpoint;
  /** The child's end (`process` inside the forked module). */
  child: IpcEndpoint;
}

/** Apply the channel's serialization to a message. Throws if it cannot. */
export function serializeIpcMessage(message: unknown, serialization: Serialization): unknown {
  if (serialization === 'advanced') return structuredClone(message);
  return JSON.parse(JSON.stringify(message)) as unknown;
}

class Endpoint implements IpcEndpoint {
  #serialization: Serialization;
  #defer: (fn: () => void) => void;
  #other: Endpoint | null = null;

  #connected = true;
  #refd = true;
  #messageListeners: Array<(message: unknown) => void> = [];
  /** Messages that arrived before anyone was listening (Node buffers these). */
  #pending: unknown[] = [];
  #disconnectListeners: Array<() => void> = [];
  #errorListeners: Array<(err: Error) => void> = [];

  constructor(serialization: Serialization, defer: (fn: () => void) => void) {
    this.#serialization = serialization;
    this.#defer = defer;
  }

  /** Build a linked pair; only the class body may wire up the private ends. */
  static pair(serialization: Serialization, defer: (fn: () => void) => void): IpcChannelPair {
    const parent = new Endpoint(serialization, defer);
    const child = new Endpoint(serialization, defer);
    parent.#other = child;
    child.#other = parent;
    return { parent, child };
  }

  get connected(): boolean {
    return this.#connected;
  }

  get refd(): boolean {
    return this.#refd;
  }

  ref(): void {
    this.#refd = true;
  }

  unref(): void {
    this.#refd = false;
  }

  send(message: unknown, callback?: (err: Error | null) => void): boolean {
    if (message === undefined) throw new IpcMissingArgsError();
    if (callback !== undefined && typeof callback !== 'function') {
      throw new TypeError('The "callback" argument must be of type function');
    }
    // Serialize *before* the connected check: Node throws for an unserializable
    // message even when the channel is already closed.
    const wire = serializeIpcMessage(message, this.#serialization);

    if (!this.#connected || this.#other === null) {
      // Node reports a closed channel through the callback *and* an `error`
      // event; both are asynchronous and both are worth reproducing.
      const err = new IpcChannelClosedError();
      if (callback) this.#defer(() => callback(err));
      this.#schedule(this.#errorListeners.map((cb) => () => cb(err)));
      return false;
    }

    this.#other.#accept(wire);
    if (callback) this.#defer(() => callback(null));
    return true;
  }

  disconnect(): void {
    if (!this.#connected) return;
    const other = this.#other;
    this.#connected = false;
    if (other) other.#connected = false;
    this.#schedule(this.#disconnectListeners);
    if (other) other.#schedule(other.#disconnectListeners);
  }

  onMessage(cb: (message: unknown) => void): () => void {
    this.#messageListeners.push(cb);
    if (this.#pending.length > 0) {
      const queued = this.#pending.splice(0, this.#pending.length);
      for (const message of queued) this.#defer(() => cb(message));
    }
    return () => {
      this.#messageListeners = this.#messageListeners.filter((fn) => fn !== cb);
    };
  }

  onDisconnect(cb: () => void): () => void {
    // A late subscriber on a dead channel still hears about it, asynchronously.
    if (!this.#connected) {
      this.#defer(cb);
      return () => undefined;
    }
    this.#disconnectListeners.push(cb);
    return () => {
      this.#disconnectListeners = this.#disconnectListeners.filter((fn) => fn !== cb);
    };
  }

  onError(cb: (err: Error) => void): () => void {
    this.#errorListeners.push(cb);
    return () => {
      this.#errorListeners = this.#errorListeners.filter((fn) => fn !== cb);
    };
  }

  /** Take delivery of a message from the other end. */
  #accept(wire: unknown): void {
    if (!this.#connected) return;
    if (this.#messageListeners.length === 0) {
      this.#pending.push(wire);
      return;
    }
    const listeners = [...this.#messageListeners];
    this.#defer(() => {
      for (const listener of listeners) listener(wire);
    });
  }

  #schedule(callbacks: Array<() => void>): void {
    if (callbacks.length === 0) return;
    const snapshot = [...callbacks];
    this.#defer(() => {
      for (const cb of snapshot) cb();
    });
  }
}

/**
 * Build the two ends of one forked child's channel. `defer` must be the host
 * macrotask scheduler (`setTimeout(…, 0)`), *not* a promise microtask: a message
 * has to arrive strictly after the send returns, even when the sender is itself
 * asynchronous.
 */
export function createIpcChannelPair(opts: {
  serialization?: Serialization;
  defer: (fn: () => void) => void;
}): IpcChannelPair {
  return Endpoint.pair(opts.serialization ?? 'json', opts.defer);
}
