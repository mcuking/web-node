import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `string_decoder` is Node's real `lib/string_decoder.js` now, on a JS port of
 * `src/string_decoder.cc`. Every expected string below was read off a real
 * Node v26.9.0 first — including the streaming edge cases (a multi-byte UTF-8
 * character split across chunks, a split surrogate pair, base64 holding back
 * 1–2 bytes) and the legacy `lastChar`/`lastNeed`/`lastTotal` fields.
 */
interface BufferCtor {
  new (size: number): Uint8Array;
  from(value: unknown, encodingOrOffset?: unknown, length?: unknown): Uint8Array;
  isBuffer(v: unknown): boolean;
}

interface Realm {
  require(id: string): any;
}

function boot(): { realm: Realm; Buffer: BufferCtor } {
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
  const realm = runtime.realm as unknown as Realm;
  const Buffer = (realm.require('buffer') as { Buffer: BufferCtor }).Buffer;
  return { realm, Buffer };
}

/** Feed chunks through a decoder, returning `write()` results + `end()`. */
function seq(realm: Realm, Buffer: BufferCtor, encoding: string | undefined, chunks: number[][]): string[] {
  const { StringDecoder } = realm.require('string_decoder');
  const d = new StringDecoder(encoding);
  const out: string[] = chunks.map((c) => d.write(Buffer.from(c)));
  out.push(d.end());
  return out;
}

describe('vendored: string_decoder', () => {
  it('exposes the real module surface', () => {
    const { realm } = boot();
    expect(Object.keys(realm.require('string_decoder'))).toEqual(['StringDecoder']);
  });

  it('normalizes encoding names like Node', () => {
    const { realm } = boot();
    const { StringDecoder } = realm.require('string_decoder');
    expect(new StringDecoder().encoding).toBe('utf8');
    expect(new StringDecoder('utf8').encoding).toBe('utf8');
    expect(new StringDecoder('UTF-8').encoding).toBe('utf8');
    expect(new StringDecoder('ucs2').encoding).toBe('utf16le');
    expect(new StringDecoder('utf-16le').encoding).toBe('utf16le');
    expect(new StringDecoder('binary').encoding).toBe('latin1');
    expect(new StringDecoder('base64url').encoding).toBe('base64url');
    // A string argument is returned verbatim (only ArrayBuffer views decode).
    expect(new StringDecoder('utf8').write('hé')).toBe('hé');
  });

  it('throws ERR_UNKNOWN_ENCODING, like Node', () => {
    const { realm } = boot();
    const { StringDecoder } = realm.require('string_decoder');
    let err: any;
    try {
      new StringDecoder('bogus');
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe('ERR_UNKNOWN_ENCODING');
    expect(err.message).toBe('Unknown encoding: bogus');
  });

  it('throws ERR_INVALID_ARG_TYPE for a non-view argument', () => {
    const { realm } = boot();
    const { StringDecoder } = realm.require('string_decoder');
    let err: any;
    try {
      new StringDecoder('utf8').write(5 as unknown as Uint8Array);
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe('ERR_INVALID_ARG_TYPE');
  });

  it('decodes single-chunk input for every encoding', () => {
    const { realm, Buffer } = boot();
    expect(seq(realm, Buffer, 'utf8', [[0xe2, 0x82, 0xac]])).toEqual(['€', '']);
    expect(seq(realm, Buffer, 'hex', [[1, 2, 255]])).toEqual(['0102ff', '']);
    expect(seq(realm, Buffer, 'latin1', [[0x41, 0xff, 0x42]])).toEqual(['A\u00ffB', '']);
    // ascii forces the high bit off (0xFF -> 0x7F).
    expect(seq(realm, Buffer, 'ascii', [[0x41, 0xff, 0x42]])).toEqual(['A\u007fB', '']);
    expect(seq(realm, Buffer, 'utf16le', [[0x61, 0x00, 0x62, 0x00]])).toEqual(['ab', '']);
  });

  it('holds back a UTF-8 character split across chunks', () => {
    const { realm, Buffer } = boot();
    // € (E2 82 AC) split 2+1.
    expect(seq(realm, Buffer, 'utf8', [[0xe2, 0x82], [0xac]])).toEqual(['', '€', '']);
    // A chunk that ends mid-character, with data on both sides.
    expect(seq(realm, Buffer, 'utf8', [[0x61, 0xe2, 0x82], [0xac, 0x62]])).toEqual(['a', '€b', '']);
    // 4-byte emoji (F0 9F 98 80) split 2+2 and 1+3.
    expect(seq(realm, Buffer, 'utf8', [[0xf0, 0x9f], [0x98, 0x80]])).toEqual(['', '😀', '']);
    expect(seq(realm, Buffer, 'utf8', [[0xf0], [0x9f, 0x98, 0x80]])).toEqual(['', '😀', '']);
  });

  it('emits U+FFFD for an incomplete character at end()', () => {
    const { realm, Buffer } = boot();
    expect(seq(realm, Buffer, 'utf8', [[0xe2, 0x82]])).toEqual(['', '\uFFFD']);
    // A lone continuation byte is replaced too.
    expect(seq(realm, Buffer, 'utf8', [[0x80, 0x41]])).toEqual(['\uFFFDA', '']);
    // >4 trailing bytes is invalid UTF-8; the engine decoder handles it.
    expect(seq(realm, Buffer, 'utf8', [[0xff, 0x80, 0x80, 0x80, 0x80, 0x41]])).toEqual([
      '\uFFFD\uFFFD\uFFFD\uFFFD\uFFFDA',
      '',
    ]);
  });

  it('holds back 1–2 bytes for base64 / base64url', () => {
    const { realm, Buffer } = boot();
    expect(seq(realm, Buffer, 'base64', [[1, 2]])).toEqual(['', 'AQI=']);
    expect(seq(realm, Buffer, 'base64', [[1, 2, 3]])).toEqual(['AQID', '']);
    expect(seq(realm, Buffer, 'base64', [[1, 2, 3, 4, 5]])).toEqual(['AQID', 'BAU=']);
    expect(seq(realm, Buffer, 'base64', [[1, 2, 3, 4, 5, 6, 7]])).toEqual(['AQIDBAUG', 'Bw==']);
    // base64url is unpadded.
    expect(seq(realm, Buffer, 'base64url', [[1, 2]])).toEqual(['', 'AQI']);
    expect(seq(realm, Buffer, 'base64url', [[251, 255, 190]])).toEqual(['-_--', '']);
    expect(seq(realm, Buffer, 'base64url', [[1, 2, 3, 4, 5]])).toEqual(['AQID', 'BAU']);
  });

  it('ignores a single trailing byte for utf16le', () => {
    const { realm, Buffer } = boot();
    expect(seq(realm, Buffer, 'utf16le', [[0x61, 0x00, 0x62]])).toEqual(['a', '']);
  });

  it('accepts any ArrayBuffer view, not just Buffer', () => {
    const { realm } = boot();
    const { StringDecoder } = realm.require('string_decoder');
    expect(new StringDecoder('utf8').write(new Uint8Array([0x61, 0x62]))).toBe('ab');
    const dv = new DataView(new Uint8Array([0x61, 0x62]).buffer);
    expect(new StringDecoder('utf8').write(dv)).toBe('ab');
  });

  it('keeps the legacy lastChar / lastNeed / lastTotal fields', () => {
    const { realm, Buffer } = boot();
    const { StringDecoder } = realm.require('string_decoder');
    const d = new StringDecoder('utf8');
    d.write(Buffer.from([0xe2, 0x82]));
    expect(Array.from(d.lastChar)).toEqual([0xe2, 0x82, 0, 0]);
    expect(Buffer.isBuffer(d.lastChar)).toBe(true);
    expect(d.lastNeed).toBe(1);
    expect(d.lastTotal).toBe(3);

    const d2 = new StringDecoder('utf8');
    d2.write(Buffer.from([0xe2, 0x82, 0xac]));
    expect(Array.from(d2.lastChar)).toEqual([0, 0, 0, 0]);
    expect(d2.lastNeed).toBe(0);
    expect(d2.lastTotal).toBe(0);
  });

  it('supports end(buf) and the legacy text(buf, offset)', () => {
    const { realm, Buffer } = boot();
    const { StringDecoder } = realm.require('string_decoder');
    expect(new StringDecoder('utf8').end(Buffer.from([0x61]))).toBe('a');
    const d = new StringDecoder('utf8');
    expect(d.text(Buffer.from([0x61, 0x62, 0x63]), 1)).toBe('bc');
  });
});
