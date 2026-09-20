import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `destroy()` / `_undestroy()` / `finished()` now run on the vendored real
 * source (vendor/node-lib/internal/streams/destroy.js + the predicates from
 * internal/streams/utils.js). Every expectation below was read off a real
 * Node v22.19.0 first.
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

describe('destroy() runs on the vendored real source', () => {
  it('emits error then close, on nextTick, and flips the state flags', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    const log: string[] = [];
    r.on('error', (e: Error) => log.push('error:' + e.message));
    r.on('close', () => log.push('close'));

    r.destroy(new Error('boom'));

    // Synchronous: destroyed/closed/errored are set, but nothing was emitted.
    expect(r.destroyed).toBe(true);
    expect(r.closed).toBe(true);
    expect(r.errored?.message).toBe('boom');
    expect(r._readableState.errorEmitted).toBe(false);
    expect(log).toEqual([]);

    await tick();
    expect(log).toEqual(['error:boom', 'close']);
    expect(r._readableState.errorEmitted).toBe(true);
    expect(r._readableState.closeEmitted).toBe(true);
  });

  it('a clean destroy() emits only close', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    const log: string[] = [];
    r.on('error', () => log.push('error'));
    r.on('close', () => log.push('close'));
    r.destroy();
    await tick();
    expect(log).toEqual(['close']);
    expect(r.errored).toBe(null);
  });

  it('`destroyed` is idempotent (a second destroy is a no-op)', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    let closes = 0;
    r.on('close', () => closes++);
    r.destroy();
    r.destroy();
    await tick();
    expect(closes).toBe(1);
  });

  it('exposes kState-backed lifecycle via the public predicates', async () => {
    const stream = boot();
    expect(typeof stream.isDestroyed).toBe('function');
    const r = new stream.Readable({ read() {} });
    expect(stream.isDestroyed(r)).toBe(false);
    expect(stream.isReadable(r)).toBe(true);
    r.destroy();
    expect(stream.isDestroyed(r)).toBe(true);
    expect(stream.isReadable(r)).toBe(false);
  });

  it('_undestroy() resets the lifecycle bits so the stream is live again', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    r.destroy();
    await tick();
    expect([r.destroyed, r.closed, r.errored]).toEqual([true, true, null]);

    r._undestroy();
    expect([r.destroyed, r.closed, r.errored]).toEqual([false, false, null]);
    expect(r._readableState.destroyed).toBe(false);
  });
});

describe('finished()', () => {
  it('resolves when a readable ends', async () => {
    const stream = boot();
    const r = stream.Readable.from([]);
    r.resume();
    await expect(stream.promises.finished(r)).resolves.toBeUndefined();
  });

  it('rejects with ERR_STREAM_PREMATURE_CLOSE when closed before finishing', async () => {
    const stream = boot();
    const w = new stream.Writable({ write(_c: unknown, _e: string, cb: () => void) { setTimeout(cb, 5); } });
    const p = stream.promises.finished(w);
    w.destroy();
    await expect(p).rejects.toMatchObject({ message: 'Premature close', code: 'ERR_STREAM_PREMATURE_CLOSE' });
  });

  it('rejects with the error a destroyed stream was destroyed with', async () => {
    const stream = boot();
    const w = new stream.Writable({ write(_c: unknown, _e: string, cb: () => void) { setTimeout(cb, 5); } });
    const p = stream.promises.finished(w);
    w.destroy(new Error('nope'));
    await expect(p).rejects.toThrow('nope');
  });

  it('the callback form returns a cleanup() that detaches its listeners', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    let called = 0;
    const cleanup = stream.finished(r, () => called++);
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(r.listenerCount('end')).toBe(0);
    expect(r.listenerCount('close')).toBe(0);
    r.destroy();
    await tick();
    expect(called).toBe(0);
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
