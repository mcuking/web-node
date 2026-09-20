import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * The whole `stream` family is now Node's own source (vendored from
 * lib/stream.js + lib/internal/streams/*), not a hand-written module. These
 * assertions cover the parts that used to be reimplemented: the module surface,
 * the default high-water marks, Writable/Duplex/Transform, the pipeline and
 * finished helpers, compose(), the async operators, and `stream.promises`.
 *
 * Values read off a real Node and reconciled with the vendored lib/ checkout;
 * the oracle is now fnm Node v26.9.0 (see docs/DEVLOG.md).
 */
function boot(): { stream: any; require: (id: string) => any } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return { stream: runtime.realm.require('stream') as any, require: (id) => runtime.realm.require(id) };
}

const tick = (ms = 40) => new Promise((res) => setTimeout(res, ms));

describe('stream is the vendored Node source', () => {
  it('exposes the module surface', () => {
    const { stream } = boot();
    for (const name of [
      'Readable',
      'Writable',
      'Duplex',
      'Transform',
      'PassThrough',
      'Stream',
      'pipeline',
      'finished',
      'compose',
      'duplexPair',
      'addAbortSignal',
      'isReadable',
      'isWritable',
      'isDisturbed',
      'isErrored',
      'isDestroyed',
      'getDefaultHighWaterMark',
      'setDefaultHighWaterMark',
    ]) {
      expect(typeof stream[name], name).toBe('function');
    }
    expect(typeof stream.promises).toBe('object');
    // prototype operators, only present because internal/streams/operators is real
    expect(typeof stream.Readable.prototype.map).toBe('function');
    expect(typeof stream.Readable.prototype.filter).toBe('function');
  });

  it('has Node\'s default high-water marks', () => {
    const { stream } = boot();
    expect(stream.getDefaultHighWaterMark()).toBe(65536);
    expect(stream.getDefaultHighWaterMark(true)).toBe(16);
    const r = new stream.Readable({ read() {} });
    expect(r.readableHighWaterMark).toBe(65536);
    const ro = new stream.Readable({ read() {}, objectMode: true });
    expect(ro.readableHighWaterMark).toBe(16);
  });

  it('writes, finishes, and reports Node\'s writable state', async () => {
    const { stream } = boot();
    const chunks: string[] = [];
    const w = new stream.Writable({
      write(chunk: Uint8Array, _enc: string, cb: () => void) {
        chunks.push(String(chunk));
        cb();
      },
    });
    expect(w.writableHighWaterMark).toBe(65536);
    const finished = new Promise<void>((res) => w.on('finish', () => res()));
    w.write('a');
    w.end('b');
    await finished;
    expect(chunks.join('')).toBe('ab');
    expect(w.writableFinished).toBe(true);
  });

  it('runs a Duplex as both ends', async () => {
    const { stream } = boot();
    const seen: string[] = [];
    const d = new stream.Duplex({
      read() {},
      write(chunk: Uint8Array, _enc: string, cb: () => void) {
        seen.push(String(chunk));
        cb();
      },
    });
    d.write('in');
    d.push('out');
    await tick();
    expect(seen.join('')).toBe('in');
    // reading the readable half
    d.on('data', () => {});
    expect(d.readable).toBe(true);
    expect(d.writable).toBe(true);
  });

  it('transforms and passes through', async () => {
    const { stream } = boot();
    const out: string[] = [];
    const t = new stream.Transform({
      transform(chunk: Uint8Array, _enc: string, cb: (e: Error | null, v?: unknown) => void) {
        cb(null, String(chunk).toUpperCase());
      },
    });
    t.on('data', (c: Uint8Array) => out.push(String(c)));
    t.write('a');
    t.end('b');
    await tick();
    expect(out.join('')).toBe('AB');

    const p = new stream.PassThrough();
    const echoed: string[] = [];
    p.on('data', (c: Uint8Array) => echoed.push(String(c)));
    p.end('samesame');
    await tick();
    expect(echoed.join('')).toBe('samesame');
  });

  it('pipes through pipeline() with a callback and via stream/promises', async () => {
    const { stream } = boot();
    const sink: string[] = [];
    const make = () => {
      const r = new stream.Readable({ read() {} });
      const t = new stream.Transform({
        transform(chunk: Uint8Array, _enc: string, cb: (e: Error | null, v?: unknown) => void) {
          cb(null, chunk);
        },
      });
      const w = new stream.Writable({
        write(chunk: Uint8Array, _enc: string, cb: () => void) {
          sink.push(String(chunk));
          cb();
        },
      });
      r.push('hello');
      r.push(null);
      return { r, t, w };
    };

    const a = make();
    await new Promise<void>((res, rej) =>
      stream.pipeline(a.r, a.t, a.w, (err: Error | null) => (err ? rej(err) : res())),
    );
    expect(sink.join('')).toBe('hello');

    sink.length = 0;
    const b = make();
    await stream.promises.pipeline(b.r, b.t, b.w);
    expect(sink.join('')).toBe('hello');
  });

  it('compose() folds streams and finishes cleanly', async () => {
    const { stream } = boot();
    const c = stream.compose(
      new stream.Transform({
        transform(chunk: Uint8Array, _enc: string, cb: (e: Error | null, v?: unknown) => void) {
          cb(null, String(chunk).toUpperCase());
        },
      }),
    );
    const out: string[] = [];
    c.on('data', (chunk: Uint8Array) => out.push(String(chunk)));
    c.write('hi');
    c.end();
    await tick();
    expect(out.join('')).toBe('HI');
  });

  it('duplexPair() yields two cross-wired Duplexes', async () => {
    const { stream } = boot();
    const { 0: a, 1: b } = stream.duplexPair();
    const got: string[] = [];
    b.on('data', (chunk: Uint8Array) => got.push(String(chunk)));
    a.write('ping');
    await tick();
    expect(got.join('')).toBe('ping');
  });

  it('supports the async iterator operators (map/filter/toArray)', async () => {
    const { stream } = boot();
    const { Readable } = stream;
    const mapped: string[] = [];
    await new Promise<void>((res) => {
      Readable.from([1, 2, 3, 4])
        .filter((x: number) => x % 2 === 0)
        .map((x: number) => x * 10)
        .on('data', (d: number) => mapped.push(String(d)))
        .on('end', () => res());
    });
    expect(mapped.join(',')).toBe('20,40');
    // `Readable.from(array)` is objectMode, so chunks keep their type.
    await expect(Readable.from(['x', 'y']).toArray()).resolves.toEqual(['x', 'y']);
  });

  it('stream/promises re-exports finished()', async () => {
    const { stream, require } = boot();
    const promises = require('stream/promises');
    expect(typeof promises.finished).toBe('function');
    const r = stream.Readable.from([]);
    r.resume();
    await expect(promises.finished(r)).resolves.toBeUndefined();
  });
});
