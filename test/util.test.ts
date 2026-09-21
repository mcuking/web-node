import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `util` is Node's real `lib/util.js` on top of the real `lib/internal/util.js`
 * (plus vendored `internal/util/parse_args/*`, `internal/mime` and `util.diff`).
 * Every expected value below was read off Node v26.9.0 first, so these assertions
 * pin us to upstream.
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
  return {
    realm: runtime.realm as any,
    util: (runtime.realm as any).require('util') as Record<string, any>,
  };
}

describe('vendored: util', () => {
  it('routes format/inspect/types/isDeepStrictEqual to the real sources', () => {
    const { util } = boot();
    expect(util.format('%s:%d', 'x', 3)).toBe('x:3');
    expect(util.format('%o', { a: 1 })).toBe('{ a: 1 }');
    expect(util.format('%j', { a: 1 })).toBe('{"a":1}');
    expect(util.inspect({ a: 1, b: [1, 2] })).toBe('{ a: 1, b: [ 1, 2 ] }');
    expect(util.types.isDate(new Date())).toBe(true);
    expect(util.isDeepStrictEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(util.isDeepStrictEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
  });

  it('provides the real promisify / callbackify / inherits / deprecate', async () => {
    const { util } = boot();
    expect(typeof util.promisify).toBe('function');
    expect(typeof util.callbackify).toBe('function');
    expect(typeof util.inherits).toBe('function');
    expect(typeof util.deprecate).toBe('function');

    // `promisify` is the real one: it honours the `util.promisify.custom` hook.
    const readFile = (path: string, cb: (e: null, v: string) => void) => cb(null, `file:${path}`);
    (readFile as any)[util.promisify.custom] = (path: string) => Promise.resolve(`custom:${path}`);
    await expect(util.promisify(readFile)('/a')).resolves.toBe('custom:/a');

    const plain = (x: number, cb: (e: null, v: number) => void) => cb(null, x * 2);
    await expect(util.promisify(plain)(21)).resolves.toBe(42);

    const asyncFn = async (x: number) => x + 1;
    const cbFn = util.callbackify(asyncFn);
    await new Promise<void>((resolve) => {
      cbFn(1, (err: unknown, v: number) => {
        expect(err).toBeNull();
        expect(v).toBe(2);
        resolve();
      });
    });
  });

  it('exposes the real string helpers', () => {
    const { util } = boot();
    expect(util.stripVTControlCharacters('\u001b[31mx\u001b[39m')).toBe('x');
    expect(util.toUSVString('a\uD800b')).toBe('a\uFFFDb');
    expect(typeof util.styleText('red', 'hi')).toBe('string');
  });

  it('parses dotenv content exactly like Node', () => {
    const { util } = boot();
    expect(util.parseEnv('A=1\nB="x\\ny"\n# c\nC=2 # tail')).toEqual({ A: '1', B: 'x\ny', C: '2' });
    expect(util.parseEnv('export   FOO=bar\nQ=\'a b\'\nK=`multi`')).toEqual({
      FOO: 'bar',
      Q: 'a b',
      K: 'multi',
    });
    expect(util.parseEnv('EMPTY=\n#only comment\nX=a=b')).toEqual({ EMPTY: '', X: 'a=b' });
  });

  it('ships the real MIMEType/parseArgs/diff surface', () => {
    const { util } = boot();
    expect(new util.MIMEType('text/html; charset=utf-8').essence).toBe('text/html');
    expect(util.parseArgs({ args: ['--foo', 'bar'], options: { foo: { type: 'string' } } })).toEqual({
      values: { foo: 'bar' },
      positionals: [],
    });
    expect(util.diff(['a', 'b'], ['a', 'c'])).toEqual([
      [0, 'a'],
      [1, 'b'],
      [-1, 'c'],
    ]);
  });

  it('exposes the real libuv errno table', () => {
    const { util } = boot();
    // The `uv` binding now carries libuv's own `UV_ERRNO_MAP` (deps/uv/include/uv.h),
    // so the system error map is populated exactly as in Node.
    expect(util.getSystemErrorMap().size).toBe(85);
    expect(util.getSystemErrorMap().get(-2)).toEqual([
      'ENOENT',
      'no such file or directory',
    ]);
    expect(util.getSystemErrorName(-2)).toBe('ENOENT');
    // Codes outside the table still fall back to Node's shape.
    expect(util.getSystemErrorName(-4045)).toBe('Unknown system error -4045');
  });
});
