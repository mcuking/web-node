import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * The iterable-streams API (`stream/iter`) and the stream consumers
 * (`stream/consumers`) are now the real Node source. `stream/iter` is a fully
 * self-contained pure-JS group (`internal/streams/iter/*`); `stream/consumers`
 * was blocked until M37 because it needs a real `Blob`.
 *
 * Upstream gates `stream/iter` behind `--experimental-stream-iter`; a tab has no
 * flag surface, so the runtime always exposes it (and reports the flag as on,
 * which is what `internal/streams/readable` checks before installing
 * `toAsyncStreamable`). Expected values are read off Node v26.9.0 probes
 * (/tmp/iter-oracle.mjs, /tmp/iter-oracle2.mjs).
 */
function boot(): { req: (id: string) => any; runtime: NodeRuntime } {
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
  return { req: runtime.realm.require.bind(runtime.realm) as (id: string) => any, runtime };
}

const ITER_EXPORTS = [
  'Stream',
  'toStreamable',
  'toAsyncStreamable',
  'broadcastProtocol',
  'shareProtocol',
  'shareSyncProtocol',
  'drainableProtocol',
  'push',
  'duplex',
  'from',
  'fromSync',
  'pull',
  'pullSync',
  'pipeTo',
  'pipeToSync',
  'bytes',
  'text',
  'arrayBuffer',
  'array',
  'bytesSync',
  'textSync',
  'arrayBufferSync',
  'arraySync',
  'merge',
  'broadcast',
  'Broadcast',
  'share',
  'shareSync',
  'Share',
  'SyncShare',
  'tap',
  'tapSync',
  'ondrain',
  'fromReadable',
  'fromWritable',
  'toReadable',
  'toReadableSync',
  'toWritable',
];

describe('stream/iter: surface', () => {
  it('exposes the full iterable-streams namespace under both ids', () => {
    const { req } = boot();
    const iter = req('stream/iter');
    expect(Object.keys(iter).sort()).toEqual([...ITER_EXPORTS].sort());
    expect(req('node:stream/iter')).toBe(iter);
    expect(typeof iter.push).toBe('function');
    expect(typeof iter.Stream).toBe('object');
    // `Stream` is the frozen namespace with the headline operations.
    expect(Object.isFrozen(iter.Stream)).toBe(true);
    expect(typeof iter.Stream.bytes).toBe('function');
  });

  it('uses global protocol symbols', () => {
    const { req } = boot();
    const iter = req('stream/iter');
    expect(iter.toStreamable).toBe(Symbol.for('Stream.toStreamable'));
    expect(iter.toAsyncStreamable).toBe(Symbol.for('Stream.toAsyncStreamable'));
    expect(iter.broadcastProtocol).toBe(Symbol.for('Stream.broadcastProtocol'));
  });
});

describe('stream/iter: push + consumers', () => {
  it('pushes strings and collects them as bytes/text', async () => {
    const { req } = boot();
    const { push, bytes, text } = req('stream/iter');

    {
      const { writer, readable } = push();
      const collected = bytes(readable);
      await writer.write('hello ');
      await writer.write('world');
      await writer.end();
      expect(Array.from(await collected)).toEqual([
        104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100,
      ]);
    }
    {
      const { writer, readable } = push();
      const collected = text(readable);
      writer.write('abc');
      writer.write('def');
      writer.end();
      expect(await collected).toBe('abcdef');
    }
  });
});

describe('stream/iter: from / fromSync', () => {
  it('wraps an iterable and a sync iterable', async () => {
    const { req } = boot();
    const { from, fromSync, text, textSync, bytesSync } = req('stream/iter');
    expect(await text(from(['a', 'b', 'c']))).toBe('abc');
    expect(textSync(fromSync(['x', 'y']))).toBe('xy');
    expect(Array.from(bytesSync(fromSync(['x'])))).toEqual([120]);
  });
});

describe('stream/iter: pull + merge', () => {
  it('applies a stateless transform', async () => {
    const { req } = boot();
    const { pull, from, text } = req('stream/iter');
    const out = pull(from(['a', 'b', 'c']), (chunk: unknown) => chunk);
    expect(await text(out)).toBe('abc');
  });

  it('merges two sources', async () => {
    const { req } = boot();
    const { merge, from, text } = req('stream/iter');
    expect(await text(merge(from(['a']), from(['b'])))).toBe('ab');
  });
});

describe('stream/iter: classic interop', () => {
  it('bridges a classic Readable into iter and back', async () => {
    const { req } = boot();
    const { fromReadable, toReadable, from, text } = req('stream/iter');
    const { Readable } = req('stream');
    expect(await text(fromReadable(Readable.from(['x', 'y', 'z'])))).toBe('xyz');

    const web = toReadable(from(['m', 'n']));
    const chunks: string[] = [];
    for await (const c of web) chunks.push(String(c));
    expect(chunks).toEqual(['m', 'n']);
  });

  it('bridges iter into a classic Writable via fromWritable/pipeTo', async () => {
    const { req } = boot();
    const { fromWritable, pipeTo, push } = req('stream/iter');
    const { Writable } = req('stream');
    const sink: string[] = [];
    const dest = fromWritable(
      new Writable({
        write(c: unknown, _e: unknown, cb: () => void) {
          sink.push(String(c));
          cb();
        },
      }),
    );
    const { writer, readable } = push();
    const done = pipeTo(readable, dest);
    await writer.write('a');
    await writer.write('b');
    await writer.end();
    await done;
    expect(sink).toEqual(['a', 'b']);
  });
});

describe('stream/consumers', () => {
  it('exposes the six consumers', () => {
    const { req } = boot();
    const consumers = req('stream/consumers');
    expect(Object.keys(consumers).sort()).toEqual(
      ['arrayBuffer', 'blob', 'buffer', 'bytes', 'text', 'json'].sort(),
    );
    expect(req('node:stream/consumers')).toBe(consumers);
  });

  it('collects a classic Readable into text/json/buffer/bytes', async () => {
    const { req } = boot();
    const consumers = req('stream/consumers');
    const { Readable } = req('stream');

    expect(await consumers.text(Readable.from(['h', 'i']))).toBe('hi');
    expect(await consumers.json(Readable.from(['{"a"', ':1}']))).toEqual({ a: 1 });

    const buf = await consumers.buffer(Readable.from(['AB']));
    expect(Array.from(buf)).toEqual([65, 66]);

    const bytes = await consumers.bytes(Readable.from(['AB']));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([65, 66]);

    const ab = await consumers.arrayBuffer(Readable.from(['AB']));
    expect(new TextDecoder().decode(ab)).toBe('AB');
  });

  it('turns a stream into a real Blob', async () => {
    const { req } = boot();
    const consumers = req('stream/consumers');
    const { Readable } = req('stream');
    const blob = await consumers.blob(Readable.from(['ab', 'cd']));
    expect(blob.size).toBe(4);
    expect(Object.prototype.toString.call(blob)).toBe('[object Blob]');
    expect(await blob.text()).toBe('abcd');
  });

  it('rejects malformed JSON', async () => {
    const { req } = boot();
    const consumers = req('stream/consumers');
    const { Readable } = req('stream');
    await expect(consumers.json(Readable.from(['not json']))).rejects.toThrowError(
      /Unexpected token|JSON/,
    );
  });
});

describe('stream/iter: error paths', () => {
  it('rejects an unusable source type', () => {
    const { req } = boot();
    const { from } = req('stream/iter');
    expect(() => from(42 as any)).toThrowError(/ERR_INVALID_ARG_TYPE|must be of type/);
  });
});
