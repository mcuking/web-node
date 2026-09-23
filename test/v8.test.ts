import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `v8` is now Node's own `lib/v8.js`. The interesting half — `serialize` /
 * `deserialize`, `Serializer` / `Deserializer` — runs on the `serdes` binding,
 * which reimplements V8's structured-clone wire format (serialization version
 * 15) in JavaScript, tag for tag, from
 * `deps/v8/src/objects/value-serializer.cc`.
 *
 * Every hex string below was captured from a real Node, oracle fnm Node v26.9.0
 * (`v8.serialize(value).toString('hex')`), so these are byte-for-byte parity
 * checks, not "looks about right" ones. The heap/profiler surface cannot exist
 * in a page and throws; the exceptions are asserted too.
 */
function boot(): { require: (id: string) => any; Buffer: any } {
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
  const require = (id: string): any => runtime.realm.require(id);
  // The runtime's own `Buffer`, not the host's: `lib/v8.js` recognises a
  // Buffer by `abView.constructor === Buffer`, so the identity matters.
  return { require, Buffer: require('buffer').Buffer };
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('v8 is the vendored Node source', () => {
  it('exposes the module surface', () => {
    const v8 = boot().require('v8');
    for (const key of [
      'Serializer',
      'Deserializer',
      'DefaultSerializer',
      'DefaultDeserializer',
      'serialize',
      'deserialize',
      'cachedDataVersionTag',
      'getHeapStatistics',
      'getHeapSpaceStatistics',
      'getHeapCodeStatistics',
      'getHeapSnapshot',
      'writeHeapSnapshot',
      'queryObjects',
      'setFlagsFromString',
      'promiseHooks',
      'startupSnapshot',
      'GCProfiler',
      'isStringOneByteRepresentation',
      'takeCoverage',
      'stopCoverage',
    ]) {
      expect(v8, key).toHaveProperty(key);
    }
    // A stock Node build ships with the inspector, so the coverage helpers are
    // present. web-node has no inspector profiler, so the calls throw loudly.
    expect(typeof v8.takeCoverage).toBe('function');
    expect(typeof v8.stopCoverage).toBe('function');
    expect(() => v8.takeCoverage()).toThrowError(/not implemented/i);
    expect(() => v8.stopCoverage()).toThrowError(/not implemented/i);
  });

  it('serializes the primitive tags byte-for-byte', () => {
    const { serialize } = boot().require('v8');
    const cases: [unknown, string][] = [
      [undefined, 'ff0f5f'],
      [null, 'ff0f30'],
      [true, 'ff0f54'],
      [false, 'ff0f46'],
      [0, 'ff0f4900'],
      [1, 'ff0f4902'],
      [-1, 'ff0f4901'],
      [2147483647, 'ff0f49feffffff0f'],
      [-2147483648, 'ff0f49ffffffff0f'],
      // Past Smi range the value is a HeapNumber: a raw double.
      [2147483648, 'ff0f4e000000000000e041'],
      [4294967295, 'ff0f4e0000e0ffffffef41'],
      [1.5, 'ff0f4e000000000000f83f'],
      [-0, 'ff0f4e0000000000000080'],
      [NaN, 'ff0f4e000000000000f87f'],
      [Infinity, 'ff0f4e000000000000f07f'],
      [-Infinity, 'ff0f4e000000000000f0ff'],
      [100, 'ff0f49c801'],
      [0n, 'ff0f5a00'],
      [1n, 'ff0f5a100100000000000000'],
      [-1n, 'ff0f5a110100000000000000'],
      [123456789012345678901234567890n, 'ff0f5a20d20a3f4eeee073c3f60fe98e01000000'],
      [2n ** 64n, 'ff0f5a2000000000000000000100000000000000'],
      ['', 'ff0f2200'],
      ['abc', 'ff0f2203616263'],
      // Latin-1: é (0xE9) still fits one byte, so it stays a one-byte string.
      ['héllo', 'ff0f220568e96c6c6f'],
      // Anything above 0xFF becomes a two-byte (UTF-16LE) string.
      ['中', 'ff0f63022d4e'],
      ['🦀', 'ff0f63043ed880dd'],
    ];
    for (const [value, expected] of cases) {
      expect(hex(serialize(value)), String(value)).toBe(expected);
    }
  });

  it('zero-pads a two-byte string when that restores aligned payloads', () => {
    const { serialize } = boot().require('v8');
    // `["a","中"]` puts the buffer at an odd length before the two-byte string,
    // so V8 emits a `kPadding` byte first; `[1,"中"]` does not.
    expect(hex(serialize(['a', '中']))).toBe('ff0f41022201610063022d4e240002');
    expect(hex(serialize([1, '中']))).toBe('ff0f4102490263022d4e240002');
    expect(hex(serialize({ a: '中' }))).toBe('ff0f6f22016163022d4e7b01');
  });

  it('serializes objects, arrays, maps, sets and dates byte-for-byte', () => {
    const { serialize } = boot().require('v8');
    const cases: [unknown, string][] = [
      [{}, 'ff0f6f7b00'],
      [{ a: 1 }, 'ff0f6f22016149027b01'],
      [{ a: { b: [1, 2] } }, 'ff0f6f2201616f2201624102490249042400027b017b01'],
      // Non-enumerable properties are skipped.
      [Object.assign(Object.defineProperty({}, 'h', { value: 1, enumerable: false }), { v: 2 }), 'ff0f6f22017649047b01'],
      // Getters are invoked.
      [{ get x() { return 42; } }, 'ff0f6f22017849547b01'],
      // Integer-like keys stay numbers and sort first.
      [{ 2: 'b', 1: 'a' }, 'ff0f6f490222016149042201627b02'],
      [{ 1: 'a', z: 'b' }, 'ff0f6f490222016122017a2201627b02'],
      [[], 'ff0f4100240000'],
      [[1, 2, 3], 'ff0f4103490249044906240003'],
      [[1, 2, 3, 4, 5], 'ff0f41054902490449064908490a240005'],
      // A hole makes the array sparse: only present indices are written.
      [[1, , 3], 'ff0f61034900490249044906400203'],
      [Object.assign([1, 2], { x: 9 }), 'ff0f4102490249042201784912240102'],
      [new Date(0), 'ff0f440000000000000000'],
      [new Date(1700000000123), 'ff0f4400b08756febc7842'],
      [/ab+c/gi, 'ff0f52220461622b6303'],
      [/x/u, 'ff0f5222017810'],
      [new Map<unknown, unknown>([[1, 'a'], ['b', 2]]), 'ff0f3b490222016122016249043a04'],
      [new Set([1, 2, 'x']), 'ff0f27490249042201782c03'],
    ];
    for (const [value, expected] of cases) {
      expect(hex(serialize(value)), JSON.stringify(value) || String(value)).toBe(expected);
    }
  });

  it('matches V8 on numeric array elements kinds and boxed primitives', () => {
    const { serialize } = boot().require('v8');
    const cases: [unknown, string][] = [
      // An all-int array is PACKED_SMI (ZigZag int32 per element)...
      [[1, 2], 'ff0f410249024904240002'],
      // ...but one int32 max pushes the whole array to double elements.
      [[2147483647, 2147483648], 'ff0f41024e0000c0ffffffdf414e000000000000e041240002'],
      [[1.5, 2], 'ff0f41024e000000000000f83f4e0000000000000040240002'],
      [[1, 2.5], 'ff0f41024e000000000000f03f4e0000000000000440240002'],
      [[-0], 'ff0f41014e0000000000000080240001'],
      [[true], 'ff0f410154240001'],
      [[undefined], 'ff0f41015f240001'],
      [[null], 'ff0f410130240001'],
      [['a'], 'ff0f4101220161240001'],
      [[1, 'a'], 'ff0f41024902220161240002'],
      [[new Number(1), new String('a'), new Boolean(true)], 'ff0f41036e000000000000f03f7322016179240003'],
      [new Boolean(true), 'ff0f79'],
      [new Boolean(false), 'ff0f78'],
      [new Number(42), 'ff0f6e0000000000004540'],
      [new String('s'), 'ff0f73220173'],
      [Object(7n), 'ff0f7a100700000000000000'],
    ];
    for (const [value, expected] of cases) {
      expect(hex(serialize(value))).toBe(expected);
    }
  });

  it('assigns object ids and emits references for repeats', () => {
    const { serialize, deserialize } = boot().require('v8');
    expect(hex(serialize({ a: 1, b: 1 }))).toBe('ff0f6f220161490222016249027b02');
    const shared = (() => {
      const inner = { v: 1 };
      return { a: inner, b: inner };
    })();
    expect(hex(serialize(shared))).toBe('ff0f6f2201616f22017649027b012201625e017b02');
    const self = (() => {
      const o: Record<string, unknown> = {};
      o.self = o;
      return o;
    })();
    expect(hex(serialize(self))).toBe('ff0f6f220473656c665e007b01');
    const back = deserialize(serialize(shared)) as { a: unknown; b: unknown };
    expect(back.a).toBe(back.b);
  });

  it('routes ArrayBufferViews through the host-object path', () => {
    const { serialize } = boot().require('v8');
    // Node's `DefaultSerializer` turns on
    // `setTreatArrayBufferViewsAsHostObjects`, so each view is `kHostObject`
    // plus its type index, length and bytes.
    expect(hex(serialize(new Int8Array([1, 2, 3])))).toBe('ff0f5c0003010203');
    expect(hex(serialize(new Uint8Array([1, 2, 3, 4])))).toBe('ff0f5c010401020304');
    expect(hex(serialize(new Uint8ClampedArray([1, 2])))).toBe('ff0f5c02020102');
    expect(hex(serialize(new Int16Array([1, -2])))).toBe('ff0f5c03040100feff');
    expect(hex(serialize(new Float64Array([1.5])))).toBe('ff0f5c0808000000000000f83f');
    expect(hex(serialize(new BigInt64Array([1n])))).toBe('ff0f5c0b080100000000000000');
    expect(hex(serialize(new DataView(new ArrayBuffer(8), 2, 4)))).toBe('ff0f5c090400000000');
    expect(hex(serialize(new ArrayBuffer(4)))).toBe('ff0f420400000000');
  });

  it('round-trips buffers, views and views sharing a buffer', () => {
    const { require, Buffer } = boot();
    const { serialize, deserialize } = require('v8');
    const buffer = Buffer.from([1, 2, 3]);
    expect(hex(serialize(buffer))).toBe('ff0f5c0a03010203');
    const back = deserialize(serialize(buffer)) as Uint8Array;
    expect(Buffer.isBuffer(back)).toBe(true);
    expect([...back]).toEqual([1, 2, 3]);

    const base = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = new Uint16Array(base.buffer, 2, 2);
    const restored = deserialize(serialize({ view, base })) as {
      view: Uint16Array;
      base: Uint8Array;
    };
    expect(restored.view.constructor).toBe(Uint16Array);
    expect([...restored.view]).toEqual([1027, 1541]);
    expect([...restored.base]).toEqual([1, 2, 3, 4, 5, 6]);
    // Node's host-object path is zero-copy: `_readHostObject` builds each view
    // straight over the wire buffer it was handed, so all of them share one
    // backing store (and a view's data is not the neighbouring view's data).
    expect(restored.view.buffer).toBe(restored.base.buffer);
  });

  it('serializes and restores errors', () => {
    const { serialize, deserialize } = boot().require('v8');
    // The stack is opaque to a serializer, so pin it to make the bytes stable.
    const plain = new Error('boom');
    plain.stack = 'STACK';
    expect(hex(serialize(plain))).toBe('ff0f726d2204626f6f6d732205535441434b2e');
    const type = new TypeError('');
    type.stack = 'S';
    expect(hex(serialize(type))).toBe('ff0f72546d2200732201532e');
    // A non-string stack is simply not written.
    const noStack = new Error('m');
    noStack.stack = undefined as unknown as string;
    expect(hex(serialize(noStack))).toBe('ff0f726d22016d2e');

    const restored = deserialize(serialize(plain)) as Error;
    expect(restored).toBeInstanceOf(Error);
    expect(restored.message).toBe('boom');
    expect(restored.stack).toBe('STACK');
    // The name is not part of the wire format: a custom name is lost, exactly
    // as in Node.
    const custom = new Error('m');
    custom.name = 'Custom';
    custom.stack = 'S';
    expect((deserialize(serialize(custom)) as Error).name).toBe('Error');
  });

  it('restores a self-referential cause as an object reference', () => {
    const { serialize, deserialize } = boot().require('v8');
    const error = new Error('m');
    error.stack = 'ST';
    (error as { cause?: unknown }).cause = error;
    expect(hex(serialize(error))).toBe('ff0f726d22016d7322025354635e002e');
    const restored = deserialize(serialize(error)) as Error & { cause: Error };
    expect(restored.cause).toBe(restored);
    expect(Object.keys(restored)).not.toContain('cause');
  });

  it('refuses the receivers V8 cannot clone', () => {
    const { serialize } = boot().require('v8');
    const cases: [unknown, string][] = [
      [Symbol('x'), 'Symbol(x) could not be cloned.'],
      [() => 1, '() => 1 could not be cloned.'],
      [new WeakMap(), '#<WeakMap> could not be cloned.'],
      [new WeakSet(), '#<WeakSet> could not be cloned.'],
      [Promise.resolve(1), '#<Promise> could not be cloned.'],
      [new SharedArrayBuffer(4), '#<SharedArrayBuffer> could not be cloned.'],
      [[][Symbol.iterator](), '[object Array Iterator] could not be cloned.'],
    ];
    for (const [value, message] of cases) {
      expect(() => serialize(value), message).toThrow(message);
    }
  });

  it('serializes through the low-level Serializer with real views', () => {
    const v8 = boot().require('v8');
    const { Serializer, Deserializer } = v8;
    const ser = new Serializer();
    ser.writeHeader();
    ser.writeValue(new Uint8Array([1, 2, 3]));
    const bytes = ser.releaseBuffer() as Uint8Array;
    // Without `setTreatArrayBufferViewsAsHostObjects` the buffer is written
    // first and an `kArrayBufferView` tag describes the window into it.
    expect(hex(bytes)).toBe('ff0f42030102035642000300');
    // `releaseBuffer` empties the serializer, like V8's `Release()`.
    expect((ser.releaseBuffer() as Uint8Array).length).toBe(0);

    const der = new Deserializer(bytes);
    der.readHeader();
    expect(der.getWireFormatVersion()).toBe(15);
    const view = der.readValue() as Uint8Array;
    expect(view.constructor).toBe(Uint8Array);
    expect([...view]).toEqual([1, 2, 3]);

    // Without `readHeader` the version is still 0 and reading fails, exactly as
    // in Node (the header is what installs the format version).
    const unread = new Deserializer(bytes);
    expect(unread.getWireFormatVersion()).toBe(0);
    expect(() => unread.readValue()).toThrow('Unable to deserialize cloned data.');
  });

  it('honours transferArrayBuffer on both sides', () => {
    const v8 = boot().require('v8');
    const buffer = new ArrayBuffer(4);
    const ser = new v8.Serializer();
    ser.writeHeader();
    ser.transferArrayBuffer(7, buffer);
    ser.writeValue(buffer);
    const bytes = ser.releaseBuffer() as Uint8Array;
    expect(hex(bytes)).toBe('ff0f7407');

    const der = new v8.Deserializer(bytes);
    der.readHeader();
    der.transferArrayBuffer(7, buffer);
    expect(der.readValue()).toBe(buffer);
  });

  it('reports invalid input the way Node does', () => {
    const { require, Buffer } = boot();
    const v8 = require('v8');
    const fromHex = (input: string): Uint8Array =>
      Buffer.from(input, 'hex') as unknown as Uint8Array;
    expect(() => new v8.Deserializer('nope')).toThrow(TypeError);
    expect(() => new v8.Deserializer('nope')).toThrow(/buffer/);
    const bad = (input: string, message: string): void => {
      expect(() => v8.deserialize(fromHex(input))).toThrow(message);
    };
    const versionError = 'Unable to deserialize cloned data due to invalid or unsupported version.';
    bad('', versionError);
    bad('5f', versionError);
    bad('ff00', versionError);
    bad('ff14', versionError);
    // A valid header with nothing behind it is the generic failure.
    bad('ff0f', 'Unable to deserialize cloned data.');
    bad('ff0f99', 'Unable to deserialize cloned data.');
    bad('ff0f5e05', 'Unable to deserialize cloned data.');
    // Padding bytes between tags are skipped.
    expect(v8.deserialize(fromHex('ff0f005f'))).toBeUndefined();
  });

  it('answers the questions a page can answer honestly', () => {
    const v8 = boot().require('v8');
    expect(typeof v8.cachedDataVersionTag()).toBe('number');
    expect(v8.isStringOneByteRepresentation('abc')).toBe(true);
    expect(v8.isStringOneByteRepresentation('中')).toBe(false);
    expect(() => v8.setFlagsFromString('--no-opt')).not.toThrow();
  });

  it('throws loudly for the V8 internals a page cannot reach', () => {
    const v8 = boot().require('v8');
    const notImplemented = /is not implemented/;
    expect(() => v8.getHeapStatistics()).toThrow(notImplemented);
    expect(() => v8.getHeapSpaceStatistics()).toThrow(notImplemented);
    expect(() => v8.getHeapCodeStatistics()).toThrow(notImplemented);
    expect(() => v8.getHeapSnapshot()).toThrow(notImplemented);
    expect(() => v8.writeHeapSnapshot()).toThrow(notImplemented);
    expect(() => v8.queryObjects(Object)).toThrow(notImplemented);
    expect(() => v8.startCpuProfile({})).toThrow(notImplemented);
    expect(() => new v8.GCProfiler().start()).toThrow(notImplemented);
  });

  it('exposes the startup-snapshot namespace without pretending to build one', () => {
    const v8 = boot().require('v8');
    // Real Node exposes the `isBuildingSnapshotBuffer` byte, so `[0]` is the
    // number 0, not `false`.
    expect(v8.startupSnapshot.isBuildingSnapshot()).toBe(0);
    expect(() => v8.startupSnapshot.addSerializeCallback(() => {})).toThrow(
      /not building startup snapshot/,
    );
  });

  it('exposes promise hooks backed by the real async_hooks binding', () => {
    const v8 = boot().require('v8');
    // The `promiseHooks` namespace is Node's real `internal/promise_hooks`
    // module. Registering a hook is accepted; V8 never reports promise events
    // to JS embedders, so the hooks simply never fire (documented deviation).
    expect(typeof v8.promiseHooks.onInit).toBe('function');
    expect(typeof v8.promiseHooks.createHook).toBe('function');
    expect(() => v8.promiseHooks.onInit(() => {})).not.toThrow();
  });
});
