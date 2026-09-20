import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `Readable.from` is Node's own implementation now (vendor/node-lib/
 * internal/streams/from.js), plus the matching `ERR_*` families. Every expected
 * value below was read off a real Node v22 first.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  return new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
}

const err = (fn: () => unknown): { code?: string; name: string; message: string } => {
  try {
    fn();
  } catch (e) {
    const e2 = e as Error & { code?: string };
    return { code: e2.code, name: e2.constructor.name, message: e2.message };
  }
  return { name: '(none)', message: '(no throw)' };
};

describe('Readable.from (Node source)', () => {
  it('rejects non-iterables with Node’s ERR_INVALID_ARG_TYPE message', () => {
    const { Readable } = boot().realm.require('stream') as any;
    expect(err(() => Readable.from(null))).toEqual({
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message:
        'The "iterable" argument must be an instance of Iterable. Received null',
    });
    expect(err(() => Readable.from(42)).message).toBe(
      'The "iterable" argument must be an instance of Iterable. Received type number (42)',
    );
    expect(err(() => Readable.from(true)).message).toBe(
      'The "iterable" argument must be an instance of Iterable. Received type boolean (true)',
    );
  });

  it('yields a whole string / Buffer as one chunk (not per byte)', async () => {
    const runtime = boot();
    const { Readable } = runtime.realm.require('stream') as any;
    const { Buffer: B } = runtime.realm.require('buffer') as any;

    const stringChunks: unknown[] = [];
    for await (const c of Readable.from('abc')) stringChunks.push(c);
    expect(stringChunks).toEqual(['abc']);

    const bufferChunks: unknown[] = [];
    for await (const c of Readable.from(B.from('hi'))) bufferChunks.push(c);
    expect(bufferChunks).toHaveLength(1);
    expect(B.isBuffer(bufferChunks[0])).toBe(true);
  });

  it('is object mode with highWaterMark 1, and streams an async generator', async () => {
    const { Readable } = boot().realm.require('stream') as any;
    async function* gen() {
      yield 1;
      yield 2;
    }
    const r = Readable.from(gen());
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(1);
    const chunks: unknown[] = [];
    for await (const c of r) chunks.push(c);
    expect(chunks).toEqual([1, 2]);
  });

  it('turns a null value into ERR_STREAM_NULL_VALUES', async () => {
    const { Readable } = boot().realm.require('stream') as any;
    async function* gen() {
      yield null;
    }
    let caught: any;
    try {
      for await (const _ of Readable.from(gen())) {
        /* drain */
      }
    } catch (e) {
      caught = e;
    }
    expect(caught?.code).toBe('ERR_STREAM_NULL_VALUES');
    expect(caught?.message).toBe('May not write null values to stream');
  });

  it('runs the generator’s finally when the stream is destroyed', async () => {
    const { Readable } = boot().realm.require('stream') as any;
    let cleaned = false;
    async function* gen() {
      try {
        yield 1;
        yield 2;
      } finally {
        cleaned = true;
      }
    }
    const r = Readable.from(gen());
    r.once('data', () => r.destroy());
    await new Promise((res) => setTimeout(res, 30));
    expect(cleaned).toBe(true);
  });

  it('propagates iterator errors', async () => {
    const { Readable } = boot().realm.require('stream') as any;
    async function* gen() {
      yield 1;
      throw new Error('boom');
    }
    let caught: any;
    try {
      for await (const _ of Readable.from(gen())) {
        /* drain */
      }
    } catch (e) {
      caught = e;
    }
    expect(caught?.message).toBe('boom');
  });
});

describe('stream: synchronous push() inside _read()', () => {
  it('does not loop or duplicate chunks when _read pushes synchronously', async () => {
    const runtime = boot();
    const { Readable } = runtime.realm.require('stream') as any;
    const { Buffer: B } = runtime.realm.require('buffer') as any;

    // Flowing mode.
    let flowing = 0;
    const a = new Readable({
      read(this: any) {
        this.push('x');
        this.push(null);
      },
    });
    a.on('data', () => (flowing += 1));
    await new Promise((res) => setTimeout(res, 30));
    expect(flowing).toBe(1);

    // Async iteration.
    const b = new Readable({
      read(this: any) {
        this.push(B.from('y'));
        this.push(null);
      },
    });
    const got: unknown[] = [];
    for await (const c of b) got.push(c);
    expect(got).toHaveLength(1);
  });

  it('still terminates a multi-chunk synchronous source', async () => {
    const { Readable } = boot().realm.require('stream') as any;
    let i = 0;
    const values = ['a', 'b', 'c'];
    const r = new Readable({
      objectMode: true,
      read(this: any) {
        this.push(i < values.length ? values[i++] : null);
      },
    });
    const got: unknown[] = [];
    for await (const c of r) got.push(c);
    expect(got).toEqual(['a', 'b', 'c']);
  });
});
