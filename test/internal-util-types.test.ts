import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `internal/util/types` is Node's real source now; the predicates underneath it
 * come from our `types` binding, which mirrors `src/node_types.cc`. Expected
 * values were read off a real Node v26.9.0 first, including the cases that are
 * easy to get wrong: a primitive is not a boxed primitive, and a boxed BigInt
 * is not the same as a BigInt64Array.
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
  return runtime.realm as any;
}

describe('vendored: internal/util/types', () => {
  it('exports exactly the surface Node exposes on util.types', () => {
    const realm = boot();
    const types = realm.require('util').types;
    expect(Object.keys(types).sort()).toEqual(
      [
        'isAnyArrayBuffer',
        'isArgumentsObject',
        'isArrayBuffer',
        'isArrayBufferView',
        'isAsyncFunction',
        'isBigInt64Array',
        'isBigIntObject',
        'isBigUint64Array',
        'isBooleanObject',
        'isBoxedPrimitive',
        'isCryptoKey',
        'isDataView',
        'isDate',
        'isExternal',
        'isFloat16Array',
        'isFloat32Array',
        'isFloat64Array',
        'isGeneratorFunction',
        'isGeneratorObject',
        'isInt16Array',
        'isInt32Array',
        'isInt8Array',
        'isKeyObject',
        'isMap',
        'isMapIterator',
        'isModuleNamespaceObject',
        'isNativeError',
        'isNumberObject',
        'isPromise',
        'isProxy',
        'isRegExp',
        'isSet',
        'isSetIterator',
        'isSharedArrayBuffer',
        'isStringObject',
        'isSymbolObject',
        'isTypedArray',
        'isUint16Array',
        'isUint32Array',
        'isUint8Array',
        'isUint8ClampedArray',
        'isWeakMap',
        'isWeakSet',
      ].sort(),
    );
  });

  it('separates views from buffers and TypedArrays from DataView', () => {
    const realm = boot();
    const t = realm.require('internal/util/types');
    expect(t.isArrayBufferView(new Uint8Array(1))).toBe(true);
    expect(t.isArrayBufferView(new ArrayBuffer(1))).toBe(false);
    expect(t.isTypedArray(new Uint8Array(1))).toBe(true);
    expect(t.isTypedArray(new DataView(new ArrayBuffer(1)))).toBe(false);
    expect(t.isDataView(new DataView(new ArrayBuffer(1)))).toBe(true);
    expect(t.isDataView(new Uint8Array(1))).toBe(false);
    expect(t.isUint8Array(new Uint8ClampedArray(1))).toBe(false);
    expect(t.isBigInt64Array(new BigInt64Array(0))).toBe(true);
  });

  it('does not treat primitives as boxed primitives', () => {
    const realm = boot();
    const t = realm.require('internal/util/types');
    expect(t.isBoxedPrimitive(new Number(1))).toBe(true);
    expect(t.isBoxedPrimitive(new String('x'))).toBe(true);
    expect(t.isBoxedPrimitive(Object(Symbol('s')))).toBe(true);
    expect(t.isBoxedPrimitive(Object(1n))).toBe(true);
    // The primitives themselves are not boxed.
    expect(t.isBoxedPrimitive(1)).toBe(false);
    expect(t.isBoxedPrimitive('x')).toBe(false);
    expect(t.isBoxedPrimitive(1n)).toBe(false);
    expect(t.isBoxedPrimitive(Symbol('s'))).toBe(false);
    expect(t.isNumberObject(1)).toBe(false);
    expect(t.isSymbolObject(Symbol('s'))).toBe(false);
    expect(t.isBigIntObject(1n)).toBe(false);
    expect(t.isBigIntObject(Object(1n))).toBe(true);
  });

  it('recognises promise / date / regexp / collections', () => {
    const realm = boot();
    const t = realm.require('internal/util/types');
    expect(t.isPromise(Promise.resolve())).toBe(true);
    expect(t.isPromise({})).toBe(false);
    expect(t.isDate(new Date())).toBe(true);
    expect(t.isRegExp(/x/)).toBe(true);
    expect(t.isMap(new Map())).toBe(true);
    expect(t.isSet(new Set())).toBe(true);
    expect(t.isNativeError(new Error('x'))).toBe(true);
    expect(t.isAnyArrayBuffer(new ArrayBuffer(1))).toBe(true);
    expect(t.isAsyncFunction(async () => {})).toBe(true);
    expect(t.isGeneratorObject((function* () {})())).toBe(true);
  });

  it('isKeyObject / isCryptoKey return false without OpenSSL', () => {
    const realm = boot();
    const t = realm.require('internal/util/types');
    const processShim = realm.require('process');
    expect(processShim.versions.openssl).toBeUndefined();
    // The realm runs against the host global, and in a real Node test host
    // `process.versions.openssl` is set — so the module's `process.versions.openssl`
    // guard would take the wrong branch. Inside the browser Worker the realm's
    // own `process` IS the global (installGlobals), so swap it in for the call to
    // exercise the real short-circuit; Node's lazy `require('internal/crypto/keys')`
    // never fires when OpenSSL is absent.
    const hostProcess = (globalThis as { process?: unknown }).process;
    (globalThis as { process?: unknown }).process = processShim;
    try {
      expect(t.isKeyObject({})).toBe(false);
      expect(t.isCryptoKey({})).toBe(false);
    } finally {
      (globalThis as { process?: unknown }).process = hostProcess;
    }
  });
});
