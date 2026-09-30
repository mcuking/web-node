import { afterEach, describe, expect, it } from 'vitest';
import { beginGcPump, gcPumpActive } from '../src/node-runtime/gc-pump';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const scope = globalThis as unknown as { gc?: () => void };

afterEach(() => {
  delete scope.gc;
});

describe('gc pump', () => {
  it('is a silent no-op without a global gc', async () => {
    delete scope.gc;
    const release = beginGcPump(5);
    await sleep(20);
    release();
    expect(gcPumpActive()).toBe(false);
  });

  it('collects periodically while held, then stops', async () => {
    let calls = 0;
    scope.gc = () => {
      calls += 1;
    };
    const release = beginGcPump(5);
    await sleep(40);
    expect(calls).toBeGreaterThan(0);
    expect(gcPumpActive()).toBe(true);
    release();
    expect(gcPumpActive()).toBe(false);
    const settled = calls;
    await sleep(30);
    expect(calls).toBe(settled);
  });

  it('shares one interval across overlapping holders', async () => {
    let calls = 0;
    scope.gc = () => {
      calls += 1;
    };
    const first = beginGcPump(5);
    const second = beginGcPump(5);
    await sleep(25);
    first();
    // The second holder keeps the pump alive.
    expect(gcPumpActive()).toBe(true);
    second();
    expect(gcPumpActive()).toBe(false);
    expect(calls).toBeGreaterThan(0);
  });

  it('tolerates a throwing gc', async () => {
    scope.gc = () => {
      throw new Error('boom');
    };
    const release = beginGcPump(5);
    await sleep(20);
    release();
    expect(gcPumpActive()).toBe(false);
  });
});
