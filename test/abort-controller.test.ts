import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `internal/abort_controller` is now Node's real `lib/internal/abort_controller.js`
 * (replacing a shim that re-exported the host AbortController/AbortSignal).
 * Expected values were read off Node v26.9.0 first.
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
  return runtime.realm as any;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('vendored: internal/abort_controller', () => {
  it('builds a real AbortSignal on top of the vendored EventTarget', () => {
    const realm = boot();
    const ac = realm.require('internal/abort_controller') as any;
    const controller = new ac.AbortController();
    const et = realm.require('internal/event_target') as any;

    expect(Object.getPrototypeOf(ac.AbortSignal).name).toBe('EventTarget');
    expect(Object.getPrototypeOf(ac.AbortSignal)).toBe(et.EventTarget);
    expect(controller.signal).toBeInstanceOf(ac.AbortSignal);
    expect(controller.signal.aborted).toBe(false);
    expect(controller.signal.reason).toBeUndefined();
  });

  it('aborts with a DOMException AbortError (code 20)', () => {
    const realm = boot();
    const { AbortController } = realm.require('internal/abort_controller') as any;
    const controller = new AbortController();
    controller.abort();
    const { reason } = controller.signal;
    // Node's default reason is `new DOMException('This operation was aborted', 'AbortError')`.
    expect(reason.name).toBe('AbortError');
    expect(reason.code).toBe(20);
    expect(reason.message).toBe('This operation was aborted');
    expect(() => controller.signal.throwIfAborted()).toThrowError(/aborted/);
    // The `abort` event really fires through the vendored EventTarget.
    expect(controller.signal.aborted).toBe(true);
  });

  it('fires an abort event listener exactly once', () => {
    const realm = boot();
    const { AbortController } = realm.require('internal/abort_controller') as any;
    const controller = new AbortController();
    let calls = 0;
    controller.signal.addEventListener('abort', () => calls++);
    controller.abort();
    controller.abort();
    expect(calls).toBe(1);
  });

  it('supports the static combinators (timeout / any / abort)', async () => {
    const realm = boot();
    const { AbortSignal } = realm.require('internal/abort_controller') as any;
    expect(typeof AbortSignal.timeout).toBe('function');
    expect(typeof AbortSignal.any).toBe('function');
    expect(AbortSignal.abort().aborted).toBe(true);
    expect(AbortSignal.any([]).aborted).toBe(false);

    // `timeout()` routes through the runtime's own timers.
    const signal = AbortSignal.timeout(5);
    expect(signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it('propagates an abort reason through AbortSignal.any', () => {
    const realm = boot();
    const { AbortController, AbortSignal } = realm.require('internal/abort_controller') as any;
    const a = new AbortController();
    const b = new AbortController();
    const any = AbortSignal.any([a.signal, b.signal]);
    expect(any.aborted).toBe(false);
    a.abort();
    expect(any.aborted).toBe(true);
    expect(any.reason).toBe(a.signal.reason);
  });

  it('exposes the transferable helpers', () => {
    const realm = boot();
    const ac = realm.require('internal/abort_controller') as any;
    expect(typeof ac.aborted).toBe('function');
    expect(typeof ac.transferableAbortSignal).toBe('function');
    expect(typeof ac.transferableAbortController).toBe('function');
  });
});
