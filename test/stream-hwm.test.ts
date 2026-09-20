import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * High-water-mark semantics.
 *
 * These are backed by Node's own `internal/streams/state.js`, vendored verbatim
 * (see tools/vendor.mjs), so the defaults and the Duplex per-side keys are the
 * real implementation rather than a hand-rolled approximation. Every expected
 * value below was read off a real Node v22 first.
 */
function boot(files: Record<string, string>, entry = '/project/index.js') {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [p, content] of Object.entries(files)) {
    const dir = p.split('/').slice(0, -1).join('/');
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(p, new TextEncoder().encode(content));
  }
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: [entry],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => out.push('ERR:' + c),
  });
  const run = () => {
    try {
      runtime.runMain(entry);
    } catch {
      /* assertions read the captured output */
    }
  };
  return { runtime, out, run };
}

async function waitFor(predicate: () => boolean, ms = 300): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
}

function runProgram(src: string): Promise<string> {
  const { out, run } = boot({ '/project/index.js': src });
  run();
  return waitFor(() => /__done__/.test(out.join(''))).then(() => out.join(''));
}

describe('stream highWaterMark (from vendored internal/streams/state.js)', () => {
  it('uses Node defaults: 64 KiB bytes, 16 objects', async () => {
    const text = await runProgram(`
      const stream = require('stream');
      const { Readable, Writable, Duplex } = stream;
      console.log('defaults', stream.getDefaultHighWaterMark(false), stream.getDefaultHighWaterMark(true));
      console.log('r', new Readable().readableHighWaterMark);
      console.log('r obj', new Readable({ objectMode: true }).readableHighWaterMark);
      console.log('w', new Writable().writableHighWaterMark);
      console.log('zero', new Readable({ highWaterMark: 0 }).readableHighWaterMark);
      console.log('duplex', new Duplex().readableHighWaterMark, new Duplex().writableHighWaterMark);
      console.log('duplex obj', new Duplex({ objectMode: true }).readableHighWaterMark);
      console.log('__done__');
    `);
    expect(text).toContain('defaults 65536 16');
    expect(text).toContain('r 65536');
    expect(text).toContain('r obj 16');
    expect(text).toContain('w 65536');
    expect(text).toContain('zero 0');
    expect(text).toContain('duplex 65536 65536');
    expect(text).toContain('duplex obj 16');
  });

  it('honours the Duplex per-side highWaterMark keys', async () => {
    const text = await runProgram(`
      const { Duplex } = require('stream');
      console.log('rHWM', new Duplex({ readableHighWaterMark: 5 }).readableHighWaterMark, new Duplex({ readableHighWaterMark: 5 }).writableHighWaterMark);
      console.log('wHWM', new Duplex({ writableHighWaterMark: 7 }).readableHighWaterMark, new Duplex({ writableHighWaterMark: 7 }).writableHighWaterMark);
      console.log('wins', new Duplex({ highWaterMark: 9, readableHighWaterMark: 5 }).readableHighWaterMark);
      console.log('__done__');
    `);
    expect(text).toContain('rHWM 5 65536');
    expect(text).toContain('wHWM 65536 7');
    expect(text).toContain('wins 9');
  });

  it('Duplex per-side objectMode; plain streams ignore the other side flag', async () => {
    const text = await runProgram(`
      const { Readable, Writable, Duplex } = require('stream');
      console.log('duplex', new Duplex({ writableObjectMode: true }).writableObjectMode, new Duplex({ writableObjectMode: true }).readableObjectMode);
      console.log('rObj', new Duplex({ readableObjectMode: true }).readableObjectMode, new Duplex({ readableObjectMode: true }).writableObjectMode);
      console.log('w ignores', new Writable({ writableObjectMode: true }).writableObjectMode);
      console.log('r ignores', new Readable({ readableObjectMode: true }).readableObjectMode);
      console.log('__done__');
    `);
    expect(text).toContain('duplex true false');
    expect(text).toContain('rObj true false');
    expect(text).toContain('w ignores false');
    expect(text).toContain('r ignores false');
  });

  it('rejects an invalid highWaterMark the way Node does', async () => {
    const text = await runProgram(`
      const { Readable } = require('stream');
      for (const bad of [-1, 1.5]) {
        try {
          new Readable({ highWaterMark: bad });
        } catch (err) {
          console.log(err.code, err.constructor.name, '|', err.message);
        }
      }
      console.log('__done__');
    `);
    expect(text).toContain("ERR_INVALID_ARG_VALUE TypeError | The property 'options.highWaterMark' is invalid. Received -1");
    expect(text).toContain("The property 'options.highWaterMark' is invalid. Received 1.5");
  });

  it('raises the highWaterMark when read(n) asks for more (power of two)', async () => {
    const text = await runProgram(`
      const { Readable } = require('stream');
      const r = new Readable({ read() {} });
      console.log('before', r.readableHighWaterMark);
      r.read(100000);
      console.log('after', r.readableHighWaterMark);
      console.log('__done__');
    `);
    expect(text).toContain('before 65536');
    expect(text).toContain('after 131072');
  });

  it('setDefaultHighWaterMark changes subsequent defaults', async () => {
    const text = await runProgram(`
      const stream = require('stream');
      const { Readable } = stream;
      const original = stream.getDefaultHighWaterMark(false);
      stream.setDefaultHighWaterMark(false, 1024);
      console.log('custom', new Readable().readableHighWaterMark);
      stream.setDefaultHighWaterMark(false, original);
      console.log('restored', new Readable().readableHighWaterMark);
      console.log('__done__');
    `);
    expect(text).toContain('custom 1024');
    expect(text).toContain('restored 65536');
  });
});
