import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * The vendored `lib/buffer.js` + `lib/internal/buffer.js` codecs and search,
 * checked against a real Node v26.9.0 (the oracle). These exercise the whole
 * `buffer` binding surface — the per-encoding slice/write codecs, `indexOf`
 * (string / Buffer / UCS2), the byte swaps, `fill`, `compare`, `isAscii`/
 * `isUtf8`, `transcode` and `btoa`/`atob`.
 *
 * See tools/vendor.mjs + vendor/node-lib/MANIFEST.json for provenance.
 */
interface BufferInstance {
  readonly length: number;
  readonly byteOffset: number;
  readonly buffer: { byteLength: number };
  [index: number]: number;
  toString(enc?: string): string;
  subarray(a?: number, b?: number): BufferInstance;
  slice(a?: number, b?: number): BufferInstance;
  fill(value: unknown, encoding?: unknown): BufferInstance;
  swap16(): BufferInstance;
  swap32(): BufferInstance;
  swap64(): BufferInstance;
  indexOf(v: unknown, enc?: unknown): number;
  lastIndexOf(v: unknown, enc?: unknown): number;
}

interface BufferCtor {
  from(value: unknown, encodingOrOffset?: unknown, length?: unknown): BufferInstance;
  alloc(size: number, fill?: unknown, encoding?: string): BufferInstance;
  allocUnsafe(size: number): BufferInstance;
  allocUnsafeSlow(size: number): BufferInstance;
  byteLength(value: string, encoding?: string): number;
  isBuffer(v: unknown): boolean;
  poolSize: number;
}

interface BufferModule {
  Buffer: BufferCtor;
  transcode(source: BufferInstance, from: string, to: string): BufferInstance;
  isUtf8(v: BufferInstance): boolean;
  isAscii(v: BufferInstance): boolean;
  kMaxLength: number;
  kStringMaxLength: number;
  btoa(input: string): string;
  atob(input: string): string;
  constants: { MAX_LENGTH: number; MAX_STRING_LENGTH: number };
  INSPECT_MAX_BYTES: number;
}

function boot(): BufferModule {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('buffer') as unknown as BufferModule;
}

describe('buffer module surface (matching Node)', () => {
  it('exports the same keys as Node', () => {
    const B = boot();
    expect(Object.keys(B)).toEqual([
      'Buffer',
      'transcode',
      'isUtf8',
      'isAscii',
      'kMaxLength',
      'kStringMaxLength',
      'btoa',
      'atob',
      'constants',
      'INSPECT_MAX_BYTES',
      'Blob',
      'resolveObjectURL',
      'File',
    ]);
    expect(B.kMaxLength).toBe(Number.MAX_SAFE_INTEGER);
    expect(B.kStringMaxLength).toBe(536870888);
    expect(B.constants).toEqual({
      MAX_LENGTH: 9007199254740991,
      MAX_STRING_LENGTH: 536870888,
    });
    expect(B.INSPECT_MAX_BYTES).toBe(50);
  });
});

describe('buffer codecs (matching Node v26.9.0)', () => {
  const bytes = [0x00, 0x41, 0x7f, 0x80, 0xc3, 0xa9, 0xff, 0xe4, 0xb8, 0xad];

  it('encodes hex/base64/base64url and the lossy text encodings', () => {
    const { Buffer } = boot();
    const buf = Buffer.from(bytes);
    expect(buf.toString('hex')).toBe('00417f80c3a9ffe4b8ad');
    expect(buf.toString('base64')).toBe('AEF/gMOp/+S4rQ==');
    expect(buf.toString('base64url')).toBe('AEF_gMOp_-S4rQ');
    // ascii masks every byte with 0x7f (0x80->0, 0xc3->'C', 0xa9->')', 0xff->DEL, ...).
    expect(buf.toString('ascii')).toBe(
      String.fromCharCode(0x00, 0x41, 0x7f, 0x00, 0x43, 0x29, 0x7f, 0x64, 0x38, 0x2d),
    );
    // latin1 is a straight byte->code point map.
    expect(buf.toString('latin1')).toBe(
      String.fromCharCode(0x00, 0x41, 0x7f, 0x80, 0xc3, 0xa9, 0xff, 0xe4, 0xb8, 0xad),
    );
    // utf8 substitutes U+FFFD for the lone 0x80 and 0xff, decoding é and 中.
    expect(buf.toString('utf8')).toBe(
      String.fromCharCode(0x00, 0x41, 0x7f, 0xfffd, 0xe9, 0xfffd, 0x4e2d),
    );
  });

  it('decodes ascii & latin1 asymmetrically (ascii masks 0x7f)', () => {
    const { Buffer } = boot();
    expect(Buffer.from([0xe9]).toString('ascii')).toBe('i');
    expect(Buffer.from([0xe9]).toString('latin1')).toBe('é');
  });

  it('decodes an odd-length hex string by dropping the trailing nibble', () => {
    const { Buffer } = boot();
    expect(Buffer.from('020304', 'hex').toString('hex')).toBe('020304');
    // A trailing single nibble is ignored on write.
    expect(Buffer.alloc(4).fill('abc', 'hex').subarray(0, 1).toString('hex')).toBe('ab');
  });

  it('measures byteLength per encoding', () => {
    const { Buffer } = boot();
    expect(Buffer.byteLength('中abc', 'utf8')).toBe(6);
    expect(Buffer.byteLength('é', 'latin1')).toBe(1);
  });
});

describe('buffer search (matching Node v26.9.0)', () => {
  it('finds substrings in utf8 and ucs2', () => {
    const { Buffer } = boot();
    const hay = Buffer.from('abcdefabcdef');
    expect(hay.indexOf('def')).toBe(3);
    expect(hay.lastIndexOf('f')).toBe(11);
    expect(Buffer.from('abc', 'ucs2').indexOf('c', 'ucs2')).toBe(4);
  });

  it('finds a Buffer needle', () => {
    const { Buffer } = boot();
    expect(Buffer.from('abcdefabcdef').indexOf(Buffer.from('def'))).toBe(3);
  });
});

describe('buffer byte swaps (matching Node v26.9.0)', () => {
  it('swaps 16/32/64-bit words', () => {
    const { Buffer } = boot();
    expect(Buffer.from('0102030405060708', 'hex').swap16().toString('hex')).toBe('0201040306050807');
    expect(Buffer.from('0102030405060708', 'hex').swap32().toString('hex')).toBe('0403020108070605');
    expect(Buffer.from('0102030405060708', 'hex').swap64().toString('hex')).toBe('0807060504030201');
  });
});

describe('buffer fill (matching Node v26.9.0)', () => {
  it('tiles hex, multibyte utf8 and latin1 fills', () => {
    const { Buffer } = boot();
    expect(Buffer.alloc(6).fill('ab', 'hex').toString('hex')).toBe('abababababab');
    expect(Buffer.alloc(8).fill('中').toString('hex')).toBe('e4b8ade4b8ade4b8');
    expect(Buffer.alloc(3).fill('abc', 'latin1').toString('hex')).toBe('616263');
  });
});

describe('buffer detection (matching Node v26.9.0)', () => {
  it('isAscii / isUtf8', () => {
    const B = boot();
    const Buf = B.Buffer;
    expect(B.isAscii(Buf.from([0x41, 0x7f]))).toBe(true);
    expect(B.isAscii(Buf.from([0x80]))).toBe(false);
    expect(B.isUtf8(Buf.from([0xe4, 0xb8, 0xad]))).toBe(true);
    expect(B.isUtf8(Buf.from([0xff]))).toBe(false);
  });
});

describe('Buffer.transcode (matching Node v26.9.0)', () => {
  it('converts between utf8/ucs2/ascii/latin1', () => {
    const B = boot();
    const Buf = B.Buffer;
    const tc = (f: string, t: string, arr: number[]) =>
      B.transcode(Buf.from(arr), f, t).toString('hex');
    expect(tc('ascii', 'utf8', [0x41, 0xff])).toBe('41efbfbd');
    expect(tc('utf8', 'ascii', [0xe4, 0xb8, 0xad])).toBe('3f');
    expect(tc('utf8', 'ucs2', [0xe4, 0xb8, 0xad])).toBe('2d4e');
    expect(tc('ucs2', 'utf8', [0x2d, 0x4e])).toBe('e4b8ad');
    expect(tc('latin1', 'utf16le', [0xe9])).toBe('e900');
    expect(tc('utf8', 'latin1', [0x41, 0xe4, 0xb8, 0xad, 0x42])).toBe('413f42');
  });

  it('returns a Buffer and throws an ICU-coded error for a bad encoding', () => {
    const B = boot();
    const Buf = B.Buffer;
    expect(Buf.isBuffer(B.transcode(Buf.from([0x61]), 'utf8', 'latin1'))).toBe(true);
    expect(() => B.transcode(Buf.from('x'), 'weird', 'utf8')).toThrowError(
      /Unable to transcode Buffer \[U_ILLEGAL_ARGUMENT_ERROR\]/,
    );
    try {
      B.transcode(Buf.from('x'), 'weird', 'utf8');
    } catch (e: unknown) {
      expect((e as { code?: string }).code).toBe('U_ILLEGAL_ARGUMENT_ERROR');
    }
  });
});

describe('btoa / atob (matching Node v26.9.0)', () => {
  it('round-trips base64 and rejects high code points', () => {
    const B = boot();
    expect(B.atob('aGVsbG8=')).toBe('hello');
    expect(() => B.btoa('\u0100')).toThrowError(/Invalid character/);
  });
});

describe('allocUnsafeSlow sizing (matching Node v26.9.0)', () => {
  it('owns an exactly-sized backing store', () => {
    const { Buffer } = boot();
    expect(Buffer.allocUnsafeSlow(64).buffer.byteLength).toBe(64);
    expect(Buffer.allocUnsafeSlow(65).buffer.byteLength).toBe(65);
  });
});
