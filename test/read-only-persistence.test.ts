import { describe, expect, it } from 'vitest';
import { readOnlyPersistence } from '../src/node-runtime/vfs/read-only';
import type { Persistence } from '../src/node-runtime/vfs/persistence';

function spyBackend() {
  const calls = { load: 0, schedule: 0, flush: 0, sync: 0, deleted: 0, readSource: 0, clear: 0 };
  const inner: Persistence = {
    durable: true,
    load: () => {
      calls.load += 1;
      return Promise.resolve(null);
    },
    schedule: () => {
      calls.schedule += 1;
    },
    flush: () => {
      calls.flush += 1;
      return Promise.resolve();
    },
    sync: () => {
      calls.sync += 1;
    },
    deleted: () => {
      calls.deleted += 1;
    },
    readSource: () => {
      calls.readSource += 1;
      return null;
    },
    clear: () => {
      calls.clear += 1;
      return Promise.resolve();
    },
  };
  return { inner, calls };
}

describe('readOnlyPersistence', () => {
  it('reads through to the backend', async () => {
    const { inner, calls } = spyBackend();
    const view = readOnlyPersistence(inner);
    expect(await view.load()).toBeNull();
    expect(view.readSource()).toBeNull();
    expect(calls.load).toBe(1);
    expect(calls.readSource).toBe(1);
  });

  it('reports itself as non-durable (no synchronous flush sink)', () => {
    const { inner } = spyBackend();
    expect(readOnlyPersistence(inner).durable).toBe(false);
  });

  it('drops every write and never clears the shared store', async () => {
    const { inner, calls } = spyBackend();
    const view = readOnlyPersistence(inner);
    view.schedule({ snapshot: () => [] });
    await view.flush({ snapshot: () => [] });
    view.sync('/project/a.js', new Uint8Array());
    view.deleted(['/project/a.js']);
    await view.clear();
    expect(calls.schedule + calls.flush + calls.sync + calls.deleted + calls.clear).toBe(0);
  });
});
