import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `tty` is Node's own `lib/tty.js` now. A browser tab has no file descriptors
 * and no controlling terminal, so the honest surface is:
 *
 * - `isatty(fd)` is the real function and answers `false` (what Node reports for
 *   a pipe or a redirected stream);
 * - `getColorDepth`/`hasColors` on `WriteStream.prototype` are the real
 *   `internal/tty` functions and compute from `process.env`;
 * - `ReadStream`/`WriteStream` are the real classes, but they exist to wrap a
 *   native `TTY` handle, so constructing either throws (loudly, typed) instead
 *   of pretending to be a terminal.
 *
 * The colour answers are checked against a real Node in `tty-corpus.test.ts`;
 * here we cover the module surface and the library-visible behaviour.
 */
function boot(env: Record<string, string> = {}): {
  runtime: NodeRuntime;
  require: (id: string) => any;
} {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    env,
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return { runtime, require: (id: string): any => runtime.realm.require(id) };
}

/**
 * Run `fn` with the *runtime's* `process` as the ambient global.
 *
 * Vendored modules read `process` off the global scope (as they do in a real
 * Node). In production the runtime installs its own `process` there; under the
 * Node test harness we install it only for the duration of a call, so the
 * `process.env` a library sees is the runtime's, not vitest's.
 */
function withRuntimeProcess<T>(runtime: NodeRuntime, fn: () => T): T {
  const g = globalThis as unknown as { process: unknown };
  const previous = g.process;
  g.process = runtime.realm.require('process');
  try {
    return fn();
  } finally {
    g.process = previous;
  }
}

describe('tty is the vendored Node source', () => {
  it('exposes the module surface', () => {
    const tty = boot().require('tty');
    expect(Object.keys(tty)).toEqual(['isatty', 'ReadStream', 'WriteStream']);
    expect(typeof tty.isatty).toBe('function');
    expect(typeof tty.ReadStream).toBe('function');
    expect(typeof tty.WriteStream).toBe('function');
    expect(typeof tty.WriteStream.prototype.getColorDepth).toBe('function');
    expect(typeof tty.WriteStream.prototype.hasColors).toBe('function');
  });

  it('answers isatty like a non-terminal stream', () => {
    const { isatty } = boot().require('tty') as { isatty: (fd: unknown) => boolean };
    // Anything that is not an integer in [0, 2^31-1] is false before the
    // handle is even consulted; the rest are false because there is no tty.
    for (const fd of [0, 1, 2, 5, 999, -1, 0.5, 1.5, NaN, '1', null, undefined, 2 ** 31]) {
      expect(isatty(fd), `isatty(${String(fd)})`).toBe(false);
    }
  });

  it('refuses to fabricate a terminal stream', () => {
    const tty = boot().require('tty');
    const fails = (make: () => unknown, label: string): void => {
      let caught: any;
      try {
        make();
      } catch (err) {
        caught = err;
      }
      expect(caught, label).toBeInstanceOf(Error);
      expect(caught.code, label).toBe('ERR_WEB_NODE_NOT_IMPLEMENTED');
    };
    fails(() => new tty.WriteStream(1), 'new WriteStream(1)');
    fails(() => new tty.ReadStream(1), 'new ReadStream(1)');
  });

  it('rejects a bad fd before touching the handle, like Node', () => {
    const tty = boot().require('tty');
    expect(() => new tty.WriteStream(-1)).toThrow(/"fd" must be a positive integer/);
    expect(() => new tty.WriteStream(1.5)).toThrow(/"fd" must be a positive integer/);
  });

  it('computes colour depth from the ambient process.env by default', () => {
    // No explicit env: the function reads `process.env`, which is the runtime's
    // environment in production.
    const forced = boot({ FORCE_COLOR: '3' });
    expect(
      withRuntimeProcess(forced.runtime, () => forced.require('tty').WriteStream.prototype.getColorDepth()),
    ).toBe(24);
    const plain = boot();
    expect(
      withRuntimeProcess(plain.runtime, () => plain.require('tty').WriteStream.prototype.getColorDepth()),
    ).toBe(1);
  });

  it('colourises util.styleText when FORCE_COLOR asks for it', () => {
    // This is the library-visible payoff: `internal/util/colors` lazily reaches
    // for `internal/tty` whenever FORCE_COLOR is set, which used to be a missing
    // module. With it registered, `styleText` really emits ANSI codes.
    const colors = (env: Record<string, string>): ((format: string, text: string) => string) => {
      const { runtime, require } = boot(env);
      return (format: string, text: string): string =>
        withRuntimeProcess(runtime, () =>
          (require('util') as {
            styleText: (f: string, t: string) => string;
          }).styleText(format, text),
        );
    };

    expect(colors({ FORCE_COLOR: '3' })('red', 'x')).toBe('\u001b[31mx\u001b[39m');
    expect(colors({ FORCE_COLOR: '1' })('red', 'x')).toBe('\u001b[31mx\u001b[39m');
    expect(colors({ FORCE_COLOR: '0' })('red', 'x')).toBe('x');
    expect(colors({})('red', 'x')).toBe('x');
  });

  it('carries the tty error codes Node declares', () => {
    const { codes } = boot().require('internal/errors') as {
      codes: Record<string, new (...args: any[]) => Error & { code: string }>;
    };
    const fd = new codes.ERR_INVALID_FD(3);
    expect(fd).toBeInstanceOf(RangeError);
    expect(fd.code).toBe('ERR_INVALID_FD');
    expect(fd.message).toBe('"fd" must be a positive integer: 3');

    const cursor = new codes.ERR_INVALID_CURSOR_POS();
    expect(cursor).toBeInstanceOf(TypeError);
    expect(cursor.code).toBe('ERR_INVALID_CURSOR_POS');

    const type = new codes.ERR_INVALID_FD_TYPE('file');
    expect(type).toBeInstanceOf(TypeError);
    expect(type.message).toBe('Unsupported fd type: file');

    // `SystemError`-shaped: the message is assembled from the context object.
    const ttyInit = new codes.ERR_TTY_INIT_FAILED({
      syscall: 'uv_tty_init',
      code: 'EINVAL',
      message: 'invalid argument',
      errno: -22,
    });
    expect(ttyInit.name).toBe('SystemError');
    expect(ttyInit.code).toBe('ERR_TTY_INIT_FAILED');
    expect(ttyInit.message).toBe(
      'TTY initialization failed: uv_tty_init returned EINVAL (invalid argument)',
    );
    expect((ttyInit as unknown as { errno: number }).errno).toBe(-22);
    expect((ttyInit as unknown as { syscall: string }).syscall).toBe('uv_tty_init');
  });
});
