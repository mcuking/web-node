import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `stream/web` is now the real `lib/stream/web.js` plus the whole
 * `internal/webstreams/*` group — WHATWG ReadableStream / WritableStream /
 * TransformStream and the queuing strategies, text codecs and the
 * classic<->web adapters. It used to be absent entirely (a bare
 * `require('stream/web')` threw), and `internal/webstreams/adapters` was a
 * throwing Proxy, so `Readable.toWeb` was unreachable.
 *
 * The group is pure JS sitting on the `messaging`, `buffer`, `stream_wrap`
 * (shape only), `util` bindings and the vendored buffer/stream/worker modules.
 * Expected values are read off Node v26.9.0 (probe /tmp/ws-oracle.mjs).
 */
function boot(): (id: string) => any {
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
  return runtime.realm.require.bind(runtime.realm) as (id: string) => any;
}

async function drain(stream: any): Promise<unknown[]> {
  const reader = stream.getReader();
  const out: unknown[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe('stream/web: exports', () => {
  it('exposes every WHATWG class as a constructor', () => {
    const W = boot()('stream/web');
    for (const name of [
      'ReadableStream',
      'ReadableStreamDefaultReader',
      'ReadableStreamBYOBReader',
      'ReadableStreamBYOBRequest',
      'ReadableByteStreamController',
      'ReadableStreamDefaultController',
      'TransformStream',
      'TransformStreamDefaultController',
      'WritableStream',
      'WritableStreamDefaultWriter',
      'WritableStreamDefaultController',
      'ByteLengthQueuingStrategy',
      'CountQueuingStrategy',
      'TextEncoderStream',
      'TextDecoderStream',
      'CompressionStream',
      'DecompressionStream',
    ]) {
      expect(typeof W[name], name).toBe('function');
    }
    expect(typeof W.ReadableStreamTee).toBe('function');
  });

  it('is reachable as node:stream/web too', () => {
    const W = boot()('node:stream/web');
    expect(typeof W.ReadableStream).toBe('function');
  });

  it('compresses and decompresses through the zlib-backed codecs', async () => {
    const W = boot()('stream/web');
    const data = new TextEncoder().encode('hello hello hello hello'.repeat(20));

    const drain = async (stream: unknown): Promise<Uint8Array> => {
      const parts: Uint8Array[] = [];
      for await (const chunk of stream as AsyncIterable<Uint8Array>) parts.push(chunk);
      let total = 0;
      for (const part of parts) total += part.byteLength;
      const out = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
      }
      return out;
    };

    for (const format of ['gzip', 'deflate', 'deflate-raw'] as const) {
      const cs = new W.CompressionStream(format);
      const writer = cs.writable.getWriter();
      void writer.write(data);
      void writer.close();
      const compressed = await drain(cs.readable);

      const ds = new W.DecompressionStream(format);
      const writer2 = ds.writable.getWriter();
      void writer2.write(compressed);
      void writer2.close();
      expect(await drain(ds.readable)).toEqual(data);
    }
  });

  it('throws a typed NotImplementedError for the brotli codec', () => {
    const W = boot()('stream/web');
    // The platform ships no brotli codec, so only that format is unavailable.
    expect(() => new W.CompressionStream('brotli')).toThrowError(/not implemented/);
  });
});

describe('stream/web: ReadableStream', () => {
  it('reads a default source to completion and locks while reading', async () => {
    const W = boot()('stream/web');
    const rs = new W.ReadableStream({
      start(c: any) {
        c.enqueue('a');
        c.enqueue('b');
        c.close();
      },
    });
    expect(rs.locked).toBe(false);
    const reader = rs.getReader();
    expect(reader.constructor.name).toBe('ReadableStreamDefaultReader');
    expect(rs.locked).toBe(true);
    const out: unknown[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
    }
    expect(out).toEqual(['a', 'b']);
  });

  it('rejects a null source with the Node error shape', () => {
    const W = boot()('stream/web');
    try {
      new W.ReadableStream(null);
      throw new Error('expected the constructor to reject a null source');
    } catch (error) {
      expect((error as { name?: string }).name).toBe('TypeError');
      expect((error as { code?: string }).code).toBe('ERR_INVALID_ARG_TYPE');
      expect((error as Error).message).toMatch(
        /The "source" argument must be of type object\. Received null/,
      );
    }
  });

  it('propagates a source error to the reader', async () => {
    const W = boot()('stream/web');
    const rs = new W.ReadableStream({
      start(c: any) {
        c.error(new Error('boom'));
      },
    });
    await expect(rs.getReader().read()).rejects.toThrowError('boom');
  });

  it('tees into two independently readable branches', async () => {
    const W = boot()('stream/web');
    const rs = new W.ReadableStream({
      start(c: any) {
        c.enqueue(1);
        c.enqueue(2);
        c.close();
      },
    });
    const [a, b] = rs.tee();
    expect(await drain(a)).toEqual([1, 2]);
    expect(await drain(b)).toEqual([1, 2]);
  });

  it('fills a BYOB read from the byte-stream queue', async () => {
    const W = boot()('stream/web');
    const rs = new W.ReadableStream({
      type: 'bytes',
      start(c: any) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.enqueue(new Uint8Array([4, 5]));
        c.close();
      },
    });
    const reader = rs.getReader({ mode: 'byob' });
    const first = await reader.read(new Uint8Array(8));
    expect(Array.from(first.value as Uint8Array)).toEqual([1, 2, 3, 4, 5]);
    expect(first.done).toBe(false);
    const end = await reader.read(new Uint8Array(8));
    expect(end.done).toBe(true);
    expect(Array.from(end.value as Uint8Array)).toEqual([]);
  });

  it('hands a default read of a byte stream a Uint8Array', async () => {
    const W = boot()('stream/web');
    const rs = new W.ReadableStream({
      type: 'bytes',
      start(c: any) {
        c.enqueue(new Uint8Array([9, 9]));
        c.close();
      },
    });
    const { value, done } = await rs.getReader().read();
    expect(done).toBe(false);
    expect(Array.from(value as Uint8Array)).toEqual([9, 9]);
    expect((value as Uint8Array).constructor.name).toBe('Uint8Array');
  });
});

describe('stream/web: TransformStream and WritableStream', () => {
  it('runs a transform and flushes on writable close', async () => {
    const W = boot()('stream/web');
    const { readable, writable } = new W.TransformStream({
      transform(chunk: unknown, c: any) {
        c.enqueue(String(chunk).toUpperCase());
      },
    });
    const collected = drain(readable);
    const writer = writable.getWriter();
    await writer.write('abc');
    await writer.close();
    expect(await collected).toEqual(['ABC']);
  });

  it('buffers chunks around a slow writer', async () => {
    const W = boot()('stream/web');
    const written: unknown[] = [];
    const ws = new W.WritableStream({
      write(chunk: unknown) {
        written.push(chunk);
      },
    });
    const writer = ws.getWriter();
    writer.write(1);
    writer.write(2);
    await writer.close();
    expect(written).toEqual([1, 2]);
  });
});

describe('stream/web: queuing strategies and text codecs', () => {
  it('CountQueuingStrategy / ByteLengthQueuingStrategy report the Node values', () => {
    const W = boot()('stream/web');
    const cqs = new W.CountQueuingStrategy({ highWaterMark: 3 });
    expect(cqs.highWaterMark).toBe(3);
    expect(String(cqs.size({}))).toBe('1');
    const bqs = new W.ByteLengthQueuingStrategy({ highWaterMark: 10 });
    expect(bqs.highWaterMark).toBe(10);
    expect(bqs.size({ byteLength: 4 })).toBe(4);
  });

  it('TextEncoderStream encodes to UTF-8 bytes', async () => {
    const require_ = boot();
    const W = require_('stream/web');
    const Buffer = require_('buffer').Buffer;
    const { readable, writable } = new W.TextEncoderStream();
    const collected = (async () => {
      const reader = readable.getReader();
      const parts: string[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parts.push(Buffer.from(value as Uint8Array).toString('hex'));
      }
      return parts;
    })();
    const writer = writable.getWriter();
    await writer.write('hé');
    await writer.close();
    expect(await collected).toEqual(['68c3a9']);
  });

  it('TextDecoderStream decodes UTF-8 bytes', async () => {
    const W = boot()('stream/web');
    const { readable, writable } = new W.TextDecoderStream();
    const collected = drain(readable);
    const writer = writable.getWriter();
    await writer.write(new Uint8Array([0x68, 0x69]));
    await writer.close();
    expect(await collected).toEqual(['hi']);
  });
});

describe('stream/web: classic adapters', () => {
  it('Readable.toWeb bridges a classic Readable into a web ReadableStream', async () => {
    const require_ = boot();
    const stream = require_('stream');
    const Buffer = require_('buffer').Buffer;
    const web = stream.Readable.toWeb(stream.Readable.from(['x', 'y']));
    const reader = web.getReader();
    const out: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(Buffer.from(value).toString());
    }
    expect(out).toEqual(['x', 'y']);
  });

  it('Writable.toWeb bridges a classic Writable from a web WritableStream', async () => {
    const require_ = boot();
    const stream = require_('stream');
    const W = require_('stream/web');
    const Buffer = require_('buffer').Buffer;
    const received: string[] = [];
    const classic = new stream.Writable({
      write(chunk: any, _enc: string, cb: () => void) {
        received.push(chunk.toString());
        cb();
      },
    });
    const web = stream.Writable.toWeb(classic);
    const writer = web.getWriter();
    await writer.write(Buffer.from('hello'));
    await writer.close();
    expect(received).toEqual(['hello']);
  });
});
