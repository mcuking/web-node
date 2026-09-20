import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `finished()` is now Node's real end-of-stream (vendored from
 * internal/streams/end-of-stream.js), not a hand-written approximation. As in
 * Node, `stream.finished(stream[, options], callback)` requires a callback; the
 * promise form is `stream.promises.finished`. Options match a real Node; the
 * oracle is now fnm Node v26.9.0, the same line the vendored lib/ checkout is
 * from (see docs/DEVLOG.md).
 */
function boot() {
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
  return runtime.realm.require('stream') as any;
}

const tick = (ms = 40) => new Promise((res) => setTimeout(res, ms));

describe('finished() is the vendored end-of-stream', () => {
  it('resolves once a readable ends', async () => {
    const stream = boot();
    const r = stream.Readable.from([]);
    r.resume();
    await expect(stream.promises.finished(r)).resolves.toBeUndefined();
  });

  it('resolves on an already-ended readable', async () => {
    const stream = boot();
    const r = stream.Readable.from([]);
    await new Promise<void>((res) => {
      r.on('end', () => res());
      r.resume();
    });
    await expect(stream.promises.finished(r)).resolves.toBeUndefined();
  });

  it('honours options.readable:false and waits for the writable half', async () => {
    const stream = boot();
    const w = new stream.Writable({ write(_c: unknown, _e: string, cb: () => void) { cb(); } });
    const p = stream.promises.finished(w, { readable: false });
    w.end('x');
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects with ERR_STREAM_PREMATURE_CLOSE on a close that beats a half', async () => {
    const stream = boot();
    const w = new stream.Writable({ write(_c: unknown, _e: string, cb: () => void) { setTimeout(cb, 5); } });
    const p = stream.promises.finished(w);
    w.destroy();
    await expect(p).rejects.toMatchObject({ message: 'Premature close', code: 'ERR_STREAM_PREMATURE_CLOSE' });
  });

  it('rejects with the error the stream was destroyed with', async () => {
    const stream = boot();
    const w = new stream.Writable({ write(_c: unknown, _e: string, cb: () => void) { setTimeout(cb, 5); } });
    const p = stream.promises.finished(w);
    w.destroy(new Error('nope'));
    await expect(p).rejects.toThrow('nope');
  });

  it('rejects with an AbortError when the signal aborts mid-flight', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    const ac = new AbortController();
    const p = stream.promises.finished(r, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    const ac = new AbortController();
    ac.abort();
    await expect(stream.promises.finished(r, { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
  });

  it('the callback form returns a cleanup() that detaches its listeners', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    let called = 0;
    const cleanup = stream.finished(r, () => called++);
    expect(typeof cleanup).toBe('function');
    cleanup();
    r.destroy();
    await tick();
    expect(called).toBe(0);
    expect(r.listenerCount('error')).toBe(0);
  });

  it('the callback form fires once for a clean end', async () => {
    const stream = boot();
    const r = stream.Readable.from([]);
    r.resume();
    const seen: string[] = [];
    stream.finished(r, (err?: Error | null) => seen.push(err ? 'err:' + err.message : 'ok'));
    await tick();
    expect(seen).toEqual(['ok']);
  });
});

describe('pipeline() still routes through the vendored finished()', () => {
  it('destroys the destination when the source errors', async () => {
    const stream = boot();
    const a = new stream.Readable({ read(this: any) { this.destroy(new Error('src')); } });
    const b = new stream.Writable({ write(_c: unknown, _e: string, cb: () => void) { cb(); } });
    await expect(stream.promises.pipeline(a, b)).rejects.toThrow('src');
    expect(b.destroyed).toBe(true);
  });
});
