import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * The real `internal/streams/readable.js` is vendored and loadable: it is the
 * base the public `stream` module is now built on (see DEVLOG).
 * It only needs the pieces we already ship — the real `events.js` for its
 * `_events` storage, the vendored state/utils/destroy/end-of-stream, and the
 * `[kState]` bits those agree on. Expectations match a real Node; the oracle is
 * now fnm Node v26.9.0 (the same line as the vendored lib/ checkout).
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
  return runtime;
}

const tick = (ms = 40) => new Promise((res) => setTimeout(res, ms));

describe('the vendored internal/streams/readable.js runs', () => {
  it('exposes Readable and ReadableState', () => {
    const rt = boot();
    const Readable = rt.realm.require('internal/streams/readable') as any;
    expect(typeof Readable).toBe('function');
    expect(typeof Readable.ReadableState).toBe('function');
  });

  it('reads an exact byte count out of the buffer', () => {
    const rt = boot();
    const Readable = rt.realm.require('internal/streams/readable') as any;
    const r = new Readable({ read() {} });
    r.push('hello');
    expect(r._readableState.length).toBe(5);
    expect(r.read(2)?.toString()).toBe('he');
    expect(r._readableState.length).toBe(3);
  });

  it('flows data and ends', async () => {
    const rt = boot();
    const Readable = rt.realm.require('internal/streams/readable') as any;
    const r = new Readable({ read() {} });
    const chunks: string[] = [];
    r.on('data', (c: { toString(): string }) => chunks.push(c.toString()));
    r.push('a');
    r.push('b');
    r.push(null);
    await tick(60);
    expect(chunks.join('')).toBe('ab');
    expect(r.readableEnded).toBe(true);
  });
});
