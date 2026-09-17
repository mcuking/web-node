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
 *   - `read(n)` in byte mode hands back whole buffered chunks, it does not
 *     split to an exact byte count. `'data'`/`pipe()` (the common paths) are
 *     exact;  `read(n)` is a convenience.
 *   - No `objectMode`/`readableObjectMode` separation, no `autoDestroy` timing
 *     subtleties, no `stream.finished` cleanup handle.
 */

const DEFAULT_HWM = 16 * 1024;
const OBJECT_HWM = 16;

type AnyChunk = unknown;
type WriteDone = (err?: Error | null) => void;

/** Effective size of a chunk for high-water-mark accounting. */
function chunkSize(chunk: AnyChunk, objectMode: boolean): number {
  if (objectMode) return 1;
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk).byteLength;
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk)) return (chunk as ArrayBufferView).byteLength;
  if (chunk instanceof ArrayBuffer) return chunk.byteLength;
  return 1;
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
  destroyed: boolean;
  error: Error | null;
}

const W_STATE = new WeakMap<object, WritableState>();

function wstate(self: object): WritableState {
  const s = W_STATE.get(self);
  if (!s) throw new Error('[web-node] writable state missing; call super() first');
  return s;
}

function initWritable(self: object, options: Record<string, unknown> = {}): void {
  const objectMode = !!options.objectMode;
  W_STATE.set(self, {
    buffer: [],
    length: 0,
    writing: false,
    ending: false,
    ended: false,
    finished: false,
    needDrain: false,
    corked: 0,
    hwm: typeof options.highWaterMark === 'number' ? (options.highWaterMark as number) : objectMode ? OBJECT_HWM : DEFAULT_HWM,
    objectMode,
    decodeStrings: options.decodeStrings !== false,
    destroyed: false,
    error: null,
  });
}

export const streamSpec: BuiltinSpec = {
  id: 'stream',
  aliases: ['node:stream'],
  origin: 'web-node',
  deps: ['events'],
  init: (ctx: BuiltinInitContext) => {
    const { EventEmitter } = ctx.require('events') as { EventEmitter: new () => EmitterLike };
    const { Buffer: Buffer_ } = ctx.require('buffer') as {
      Buffer: { from(v: unknown, e?: string): Uint8Array; allocUnsafe(n: number): Uint8Array };
    };

    interface EmitterLike {
      on(name: string, fn: (...a: never[]) => void): unknown;
      once(name: string, fn: (...a: never[]) => void): unknown;
      emit(name: string, ...args: unknown[]): boolean;
      removeListener(name: string, fn: (...a: never[]) => void): unknown;
    }

    const defer = (fn: () => void): void => ctx.binding.nextTick(fn as (...a: unknown[]) => void);

    // ======================= Readable ======================================

    class Readable extends (EventEmitter as new () => EmitterLike) {
      readable = true;

      #buffer: AnyChunk[] = [];
      #length = 0;
      #hwm: number;
      #objectMode: boolean;
      #ended = false;
      #endEmitted = false;
      #flowing = false;
      #paused = false;
      #reading = false;
      #destroyed = false;
      #encoding: string | null = null;
      #piped: unknown[] = [];

      constructor(options: Record<string, unknown> = {}) {
        super();
        this.#objectMode = !!options.objectMode;
        this.#hwm =
          typeof options.highWaterMark === 'number'
            ? (options.highWaterMark as number)
            : this.#objectMode
              ? OBJECT_HWM
              : DEFAULT_HWM;
        if (typeof options.read === 'function') {
          (this as unknown as Record<string, unknown>)._read = (options.read as (...a: unknown[]) => void).bind(this);
        }
        if (typeof options.encoding === 'string') this.#encoding = options.encoding;
        if (typeof options.destroy === 'function') {
          (this as unknown as Record<string, unknown>)._destroy = (options.destroy as (...a: unknown[]) => void).bind(this);
        }
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
        if (this.#objectMode || this.#encoding === null) return chunk;
        if (typeof chunk === 'string') return chunk;
        return new TextDecoder(this.#encoding === 'utf8' ? 'utf-8' : this.#encoding).decode(toBytes(chunk));
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
        if (this.#ended && this.#buffer.length === 0 && !this.#endEmitted && this.#shouldFlow()) {
          this.#endEmitted = true;
          // Deferred, like Node. A synchronous 'end' would fire from inside the
          // very call that started the flow (`pipe()`, `on('data')`, `resume()`),
          // i.e. before the caller had a chance to attach its own 'end' handler.
          defer(() => {
            this.emit('end');
            this.emit('close');
          });
        }
      }

      push(chunk: AnyChunk): boolean {
        if (this.#destroyed) return false;
        if (chunk === null) {
          this.#ended = true;
          this.#reading = false;
          this.#drain();
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
      on(name: string, fn: (...a: never[]) => void): this {
        (super.on as (n: string, f: (...a: never[]) => void) => unknown)(name, fn);
        if (name === 'data') {
          this.#flowing = true;
          this.#paused = false;
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

      /** Pull API. Byte mode returns whole buffered chunks, not exact counts. */
      read(n?: number): AnyChunk {
        if (this.#destroyed) return null;
        if (this.#buffer.length === 0) {
          if (!this.#ended) this.#maybeRead();
          if (this.#buffer.length === 0) return null;
        }
        if (this.#objectMode) {
          const chunk = this.#buffer.shift() as AnyChunk;
          this.#length -= 1;
          return chunk;
        }
        if (n === undefined || Number.isNaN(n)) {
          const all = this.#buffer;
          this.#buffer = [];
          this.#length = 0;
          return this.#decode(concatChunks(all));
        }
        const want = Math.max(0, Math.floor(n));
        if (want === 0) return this.#decode(new Uint8Array(0));
        const out: Uint8Array[] = [];
        let got = 0;
        while (this.#buffer.length > 0 && got < want) {
          const head = toBytes(this.#buffer[0]);
          const take = Math.min(head.byteLength, want - got);
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
        initWritable(this, options);
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
            self.emit('finish');
            self.emit('close');
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
        super(options);
        initWritable(this, options);
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
      promises,
      default: { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished },
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
