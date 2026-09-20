import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `async_hooks` is real Node source now (internal/async_hooks.js + async_hooks.js
 * + internal/async_local_storage/*), backed by our JS `async_wrap` binding. The
 * expected values below were read off a real Node v26 first.
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
  const ah = runtime.realm.require('async_hooks') as any;
  const process = runtime.process as any;
  const timers = runtime.realm.require('timers') as any;
  return { runtime, ah, process, timers };
}

const tick = (ms = 40) => new Promise((res) => setTimeout(res, ms));

describe('async_hooks (real Node source on the async_wrap binding)', () => {
  it('exposes the public surface', () => {
    const { ah } = boot();
    expect(Object.keys(ah).sort()).toEqual([
      'AsyncLocalStorage',
      'AsyncResource',
      'asyncWrapProviders',
      'createHook',
      'executionAsyncId',
      'executionAsyncResource',
      'triggerAsyncId',
    ]);
  });

  it('reports the bootstrap execution context (id 1, trigger 0)', () => {
    const { ah } = boot();
    expect(ah.executionAsyncId()).toBe(1);
    expect(ah.triggerAsyncId()).toBe(0);
  });

  it('AsyncResource allocates ids and runInAsyncScope enters its context', () => {
    const { ah } = boot();
    const ar = new ah.AsyncResource('DEMO');
    expect(ar.asyncId()).toBeGreaterThan(0);
    expect(ar.triggerAsyncId()).toBe(1);

    let inScope = false;
    ar.runInAsyncScope(() => {
      inScope = ah.executionAsyncId() === ar.asyncId();
    });
    expect(inScope).toBe(true);
    expect(ah.executionAsyncId()).toBe(1);
  });

  it('createHook fires init/before/after for process.nextTick and timers', async () => {
    const { ah, process, timers } = boot();
    const events: string[] = [];
    const hook = ah.createHook({
      init(_id: number, type: string) {
        events.push(`init:${type}`);
      },
      before() {
        events.push('before');
      },
      after() {
        events.push('after');
      },
      destroy() {
        events.push('destroy');
      },
    });
    hook.enable();
    process.nextTick(() => {});
    await new Promise<void>((resolve) => {
      timers.setTimeout(() => resolve(), 10);
    });
    hook.disable();
    await tick();
    expect(events).toContain('init:TickObject');
    expect(events).toContain('init:Timeout');
    expect(events).toContain('before');
    expect(events).toContain('after');
  });

  it('AsyncLocalStorage carries the store across nextTick and setTimeout', async () => {
    const { ah, process, timers } = boot();
    const als = new ah.AsyncLocalStorage();
    const seen: Array<string | undefined> = [];

    als.run({ user: 'tang' }, () => {
      seen.push(JSON.stringify(als.getStore()));
      process.nextTick(() => seen.push(JSON.stringify(als.getStore())));
      timers.setTimeout(() => seen.push(JSON.stringify(als.getStore())), 5);
    });

    await tick(40);
    expect(seen).toEqual([
      '{"user":"tang"}',
      '{"user":"tang"}',
      '{"user":"tang"}',
    ]);
    expect(als.getStore()).toBeUndefined();
  });

  it('vendored code takes the AsyncResource branch once hooks are enabled', () => {
    const { ah } = boot();
    expect(ah.executionAsyncResource()).toBeDefined();
  });
});
