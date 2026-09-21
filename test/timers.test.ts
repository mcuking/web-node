import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `timers` is Node's real `lib/timers.js` + `lib/internal/timers.js` now (plus
 * `timers/promises.js`, `internal/linkedlist` and `internal/priority_queue`),
 * replacing a hand-written module whose `ref`/`unref`/`refresh` were no-ops and
 * whose `promises` was an approximation. The queue runners are driven by a JS
 * stand-in for libuv in the `timers` binding.
 *
 * Expected output was read off Node v26.9.0 first (see the `p5`/`p6`/`p7`/`p8`
 * probes in the milestone notes).
 */
function boot(program: string) {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  const out: string[] = [];
  const err: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => err.push(c),
  });
  runtime.runMain('/project/index.js');
  return { runtime, out, err };
}

const tick = (ms = 60): Promise<void> => new Promise((res) => setTimeout(res, ms));

describe('vendored: timers', () => {
  it('exposes the public surface, and Timeouts carry real state', () => {
    const { out } = boot(`
      const timers = require('timers');
      console.log(Object.keys(timers).sort().join(','));
      const t = timers.setTimeout(() => {}, 50);
      console.log(
        t.constructor.name, t.hasRef(), t._idleTimeout, t._repeat,
        t.unref() === t, t.hasRef(), t.ref() === t, t.hasRef(),
        typeof t.close,
      );
      timers.clearTimeout(t);
    `);
    expect(out.join('')).toBe(
      'clearImmediate,clearInterval,clearTimeout,promises,setImmediate,setInterval,setTimeout\n' +
        'Timeout true 50 null true false true true function\n',
    );
  });

  it('coerces a Timeout to its async id and can be cleared by that primitive', async () => {
    const { out } = boot(`
      const timers = require('timers');
      const t = timers.setTimeout(() => console.log('SHOULD-NOT-PRINT'), 20);
      const n = +t;
      console.log('primitive', typeof n, n > 0);
      timers.clearTimeout(n);
      console.log('destroyed', t._destroyed);
    `);
    await tick();
    expect(out.join('')).toBe('primitive number true\ndestroyed true\n');
  });

  it('setImmediate produces a refed Immediate', async () => {
    const { out } = boot(`
      const timers = require('timers');
      const i = timers.setImmediate(() => console.log('immediate'));
      console.log('immediate-ref', i.hasRef(), i.constructor.name);
    `);
    await tick();
    expect(out.join('')).toBe('immediate-ref true Immediate\nimmediate\n');
  });

  it('fires timeouts in expiry order', async () => {
    const { out } = boot(`
      const timers = require('timers');
      timers.setTimeout(() => console.log('b'), 20);
      timers.setTimeout(() => console.log('a'), 5);
      timers.setTimeout(() => console.log('c'), 35);
    `);
    await tick(120);
    expect(out.join('')).toBe('a\nb\nc\n');
  });

  it('passes extra arguments through', async () => {
    const { out } = boot(`
      const timers = require('timers');
      timers.setTimeout((a, b) => console.log('args', a, b), 2, 'x', 3);
    `);
    await tick();
    expect(out.join('')).toBe('args x 3\n');
  });

  it('repeats an interval until it is cleared', async () => {
    const { out } = boot(`
      const timers = require('timers');
      let n = 0;
      const t = timers.setInterval(() => {
        n++;
        if (n === 3) { timers.clearInterval(t); console.log('interval', n, t._destroyed); }
      }, 2);
    `);
    await tick(80);
    expect(out.join('')).toBe('interval 3 true\n');
  });

  it('drives timers/promises off the same queue', async () => {
    const { out } = boot(`
      const tp = require('timers/promises');
      (async () => {
        console.log('setTimeout', await tp.setTimeout(5, 'v'));
        console.log('setImmediate', await tp.setImmediate('w'));
        await tp.scheduler.wait(2);
        console.log('wait-ok');
        console.log('yield', await tp.scheduler.yield() === undefined);
        const it = tp.setInterval(2, 'i');
        const seen = [];
        for await (const x of it) { seen.push(x); if (seen.length === 3) break; }
        console.log('interval', seen.join(','));
        console.log('same', require('timers/promises') === require('timers').promises);
        console.log('DONE');
      })();
    `);
    await tick(80);
    expect(out.join('')).toBe(
      'setTimeout v\nsetImmediate w\nwait-ok\nyield true\ninterval i,i,i\nsame true\nDONE\n',
    );
  });

  it('keeps the runner alive while a timer is pending, and drops it on reset', async () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    writeProgram(vfs, "require('timers').setTimeout(() => console.log('later'), 30);");
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: () => {},
    });
    runtime.runMain('/project/index.js');
    expect(runtime.activeTimers).toBeGreaterThan(0);
    // Starting a run drops the previous program's queue (each run is a fresh
    // process), so the leftover timeout never fires.
    runtime.runMain('/project/index.js');
    await tick(80);
    expect(out.join('')).toBe('');
  });
});

function writeProgram(vfs: MemoryVfs, source: string): void {
  vfs.writeFile('/project/index.js', new TextEncoder().encode(source));
}
