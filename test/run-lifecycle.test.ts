import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * A program is over when the event loop has nothing left to run, not when its
 * entry module returns. These tests pin the pieces `runtime.worker.ts` relies on
 * to report the exit at the right moment: `pendingWork` (would Node still be
 * alive?) and `drain()` (wait until it would not).
 */
function boot(program: string) {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: () => undefined,
  });
  runtime.runMain('/project/index.js');
  return { runtime, out };
}

describe('run lifecycle: the process ends when the loop drains', () => {
  it('leaves a pending timer as live work, and drain() waits for it', async () => {
    const { runtime, out } = boot(`
      setTimeout(() => console.log('late'), 20);
      console.log('sync-end');
    `);
    // The synchronous phase is over, but the timer still holds the loop open.
    expect(out.join('')).toBe('sync-end\n');
    expect(runtime.pendingWork).toBeGreaterThan(0);

    expect(await runtime.drain()).toBe(true);
    expect(out.join('')).toBe('sync-end\nlate\n');
    expect(runtime.pendingWork).toBe(0);
  });

  it('runs a promise continuation before the loop counts as drained', async () => {
    const { runtime, out } = boot(`
      Promise.resolve().then(() => console.log('micro'));
      console.log('sync');
    `);
    expect(out.join('')).toBe('sync\n');
    await runtime.drain();
    expect(out.join('')).toBe('sync\nmicro\n');
  });

  it('an interval keeps the run alive until it is cleared', async () => {
    const { runtime, out } = boot(`
      let n = 0;
      const h = setInterval(() => {
        if (++n === 3) { clearInterval(h); console.log('cleared'); }
      }, 5);
    `);
    expect(await runtime.drain()).toBe(true);
    expect(out.join('')).toBe('cleared\n');
    expect(runtime.pendingWork).toBe(0);
  });

  it('reports false rather than waiting forever on an interval nobody clears', async () => {
    const { runtime } = boot(`setInterval(() => {}, 5);`);
    expect(await runtime.drain(40)).toBe(false);
    expect(runtime.pendingWork).toBeGreaterThan(0);
    runtime.resetRunState(); // model the next Run starting clean
    expect(runtime.pendingWork).toBe(0);
  });

  it('an unref()ed timer does not hold the loop open', async () => {
    const { runtime, out } = boot(`
      setTimeout(() => console.log('unrefed'), 5000).unref();
      console.log('done');
    `);
    expect(await runtime.drain(50)).toBe(true);
    expect(out.join('')).toBe('done\n');
  });
});
