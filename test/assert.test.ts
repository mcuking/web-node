import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `assert` is Node's real `lib/assert.js` (plus `internal/assert/*`,
 * `internal/util/comparisons`). Every expected string below was read off a real
 * Node v26.9.0 first, so these assertions pin us to upstream byte for byte.
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
  const realm = runtime.realm as any;
  return {
    realm,
    assert: realm.require('assert') as {
      (value: unknown, ...args: unknown[]): void;
      ok: (value: unknown, ...args: unknown[]) => void;
      strict: (value: unknown, ...args: unknown[]) => void;
      strictEqual: (a: unknown, b: unknown, ...args: unknown[]) => void;
      notStrictEqual: (a: unknown, b: unknown, ...args: unknown[]) => void;
      deepStrictEqual: (a: unknown, b: unknown, ...args: unknown[]) => void;
      notDeepStrictEqual: (a: unknown, b: unknown, ...args: unknown[]) => void;
      partialDeepStrictEqual: (a: unknown, b: unknown, ...args: unknown[]) => void;
      throws: (fn: () => unknown, ...args: unknown[]) => void;
      match: (s: string, re: RegExp) => void;
      doesNotMatch: (s: string, re: RegExp) => void;
      fail: (...args: unknown[]) => void;
    },
    util: realm.require('util') as { isDeepStrictEqual: (a: unknown, b: unknown) => boolean },
  };
}

function grab(fn: () => unknown): string {
  try {
    fn();
    return 'OK';
  } catch (e) {
    const err = e as Error & { code?: string };
    return `${err.name}|${err.code ?? ''}|${JSON.stringify(err.message)}`;
  }
}

describe('vendored: assert', () => {
  it('passes for true assertions', () => {
    const { assert } = boot();
    expect(grab(() => assert(true))).toBe('OK');
    expect(grab(() => assert.ok(1))).toBe('OK');
    expect(grab(() => assert.strictEqual(1, 1))).toBe('OK');
    expect(grab(() => assert.deepStrictEqual({ a: [1, 2] }, { a: [1, 2] }))).toBe('OK');
    expect(grab(() => assert.partialDeepStrictEqual({ a: 1, b: 2 }, { a: 1 }))).toBe('OK');
    expect(typeof assert.strict).toBe('function');
  });

  it('builds the same equality messages as Node', () => {
    const { assert } = boot();
    expect(grab(() => assert.strictEqual(1, 2))).toBe(
      'AssertionError|ERR_ASSERTION|"Expected values to be strictly equal:\\n\\n1 !== 2\\n"',
    );
    expect(grab(() => assert.notStrictEqual(1, 1))).toBe(
      'AssertionError|ERR_ASSERTION|"Expected \\"actual\\" to be strictly unequal to: 1"',
    );
  });

  it('renders the real Myers diff for deep comparisons', () => {
    const { assert } = boot();
    expect(grab(() => assert.deepStrictEqual({ a: 1 }, { a: 2 }))).toBe(
      'AssertionError|ERR_ASSERTION|"Expected values to be strictly deep-equal:\\n+ actual - expected\\n\\n  {\\n+   a: 1\\n-   a: 2\\n  }\\n"',
    );
    expect(grab(() => assert.notDeepStrictEqual({ a: 1 }, { a: 1 }))).toBe(
      'AssertionError|ERR_ASSERTION|"Expected \\"actual\\" not to be strictly deep-equal to:\\n\\n{\\n  a: 1\\n}\\n"',
    );
    expect(grab(() => assert.partialDeepStrictEqual({ a: 1 }, { a: 1, b: 2 }))).toBe(
      'AssertionError|ERR_ASSERTION|"Expected values to be partially and strictly deep-equal:\\n+ actual - expected\\n\\n  {\\n    a: 1,\\n-   b: 2\\n  }\\n"',
    );
  });

  it('handles throws / match / fail and custom messages', () => {
    const { assert } = boot();
    expect(grab(() => assert.throws(() => {}))).toBe('AssertionError|ERR_ASSERTION|"Missing expected exception."');
    expect(grab(() => assert.throws(() => {
      throw new Error('x');
    }, TypeError))).toBe(
      'AssertionError|ERR_ASSERTION|"The error is expected to be an instance of \\"TypeError\\". Received \\"Error\\"\\n\\nError message:\\n\\nx"',
    );
    expect(grab(() => assert.match('abc', /z/))).toBe(
      'AssertionError|ERR_ASSERTION|"The input did not match the regular expression /z/. Input:\\n\\n\'abc\'\\n"',
    );
    expect(grab(() => assert.doesNotMatch('abc', /a/))).toBe(
      'AssertionError|ERR_ASSERTION|"The input was expected to not match the regular expression /a/. Input:\\n\\n\'abc\'\\n"',
    );
    expect(grab(() => assert.fail('boom'))).toBe('AssertionError|ERR_ASSERTION|"boom"');
    expect(grab(() => assert.strictEqual(1, 2, 'ctx %s', 5))).toBe(
      'AssertionError|ERR_ASSERTION|"ctx 5\\n\\n1 !== 2\\n"',
    );
  });

  it('recovers the offending expression for a failed ok()', () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile(
      '/project/index.js',
      new TextEncoder().encode(
        [
          "const assert = require('assert');",
          'function a() {',
          '  assert.ok(0);',
          '}',
          'function b() {',
          '  assert(false);',
          '}',
          'function c() {',
          '  assert.ok(false); assert.ok(true);',
          '}',
          'try { a(); } catch (e) { console.log("A:" + e.name + "|" + JSON.stringify(e.message)); }',
          'try { b(); } catch (e) { console.log("B:" + e.name + "|" + JSON.stringify(e.message)); }',
          'try { c(); } catch (e) { console.log("C:" + e.name + "|" + JSON.stringify(e.message)); }',
        ].join('\n'),
      ),
    );
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array)),
      onStderr: () => {},
    });
    runtime.runMain('/project/index.js');
    expect(out.join('')).toBe(
      'A:AssertionError|"The expression evaluated to a falsy value:\\n\\n  assert.ok(0)\\n"\n' +
        'B:AssertionError|"The expression evaluated to a falsy value:\\n\\n  assert(false)\\n"\n' +
        'C:AssertionError|"The expression evaluated to a falsy value:\\n\\n  assert.ok(false)\\n"\n',
    );
  });

  it('attributes stack frames to the real file and line', () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile(
      '/project/index.js',
      new TextEncoder().encode(
        [
          'function f() {',
          "  throw new Error('x');",
          '}',
          "try { f(); } catch (e) { console.log('L:' + e.stack.split('\\n')[1].trim()); }",
        ].join('\n'),
      ),
    );
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array)),
      onStderr: () => {},
    });
    runtime.runMain('/project/index.js');
    // The throwing statement is on line 2; the frame must say so (the indirect
    // eval wrapper in compileTagged keeps V8's line offset at zero).
    expect(out.join('')).toBe('L:at f (/project/index.js:2:9)\n');
  });

  it('gives util.isDeepStrictEqual the real structural comparison', () => {
    const { util } = boot();
    expect(util.isDeepStrictEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(util.isDeepStrictEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(util.isDeepStrictEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(util.isDeepStrictEqual(new Map([[1, { x: 1 }]]), new Map([[1, { x: 1 }]]))).toBe(true);
    expect(util.isDeepStrictEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    expect(util.isDeepStrictEqual(a, b)).toBe(true);
  });
});

describe('vendored: internal/validators', () => {
  it('throws Node-shaped argument errors', () => {
    const { realm } = boot();
    const v = realm.require('internal/validators') as {
      validateString: (value: unknown, name: string) => void;
      validateObject: (value: unknown, name: string, bits: number) => void;
      validateInteger: (value: unknown, name: string) => void;
      kValidateObjectAllowNullable: number;
      kValidateObjectAllowArray: number;
      kValidateObjectAllowFunction: number;
    };
    expect(grab(() => v.validateString('ok', 'x'))).toBe('OK');
    expect(grab(() => v.validateString(1, 'x'))).toBe(
      'TypeError|ERR_INVALID_ARG_TYPE|"The \\"x\\" argument must be of type string. Received type number (1)"',
    );
    expect(grab(() => v.validateObject(null, 'x', 0))).toBe(
      'TypeError|ERR_INVALID_ARG_TYPE|"The \\"x\\" argument must be of type object. Received null"',
    );
    expect(grab(() => v.validateInteger(1.5, 'x'))).toBe(
      'RangeError|ERR_OUT_OF_RANGE|"The value of \\"x\\" is out of range. It must be an integer. Received 1.5"',
    );
    expect([v.kValidateObjectAllowNullable, v.kValidateObjectAllowArray, v.kValidateObjectAllowFunction]).toEqual([
      1, 2, 4,
    ]);
  });
});
