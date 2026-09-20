import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * The stream state surface — `_readableState` / `_writableState` and the
 * predicates built on them (`stream.isReadable/isWritable/isDisturbed/
 * isErrored`). Expected values were read off a real Node v22 first, so a drift
 * here means we diverged from Node, not from our own past behaviour.
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
  const stream = runtime.realm.require('stream') as any;
  return { runtime, stream };
}

const tick = (ms = 30) => new Promise((res) => setTimeout(res, ms));

describe('readable state shape', () => {
  it('exposes the fields internal/streams/utils reads, with stable identity', () => {
    const { stream } = boot();
    const r = new stream.Readable({ read() {} });
    const s = r._readableState;

    expect(r._readableState).toBe(s); // stable identity, like Node
    expect({
      objectMode: s.objectMode,
      highWaterMark: s.highWaterMark,
      length: s.length,
      ended: s.ended,
      endEmitted: s.endEmitted,
      destroyed: s.destroyed,
      closed: s.closed,
      errored: s.errored,
      errorEmitted: s.errorEmitted,
      autoDestroy: s.autoDestroy,
      emitClose: s.emitClose,
      readable: s.readable,
      dataEmitted: s.dataEmitted,
      flowing: s.flowing,
      reading: s.reading,
      defaultEncoding: s.defaultEncoding,
    }).toEqual({
      objectMode: false,
      highWaterMark: 65536,
      length: 0,
      ended: false,
      endEmitted: false,
      destroyed: false,
      closed: false,
      errored: null,
      errorEmitted: false,
      autoDestroy: true,
      emitClose: true,
      readable: true,
      dataEmitted: false,
      flowing: null,
      reading: false,
      defaultEncoding: 'utf8',
    });
  });

  it('matches Node’s public readable getters', () => {
    const { stream } = boot();
    const r = new stream.Readable({ read() {} });
    expect({
      readable: r.readable,
      readableEnded: r.readableEnded,
      readableAborted: r.readableAborted,
      readableDidRead: r.readableDidRead,
      errored: r.errored,
      closed: r.closed,
      destroyed: r.destroyed,
      readableFlowing: r.readableFlowing,
      readableEncoding: r.readableEncoding,
    }).toEqual({
      readable: true,
      readableEnded: false,
      readableAborted: false,
      readableDidRead: false,
      errored: null,
      closed: false,
      destroyed: false,
      readableFlowing: null,
      readableEncoding: null,
    });
  });
});

describe('writable state shape', () => {
  it('exposes the writable state fields with stable identity', () => {
    const { stream } = boot();
    const w = new stream.Writable({ write(_c: unknown, _e: unknown, cb: () => void) { cb(); } });
    const s = w._writableState;

    expect(w._writableState).toBe(s);
    expect({
      objectMode: s.objectMode,
      highWaterMark: s.highWaterMark,
      length: s.length,
      writing: s.writing,
      corked: s.corked,
      ended: s.ended,
      finished: s.finished,
      destroyed: s.destroyed,
      closed: s.closed,
      errored: s.errored,
      errorEmitted: s.errorEmitted,
      autoDestroy: s.autoDestroy,
      emitClose: s.emitClose,
      needDrain: s.needDrain,
      ending: s.ending,
      writable: s.writable,
    }).toEqual({
      objectMode: false,
      highWaterMark: 65536,
      length: 0,
      writing: false,
      corked: 0,
      ended: false,
      finished: false,
      destroyed: false,
      closed: false,
      errored: null,
      errorEmitted: false,
      autoDestroy: true,
      emitClose: true,
      needDrain: false,
      ending: false,
      writable: true,
    });
  });

  it('reports writableEnded as soon as end() is called (like kEnding)', () => {
    const { stream } = boot();
    const w = new stream.Writable({ write(_c: unknown, _e: unknown, cb: () => void) { cb(); } });
    expect({
      writableEnded: w.writableEnded,
      writableFinished: w.writableFinished,
      writableCorked: w.writableCorked,
      writableNeedDrain: w.writableNeedDrain,
      writableAborted: w.writableAborted,
      errored: w.errored,
      destroyed: w.destroyed,
      closed: w.closed,
    }).toEqual({
      writableEnded: false,
      writableFinished: false,
      writableCorked: 0,
      writableNeedDrain: false,
      writableAborted: false,
      errored: null,
      destroyed: false,
      closed: false,
    });

    w.end();
    expect({
      writableEnded: w.writableEnded,
      writableFinished: w.writableFinished,
      stateEnded: w._writableState.ended,
      stateFinished: w._writableState.finished,
      stateEnding: w._writableState.ending,
      writable: w.writable,
    }).toEqual({
      writableEnded: true,
      writableFinished: false,
      stateEnded: true,
      stateFinished: false,
      stateEnding: true,
      writable: false,
    });
  });
});

describe('stream predicates (internal/streams/utils.js)', () => {
  it('classifies a fresh readable', () => {
    const { stream } = boot();
    const r = new stream.Readable({ read() {} });
    expect({
      isReadable: stream.isReadable(r),
      isWritable: stream.isWritable(r),
      isDisturbed: stream.isDisturbed(r),
      isErrored: stream.isErrored(r),
    }).toEqual({ isReadable: true, isWritable: null, isDisturbed: false, isErrored: false });
  });

  it('a fully consumed readable is neither readable nor writable', async () => {
    const { stream } = boot();
    const r = new stream.Readable({ read() {} });
    r.push('x');
    r.push(null);
    r.resume();
    await tick();
    expect({
      isReadable: stream.isReadable(r),
      isDisturbed: stream.isDisturbed(r),
      readableEnded: r.readableEnded,
      readableDidRead: r.readableDidRead,
      destroyed: r.destroyed,
      closed: r.closed,
    }).toEqual({
      isReadable: false,
      isDisturbed: true,
      readableEnded: true,
      readableDidRead: true,
      destroyed: true,
      closed: true,
    });
  });

  it('a destroyed (no error) readable is aborted and disturbed', async () => {
    const { stream } = boot();
    const d = new stream.Readable({ read() {} });
    d.destroy();
    await tick();
    expect({
      isReadable: stream.isReadable(d),
      isDisturbed: stream.isDisturbed(d),
      isErrored: stream.isErrored(d),
      readableAborted: d.readableAborted,
      closed: d.closed,
      destroyed: d.destroyed,
      errored: d.errored,
      stateReadable: d._readableState.readable,
    }).toEqual({
      isReadable: false,
      isDisturbed: true,
      isErrored: false,
      readableAborted: true,
      closed: true,
      destroyed: true,
      errored: null,
      stateReadable: true,
    });
  });

  it('an errored readable reports isErrored and the error', async () => {
    const { stream } = boot();
    const e = new stream.Readable({ read() {} });
    e.on('error', () => {});
    e.destroy(new Error('boom'));
    await tick();
    expect({
      isErrored: stream.isErrored(e),
      erroredMessage: (e.errored as Error).message,
      readableAborted: e.readableAborted,
      isDisturbed: stream.isDisturbed(e),
      errorEmitted: e._readableState.errorEmitted,
    }).toEqual({
      isErrored: true,
      erroredMessage: 'boom',
      readableAborted: true,
      isDisturbed: true,
      errorEmitted: true,
    });
  });

  it('a destroyed writable is aborted, and PassThrough/Duplex are both halves', async () => {
    const { stream } = boot();

    const dw = new stream.Writable({ write(_c: unknown, _e: unknown, cb: () => void) { cb(); } });
    dw.on('error', () => {});
    dw.destroy();
    await tick();
    expect({
      isWritable: stream.isWritable(dw),
      writableAborted: dw.writableAborted,
      closed: dw.closed,
      destroyed: dw.destroyed,
    }).toEqual({
      isWritable: false,
      writableAborted: true,
      closed: true,
      destroyed: true,
    });

    const p = new stream.PassThrough();
    expect({
      hasR: !!p._readableState,
      hasW: !!p._writableState,
      isReadable: stream.isReadable(p),
      isWritable: stream.isWritable(p),
    }).toEqual({ hasR: true, hasW: true, isReadable: true, isWritable: true });

    const x = new stream.Duplex({ read() {}, write(_c: unknown, _e: unknown, cb: () => void) { cb(); } });
    expect({
      hasR: !!x._readableState,
      hasW: !!x._writableState,
      isReadable: stream.isReadable(x),
      isWritable: stream.isWritable(x),
    }).toEqual({ hasR: true, hasW: true, isReadable: true, isWritable: true });
  });
});
