import { describe, expect, it } from 'vitest';
import { createWorkerHost, defaultMaxRealThreads } from '../src/node-runtime/proc/worker';
import { MemoryVfs } from '../src/node-runtime/vfs';
import type { Realm } from '../src/node-runtime/realm';
import type { WorkerRequest } from '../src/node-runtime/proc/worker';
import type { SpawnedThread } from '../src/node-runtime/proc/real-worker';

/**
 * M147 Phase D: the concurrent real-thread cap.
 *
 * Measurement (browser, CDP): each real thread boots its own realm at ~5 MB of
 * JS heap, while sharing the compiled `WebAssembly.Module`s would save only
 * ~2 ms (all six modules compile in ~3 ms total). So the lever that matters is
 * **bounding how many realms exist at once** — an 8–16-worker `jest-worker` pool
 * would otherwise multiply that 5 MB. Past the cap a `Worker` falls back to the
 * cooperative same-loop path: correct and API-identical, just not parallel, the
 * same honest degradation as the isolation gate.
 */

class FakeReadable {
  #cbs: Array<(chunk: unknown) => void> = [];
  on(event: string, cb: (chunk: unknown) => void): this {
    if (event === 'data') this.#cbs.push(cb);
    return this;
  }
  push(chunk: unknown): boolean {
    for (const cb of this.#cbs) cb(chunk);
    return true;
  }
}

/** A realm with just the pieces the worker host touches. */
const realm = (): Realm =>
  ({
    require: (id: string) =>
      id === 'internal/worker/io'
        ? { MessageChannel: (globalThis as { MessageChannel: unknown }).MessageChannel }
        : { Readable: FakeReadable, Writable: class {} },
    internalBinding: () => ({
      __ports: {
        connect: () => {},
        onFrame: () => {},
        importPort: () => ({}),
        buildMessage: (value: unknown) => ({ data: structuredClone(value), tokens: [] }),
        importMessage: (frame: { data: unknown }) => ({ value: frame.data, ports: [] }),
      },
    }),
  }) as unknown as Realm;

function request(): WorkerRequest {
  return {
    filename: '/project/index.js',
    workerData: null,
    argv: ['/bin/node', '/project/index.js'],
    name: 'WorkerThread',
    env: {},
    execArgv: [],
    stdout: true,
    stderr: true,
  };
}

const fakeThread = (): SpawnedThread => ({
  postMessage: () => {},
  terminate: () => Promise.resolve(0),
  addEventListener: () => {},
});

describe('concurrent real-thread cap (Phase D)', () => {
  it('routes over-cap workers to the cooperative path, and frees a slot on exit', () => {
    const host = createWorkerHost({
      vfs: new MemoryVfs({ cwd: '/project' }),
      realm,
      loader: () => ({}) as never,
      globals: () => ({}),
      aliases: () => ({}),
      toolingWrappers: () => ({}),
      execPath: '/bin/node',
      baseEnv: {},
      // Do not start anything: this test is about routing, not running.
      defer: () => {},
      realThreads: true,
      maxRealThreads: 1,
      spawnRealWorker: () => fakeThread(),
    });

    const first = host.create(request());
    expect(host.liveRealThreads).toBe(1);
    expect(first.constructor.name).toBe('RealWorker');

    // The cap is full ⇒ the next worker is cooperative (no new realm).
    const second = host.create(request());
    expect(second.constructor.name).toBe('Worker');
    expect(host.liveRealThreads).toBe(1);

    // The real worker exits ⇒ its slot frees up and the next one is real again.
    void first.terminate();
    expect(host.liveRealThreads).toBe(0);
    const third = host.create(request());
    expect(third.constructor.name).toBe('RealWorker');
    expect(host.liveRealThreads).toBe(1);
  });

  it('defaults the cap to the core count, with a floor of one', () => {
    expect(defaultMaxRealThreads()).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(defaultMaxRealThreads())).toBe(true);
  });

  it('honours the global override', () => {
    const scope = globalThis as { __WEB_NODE_MAX_THREADS__?: unknown };
    const previous = scope.__WEB_NODE_MAX_THREADS__;
    try {
      scope.__WEB_NODE_MAX_THREADS__ = 2;
      expect(defaultMaxRealThreads()).toBe(2);
    } finally {
      if (previous === undefined) delete scope.__WEB_NODE_MAX_THREADS__;
      else scope.__WEB_NODE_MAX_THREADS__ = previous;
    }
  });
});
