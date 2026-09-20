import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `util.inspect` / `util.format` are Node's real `internal/util/inspect.js` now.
 * Every expected string below was read off a real Node v26.9.0 first, so these
 * assertions pin our output to the upstream one byte for byte.
 *
 * Two predicates the vendored code sits on cannot be answered from JS, and both
 * are asserted here as the documented approximations they are:
 *   - a settled promise still reports `Promise { <pending> }`;
 *   - a Proxy inspects as the plain object it wraps.
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
    util: realm.require('util') as {
      inspect: ((v: unknown, o?: unknown) => string) & { custom: symbol };
      format: (f: unknown, ...a: unknown[]) => string;
      formatWithOptions: (o: unknown, f: unknown, ...a: unknown[]) => string;
    },
    Buffer: realm.require('buffer').Buffer as {
      from: (v: unknown) => Uint8Array;
    },
  };
}

describe('vendored: internal/util/inspect', () => {
  it('renders primitives and plain structures like Node', () => {
    const { util } = boot();
    expect(util.inspect({ a: 1, b: 'x' })).toBe("{ a: 1, b: 'x' }");
    expect(util.inspect([1, 2, 3])).toBe('[ 1, 2, 3 ]');
    expect(util.inspect({})).toBe('{}');
    expect(util.inspect('hi')).toBe("'hi'");
    expect(util.inspect(1.5)).toBe('1.5');
    expect(util.inspect(null)).toBe('null');
    expect(util.inspect(undefined)).toBe('undefined');
    expect(util.inspect(Symbol('x'))).toBe('Symbol(x)');
    expect(util.inspect(1n)).toBe('1n');
    expect(util.inspect(function foo() {})).toBe('[Function: foo]');
    expect(util.inspect(new Number(1))).toBe('[Number: 1]');
  });

  it('honours depth, sorted, showHidden and maxStringLength', () => {
    const { util } = boot();
    const deep = { a: { b: { c: { d: 1 } } } };
    expect(util.inspect(deep)).toBe('{ a: { b: { c: [Object] } } }');
    expect(util.inspect(deep, { depth: 0 })).toBe('{ a: [Object] }');
    expect(util.inspect(deep, { depth: 1 })).toBe('{ a: { b: [Object] } }');
    expect(util.inspect({ b: 1, a: 2 }, { sorted: true })).toBe('{ a: 2, b: 1 }');
    expect(
      util.inspect(Object.defineProperty({ a: 1 }, 'h', { value: 2, enumerable: false }), { showHidden: true }),
    ).toBe('{ a: 1, [h]: 2 }');
    expect(util.inspect('abcdefghij', { maxStringLength: 3 })).toBe("'abc'... 7 more characters");
  });

  it('renders collections, typed arrays, buffers and dates', () => {
    const { util, Buffer } = boot();
    expect(util.inspect(new Map([[1, 2]]))).toBe('Map(1) { 1 => 2 }');
    expect(util.inspect(new Map())).toBe('Map(0) {}');
    expect(util.inspect(new Set([1, 2]))).toBe('Set(2) { 1, 2 }');
    expect(util.inspect(new Set())).toBe('Set(0) {}');
    expect(util.inspect(new WeakMap())).toBe('WeakMap { <items unknown> }');
    expect(util.inspect(new Uint8Array([1, 2, 3]))).toBe('Uint8Array(3) [ 1, 2, 3 ]');
    expect(util.inspect(Buffer.from([1, 2]))).toBe('<Buffer 01 02>');
    expect(util.inspect(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    expect(util.inspect(/a/g)).toBe('/a/g');
  });

  it('dumps ArrayBuffer contents and marks circular references', () => {
    const { util } = boot();
    expect(util.inspect(new ArrayBuffer(4))).toBe(
      'ArrayBuffer { [Uint8Contents]: <00 00 00 00>, [byteLength]: 4 }',
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(util.inspect(circular)).toBe('<ref *1> { self: [Circular *1] }');
    expect(util.inspect([[1, [2, [3]]]])).toBe('[ [ 1, [ 2, [Array] ] ] ]');
  });

  it('formats values with format / formatWithOptions', () => {
    const { util } = boot();
    expect(util.format('%d %s %o %j %%', 1, 2, { a: 3 }, { b: 4 })).toBe('1 2 { a: 3 } {"b":4} %');
    expect(util.format('a', { x: 1 }, [1, 2])).toBe('a { x: 1 } [ 1, 2 ]');
    expect(util.formatWithOptions({ colors: false }, 'n=%d', 7)).toBe('n=7');
  });

  it('routes custom inspect symbols, with colours when asked', () => {
    const { util } = boot();
    expect(util.inspect({ [util.inspect.custom]: () => 'CUSTOM_OUT' })).toBe('CUSTOM_OUT');
    expect(util.inspect({ a: 1 }, { colors: true })).toBe('{ a: \u001b[33m1\u001b[39m }');
  });

  it('reports an error without a stack as a bracketed one-liner', () => {
    const { util } = boot();
    const err = Object.assign(new Error('x'), { stack: undefined });
    expect(util.inspect(err)).toBe('[Error: x]');
  });

  it('documents the promise / proxy approximations from the util binding', () => {
    const { util } = boot();
    // V8 exposes neither a promise's state nor a Proxy synchronously, so these
    // are the deliberate limits of a JS-only native layer. Real Node v26.9.0
    // prints `Promise { 1 }` and `Proxy({ a: 1 })` respectively.
    expect(util.inspect(Promise.resolve(1))).toBe('Promise { <pending> }');
    const target = { a: 1 };
    expect(util.inspect(new Proxy(target, {}))).toBe('{ a: 1 }');
  });

  it('flows through console.log end to end', () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile(
      '/project/index.js',
      new TextEncoder().encode(
        [
          "console.log({ a: 1 }, [1, 2], new Map([[1, 2]]));",
          "console.log('%o', { b: 2 });",
          'console.log(new Uint8Array([1, 2]));',
        ].join('\n'),
      ),
    );
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: () => {},
    });
    runtime.runMain('/project/index.js');
    expect(out.join('')).toBe(
      '{ a: 1 } [ 1, 2 ] Map(1) { 1 => 2 }\n' + '{ b: 2 }\n' + 'Uint8Array(2) [ 1, 2 ]\n',
    );
  });
});
