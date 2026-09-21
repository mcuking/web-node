/**
 * A corpus of `vm` behaviours, shared by the oracle generator and the parity
 * test.
 *
 * `tools/vm-corpus-oracle.mjs` runs this against a real Node's `vm` and writes
 * `test/fixtures/vm-corpus.json`; `test/vm-corpus.test.ts` runs the identical
 * function against the web-node runtime's `vm` and asserts the answers are
 * equal. One list, so neither side can drift.
 *
 * The entries stay inside the surface a single realm can honestly reproduce:
 * expression results, the sandbox being the global scope, `this`/`globalThis`
 * identity, which globals a fresh context exposes, the validation errors (which
 * come from the vendored `internal/validators`, so their messages are exact),
 * and the shape of the module. Realm-identity facts that need a second V8
 * context — `Array` inside being a *different* `Array`, enumerable intrinsics
 * on `globalThis` — are deliberately out of scope; see docs/DEVLOG.md.
 */

/** Run `fn`, encoding a thrown error as a comparable value. */
function capture(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, name: err && err.name, message: err && err.message, code: err && err.code };
  }
}

export function runVmCorpus(vm) {
  return {
    expr: vm.runInNewContext('1+2'),
    completionLastValue: vm.runInNewContext('var q=1; q+1'),
    thisType: typeof vm.runInNewContext('this'),
    thisEqualsGlobalThis: vm.runInNewContext('this===globalThis'),
    thisIsSandbox: (() => {
      const sandbox = {};
      return vm.runInNewContext('this', sandbox) === sandbox;
    })(),
    thisFreshIdentity: (() => {
      const a = vm.runInNewContext('this');
      const b = vm.runInNewContext('this');
      return a === b;
    })(),
    typeofProcess: vm.runInNewContext('typeof process'),
    typeofRequire: vm.runInNewContext('typeof require'),
    typeofModule: vm.runInNewContext('typeof module'),
    typeofBuffer: vm.runInNewContext('typeof Buffer'),
    typeofSetTimeout: vm.runInNewContext('typeof setTimeout'),
    typeofGlobal: vm.runInNewContext('typeof global'),
    typeofConsole: vm.runInNewContext('typeof console'),
    typeofMath: vm.runInNewContext('typeof Math'),
    typeofJSON: vm.runInNewContext('typeof JSON'),
    typeofArray: vm.runInNewContext('typeof Array'),
    typeofDate: vm.runInNewContext('typeof Date'),
    sandboxWrite: (() => {
      const sandbox = {};
      vm.runInNewContext('x=1', sandbox);
      return sandbox.x;
    })(),
    sandboxVar: (() => {
      const sandbox = {};
      vm.runInNewContext('var y=1; y', sandbox);
      return sandbox.y;
    })(),
    sandboxRead: (() => {
      const sandbox = { n: 41 };
      return vm.runInNewContext('n+1', sandbox);
    })(),
    globalWriteThenRead: (() => {
      const sandbox = vm.createContext({});
      vm.runInContext('globalThis.g=7', sandbox);
      return sandbox.g;
    })(),
    jsonStringify: vm.runInNewContext("JSON.stringify({a:1})"),
    mathMax: vm.runInNewContext('Math.max(1,2)'),
    mapJoin: vm.runInNewContext("[1,2,3].map(function(n){return n*2}).join(',')"),
    tryCatchInContext: vm.runInNewContext('try { throw new Error("e") } catch (x) { x.message }'),
    iife: vm.runInNewContext('(function(){return 42})()'),

    isContextCreated: vm.isContext(vm.createContext({})),
    isContextPlain: vm.isContext({}),
    isContextArray: vm.isContext([]),
    createContextReturnsArg: (() => {
      const object = {};
      return vm.createContext(object) === object;
    })(),
    createContextIdempotent: (() => {
      const context = vm.createContext({});
      return vm.createContext(context) === context;
    })(),
    createContextName: (() => {
      const context = vm.createContext({}, { name: 'n1' });
      return vm.isContext(context);
    })(),
    dontContextifyIsContext: vm.isContext(vm.createContext(vm.constants.DONT_CONTEXTIFY)),
    dontContextifyRun: vm.runInContext(
      '1+1',
      vm.createContext(vm.constants.DONT_CONTEXTIFY),
    ),

    createScriptInstance: vm.createScript('1') instanceof vm.Script,
    scriptRunInThisContext: new vm.Script('3*4').runInThisContext(),
    scriptRunInNewContext: new vm.Script('3*4').runInNewContext(),
    scriptRunInContext: new vm.Script('7').runInContext(vm.createContext({})),
    scriptStringOptions: new vm.Script('1', 'myfile').runInThisContext(),
    runInNewContextStringOptions: vm.runInNewContext('2+2', {}, 'somefile'),
    scriptPrototypeMethods: [
      typeof vm.Script.prototype.runInThisContext,
      typeof vm.Script.prototype.runInContext,
      typeof vm.Script.prototype.runInNewContext,
    ].join(','),

    compileFunctionBasic: vm.compileFunction('return a+b', ['a', 'b'])(1, 2),
    compileFunctionNoParams: vm.compileFunction('return 5')(),
    compileFunctionContext: (() => {
      const context = vm.createContext({ z: 10 });
      return vm.compileFunction('return z', [], { parsingContext: context })();
    })(),

    constantsKeys: Object.keys(vm.constants).join(','),
    constantsTypes: [typeof vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER, typeof vm.constants.DONT_CONTEXTIFY].join(','),
    moduleKeys: Object.keys(vm).join(','),

    syntaxError: capture(() => vm.runInNewContext('syntax error(')),
    runtimeError: capture(() => vm.runInNewContext('null.x')),
    customThrow: capture(() => vm.runInNewContext('throw new TypeError("boom")')),
    scriptLineOffsetType: capture(() => new vm.Script('1', { lineOffset: 'x' })),
    scriptColumnOffsetRange: capture(() => new vm.Script('1', { columnOffset: 1.5 })),
    runInContextNonContext: capture(() => vm.runInContext('1', {})),
    compileFunctionParamsType: capture(() => vm.compileFunction('return 1', 'notarray')),
    compileFunctionNonContext: capture(() => vm.compileFunction('return 1', [], { parsingContext: {} })),
    timeoutType: capture(() => vm.runInNewContext('1', {}, { timeout: 'x' })),
    timeoutZero: capture(() => vm.runInNewContext('1', {}, { timeout: 0 })),
    isContextNonObject: capture(() => vm.isContext(3)),
    createContextBadName: capture(() => vm.createContext({}, { name: 3 })),
  };
}
