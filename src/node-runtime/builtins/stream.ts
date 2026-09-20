import type { BuiltinSpec, BuiltinInitContext } from './types';

/**
 * `stream` builtin — Readable / Writable / Duplex / Transform / PassThrough.
 *
 * Not vendored `lib/stream*.js`: the real implementation is a 30+ file cluster
 * (`internal/streams/{readable,writable,duplex,transform,destroy,state,utils,
 * pipeline,finished,legacy/...}`) sitting on `internal/errors`,
 * `internal/validators`, `async_hooks` and `destr`. Same call we made for `net`
 * and `http`: implement the observable surface user code actually touches and
 * mark the module `origin: 'web-node'` so `describe()` never claims otherwise.
 *
 * What is real here, not faked:
 *   - **Backpressure.** `write()`/`push()` return `false` once the internal
 *     buffer reaches the high-water mark; `write()` then fires `'drain'` when it
 *     empties, and `pipe()` pauses the source and resumes on that `'drain'`.
 *     `req.pipe(res)` therefore propagates backpressure instead of buffering the
 *     whole body in memory.
 *   - **Ordering.** A Writable runs at most one `_write()` at a time and queues
 *     the rest, so `_write` implementations do not have to be re-entrant.
 *
 * Deliberate simplifications (documented in the design spec):
 *   - `stream.finished`'s callback form returns a no-op `cleanup()`.
 *
 * What is real here, not approximated:
 *   - `read(n)` in byte mode is exact: it splits to the requested byte count
 *     instead of handing back whole buffered chunks.
 *   - Both halves of the `objectMode` split are real getters
 *     (`readableObjectMode` / `writableObjectMode`), and an object-mode
 *     writable passes strings through untouched instead of encoding them.
 *   - `autoDestroy` (on by default) closes the stream after `end`/`finish`,
 *     with `destroyed === true` by the time `close` fires; a duplex waits for
 *     both halves.
 *   - Paused-mode consumers are driven by the `readable` event.
 *   - High-water marks come from Node's own `internal/streams/state.js`
 *     (vendored verbatim), so defaults, Duplex per-side keys
 *     (`readableHighWaterMark`/`writableHighWaterMark`, `readableObjectMode`/
 *     `writableObjectMode`) and validation match the real implementation.
 */

type AnyChunk = unknown;
type WriteDone = (err?: Error | null) => void;

/**
 * High-water-mark resolution is delegated to `internal/streams/state.js`; we
 * only adapt our per-instance object-mode flags to the `state` shape it wants.
 */
type DuplexKey = 'readableHighWaterMark' | 'writableHighWaterMark';
type HwmResolver = (
  objectMode: boolean,
  options: Record<string, unknown>,
  duplexKey: DuplexKey,
  isDuplex: boolean,
) => number;

/** Effective size of a chunk for high-water-mark accounting. */
function chunkSize(chunk: AnyChunk, objectMode: boolean): number {
  if (objectMode) return 1;
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk).byteLength;
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk)) return (chunk as ArrayBufferView).byteLength;
  if (chunk instanceof ArrayBuffer) return chunk.byteLength;
  return 1;
}

/** Node caps a single read at 1 GiB. */
const MAX_HWM = 0x40000000;

/**
 * `read(n)` with `n` above the current high-water mark raises it, rounded up to
 * a power of two so it cannot creep upwards in tiny steps (Node's
 * `computeNewHighWaterMark`).
 */
function computeNewHighWaterMark(n: number): number {
  if (n > MAX_HWM) {
    const err = new RangeError(`The value of "size" is out of range. It must be <= 1GiB. Received ${n}`);
    (err as { code?: string }).code = 'ERR_OUT_OF_RANGE';
    throw err;
  }
  n--;
  n |= n >>> 1;
  n |= n >>> 2;
  n |= n >>> 4;
  n |= n >>> 8;
  n |= n >>> 16;
  return n + 1;
}

function toBytes(chunk: AnyChunk): Uint8Array {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  if (chunk instanceof Uint8Array) return chunk;
  if (ArrayBuffer.isView(chunk)) {
    const v = chunk as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer, ArrayBuffer, or Array');
}

// ---------------------------------------------------------------------------
// Writable state lives in a WeakMap, not in `#private` fields.
//
// Reason: `Duplex`/`Transform`/`PassThrough` are built by mixing the writable
// API onto a `Readable` subclass (structurally what Node does too). Private
// fields are per-constructor and would not be reachable from a mixed instance,
// while a WeakMap keyed by the instance works for every subclass shape.
// ---------------------------------------------------------------------------

interface WritableState {
  buffer: Array<{ chunk: AnyChunk; cb?: WriteDone }>;
  length: number;
  writing: boolean;
  ending: boolean;
  ended: boolean;
  finished: boolean;
  needDrain: boolean;
  corked: number;
  hwm: number;
  objectMode: boolean;
  decodeStrings: boolean;
  autoDestroy: boolean;
  closed: boolean;
  destroyed: boolean;
  error: Error | null;
}

/**
 * `autoDestroy` bookkeeping, shared by every stream shape.
 *
 * A plain `Readable` is "done" when it ends; a plain `Writable` when it
 * finishes; a `Duplex` only when *both* halves are done (otherwise the writable
 * side would be torn down while the readable side is still producing, which is
 * the classic half-open bug). Registering the two flags in one place lets a
 * single helper decide when to `destroy()`.
 */
interface AutoDestroyState {
  autoDestroy: boolean;
  readableDone: boolean;
  writableDone: boolean;
  /**
   * Mark the stream destroyed and emit `close`, once.
   *
   * Deliberately *not* `destroy()`: the normal `end`/`finish` path has already
   * released whatever the stream held, so re-entering `_destroy` here would tear
   * down resources a second time (an http `ClientRequest` aborts its socket, for
   * one). This mirrors what the hand-written `close` emission did before
   * `autoDestroy` existed, plus the `destroyed` flag Node expects at `close`.
   */
  close: () => void;
}

const DESTROY_STATE = new WeakMap<object, AutoDestroyState>();

function settleAutoDestroy(self: object, side: 'readable' | 'writable'): void {
  const state = DESTROY_STATE.get(self);
  if (!state) return;
  if (side === 'readable') state.readableDone = true;
  else state.writableDone = true;
  if (!state.autoDestroy) return;
  if (state.readableDone && state.writableDone) state.close();
}

const W_STATE = new WeakMap<object, WritableState>();

function wstate(self: object): WritableState {
  const s = W_STATE.get(self);
  if (!s) throw new Error('[web-node] writable state missing; call super() first');
  return s;
}

function initWritable(
  self: object,
  options: Record<string, unknown> = {},
  resolveHwm: HwmResolver,
  isDuplex = false,
): void {
  // Node: `objectMode` wins, then the Duplex-specific side flag; a plain
  // Writable ignores `writableObjectMode`.
  const objectMode = !!(options.objectMode || (isDuplex && options.writableObjectMode));
  W_STATE.set(self, {
    buffer: [],
    length: 0,
    writing: false,
    ending: false,
    ended: false,
    finished: false,
    needDrain: false,
    corked: 0,
    hwm: resolveHwm(objectMode, options, 'writableHighWaterMark', isDuplex),
    objectMode,
    // Node forces `decodeStrings` off in object mode: a string is a value to
    // pass through, not bytes to re-encode as a Buffer.
    decodeStrings: options.decodeStrings !== false && !objectMode,
    autoDestroy: options.autoDestroy !== false,
    closed: false,
    destroyed: false,
    error: null,
  });
  // A Duplex reaches here with a registry already created by Readable; a plain
  // Writable gets one now, with its readable half marked done from the start.
  const existing = DESTROY_STATE.get(self);
  if (existing) {
    existing.writableDone = false;
    if (options.autoDestroy === false) existing.autoDestroy = false;
  } else {
    DESTROY_STATE.set(self, {
      autoDestroy: options.autoDestroy !== false,
      readableDone: true,
      writableDone: false,
      close: () => {
        const s = W_STATE.get(self) as WritableState;
        if (s.closed) return;
        s.closed = true;
        s.destroyed = true;
        (self as { emit(n: string, ...a: unknown[]): unknown }).emit('close');
      },
    });
  }
}

export const streamSpec: BuiltinSpec = {
  id: 'stream',
  aliases: ['node:stream'],
  origin: 'web-node',
  deps: ['events', 'internal/streams/state'],
  init: (ctx: BuiltinInitContext) => {
    const { EventEmitter } = ctx.require('events') as { EventEmitter: new () => EmitterLike };
    const { getHighWaterMark, getDefaultHighWaterMark, setDefaultHighWaterMark } = ctx.require(
      'internal/streams/state',
    ) as {
      getHighWaterMark: (
        state: { objectMode: boolean },
        options: Record<string, unknown>,
        duplexKey: DuplexKey,
        isDuplex: boolean,
      ) => number;
      getDefaultHighWaterMark: (objectMode: boolean) => number;
      setDefaultHighWaterMark: (objectMode: boolean, value: number) => void;
    };
    const resolveHwm: HwmResolver = (objectMode, options, duplexKey, isDuplex) =>
      getHighWaterMark({ objectMode }, options, duplexKey, isDuplex);
    const { Buffer: Buffer_ } = ctx.require('buffer') as {
      Buffer: {
        new (size: number): Uint8Array;
        from(v: unknown, e?: string): Uint8Array;
        allocUnsafe(n: number): Uint8Array;
      };
    };

    interface EmitterLike {
      on(name: string, fn: (...a: never[]) => void): unknown;
      once(name: string, fn: (...a: never[]) => void): unknown;
      emit(name: string, ...args: unknown[]): boolean;
      removeListener(name: string, fn: (...a: never[]) => void): unknown;
    }

    const defer = (fn: () => void): void => ctx.binding.nextTick(fn as (...a: unknown[]) => void);

    /** Byte-mode chunks reach consumers as Buffers, as they do in Node. */
    const toBuffer = (chunk: AnyChunk): AnyChunk => {
      if (chunk instanceof Buffer_) return chunk;
      if (typeof chunk === 'string') return Buffer_.from(chunk, 'utf8');
      if (chunk instanceof Uint8Array) return Buffer_.from(chunk);
      if (ArrayBuffer.isView(chunk)) {
        const v = chunk as ArrayBufferView;
        return Buffer_.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      }
      if (chunk instanceof ArrayBuffer) return Buffer_.from(new Uint8Array(chunk));
      return chunk;
    };

    // ======================= Readable ======================================

    class Readable extends (EventEmitter as new () => EmitterLike) {
      readable = true;

      #buffer: AnyChunk[] = [];
      #length = 0;
      #hwm: number;
      #objectMode: boolean;
      #autoDestroy: boolean;
      #ended = false;
      #endEmitted = false;
      #flowing = false;
      #paused = false;
      #reading = false;
      #destroyed = false;
      #closed = false;
      #encoding: string | null = null;
      #piped: unknown[] = [];
      /** A `readable` signal is already scheduled: do not queue a second one. */
      #emittedReadable = false;
      /** The consumer asked for data (`read()`/`readable`) but got none yet. */
      #needReadable = false;

      constructor(options: Record<string, unknown> = {}, isDuplex = false) {
        super();
        this.#objectMode = !!(options.objectMode || (isDuplex && options.readableObjectMode));
        this.#autoDestroy = options.autoDestroy !== false;
        this.#hwm = resolveHwm(this.#objectMode, options, 'readableHighWaterMark', isDuplex);
        if (typeof options.read === 'function') {
          (this as unknown as Record<string, unknown>)._read = (options.read as (...a: unknown[]) => void).bind(this);
        }
        if (typeof options.encoding === 'string') this.#encoding = options.encoding;
        if (typeof options.destroy === 'function') {
          (this as unknown as Record<string, unknown>)._destroy = (options.destroy as (...a: unknown[]) => void).bind(this);
        }
        // The readable half is not done yet; the writable half is absent (a
        // Duplex flips this in `initWritable`).
        DESTROY_STATE.set(this, {
          autoDestroy: this.#autoDestroy,
          readableDone: false,
          writableDone: true,
          close: () => this.#softClose(),
        });
      }

      /** Mark destroyed and emit `close` once, without re-entering `_destroy`. */
      #softClose(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#destroyed = true;
        this.emit('close');
      }

      /** Subclasses override: produce more data (via `push`). */
      _read(_size: number): void {
        /* default: the source pushes from the outside (sockets, http bodies) */
      }

      /** Subclasses override: release resources. */
      _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        cb(err);
      }

      get readableHighWaterMark(): number {
        return this.#hwm;
      }
      get readableObjectMode(): boolean {
        return this.#objectMode;
      }
      get readableLength(): number {
        return this.#length;
      }
      get readableEnded(): boolean {
        return this.#endEmitted;
      }
      get readableFlowing(): boolean | null {
        if (this.#flowing && !this.#paused) return true;
        if (this.#paused) return false;
        return null;
      }
      get destroyed(): boolean {
        return this.#destroyed;
      }

      #shouldFlow(): boolean {
        return this.#flowing && !this.#paused && !this.#destroyed;
      }

      #decode(chunk: AnyChunk): AnyChunk {
        if (this.#objectMode) return chunk;
        if (this.#encoding !== null) {
          if (typeof chunk === 'string') return chunk;
          return new TextDecoder(this.#encoding === 'utf8' ? 'utf-8' : this.#encoding).decode(toBytes(chunk));
        }
        // Byte mode with no decoder: Node hands the consumer a Buffer, never a
        // bare Uint8Array (chunk.toString() has to mean "decode", not "list the
        // bytes").
        return toBuffer(chunk);
      }

      #maybeRead(): void {
        if (this.#reading || this.#ended || this.#destroyed) return;
        this.#reading = true;
        try {
          this._read(this.#hwm - this.#length);
        } catch (err) {
          this.destroy(err as Error);
        }
      }

      /** Move buffered chunks to the consumer and settle `end`/`close`. */
      #drain(): void {
        while (this.#buffer.length > 0 && this.#shouldFlow()) {
          const chunk = this.#buffer.shift() as AnyChunk;
          this.#length -= chunkSize(chunk, this.#objectMode);
          this.emit('data', this.#decode(chunk));
        }
        if (this.#shouldFlow() && !this.#ended && this.#length < this.#hwm) this.#maybeRead();
        // A paused consumer learns about new bytes from `readable`, not `data`.
        if (!this.#shouldFlow() && this.#buffer.length > 0) this.#emitReadable();
        if (this.#ended && this.#buffer.length === 0 && !this.#endEmitted && this.#shouldFlow()) {
          this.#endReadable();
        }
      }

      /**
       * Signal a paused consumer that data (or the end) is available.
       *
       * Deferred and coalesced the way Node does it: the flag is only cleared
       * once the event actually fires, so a burst of `push()` calls yields a
       * single `readable`.
       */
      #emitReadable(): void {
        this.#needReadable = false;
        if (this.#emittedReadable || this.#destroyed) return;
        this.#emittedReadable = true;
        defer(() => {
          if (this.#destroyed) return;
          if (this.#length > 0 || this.#ended) {
            this.#emittedReadable = false;
            this.emit('readable');
          } else {
            this.#needReadable = true;
          }
        });
      }

      /**
       * Emit `end`, then `close` (through `autoDestroy`), exactly once.
       *
       * Deferred, like Node. A synchronous `end` would fire from inside the very
       * call that started the flow (`pipe()`, `on('data')`, `resume()`), i.e.
       * before the caller had a chance to attach its own `end` handler.
       */
      #endReadable(): void {
        if (this.#endEmitted) return;
        this.#endEmitted = true;
        defer(() => {
          if (this.#destroyed) return;
          // Node re-signals `readable` with an empty buffer just before `end`,
          // so a paused reader that is mid-loop sees one final, harmless tick.
          if (!this.#shouldFlow()) this.emit('readable');
          this.emit('end');
          settleAutoDestroy(this, 'readable');
        });
      }

      push(chunk: AnyChunk): boolean {
        if (this.#destroyed) return false;
        if (chunk === null) {
          this.#ended = true;
          this.#reading = false;
          if (this.#buffer.length === 0 && !this.#shouldFlow()) this.#emitReadable();
          this.#drain();
          if (this.#ended && this.#buffer.length === 0 && !this.#endEmitted && !this.#shouldFlow()) {
            // Nothing will ever flow: a paused consumer still needs `readable`,
            // then `end`, so it can observe the empty tail.
            this.#emitReadable();
            this.#endReadable();
          }
          return false;
        }
        if (this.#ended) throw new Error('stream.push() after EOF');
        this.#buffer.push(chunk);
        this.#length += chunkSize(chunk, this.#objectMode);
        this.#reading = false;
        this.#drain();
        return this.#length < this.#hwm;
      }

      unshift(chunk: AnyChunk): void {
        if (this.#ended) throw new Error('stream.unshift() after EOF');
        this.#buffer.unshift(chunk);
        this.#length += chunkSize(chunk, this.#objectMode);
      }

      // Attaching a 'data' listener switches the stream into flowing mode, and
      // `pipe()` relies on that: this is the whole "flowing vs paused" contract.
      // A 'readable' listener is the opposite: it keeps the stream paused and
      // asks it to start producing.
      on(name: string, fn: (...a: never[]) => void): this {
        (super.on as (n: string, f: (...a: never[]) => void) => unknown)(name, fn);
        if (name === 'data') {
          this.#flowing = true;
          this.#paused = false;
          this.#drain();
        } else if (name === 'readable') {
          this.#needReadable = true;
          if (!this.#ended) this.#maybeRead();
          this.#drain();
        }
        return this;
      }

      addListener(name: string, fn: (...a: never[]) => void): this {
        return this.on(name, fn);
      }

      once(name: string, fn: (...a: never[]) => void): this {
        (super.once as (n: string, f: (...a: never[]) => void) => unknown)(name, fn);
        if (name === 'data') {
          this.#flowing = true;
          this.#paused = false;
          this.#drain();
        } else if (name === 'readable') {
          this.#needReadable = true;
          if (!this.#ended) this.#maybeRead();
          this.#drain();
        }
        return this;
      }

      pause(): this {
        this.#paused = true;
        return this;
      }

      isPaused(): boolean {
        return this.#paused;
      }

      resume(): this {
        this.#paused = false;
        this.#flowing = true;
        this.#drain();
        return this;
      }

      setEncoding(enc: string): this {
        this.#encoding = enc;
        return this;
      }

      /**
       * Pull API, byte-exact in byte mode.
       *
       * `read(n)` yields exactly `n` bytes (splitting buffered chunks as needed)
       * or everything available when `n` is omitted; object mode always yields
       * one whole value. A no-op read at a full buffer or at EOF only re-arms
       * the `readable` signal, which is what Node does.
       */
      read(n?: number): AnyChunk {
        if (this.#destroyed) return null;

        const explicit = n !== undefined && !Number.isNaN(n);
        const want = explicit ? Math.max(0, Math.floor(n as number)) : 0;

        // Asking for more than the current hwm raises it, as in Node.
        if (explicit && want > this.#hwm) this.#hwm = computeNewHighWaterMark(want);

        if (explicit && want === 0 && this.#needReadable && (this.#length >= this.#hwm || this.#ended)) {
          this.#emitReadable();
          return null;
        }

        // `_read` may push synchronously (a passthrough or a `Readable.from`), so
        // the decision to pull has to be made from the pre-read length.
        let doRead = this.#needReadable;
        if (this.#length === 0 || this.#length - want < this.#hwm) doRead = true;
        if (this.#ended || this.#reading) doRead = false;
        if (doRead) this.#maybeRead();

        const howMuch = this.#howMuchToRead(explicit, want);
        if (howMuch === 0) {
          this.#needReadable = true;
          // A zero-byte answer at EOF is the signal to finish the stream.
          if (this.#ended && this.#length === 0 && !this.#endEmitted) this.#endReadable();
          return null;
        }

        const ret = this.#fromBuffer(howMuch);
        if (ret === null) {
          this.#needReadable = true;
        } else {
          // The buffer moved, so the next arrival must announce itself again.
          this.#emittedReadable = false;
          this.#needReadable = false;
        }
        if (this.#ended && this.#length === 0 && !this.#endEmitted) this.#endReadable();
        return ret;
      }

      /** How many bytes/values a single `read()` may hand back. */
      #howMuchToRead(explicit: boolean, want: number): number {
        if (this.#length === 0 && this.#ended) return 0;
        if (this.#objectMode) return explicit && want === 0 ? 0 : 1;
        if (!explicit) return this.#length;
        if (want <= 0) return this.#length;
        return Math.min(want, this.#length);
      }

      /** Take `howMuch` out of the buffer (splitting a byte chunk if needed). */
      #fromBuffer(howMuch: number): AnyChunk {
        if (this.#buffer.length === 0) return null;
        if (this.#objectMode) {
          const chunk = this.#buffer.shift() as AnyChunk;
          this.#length -= 1;
          return chunk;
        }
        if (howMuch >= this.#length) {
          const all = this.#buffer;
          this.#buffer = [];
          this.#length = 0;
          return this.#decode(concatChunks(all));
        }
        const out: Uint8Array[] = [];
        let got = 0;
        while (this.#buffer.length > 0 && got < howMuch) {
          const head = toBytes(this.#buffer[0]);
          const take = Math.min(head.byteLength, howMuch - got);
          out.push(take === head.byteLength ? head : head.slice(0, take));
          got += take;
          if (take === head.byteLength) {
            this.#buffer.shift();
          } else {
            this.#buffer[0] = head.subarray(take);
          }
          this.#length -= take;
        }
        return this.#decode(concatChunks(out));
      }

      pipe<T extends EmitterLike & { write(c: unknown): boolean; end?: (c?: unknown) => unknown }>(
        dest: T,
        options?: { end?: boolean },
      ): T {
        this.#piped.push(dest);

        const onData = (chunk: unknown): void => {
          const ok = dest.write(chunk);
          if (ok === false) {
            // Backpressure: stop producing until the destination drains.
            this.pause();
            (dest.once as (n: string, f: () => void) => unknown)('drain', () => this.resume());
          }
        };
        const cleanup = (): void => {
          (this.removeListener as (n: string, f: unknown) => unknown)('data', onData);
          (this.removeListener as (n: string, f: unknown) => unknown)('end', onEnd);
          (this.removeListener as (n: string, f: unknown) => unknown)('error', onError);
        };
        const onEnd = (): void => {
          cleanup();
          if (options?.end !== false && typeof dest.end === 'function') dest.end();
        };
        const onError = (err: Error): void => {
          cleanup();
          const d = dest as unknown as { destroy?: (e: Error) => unknown };
          if (typeof d.destroy === 'function') d.destroy(err);
        };

        // Order matters: attaching the 'data' listener switches the stream to
        // flowing and can synchronously drain an already-buffered source, so the
        // 'end'/'error' handlers must already be in place.
        this.once('end', onEnd as (...a: never[]) => void);
        this.once('error', onError as (...a: never[]) => void);
        (dest.emit as (n: string, ...a: unknown[]) => boolean)('pipe', this);
        this.#flowing = true;
        this.#paused = false;
        this.on('data', onData as (...a: never[]) => void);
        this.#drain();
        return dest;
      }

      unpipe(dest?: unknown): this {
        if (dest) this.#piped = this.#piped.filter((d) => d !== dest);
        else this.#piped = [];
        return this;
      }

      destroy(err?: Error): this {
        if (this.#destroyed) return this;
        this.#destroyed = true;
        this.#flowing = false;
        const settle = (e?: Error | null): void => {
          const final = err ?? e ?? null;
          defer(() => {
            if (final) this.emit('error', final);
            this.emit('close');
          });
        };
        try {
          this._destroy(err ?? null, settle);
        } catch (e) {
          settle(e as Error);
        }
        return this;
      }

      [Symbol.asyncIterator](): AsyncIterator<AnyChunk> {
        const queue: AnyChunk[] = [];
        let done = false;
        let waiting: ((r: IteratorResult<AnyChunk>) => void) | null = null;

        const deliver = (chunk: AnyChunk): void => {
          if (waiting) {
            const w = waiting;
            waiting = null;
            w({ value: chunk, done: false });
          } else {
            queue.push(chunk);
          }
        };
        const finish = (): void => {
          done = true;
          if (waiting) {
            const w = waiting;
            waiting = null;
            w({ value: undefined, done: true });
          }
        };

        this.on('data', deliver as (...a: never[]) => void);
        this.once('end', finish as (...a: never[]) => void);

        return {
          next: (): Promise<IteratorResult<AnyChunk>> => {
            if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
            if (done) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => {
              waiting = resolve;
            });
          },
          return: (): Promise<IteratorResult<AnyChunk>> => {
            finish();
            return Promise.resolve({ value: undefined, done: true });
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        } as AsyncIterator<AnyChunk>;
      }

      static from(iterable: unknown, options?: Record<string, unknown>): Readable {
        const opts = { objectMode: true, ...(options ?? {}) } as Record<string, unknown>;
        // `Readable.from` is lazy in Node: unless the caller picks a size, it
        // will not buffer more than a single chunk, so an unbounded source
        // cannot fill memory.
        if (opts.highWaterMark === undefined) opts.highWaterMark = 1;
        const stream = new Readable(opts);
        const it = getIterator(iterable);
        let stopped = false;

        (stream as unknown as Record<string, unknown>)._read = (): void => {
          if (stopped) return;
          let result: unknown;
          try {
            result = it.next();
          } catch (err) {
            stopped = true;
            stream.destroy(err as Error);
            return;
          }
          Promise.resolve(result as IteratorResult<unknown>).then(
            (step: IteratorResult<unknown>) => {
              if (step.done) {
                stopped = true;
                stream.push(null);
                return;
              }
              // If push() reports backpressure the next _read() will not come
              // until the consumer drains, which is exactly what we want.
              stream.push(step.value);
            },
            (err: Error) => {
              stopped = true;
              stream.destroy(err);
            },
          );
        };
        return stream;
      }
    }

    function concatChunks(chunks: AnyChunk[]): Uint8Array {
      let total = 0;
      for (const c of chunks) {
        const b = toBytes(c);
        total += b.byteLength;
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        const b = toBytes(c);
        out.set(b, off);
        off += b.byteLength;
      }
      return out;
    }

    function getIterator(iterable: unknown): Iterator<unknown> {
      const value = iterable as Record<symbol, unknown> | null;
      if (value && typeof value[Symbol.asyncIterator] === 'function') {
        return (value[Symbol.asyncIterator] as () => Iterator<unknown>)();
      }
      if (value && typeof value[Symbol.iterator] === 'function') {
        return (value[Symbol.iterator] as () => Iterator<unknown>)();
      }
      throw new TypeError('Readable.from() expects an iterable or async iterable');
    }

    // ======================= Writable ======================================

    class Writable extends (EventEmitter as new () => EmitterLike) {
      writable = true;

      constructor(options: Record<string, unknown> = {}) {
        super();
        initWritable(this, options, resolveHwm);
        if (typeof options.write === 'function') {
          (this as unknown as Record<string, unknown>)._write = (options.write as (...a: unknown[]) => void).bind(this);
        }
        if (typeof options.final === 'function') {
          (this as unknown as Record<string, unknown>)._final = (options.final as (...a: unknown[]) => void).bind(this);
        }
        if (typeof options.destroy === 'function') {
          (this as unknown as Record<string, unknown>)._destroy = (options.destroy as (...a: unknown[]) => void).bind(this);
        }
      }

      _write(_chunk: AnyChunk, _enc: string, cb: WriteDone): void {
        cb(new Error('[web-node] _write() is not implemented'));
      }

      _final(cb: WriteDone): void {
        cb();
      }

      _destroy(err: Error | null, cb: WriteDone): void {
        cb(err);
      }

      get writableEnded(): boolean {
        return wstate(this).ended;
      }
      get writableFinished(): boolean {
        return wstate(this).finished;
      }
      get writableLength(): number {
        return wstate(this).length;
      }
      get writableHighWaterMark(): number {
        return wstate(this).hwm;
      }
      get writableObjectMode(): boolean {
        return wstate(this).objectMode;
      }
      get destroyed(): boolean {
        return wstate(this).destroyed;
      }
      get writableNeedDrain(): boolean {
        return wstate(this).needDrain;
      }

      write(chunk: AnyChunk, enc?: unknown, cb?: WriteDone): boolean {
        const s = wstate(this);
        if (typeof enc === 'function') {
          cb = enc as WriteDone;
          enc = undefined;
        }
        if (s.ending || s.ended) {
          const err = Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' });
          if (typeof cb === 'function') defer(() => (cb as WriteDone)(err));
          this.destroy(err);
          return false;
        }
        const data =
          s.decodeStrings && typeof chunk === 'string'
            ? Buffer_.from(chunk, typeof enc === 'string' ? enc : 'utf8')
            : chunk;
        s.buffer.push({ chunk: data, cb: typeof cb === 'function' ? cb : undefined });
        s.length += chunkSize(data, s.objectMode);
        if (!s.writing && s.corked === 0) doWrite(this);
        const ok = s.length < s.hwm;
        if (!ok) s.needDrain = true;
        return ok;
      }

      end(chunk?: unknown, enc?: unknown, cb?: () => void): this {
        const s = wstate(this);
        if (typeof chunk === 'function') {
          cb = chunk as () => void;
          chunk = undefined;
        } else if (typeof enc === 'function') {
          cb = enc as () => void;
          enc = undefined;
        }
        if (typeof cb === 'function') this.once('finish', cb as (...a: never[]) => void);
        if (chunk !== undefined) this.write(chunk, enc);
        s.ending = true;
        doWrite(this);
        return this;
      }

      cork(): void {
        wstate(this).corked++;
      }

      uncork(): void {
        const s = wstate(this);
        if (s.corked > 0) s.corked--;
        if (s.corked === 0) doWrite(this);
      }

      setDefaultEncoding(enc: string): this {
        void enc;
        return this;
      }

      destroy(err?: Error): this {
        const s = wstate(this);
        if (s.destroyed) return this;
        s.destroyed = true;
        s.buffer = [];
        s.length = 0;
        const settle = (e?: Error | null): void => {
          const final = err ?? e ?? null;
          defer(() => {
            if (final) this.emit('error', final);
            this.emit('close');
          });
        };
        try {
          this._destroy(err ?? null, settle);
        } catch (e) {
          settle(e as Error);
        }
        return this;
      }
    }

    /** Run queued writes one at a time, then settle `drain` / `finish`. */
    function doWrite(self: Writable): void {
      const s = wstate(self);
      if (s.writing || s.destroyed || s.corked > 0) return;
      const item = s.buffer.shift();
      if (!item) {
        afterFlush(self);
        return;
      }
      s.length -= chunkSize(item.chunk, s.objectMode);
      s.writing = true;
      let settled = false;
      const done: WriteDone = (err) => {
        if (settled) return;
        settled = true;
        s.writing = false;
        if (err) {
          s.error = err;
          if (item.cb) item.cb(err);
          self.destroy(err);
          return;
        }
        if (item.cb) item.cb(null);
        doWrite(self);
      };
      try {
        self._write(item.chunk, 'buffer', done);
      } catch (err) {
        done(err as Error);
      }
    }

    function afterFlush(self: Writable): void {
      const s = wstate(self);
      if (s.buffer.length > 0 || s.writing) return;
      if (s.needDrain) {
        s.needDrain = false;
        defer(() => self.emit('drain'));
      }
      if (s.ending && !s.finished) {
        s.finished = true;
        let settled = false;
        const done: WriteDone = (err) => {
          if (settled) return;
          settled = true;
          if (err) {
            self.destroy(err);
            return;
          }
          s.ended = true;
          // Deferred: `finish` must not fire synchronously inside `end()`, or a
          // caller attaching its listener right after `end()` would miss it.
          defer(() => {
            if (s.destroyed) return;
            self.emit('finish');
            settleAutoDestroy(self, 'writable');
          });
        };
        try {
          self._final(done);
        } catch (err) {
          done(err as Error);
        }
      }
    }

    // ======================= Duplex / Transform ============================

    class Duplex extends Readable {
      constructor(options: Record<string, unknown> = {}) {
        super(options, true);
        initWritable(this, options, resolveHwm, true);
        const self = this as unknown as Record<string, unknown>;
        if (typeof options.write === 'function') self._write = (options.write as (...a: unknown[]) => void).bind(this);
        if (typeof options.final === 'function') self._final = (options.final as (...a: unknown[]) => void).bind(this);
        if (typeof options.read === 'function') self._read = (options.read as (...a: unknown[]) => void).bind(this);
      }

      _write(_chunk: AnyChunk, _enc: string, cb: WriteDone): void {
        cb(new Error('[web-node] _write() is not implemented'));
      }

      _final(cb: WriteDone): void {
        cb();
      }
    }

    /** Copy the writable API onto a Readable subclass (what Node does structurally). */
    function mixWritableApi(target: { prototype: object }): void {
      for (const key of Object.getOwnPropertyNames(Writable.prototype)) {
        if (key === 'constructor' || key.startsWith('_') || key === 'destroy') continue;
        if (key in target.prototype) continue;
        Object.defineProperty(
          target.prototype,
          key,
          Object.getOwnPropertyDescriptor(Writable.prototype, key) as PropertyDescriptor,
        );
      }
      // Both halves must be torn down together, and the readable side owns
      // `destroy` (it already emits `error` + `close` in the right order).
      Object.defineProperty(target.prototype, 'destroy', {
        configurable: true,
        writable: true,
        value: function destroy(this: Duplex, err?: Error): Duplex {
          const s = wstate(this);
          s.destroyed = true;
          s.buffer = [];
          s.length = 0;
          return Readable.prototype.destroy.call(this, err) as Duplex;
        },
      });
    }

    mixWritableApi(Duplex);

    class Transform extends Duplex {
      constructor(options: Record<string, unknown> = {}) {
        super(options);
        const self = this as unknown as Record<string, unknown>;
        if (typeof options.transform === 'function') {
          self._transform = (options.transform as (...a: unknown[]) => void).bind(this);
        }
        if (typeof options.flush === 'function') self._flush = (options.flush as (...a: unknown[]) => void).bind(this);
      }

      _transform(_chunk: AnyChunk, _enc: string, cb: (err?: Error | null, data?: AnyChunk) => void): void {
        cb(new Error('[web-node] _transform() is not implemented'));
      }

      _flush(cb: (err?: Error | null, data?: AnyChunk) => void): void {
        cb();
      }

      _read(): void {
        /* output is produced by the write side */
      }

      _write(chunk: AnyChunk, enc: string, cb: WriteDone): void {
        let settled = false;
        this._transform(chunk, enc, (err, data) => {
          if (settled) return;
          settled = true;
          if (err) {
            cb(err);
            return;
          }
          if (data !== undefined && data !== null) this.push(data);
          cb();
        });
      }

      _final(cb: WriteDone): void {
        this._flush((err, data) => {
          if (err) {
            cb(err);
            return;
          }
          if (data !== undefined && data !== null) this.push(data);
          this.push(null);
          cb();
        });
      }
    }

    class PassThrough extends Transform {
      _transform(chunk: AnyChunk, _enc: string, cb: (err?: Error | null, data?: AnyChunk) => void): void {
        cb(null, chunk);
      }
    }

    // ======================= helpers =======================================

    function finished(stream: EmitterLike, cb?: (err?: Error | null) => void): (() => void) | Promise<void> {
      let settled = false;
      const done = (err?: Error | null): void => {
        if (settled) return;
        settled = true;
        if (cb) cb(err ?? null);
      };
      (stream.on as (n: string, f: (...a: unknown[]) => void) => unknown)('error', done as (...a: unknown[]) => void);
      (stream.on as (n: string, f: (...a: unknown[]) => void) => unknown)('end', () => done(null));
      (stream.on as (n: string, f: (...a: unknown[]) => void) => unknown)('finish', () => done(null));
      (stream.on as (n: string, f: (...a: unknown[]) => void) => unknown)('close', () => done(null));
      if (cb) return () => undefined;
      return new Promise<void>((resolve, reject) => {
        (stream.on as (n: string, f: (...a: unknown[]) => void) => unknown)('error', (e: unknown) => reject(e as Error));
        (stream.on as (n: string, f: (...a: unknown[]) => void) => unknown)('end', () => resolve());
        (stream.on as (n: string, f: (...a: unknown[]) => void) => unknown)('finish', () => resolve());
        (stream.on as (n: string, f: (...a: unknown[]) => void) => unknown)('close', () => resolve());
      });
    }

    function pipeline(...args: unknown[]): unknown {
      let cb: ((err?: Error | null) => void) | undefined;
      if (typeof args[args.length - 1] === 'function') cb = args.pop() as (err?: Error | null) => void;
      const streams = args as Array<EmitterLike & { pipe(d: unknown): unknown; destroy?: (e?: Error) => unknown }>;
      if (streams.length < 2) throw new TypeError('pipeline() requires at least two streams');

      let settled = false;
      const done = (err?: Error | null): void => {
        if (settled) return;
        settled = true;
        if (cb) cb(err ?? null);
      };

      for (let i = 0; i < streams.length - 1; i++) {
        const src = streams[i];
        const dst = streams[i + 1];
        (src.on as (n: string, f: (e: Error) => void) => unknown)('error', (err: Error) => {
          if (typeof dst.destroy === 'function') dst.destroy(err);
          done(err);
        });
        src.pipe(dst);
      }
      const last = streams[streams.length - 1];
      (last.on as (n: string, f: (e: Error) => void) => unknown)('error', (err: Error) => done(err));

      const finishPromise = finished(last) as Promise<void>;
      finishPromise.then(
        () => done(null),
        (err: Error) => done(err),
      );
      return last;
    }

    const promises = {
      pipeline: (...args: unknown[]): Promise<void> => {
        const streams = args;
        return new Promise((resolve, reject) => {
          pipeline(...streams, (err?: Error | null) => (err ? reject(err) : resolve()));
        });
      },
      finished: (stream: EmitterLike): Promise<void> => finished(stream) as Promise<void>,
    };

    function addAbortSignal(): never {
      throw new Error('[web-node] stream.addAbortSignal is not implemented');
    }
    function compose(): never {
      throw new Error('[web-node] stream.compose is not implemented');
    }
    function isReadable(stream: unknown): boolean {
      return typeof (stream as { read?: unknown } | null)?.read === 'function';
    }
    function isWritable(stream: unknown): boolean {
      return typeof (stream as { write?: unknown } | null)?.write === 'function';
    }

    return {
      Stream: Readable,
      Readable,
      Writable,
      Duplex,
      Transform,
      PassThrough,
      pipeline,
      finished,
      addAbortSignal,
      compose,
      isReadable,
      isWritable,
      getDefaultHighWaterMark,
      setDefaultHighWaterMark,
      promises,
      default: { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished, getDefaultHighWaterMark, setDefaultHighWaterMark },
      /** Non-standard: lets `net`/`http`/`fs` share the exact same base classes. */
      _base: { Readable, Writable, Duplex, Transform, PassThrough },
    };
  },
};

/**
 * `stream/promises` — the promise-only facade Node exposes at its own id.
 */
export const streamPromisesSpec: BuiltinSpec = {
  id: 'stream/promises',
  aliases: ['node:stream/promises'],
  origin: 'web-node',
  deps: ['stream'],
  init: (ctx: BuiltinInitContext) => {
    const stream = ctx.require('stream') as { promises: Record<string, unknown> };
    return { ...stream.promises, default: stream.promises };
  },
};
