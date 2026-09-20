import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Buffer semantics, checked against a real Node v22.
 *
 * The load-bearing distinction is aliasing vs copying: `slice`/`subarray` and
 * `from(ArrayBuffer)` hand back views over the same memory, while
 * `from(string|Buffer|TypedArray)` copies. A parser that slices a frame out of
 * a read buffer and later reuses it depends on exactly this.
 */
interface BufferCtor {
  new (size: number): Uint8Array;
  from(value: unknown, encodingOrOffset?: unknown, length?: unknown): Uint8Array & {
    slice(a?: number, b?: number): Uint8Array;
    subarray(a?: number, b?: number): Uint8Array;
    toString(enc?: string): string;
    byteOffset: number;
  };
  isBuffer(v: unknown): boolean;
}

function boot(): { Buffer: BufferCtor } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  const bufferModule = runtime.realm.require('buffer') as unknown as { Buffer: BufferCtor };
  return { Buffer: bufferModule.Buffer };
}

describe('buffer (aliasing, matching Node)', () => {
  it('slice returns a Buffer view that shares the backing store', () => {
    const { Buffer } = boot();
    const original = Buffer.from([1, 2, 3, 4, 5]);
    const sliced = original.slice(1, 4);

    expect(Buffer.isBuffer(sliced)).toBe(true);
    expect(sliced.length).toBe(3);
    expect(sliced.byteOffset - original.byteOffset).toBe(1);

    sliced[0] = 99;
    expect(original[1]).toBe(99); // write through the view
    original[1] = 77;
    expect(sliced[0]).toBe(77); // read back through the view
  });

  it('subarray also aliases', () => {
    const { Buffer } = boot();
    const original = Buffer.from([1, 2, 3, 4, 5]);
    const sub = original.subarray(1, 4);
    expect(Buffer.isBuffer(sub)).toBe(true);
    sub[0] = 99;
    expect(original[1]).toBe(99);
  });

  it('slice/subarray clamp negatives and out-of-range indices', () => {
    const { Buffer } = boot();
    const a = Buffer.from('abcdef');
    expect(a.slice(-3).toString()).toBe('def');
    expect(a.slice(2, -1).toString()).toBe('cde');
    expect(a.subarray(-2).toString()).toBe('ef');
    expect(a.slice(4, 2).toString()).toBe('');
    expect(a.slice(100).toString()).toBe('');
  });

  it('from(ArrayBuffer) is a view; from(string|Buffer|Uint8Array) copies', () => {
    const { Buffer } = boot();

    const ab = new ArrayBuffer(4);
    const raw = new Uint8Array(ab);
    raw.set([1, 2, 3, 4]);
    const fromAb = Buffer.from(ab);
    fromAb[0] = 42;
    expect(raw[0]).toBe(42); // shares
    expect(fromAb.byteLength).toBe(4);

    const bufSrc = Buffer.from([1, 2, 3]);
    const fromBuf = Buffer.from(bufSrc);
    fromBuf[0] = 42;
    expect(bufSrc[0]).toBe(1); // copies

    const u8 = new Uint8Array([1, 2, 3]);
    const fromU8 = Buffer.from(u8);
    fromU8[0] = 42;
    expect(u8[0]).toBe(1); // copies
  });

  it('from(ArrayBuffer, offset, length) is a windowed view', () => {
    const { Buffer } = boot();
    const ab = new ArrayBuffer(8);
    const raw = new Uint8Array(ab);
    raw.set([1, 2, 3, 4, 5, 6, 7, 8]);

    const view = Buffer.from(ab, 2, 3);
    expect(view.toString('hex')).toBe('030405');
    view[0] = 42;
    expect(raw[2]).toBe(42); // shares
  });
});
