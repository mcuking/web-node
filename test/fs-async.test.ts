import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `fs`'s async API must be *asynchronous*: Node's documentation says a callback
 * is "never called synchronously" for these, and libraries rely on it (they set
 * state up after starting the operation). Two ways that guarantee used to be
 * broken here:
 *
 *   - `binding.ReadFileJob`/`WriteFileJob` stand in for libuv thread-pool work
 *     and called `ondone` inline, so `fs.readFile`/`fs.writeFile` ran their
 *     callback before the next statement;
 *   - `readlink`/`symlink`/`link` ignored the request token, so the async form
 *     *threw* instead of reporting through the callback.
 *
 * A pending read is also live work, so it must hold the loop open — otherwise a
 * program whose only outstanding work is a read looks finished.
 */
function boot(program: string) {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  vfs.writeFile('/project/data.json', new TextEncoder().encode('{"a":1}'));
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

describe('fs async API is genuinely asynchronous', () => {
  it('readFile does not call back before the next statement', async () => {
    const { runtime, out } = boot(`
      const fs = require('fs');
      console.log('1');
      fs.readFile('/project/data.json', () => console.log('3-cb'));
      console.log('2');
    `);
    expect(out.join('')).toBe('1\n2\n');
    await runtime.drain();
    expect(out.join('')).toBe('1\n2\n3-cb\n');
  });

  it('writeFile does not call back before the next statement', async () => {
    const { runtime, out } = boot(`
      const fs = require('fs');
      fs.writeFile('/project/out.txt', 'x', () => console.log('3-cb'));
      console.log('2');
    `);
    expect(out.join('')).toBe('2\n');
    await runtime.drain();
    expect(out.join('')).toBe('2\n3-cb\n');
  });

  it('a pending read holds the loop open', async () => {
    const { runtime, out } = boot(`
      const fs = require('fs');
      fs.readFile('/project/data.json', () => console.log('done'));
    `);
    expect(runtime.pendingWork).toBeGreaterThan(0);
    expect(await runtime.drain()).toBe(true);
    expect(out.join('')).toBe('done\n');
  });

  it('readlink reports EINVAL through the callback, and still throws synchronously', async () => {
    const { runtime, out } = boot(`
      const fs = require('fs');
      fs.readlink('/project/data.json', (err) => console.log('RL ' + (err ? err.code : 'ok')));
      console.log('after');
      try { fs.readlinkSync('/project/data.json'); }
      catch (err) { console.log('RLS ' + err.code); }
    `);
    expect(out.join('')).toBe('after\nRLS EINVAL\n');
    await runtime.drain();
    expect(out.join('')).toBe('after\nRLS EINVAL\nRL EINVAL\n');
  });

  it('symlink reports its failure through the callback', async () => {
    const { runtime, out } = boot(`
      const fs = require('fs');
      fs.symlink('/project/data.json', '/project/link', (err) => {
        console.log('SL ' + (err ? err.code : 'ok'));
      });
    `);
    expect(out.join('')).toBe('');
    await runtime.drain();
    expect(out.join('')).toBe('SL ENOSYS\n');
  });

  it('link reports its failure through the callback', async () => {
    const { runtime, out } = boot(`
      const fs = require('fs');
      fs.link('/project/data.json', '/project/hard', (err) => {
        console.log('HL ' + (err ? err.code : 'ok'));
      });
    `);
    await runtime.drain();
    expect(out.join('')).toBe('HL ENOSYS\n');
  });
});
