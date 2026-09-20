import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `events` is now Node's real `events.js`, not a Map-backed shim. Every
 * expectation below was read off a real Node first, and the oracle is now fnm
 * Node v26.9.0 (see docs/DEVLOG.md).
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
  return runtime.realm.require('events') as any;
}

const tick = (ms = 40) => new Promise((res) => setTimeout(res, ms));

describe('events is the vendored Node source', () => {
  it('is the real EventEmitter with its statics and symbols', () => {
    const EE = boot();
    expect(typeof EE).toBe('function');
    expect(typeof EE.EventEmitter).toBe('function');
    expect(typeof EE.errorMonitor).toBe('symbol');
    expect(typeof EE.captureRejections).toBe('boolean');
    expect(typeof EE.once).toBe('function');
    expect(typeof EE.on).toBe('function');
    expect(typeof EE.getEventListeners).toBe('function');
  });

  it('prependListener runs before earlier listeners', () => {
    const { EventEmitter } = boot();
    const e = new EventEmitter();
    const order: string[] = [];
    e.on('x', () => order.push('a'));
    e.prependListener('x', () => order.push('b'));
    e.emit('x');
    expect(order).toEqual(['b', 'a']);
  });

  it('keeps Node\'s `_events` / `_eventsCount` shape', () => {
    const { EventEmitter, listenerCount } = boot();
    const e = new EventEmitter();
    e.on('x', () => {});
    e.on('x', () => {});
    expect(Object.keys(e._events)).toEqual(['x']);
    expect(e._eventsCount).toBe(1);
    expect(e.getMaxListeners()).toBe(10);
    expect(listenerCount(e, 'x')).toBe(2);
    expect(e.rawListeners('x').length).toBe(2);
  });

  it('emits `newListener` / `removeListener` in Node order', () => {
    const { EventEmitter } = boot();
    const e = new EventEmitter();
    const seq: string[] = [];
    e.on('newListener', (n: string) => seq.push('new:' + n));
    e.on('removeListener', (n: string) => seq.push('rm:' + n));
    const g = () => {};
    e.on('z', g);
    e.removeListener('z', g);
    // The `newListener` listener is attached while lifecycle events are recorded.
    expect(seq).toEqual(['new:removeListener', 'new:z', 'rm:z']);
  });

  it('`emit` reports whether anything was listening', () => {
    const { EventEmitter } = boot();
    expect(new EventEmitter().emit('nope')).toBe(false);
  });

  it('the errorMonitor observer sees errors before the `error` handler', async () => {
    const { EventEmitter, errorMonitor } = boot();
    const e = new EventEmitter();
    const seen: string[] = [];
    e.on(errorMonitor, (err: Error) => seen.push('monitor:' + err.message));
    e.on('error', (err: Error) => seen.push('handler:' + err.message));
    e.emit('error', new Error('boom'));
    expect(seen).toEqual(['monitor:boom', 'handler:boom']);
  });

  it('captureRejections routes a rejected async listener to `error`', async () => {
    const EE = boot();
    class MyEE extends EE.EventEmitter {
      constructor() {
        super({ captureRejections: true });
      }
    }
    const e = new MyEE();
    const log: string[] = [];
    e.on('error', (err: Error) => log.push('error:' + err.message));
    e.on('bad', async () => {
      throw new Error('asyncfail');
    });
    e.emit('bad');
    await tick(30);
    expect(log).toEqual(['error:asyncfail']);
  });

  it('`off` and `removeAllListeners` detach, and eventNames() tracks them', () => {
    const { EventEmitter } = boot();
    const e = new EventEmitter();
    const f = () => {};
    e.on('a', f);
    e.off('a', f);
    expect(e.listenerCount('a')).toBe(0);
    e.on('a', f);
    e.removeAllListeners();
    expect(e.eventNames().length).toBe(0);
  });

  it('setMaxListeners(0) removes the cap', () => {
    const { EventEmitter } = boot();
    const e = new EventEmitter();
    e.setMaxListeners(0);
    expect(e.getMaxListeners()).toBe(0);
  });

  it('static once() resolves with the emitted args', async () => {
    const { EventEmitter, once } = boot();
    const e = new EventEmitter();
    const p = once(e, 'go');
    e.emit('go', 1, 2);
    await expect(p).resolves.toEqual([1, 2]);
  });
});
