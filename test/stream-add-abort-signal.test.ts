import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `stream.addAbortSignal` is the vendored internal/streams/add-abort-signal.js,
 * replacing a stub that used to throw "not implemented". Expectations match
 * Node v22.19.0.
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

describe('stream.addAbortSignal is the vendored source', () => {
  it('destroys the stream with an AbortError when the signal aborts mid-flight', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    const ac = new AbortController();
    stream.addAbortSignal(ac.signal, r);
    let err: any = null;
    r.on('error', (e: Error) => (err = e));
    ac.abort();
    await tick();
    expect(r.destroyed).toBe(true);
    expect(err?.name).toBe('AbortError');
    expect(err?.code).toBe('ABORT_ERR');
  });

  it('destroys the stream immediately when the signal is already aborted', async () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    const ac = new AbortController();
    ac.abort();
    let err: any = null;
    r.on('error', (e: Error) => (err = e));
    stream.addAbortSignal(ac.signal, r);
    await tick();
    expect(r.destroyed).toBe(true);
    expect(err?.code).toBe('ABORT_ERR');
  });

  it('rejects a value that is not an AbortSignal', () => {
    const stream = boot();
    const r = new stream.Readable({ read() {} });
    expect(() => stream.addAbortSignal({}, r)).toThrowError(
      /The "signal" argument must be an instance of AbortSignal/,
    );
  });

  it('rejects a value that is not a stream', () => {
    const stream = boot();
    expect(() => stream.addAbortSignal(new AbortController().signal, {})).toThrowError(
      /The "stream" argument must be an instance of ReadableStream, WritableStream, or Stream/,
    );
  });
});
