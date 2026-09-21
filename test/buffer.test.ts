import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Buffer semantics, checked against a real Node v26.9.0.
 *
 * The load-bearing distinction is aliasing vs copying: `slice`/`subarray` and
 * `from(ArrayBuffer)` hand back views over the same memory, while
 * `from(string|Buffer|TypedArray)` copies. A parser that slices a frame out of
 * a read buffer and later reuses it depends on exactly this.
 */
interface BufferCtor {
  new (size: number): Uint8Array;
  poolSize: number;
  from(value: unknown, encodingOrOffset?: unknown, length?: unknown): Uint8Array & {
    slice(a?: number, b?: number): Uint8Array;
    subarray(a?: number, b?: number): Uint8Array;
    toString(enc?: string): string;
    byteOffset: number;
  };
  alloc(size: number, fill?: unknown, encoding?: string): Uint8Array;
  allocUnsafe(size: number): Uint8Array;
  allocUnsafeSlow(size: number): Uint8Array;
  concat(list: readonly Uint8Array[], totalLength?: number): Uint8Array;
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

describe('buffer pool (matching Node)', () => {
  it('poolSize is Node’s 64 KiB, and small allocUnsafe draws from one slab', () => {
    const { Buffer } = boot();
    expect(Buffer.poolSize).toBe(65536);

    const a = Buffer.allocUnsafe(10);
    const b = Buffer.allocUnsafe(10);
    expect(a.buffer).toBe(b.buffer); // one backing store
    expect(a.buffer.byteLength).toBe(Buffer.poolSize + 64); // over-allocated for alignment
    expect(a.byteOffset % 8).toBe(0);
    expect(b.byteOffset % 8).toBe(0);
    expect(b.byteOffset).toBeGreaterThanOrEqual(a.byteOffset + a.length); // no overlap
  });

  it('alloc and allocUnsafeSlow own an exactly-sized backing store', () => {
    const { Buffer } = boot();
    const pooled = Buffer.allocUnsafe(10);
    const owned = Buffer.alloc(10);
    const slow = Buffer.allocUnsafeSlow(10);
    for (const buf of [owned, slow]) {
      expect(buf.buffer).not.toBe(pooled.buffer);
      expect(buf.byteOffset).toBe(0);
      expect(buf.buffer.byteLength).toBe(10);
    }
    expect([...owned]).toEqual(new Array(10).fill(0)); // alloc zero-fills
  });

  it('from(string) and from(Buffer) copy into the pool', () => {
    const { Buffer } = boot();
    const pool = Buffer.allocUnsafe(1).buffer;

    const fromStr = Buffer.from('hi');
    expect(fromStr.buffer).toBe(pool);
    expect(fromStr.toString()).toBe('hi');

    const source = Buffer.from([1, 2, 3]);
    const copied = Buffer.from(source);
    expect(copied.buffer).toBe(pool);
    copied[0] = 42;
    expect(source[0]).toBe(1); // still a copy of the contents
  });

  it('from(TypedArray) copies into the pool too', () => {
    const { Buffer } = boot();
    const pool = Buffer.allocUnsafe(1).buffer;
    const u8 = new Uint8Array([1, 2, 3]);
    const buf = Buffer.from(u8);
    expect(buf.buffer).toBe(pool);
    buf[0] = 42;
    expect(u8[0]).toBe(1);
  });

  it('concat draws from the pool and zero-fills an over-long totalLength', () => {
    const { Buffer } = boot();
    const pool = Buffer.allocUnsafe(1).buffer;

    const joined = Buffer.concat([Buffer.from('ab'), Buffer.from('cd')]);
    expect(joined.buffer).toBe(pool);
    expect(joined.toString()).toBe('abcd');

    const padded = Buffer.concat([Buffer.from('ab')], 4);
    expect(padded.length).toBe(4);
    expect([...padded]).toEqual([97, 98, 0, 0]);
  });

  it('a request at half the pool size bypasses the pool', () => {
    const { Buffer } = boot();
    const big = Buffer.allocUnsafe(Buffer.poolSize >>> 1);
    expect(big.buffer.byteLength).toBe(Buffer.poolSize >>> 1);
    expect(big.byteOffset).toBe(0);
  });

  it('zero-length buffers never allocate a backing store', () => {
    const { Buffer } = boot();
    for (const b of [Buffer.alloc(0), Buffer.allocUnsafe(0), Buffer.from('')]) {
      expect(b.length).toBe(0);
      expect(b.buffer.byteLength).toBe(0);
    }
  });

  it('a slice of a pooled buffer still aliases the pool', () => {
    const { Buffer } = boot();
    const pooled = Buffer.allocUnsafe(12);
    const view = pooled.subarray(2, 6);
    expect(view.buffer).toBe(pooled.buffer);
    expect(view.byteOffset).toBe(pooled.byteOffset + 2);
    view[0] = 99;
    expect(pooled[2]).toBe(99);
  });
});
