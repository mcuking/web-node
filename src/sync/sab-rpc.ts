/**
 * A **synchronous** request/response channel to another worker.
 *
 * ## Why this exists
 *
 * A browser tab has no blocking syscall. Every Node API that must block —
 * `fs.fsyncSync`, and anything else that has to wait on real I/O — hits the same
 * wall: the work is asynchronous (OPFS is only reachable through `await`ed
 * handle lookups), but the caller is synchronous and cannot `await`.
 *
 * A worker cannot solve this alone. Blocking the only thread it has would also
 * freeze the event loop that would have to run the `await` — the classic
 * self-deadlock. So the work goes to a **second** worker, and the two sides talk
 * over shared memory:
 *
 *   - the caller writes the request into a `SharedArrayBuffer`, posts a tiny
 *     notification, then parks on `Atomics.wait`;
 *   - the peer picks the request up, does the (possibly asynchronous) work, and
 *     writes the answer back into the same buffer;
 *   - `Atomics.notify` wakes the caller, which reads the answer and returns.
 *
 * `postMessage` cannot carry the *answer* here, and that is the crux: a thread
 * parked in `Atomics.wait` runs no message handlers, so a reply delivered as an
 * event would never be seen. Shared memory is the only channel that works while
 * blocked.
 *
 * ## Layout
 *
 * The control block is `CONTROL_WORDS` int32s; the payload travels in a
 * separate `SharedArrayBuffer` that is handed over with each request (a
 * `SharedArrayBuffer` is *shared*, not copied, so this is a pointer hand-off by
 * structured clone — no bytes move).
 *
 * | word | name       | meaning                                            |
 * |------|------------|----------------------------------------------------|
 * | 0    | `H_STATE`  | 0 idle · 1 request posted · 2 response ready       |
 * | 1    | `H_SEQ`    | monotonic request id                               |
 * | 2    | `H_OP`     | operation code                                     |
 * | 3    | `H_STATUS` | 0 ok · 1 the peer returned a `{code, message}`     |
 * | 4    | `H_REQ_LEN`| request payload bytes                              |
 * | 5    | `H_RES_LEN`| response payload bytes                             |
 * | 6/7  | args       | two int32 arguments (flags, mode, …)               |
 *
 * Calls are strictly serialised: one request is outstanding at a time, so the
 * payload buffer can be reused without a lock.
 */

/** Int32 words in the control block. */
export const CONTROL_WORDS = 16;
/** `BitSize` — the control block is one cache line and a bit. */
export const CONTROL_BYTES = CONTROL_WORDS * 4;

export const H_STATE = 0;
export const H_SEQ = 1;
export const H_OP = 2;
export const H_STATUS = 3;
export const H_REQ_LEN = 4;
export const H_RES_LEN = 5;
export const H_ARG0 = 6;
export const H_ARG1 = 7;

export const STATE_IDLE = 0;
export const STATE_REQUEST = 1;
export const STATE_RESPONSE = 2;

export const STATUS_OK = 0;
export const STATUS_ERROR = 1;
/** The response did not fit the caller's buffer; `H_RES_LEN` says how many bytes it needs. */
export const STATUS_RETRY = 2;

/**
 * Smallest payload buffer a call will use.
 *
 * The buffer carries the response as well as the request, and the caller cannot
 * know the response size in advance — a request with no payload still has to fit
 * an error envelope. The peer can always ask for more (`STATUS_RETRY`), so this
 * only saves a round trip in the common case.
 */
export const MIN_PAYLOAD_BYTES = 1024;

/** How many times a response may be re-sized before giving up. */
const MAX_RESPONSE_ATTEMPTS = 4;

/**
 * How long a synchronous call may park before it is declared deadlocked.
 *
 * The point is not to tolerate slow work — it is to never *hang*. A parked
 * worker cannot be interrupted, so a peer that died, never started, or is
 * waiting on this very thread would otherwise freeze the tab with no way out.
 * Timing out turns that into a loud, diagnosable error.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** The error a `SyncChannel` throws; carries a Node-ish `code` when the peer sent one. */
export class SyncChannelError extends Error {
  code: string;

  constructor(message: string, code = 'ERR_WEB_NODE_SYNC_CHANNEL') {
    super(message);
    this.code = code;
    // Node's own errors are plain `Error`s; keep `name` on the prototype so
    // `err.name` reads `Error` (see `VfsError` for the same reasoning).
    this.name = 'Error';
  }
}

/** The `{code, message, …}` envelope a handler's rejection travels in. */
interface WireError {
  code: string;
  message: string;
  [key: string]: unknown;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function encodeError(err: unknown): Uint8Array {
  const code = (err as { code?: unknown })?.code;
  const message = err instanceof Error ? err.message : String(err);
  const wire: WireError = {
    code: typeof code === 'string' ? code : 'ERR_WEB_NODE_SYNC_CHANNEL',
    message,
  };
  // A `VfsError` carries `errno`/`syscall`/`path`/`dest`; the sync surface
  // (`fsyncSync`) rethrows the peer's error verbatim, so those must survive.
  if (err !== null && typeof err === 'object') {
    for (const [key, value] of Object.entries(err)) {
      if (key === 'code' || key === 'message') continue;
      const type = typeof value;
      if (type === 'string' || type === 'number' || type === 'boolean') wire[key] = value;
    }
  }
  return textEncoder.encode(JSON.stringify(wire));
}

function decodeError(bytes: Uint8Array): SyncChannelError {
  // `TextDecoder` refuses a view onto a `SharedArrayBuffer` (the buffer could be
  // detached underneath it), and this one always is — copy before decoding.
  const text = textDecoder.decode(bytes.slice());
  try {
    const wire = JSON.parse(text) as WireError;
    if (typeof wire?.message === 'string') {
      const err = new SyncChannelError(wire.message, wire.code);
      // `fsyncSync` surfaces the peer's error verbatim, so the extra context
      // fields a `VfsError` carries have to survive the trip.
      Object.assign(err, wire);
      return err;
    }
  } catch {
    /* not our envelope — fall through */
  }
  // Say what actually arrived: a truncated or clobbered envelope is a protocol
  // bug, and "unreadable" alone is not enough to find it.
  return new SyncChannelError(
    `synchronous channel returned an unreadable error: ${JSON.stringify(text.slice(0, 200))}`,
  );
}

/** One operation's handler, on the peer side. May be async: the caller is parked either way. */
export type SyncHandler = (
  op: number,
  payload: Uint8Array,
  arg0: number,
  arg1: number,
) => Uint8Array | Promise<Uint8Array>;

const EMPTY = new Uint8Array(0);

/** A caller-side async request: `{id}` plus whatever the peer's dispatcher expects. */
export interface SyncAsyncRequest {
  id: number;
  [key: string]: unknown;
}

/** Caller side of the channel: `call()` blocks the thread until the peer answers. */
export class SyncChannel {
  #control: Int32Array;
  #port: MessagePort;
  #data: SharedArrayBuffer | null = null;
  #seq = 0;
  #timeoutMs: number;
  #closed = false;

  constructor(port: MessagePort, control: SharedArrayBuffer, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#port = port;
    this.#control = new Int32Array(control, 0, CONTROL_WORDS);
    this.#timeoutMs = timeoutMs;
  }

  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  /**
   * Post a request and park until the peer answers.
   *
   * Returns the response bytes. Throws `SyncChannelError` if the peer reported
   * an error, or if it did not answer within `timeoutMs` (a deadlock, a dead
   * peer, or an unstarted one — never a silent hang).
   */
  call(op: number, payload: Uint8Array = EMPTY, arg0 = 0, arg1 = 0, timeoutMs = this.#timeoutMs): Uint8Array {
    if (this.#closed) throw new SyncChannelError('synchronous channel is closed', 'ERR_WEB_NODE_SYNC_CHANNEL_CLOSED');

    const h = this.#control;
    // One seq for the whole call: a retry is the *same* request, so the peer can
    // answer from its cache instead of running the work twice.
    const seq = ++this.#seq;
    let needed = Math.max(payload.byteLength, MIN_PAYLOAD_BYTES);

    for (let attempt = 0; attempt < MAX_RESPONSE_ATTEMPTS; attempt++) {
      // The payload buffer is shared with the peer, so it must outlive the call:
      // grow it in place (never shrink) and reuse across calls.
      let data = this.#data;
      if (data === null || data.byteLength < needed) {
        data = new SharedArrayBuffer(needed);
        this.#data = data;
      }
      // Fresh view every time — a grow can detach an older one.
      if (payload.byteLength > 0) new Uint8Array(data).set(payload);

      Atomics.store(h, H_SEQ, seq);
      Atomics.store(h, H_OP, op);
      Atomics.store(h, H_STATUS, STATUS_OK);
      Atomics.store(h, H_REQ_LEN, payload.byteLength);
      Atomics.store(h, H_RES_LEN, 0);
      Atomics.store(h, H_ARG0, arg0);
      Atomics.store(h, H_ARG1, arg1);
      // Released last: everything above is visible to the peer before it is told
      // the request exists.
      Atomics.store(h, H_STATE, STATE_REQUEST);
      Atomics.notify(h, H_STATE); // in case the peer watches the control block
      this.#port.postMessage({ seq, op, len: payload.byteLength, data });

      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (Atomics.load(h, H_STATE) === STATE_RESPONSE) break;
        const remaining = deadline - Date.now();
        if (remaining <= 0 || Atomics.wait(h, H_STATE, STATE_REQUEST, remaining) === 'timed-out') {
          if (Atomics.load(h, H_STATE) === STATE_RESPONSE) break;
          throw new SyncChannelError(
            `synchronous call #${op} did not complete within ${timeoutMs}ms`,
            'ERR_WEB_NODE_SYNC_TIMEOUT',
          );
        }
      }

      const status = Atomics.load(h, H_STATUS);
      const resLen = Atomics.load(h, H_RES_LEN);
      if (status === STATUS_RETRY) {
        needed = Math.max(payload.byteLength, resLen, MIN_PAYLOAD_BYTES);
        continue;
      }
      const view = new Uint8Array(data, 0, resLen);
      if (status === STATUS_ERROR) throw decodeError(view);
      // Copy out: the peer owns the buffer again as soon as the next call starts.
      return view.slice();
    }
    throw new SyncChannelError(
      `peer could not fit the response in ${MAX_RESPONSE_ATTEMPTS} attempts`,
      'ERR_WEB_NODE_SYNC_BUFFER',
    );
  }

  close(): void {
    this.#closed = true;
    this.#port.close();
  }
}

/**
 * Peer side: wire a `MessagePort` to a handler.
 *
 * Handles **both** channels of the protocol on one port, through **one** queue.
 * The shared payload buffer is only safe because requests are processed strictly
 * in arrival order — and that ordering has to span the async channel too, or a
 * fire-and-forget snapshot could interleave with the durable write it is
 * supposed to precede.
 *
 * `sync` answers through the shared-memory control block (the caller is parked
 * in `Atomics.wait` and can receive nothing else); `async` answers with an
 * ordinary reply message.
 */
export function serveSyncChannel<Req extends SyncAsyncRequest>(
  port: MessagePort,
  control: SharedArrayBuffer,
  options: { sync: SyncHandler; async?: (request: Req) => Promise<unknown> },
): () => void {
  const h = new Int32Array(control, 0, CONTROL_WORDS);
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;
  let answeredSeq = -1;
  let answeredResult: Uint8Array | null = null;
  let answeredStatus = STATUS_OK;

  const runSync = async (msg: { data: SharedArrayBuffer; op: number; len: number }): Promise<void> => {
    const seq = Atomics.load(h, H_SEQ);
    // A retry re-sends the same request with a bigger buffer. Re-running the
    // work would be a bug for anything that is not idempotent, so the answer is
    // kept and replayed instead.
    let result = seq === answeredSeq ? answeredResult : null;
    if (result === null) {
      const payload = new Uint8Array(msg.data, 0, msg.len);
      let status = STATUS_OK;
      try {
        result = await options.sync(msg.op, payload, Atomics.load(h, H_ARG0), Atomics.load(h, H_ARG1));
      } catch (err) {
        result = encodeError(err);
        status = STATUS_ERROR;
      }
      answeredSeq = seq;
      answeredResult = result;
      answeredStatus = status;
    }
    if (result.byteLength > msg.data.byteLength) {
      // Too big for the caller's buffer: say how much is needed and let it retry.
      Atomics.store(h, H_RES_LEN, result.byteLength);
      Atomics.store(h, H_STATUS, STATUS_RETRY);
      Atomics.store(h, H_STATE, STATE_RESPONSE);
      Atomics.notify(h, H_STATE);
      return;
    }
    if (result.byteLength > 0) new Uint8Array(msg.data).set(result, 0);
    Atomics.store(h, H_RES_LEN, result.byteLength);
    Atomics.store(h, H_STATUS, answeredStatus);
    // Status and length first; the wake-up flag last.
    Atomics.store(h, H_STATE, STATE_RESPONSE);
    Atomics.notify(h, H_STATE);
  };

  const runAsync = async (msg: Req): Promise<void> => {
    try {
      const result = await options.async!(msg);
      port.postMessage({ id: msg.id, kind: 'ok', result });
    } catch (err) {
      const code = (err as { code?: unknown })?.code;
      port.postMessage({
        id: msg.id,
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        code: typeof code === 'string' ? code : undefined,
      });
    }
  };

  const onMessage = (event: MessageEvent): void => {
    const msg = event.data as (SyncAsyncRequest & { data?: SharedArrayBuffer; op?: number; len?: number }) | null;
    if (stopped || msg === null || typeof msg !== 'object') return;
    if (typeof msg.seq === 'number' && msg.data instanceof SharedArrayBuffer) {
      queue = queue.then(() => runSync(msg as { data: SharedArrayBuffer; op: number; len: number }));
      return;
    }
    if (typeof msg.id === 'number' && options.async) {
      const request = msg as Req;
      queue = queue.then(() => runAsync(request));
    }
  };

  port.addEventListener('message', onMessage);
  port.start();
  return () => {
    stopped = true;
    port.removeEventListener('message', onMessage);
  };
}
