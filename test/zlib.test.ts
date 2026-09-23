/**
 * `zlib` — deflate/gzip over the **real zlib**, compiled to WebAssembly (M116).
 *
 * Node's zlib is a native binding over the C zlib. Here the same upstream C source
 * (`deps/zlib`) is built with wasi-sdk and reached through `internalBinding('zlib')`,
 * so — unlike the previous `CompressionStream` shim — the synchronous API and every
 * codec parameter are available, and every byte must match Node v26.9.0.
 *
 * The gate is a shared observation program (`tools/zlib-probe.cjs`) run both on a
 * real Node oracle (which produced `test/fixtures/zlib.json`) and inside web-node:
 * the two JSON blobs must be **equal**. The focused checks below exist so a
 * failure points at *what* drifted.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const encoder = new TextEncoder();
const expected = JSON.parse(readFileSync('test/fixtures/zlib.json', 'utf8')) as Record<string, unknown>;

/**
 * Run a script inside the runtime and collect everything it prints, waiting
 * until the output stops growing (or a deadline passes).
 */
function runBody(body: string, waitMs = 4000): Promise<string[]> {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', encoder.encode(body));
  const lines: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (chunk) => lines.push(chunk),
    onStderr: (chunk) => lines.push(chunk),
  });
  runtime.runMain('/project/index.js');
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs;
    let joined = '';
    let stable = 0;
    const poll = (): void => {
      const now = lines.join('');
      if (now !== joined) {
        joined = now;
        stable = 0;
      } else if (now.length > 0 && ++stable >= 8) {
        resolve(joined.split('\n').filter((line) => line.length > 0));
        return;
      }
      if (Date.now() > deadline) {
        resolve(joined.split('\n').filter((line) => line.length > 0));
        return;
      }
      setTimeout(poll, 20);
    };
    setTimeout(poll, 20);
  });
}

/** Evaluate a snippet that reports one value through `__report`; return it. */
async function evaluate(snippet: string): Promise<unknown> {
  const body = `const zlib = require('zlib');\nconst __report = (v) => console.log('RESULT ' + JSON.stringify(v));\n${snippet}\n`;
  const lines = await runBody(body);
  const line = lines.find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('no RESULT line; output was:\n' + lines.join('\n'));
  return JSON.parse(line.slice('RESULT '.length));
}

describe('zlib', () => {
  it('matches the real-Node oracle on the shared observation corpus', async () => {
    const probe = readFileSync('tools/zlib-probe.cjs', 'utf8');
    const lines = await runBody(probe, 8000);
    const line = lines.find((l) => l.startsWith('__OBS__'));
    expect(line, 'the probe produced no __OBS__ line').toBeTruthy();
    const observed = JSON.parse((line as string).slice('__OBS__'.length)) as Record<string, unknown>;
    // Compare key-by-key so a mismatch names the field instead of dumping two blobs.
    expect(Object.keys(observed).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      expect(observed[key], `field "${key}"`).toEqual(expected[key]);
    }
  }, 30000);

  it('hex-encodes gzip/deflate exactly like Node for the default options', async () => {
    const result = await evaluate(`
      __report({
        gzip: zlib.gzipSync('hello hello hello hello').toString('hex'),
        empty: zlib.gzipSync(Buffer.alloc(0)).toString('hex'),
        deflate: zlib.deflateSync('hello hello hello hello').toString('hex'),
        deflateRaw: zlib.deflateRawSync('hello hello hello hello').toString('hex'),
      });`);
    // The gzip OS byte (offset 9) is platform metadata; the oracle masks it to 0.
    const masked = { ...(result as Record<string, string>) };
    for (const key of ['gzip', 'empty']) {
      const bytes = masked[key];
      masked[key] = bytes.slice(0, 18) + '00' + bytes.slice(20);
    }
    expect(masked).toEqual({
      gzip: (expected.sync as Record<string, string>).gzipHello,
      empty: (expected.sync as Record<string, string>).gzipEmpty,
      deflate: (expected.sync as Record<string, string>).deflateHello,
      deflateRaw: (expected.sync as Record<string, string>).deflateRawHello,
    });
  });

  it('stamps the gzip OS byte with zlib\'s Unix default, not a host-specific one', async () => {
    const result = await evaluate(`__report([zlib.gzipSync('x')[9], zlib.gzipSync(Buffer.alloc(0))[9]]);`);
    expect(result).toEqual([3, 3]);
  });

  it('round-trips through the sync API', async () => {
    const result = await evaluate(`
      const fox = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(300));
      const hello = 'hello hello hello hello';
      __report({
        gzip: zlib.gunzipSync(zlib.gzipSync(fox)).equals(fox),
        inflate: zlib.inflateSync(zlib.deflateSync(fox)).equals(fox),
        inflateRaw: zlib.inflateRawSync(zlib.deflateRawSync(fox)).equals(fox),
        unzipGzip: zlib.unzipSync(zlib.gzipSync(hello)).toString(),
        unzipZlib: zlib.unzipSync(zlib.deflateSync(hello)).toString(),
      });`);
    expect(result).toEqual(expected.syncRoundtrip);
  });

  it('honors the codec parameters instead of ignoring them', async () => {
    // The previous shim threw on every non-default parameter; now `level` changes
    // the output and `dictionary` round-trips, exactly as Node does.
    const result = await evaluate(`
      const fox = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(300));
      const dict = Buffer.from('quick brown fox jumps');
      const withDict = zlib.deflateSync(fox, { dictionary: dict });
      __report({
        level0: zlib.deflateSync(fox, { level: 0 }).length,
        level9: zlib.deflateSync(fox, { level: 9 }).length,
        level0Differs: !zlib.deflateSync(fox, { level: 0 }).equals(zlib.deflateSync(fox, { level: 9 })),
        raw: zlib.deflateRawSync(fox, { level: 9, windowBits: 11, memLevel: 9, strategy: 1 }).length,
        dictLen: withDict.length,
        dictRoundtrip: zlib.inflateSync(withDict, { dictionary: dict }).equals(fox),
        dictRawRoundtrip: zlib.inflateRawSync(
          zlib.deflateRawSync(fox, { dictionary: dict }),
          { dictionary: dict },
        ).equals(fox),
      });`);
    expect(result).toEqual({
      level0: 13511,
      level9: 107,
      level0Differs: true,
      raw: Number((expected.rawParams as string).split(':')[0]),
      dictLen: Number((expected.dictDeflate as string).split(':')[0]),
      dictRoundtrip: expected.dictInflate,
      dictRawRoundtrip: expected.dictRawInflate,
    });
  });

  it('computes CRC-32 like Node', async () => {
    const result = await evaluate(`
      __report([
        zlib.crc32('hello'),
        zlib.crc32(Buffer.from('hello')),
        zlib.crc32(Buffer.from('hello'), 0xffffffff),
        zlib.crc32(''),
        zlib.crc32('', 7),
      ]);`);
    expect(result).toEqual(expected.crc);
  });

  it('reports decode failures exactly like Node', async () => {
    const result = await evaluate(`
      const err = (fn) => { try { fn(); return 'no-error'; } catch (e) { return [e.name, e.code, e.errno, e.message].join('|'); } };
      __report({
        badGzip: err(() => zlib.gunzipSync(Buffer.from('not gzip'))),
        emptyGunzip: err(() => zlib.gunzipSync(Buffer.alloc(0))),
        truncated: err(() => zlib.inflateSync(zlib.deflateSync(Buffer.from('x'.repeat(2000))).subarray(0, 12))),
        notBuffer: err(() => zlib.gzipSync(42)),
        noCallback: err(() => zlib.gzip(Buffer.from('x'))),
        badLevel: err(() => zlib.deflateSync('x', { level: 12 })),
        badChunkSize: err(() => zlib.gzipSync('x', { chunkSize: 8 })),
        badStrategy: err(() => zlib.deflateSync('x', { strategy: 9 })),
      });`);
    const oracleErrors = expected.errors as Record<string, string>;
    expect(result).toEqual({
      badGzip: oracleErrors.badGzip,
      emptyGunzip: oracleErrors.emptyGunzip,
      truncated: oracleErrors.truncated,
      notBuffer: oracleErrors.notBuffer,
      noCallback: oracleErrors.noCallback,
      badLevel: oracleErrors.badLevel,
      badChunkSize: oracleErrors.badChunkSize,
      badStrategy: oracleErrors.badStrategy,
    });
  });

  it('auto-detects gzip and zlib containers, but not raw deflate', async () => {
    const result = await evaluate(`
      const err = (fn) => { try { return fn(); } catch (e) { return e.code; } };
      __report({
        gzip: zlib.unzipSync(zlib.gzipSync('hello hello hello hello')).toString(),
        zlib: zlib.unzipSync(zlib.deflateSync('hello hello hello hello')).toString(),
        raw: err(() => zlib.unzipSync(zlib.deflateRawSync('hello hello hello hello'))),
      });`);
    expect(result).toEqual({
      gzip: 'hello hello hello hello',
      zlib: 'hello hello hello hello',
      raw: 'Z_DATA_ERROR',
    });
  });

  it('decodes a stream fed one byte at a time', async () => {
    const result = await evaluate(`
      const gz = zlib.gzipSync('hello hello hello hello');
      const gun = zlib.createGunzip();
      const parts = [];
      gun.on('data', (c) => parts.push(c));
      gun.on('end', () => __report(Buffer.concat(parts).toString()));
      gun.on('error', (e) => __report('ERR ' + e.code));
      for (const byte of gz) gun.write(Buffer.from([byte]));
      gun.end();`);
    expect(result).toBe('hello hello hello hello');
  }, 20000);

  it('makes a chunked stream equal the one-shot output, and honors flush()', async () => {
    const result = await evaluate(`
      const HELLO = Buffer.from('hello hello hello hello');
      const fox = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(300));
      const g = zlib.createGzip();
      const parts = [];
      g.on('data', (c) => parts.push(c));
      g.on('end', () => {
        const chunked = Buffer.concat(parts);
        const f = zlib.createDeflateRaw({ level: 9 });
        const fparts = [];
        f.on('data', (c) => fparts.push(c));
        f.write(HELLO.subarray(0, 8));
        f.flush(zlib.constants.Z_SYNC_FLUSH, () => f.end(HELLO.subarray(8)));
        f.on('end', () => {
          __report({
            chunkedEqualsSync: chunked.equals(zlib.gzipSync(fox)),
            flushRoundtrip: zlib.inflateRawSync(Buffer.concat(fparts)).equals(HELLO),
          });
        });
        f.on('error', (e) => __report('ERR ' + e.code));
      });
      g.on('error', (e) => __report('ERR ' + e.code));
      for (let i = 0; i < fox.length; i += 977) g.write(fox.subarray(i, i + 977));
      g.end();`);
    expect(result).toEqual({ chunkedEqualsSync: true, flushRoundtrip: true });
  }, 20000);

  it('exposes the full Node constants and codes surface', async () => {
    const result = await evaluate(`
      __report({
        keys: Object.keys(zlib.constants).sort(),
        verNum: zlib.constants.ZLIB_VERNUM,
        codes: JSON.stringify(zlib.codes),
      });`);
    const r = result as { keys: string[]; verNum: number; codes: string };
    expect(r.keys).toEqual(expected.constantKeys);
    expect(r.verNum).toBe(expected.verNum);
    expect(r.codes).toBe(expected.codes);
  });

  it('keeps brotli/zstd/zip opt-in by throwing, never silently producing nothing', async () => {
    const result = await evaluate(`
      const err = (fn) => { try { fn(); return 'no-error'; } catch (e) { return /not implemented/i.test(e.message) ? 'not-implemented' : e.name + ':' + e.message; } };
      const zlib2 = require('zlib');
      const { Transform } = require('stream');
      __report({
        brotliCompress: err(() => zlib2.brotliCompressSync(Buffer.from('x'))),
        brotliCtor: err(() => new zlib2.BrotliCompress()),
        zstdSync: err(() => zlib2.zstdCompressSync(Buffer.from('x'))),
        zipFile: err(() => new zlib2.ZipFile()),
        brotliIsTransform: zlib2.BrotliCompress.prototype instanceof Transform,
      });`);
    expect(result).toEqual({
      brotliCompress: 'not-implemented',
      brotliCtor: 'not-implemented',
      zstdSync: 'not-implemented',
      zipFile: 'not-implemented',
      brotliIsTransform: true,
    });
  });
});
