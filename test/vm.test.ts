import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `vm` is Node's own `lib/vm.js` now, backed by the `contextify` binding — a JS
 * stand-in for V8 contexts (a context is the sandbox object tagged with Node's
 * contextify symbol; a script runs inside a `with`-scope over it).
 *
 * The corpus parity test (`vm-corpus.test.ts`) checks 59 behaviours against a
 * real Node. This file covers the pieces that are ours: the module surface, the
 * `internal/util.js` cross-realm path that made a `vm` necessary in the first
 * place, and the loud failures where a single realm cannot honestly deliver
 * (code cache, script timing, `measureMemory`).
 */
function boot(): (id: string) => any {
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
  return (id: string): any => runtime.realm.require(id);
}

describe('vm is the vendored Node source', () => {
  it('exposes the module surface', () => {
    const vm = boot()('vm');
    expect(Object.keys(vm)).toEqual([
      'Script',
      'createContext',
      'createScript',
      'runInContext',
      'runInNewContext',
      'runInThisContext',
      'isContext',
      'compileFunction',
      'measureMemory',
      'constants',
    ]);
    for (const method of ['runInThisContext', 'runInContext', 'runInNewContext']) {
      expect(typeof vm.Script.prototype[method], method).toBe('function');
    }
    expect(vm.createScript('1')).toBeInstanceOf(vm.Script);
    expect(typeof vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER).toBe('symbol');
    expect(typeof vm.constants.DONT_CONTEXTIFY).toBe('symbol');
  });

  it('runs in this context against the host globals, without locals', () => {
    const vm = boot()('vm');
    const secret = 'a local in the test scope';
    void secret;
    // Host globals are visible (this is "this context").
    expect(vm.runInThisContext("typeof process")).toBe('object');
    // But the caller's locals are not (it is not an eval).
    expect(vm.runInThisContext('typeof secret')).toBe('undefined');
  });

  it('makes the sandbox the global scope of a new context', () => {
    const vm = boot()('vm');
    const sandbox: Record<string, unknown> = { seed: 41 };
    expect(vm.runInNewContext('seed + 1', sandbox)).toBe(42);
    vm.runInNewContext('assigned = "yes"', sandbox);
    expect(sandbox.assigned).toBe('yes');
    // A fresh context does not leak the host's `process`.
    expect(vm.runInNewContext('typeof process')).toBe('undefined');
  });

  it('tracks context identity through isContext', () => {
    const vm = boot()('vm');
    const object = {};
    expect(vm.isContext(object)).toBe(false);
    expect(vm.createContext(object)).toBe(object);
    expect(vm.isContext(object)).toBe(true);
    expect(vm.isContext(vm.createContext(object))).toBe(true);
  });

  it('keeps the internal/util.js cross-realm RegExp path working', () => {
    // This is why `vm` cannot be a stub: `internal/util.js` builds a
    // "side-effect-free" RegExp from `runInNewContext('this')`, and the WHATWG
    // stream finalizers reach it. It has to resolve, construct, and replace.
    const util = boot()('internal/util') as {
      SideEffectFreeRegExpPrototypeSymbolReplace: (
        regex: RegExp,
        string: string,
        replacement: string,
      ) => string;
    };
    expect(typeof util.SideEffectFreeRegExpPrototypeSymbolReplace).toBe('function');
    const replaced = util.SideEffectFreeRegExpPrototypeSymbolReplace(/a(b)c/, 'abc', '[$1]');
    expect(replaced).toBe('[b]');
  });

  it('parses a script eagerly, like Node', () => {
    const vm = boot()('vm');
    expect(() => new vm.Script('syntax error(')).toThrow(SyntaxError);
  });

  it('rejects a non-context object', () => {
    const vm = boot()('vm');
    expect(() => vm.runInContext('1', {})).toThrow(/"contextifiedObject" argument must be an vm\.Context/);
    expect(() => vm.runInContext('1', {})).toThrow(/ERR_INVALID_ARG_TYPE|must be an vm\.Context/);
  });

  it('compiles functions against a parsing context and extensions', () => {
    const vm = boot()('vm');
    const context = vm.createContext({ fromContext: 10 });
    expect(vm.compileFunction('return fromContext + 1', [], { parsingContext: context })()).toBe(11);
    expect(vm.compileFunction('return x * y', ['x', 'y'])(3, 4)).toBe(12);
    const withExtension = vm.compileFunction('return ext', [], {
      contextExtensions: [{ ext: 'e' }],
    });
    expect(withExtension()).toBe('e');
  });

  it('refuses to fake what one realm cannot do', () => {
    const vm = boot()('vm');
    const fails = (make: () => unknown, subject: string): void => {
      let caught: any;
      try {
        make();
      } catch (err) {
        caught = err;
      }
      expect(caught, subject).toBeInstanceOf(Error);
      expect(caught.code, subject).toBe('ERR_WEB_NODE_NOT_IMPLEMENTED');
    };
    // Script timing needs an interruptible isolate.
    fails(() => vm.runInNewContext('1', {}, { timeout: 50 }), 'timeout');
    fails(() => vm.runInNewContext('1', {}, { breakOnSigint: true }), 'breakOnSigint');
    // Code cache is a V8/Node compile artifact.
    fails(() => new vm.Script('1').createCachedData(), 'createCachedData');
    fails(() => new vm.Script('1', { produceCachedData: true }), 'produceCachedData');
    // Per-context memory measurement needs the V8 heap API.
    fails(() => vm.measureMemory(), 'measureMemory');
  });
});
