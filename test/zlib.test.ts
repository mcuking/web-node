/**
 * `zlib` — deflate/gzip over the platform's Compression Streams codec.
 *
 * Every byte-level expectation below is taken from real Node v26.9.0. The point
 * of the module is that the *platform* owns the codec (no JS reimplementation),
 * so for the default options the output must be byte-identical to Node's — these
 * tests pin that, plus the honest edges: the sync API and codec parameters have
 * no platform counterpart and must throw rather than silently misbehave.
 */

import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const encoder = new TextEncoder();

/**
 * Run a script inside the runtime and collect everything it prints, waiting
 * until the output stops growing (or a deadline passes).
 */
function runBody(body: string, waitMs = 1500): Promise<string[]> {
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
      } else if (now.length > 0 && ++stable >= 5) {
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

// Reference values, all produced by Node v26.9.0.
const HELLO = 'hello hello hello hello';
const HELLO_GZIP = '1f8b0800000000000013cb48cdc9c957c8402701e3513d8d17000000';
const EMPTY_GZIP = '1f8b080000000000001303000000000000000000';
// 13 500-byte input: Node's exact outputs.
const FOX_GZIP_PREFIX = '1f8b0800000000000013edcae10181500006c055';
const FOX_DEFLATE_PREFIX = '789cedcae10181500006c055be094cd302e42951';
const FOX_DEFLATE_RAW_PREFIX = 'edcae10181500006c055be094cd302e429518f12';

describe('zlib', () => {
  it('hex-encodes the same bytes Node does', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      const hello = Buffer.from(${JSON.stringify(HELLO)});
      zlib.gzip(hello, (e, b) => console.log('gzip ' + (e ? 'ERR' : b.toString('hex'))));
      zlib.gzip(Buffer.alloc(0), (e, b) => console.log('empty ' + (e ? 'ERR' : b.toString('hex'))));
      const fox = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(300));
      zlib.gzip(fox, (e, b) => console.log('foxgzip ' + (e ? 'ERR' : b.length + ' ' + b.toString('hex').slice(0, 40))));
      zlib.deflate(fox, (e, b) => console.log('foxdeflate ' + (e ? 'ERR' : b.length + ' ' + b.toString('hex').slice(0, 40))));
      zlib.deflateRaw(fox, (e, b) => console.log('foxraw ' + (e ? 'ERR' : b.length + ' ' + b.toString('hex').slice(0, 40))));
    `);
    expect(lines).toContain(`gzip ${HELLO_GZIP}`);
    expect(lines).toContain(`empty ${EMPTY_GZIP}`);
    expect(lines).toContain(`foxgzip 119 ${FOX_GZIP_PREFIX}`);
    expect(lines).toContain(`foxdeflate 107 ${FOX_DEFLATE_PREFIX}`);
    expect(lines).toContain(`foxraw 101 ${FOX_DEFLATE_RAW_PREFIX}`);
  });

  it('round-trips, and a chunked stream equals the one-shot output', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      const fox = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(300));
      zlib.gzip(fox, (e, gz) => {
        zlib.gunzip(gz, (e2, back) => console.log('roundtrip ' + (e2 ? 'ERR' : back.equals(fox))));
      });
      const g = zlib.createGzip();
      const parts = [];
      g.on('data', (c) => parts.push(c));
      g.on('end', () => {
        const joined = Buffer.concat(parts);
        console.log('chunked ' + joined.length + ' ' + joined.toString('hex').slice(0, 40));
      });
      for (let i = 0; i < fox.length; i += 977) g.write(fox.subarray(i, i + 977));
      g.end();
    `);
    expect(lines).toContain('roundtrip true');
    expect(lines).toContain(`chunked 119 ${FOX_GZIP_PREFIX}`);
  });

  it('computes CRC-32 like Node', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      console.log('crc1 ' + zlib.crc32('hello'));
      console.log('crc2 ' + zlib.crc32(Buffer.from('hello')));
      console.log('crc3 ' + zlib.crc32(Buffer.from('hello'), 0xFFFFFFFF));
    `);
    expect(lines).toContain('crc1 907060870');
    expect(lines).toContain('crc2 907060870');
    expect(lines).toContain('crc3 265137764');
  });

  it('reports a decode failure exactly like Node', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      zlib.gunzip(Buffer.from('not gzip'), (e) => console.log('bad ' + [e.name, e.code, e.errno, e.message].join('|')));
      zlib.gunzip(Buffer.alloc(0), (e) => console.log('empty ' + [e.name, e.code, e.errno, e.message].join('|')));
    `);
    expect(lines).toContain('bad Error|Z_DATA_ERROR|-3|incorrect header check');
    expect(lines).toContain('empty Error|Z_BUF_ERROR|-5|unexpected end of file');
  });

  it('auto-detects gzip and zlib containers, but not raw deflate', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      const data = Buffer.from(${JSON.stringify(HELLO)});
      const collect = (stream, input) => new Promise((resolve) => {
        const parts = [];
        stream.on('data', (c) => parts.push(c));
        stream.on('end', () => resolve(Buffer.concat(parts)));
        stream.end(input);
      });
      (async () => {
        const gz = await collect(zlib.createGzip(), data);
        const zl = await collect(zlib.createDeflate(), data);
        const raw = await collect(zlib.createDeflateRaw(), data);
        zlib.unzip(gz, (e, b) => console.log('gzip ' + (e ? 'ERR ' + e.code : b.toString())));
        zlib.unzip(zl, (e, b) => console.log('zlib ' + (e ? 'ERR ' + e.code : b.toString())));
        zlib.unzip(raw, (e, b) => console.log('raw ' + (e ? e.code : b.toString())));
      })();
    `);
    expect(lines).toContain(`gzip ${HELLO}`);
    expect(lines).toContain(`zlib ${HELLO}`);
    expect(lines).toContain('raw Z_DATA_ERROR');
  });

  it('decodes a stream fed one byte at a time', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      const data = Buffer.from(${JSON.stringify(HELLO)});
      const g = zlib.createGzip();
      const parts = [];
      g.on('data', (c) => parts.push(c));
      g.on('end', () => {
        const gz = Buffer.concat(parts);
        const gun = zlib.createGunzip();
        const out = [];
        gun.on('data', (c) => out.push(c));
        gun.on('end', () => console.log('onebyte ' + Buffer.concat(out).toString()));
        gun.on('error', (e) => console.log('onebyte ERR ' + e.code));
        for (const byte of gz) gun.write(Buffer.from([byte]));
        gun.end();
      });
      g.end(data);
    `);
    expect(lines).toContain(`onebyte ${HELLO}`);
  });

  it('exposes constants and codes', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      console.log('chunk ' + zlib.constants.Z_DEFAULT_CHUNK);
      console.log('ver ' + zlib.constants.ZLIB_VERNUM);
      console.log('deflate ' + zlib.constants.DEFLATE);
      console.log('codes ' + zlib.codes[zlib.codes.Z_DATA_ERROR]);
      console.log('codes2 ' + zlib.codes[-3]);
    `);
    expect(lines).toContain('chunk 16384');
    expect(lines).toContain('ver 4897');
    expect(lines).toContain('deflate 1');
    expect(lines).toContain('codes Z_DATA_ERROR');
    expect(lines).toContain('codes2 Z_DATA_ERROR');
  });

  it('throws for the sync API, which the platform codec cannot offer', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      for (const name of ['gzipSync', 'gunzipSync', 'deflateSync', 'inflateSync', 'deflateRawSync', 'inflateRawSync', 'unzipSync']) {
        try { zlib[name](Buffer.from('x')); console.log(name + ' ok'); }
        catch (e) { console.log(name + ' ' + e.code); }
      }
    `);
    for (const name of ['gzipSync', 'gunzipSync', 'deflateSync', 'inflateSync', 'deflateRawSync', 'inflateRawSync', 'unzipSync']) {
      expect(lines).toContain(`${name} ERR_WEB_NODE_NOT_IMPLEMENTED`);
    }
  });

  it('refuses codec parameters instead of silently ignoring them', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      const data = Buffer.from('x');
      const t = (label, fn) => { try { fn(); console.log(label + ' ok'); } catch (e) { console.log(label + ' ' + e.name); } };
      t('level', () => zlib.gzip(data, { level: 9 }, () => {}));
      t('windowBits', () => zlib.createGzip({ windowBits: 9 }));
      t('dictionary', () => zlib.createDeflate({ dictionary: data }));
      t('chunkSize', () => zlib.gzip(data, { chunkSize: 1024 }, () => {}));
    `);
    expect(lines).toContain('level NotImplementedError');
    expect(lines).toContain('windowBits NotImplementedError');
    expect(lines).toContain('dictionary NotImplementedError');
    expect(lines).toContain('chunkSize ok');
  });

  it('matches Node on argument validation', async () => {
    const lines = await runBody(`
      const zlib = require('zlib');
      const t = (label, fn) => { try { fn(); console.log(label + ' ok'); } catch (e) { console.log(label + ' ' + e.code + ' ' + e.message); } };
      t('noCallback', () => zlib.gzip(Buffer.from('x')));
      t('badChunk', () => zlib.gzip(42, () => {}));
    `);
    expect(lines).toContain(
      'noCallback ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received type undefined',
    );
    expect(lines).toContain(
      'badChunk ERR_INVALID_ARG_TYPE The "chunk" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received type number (42)',
    );
  });

  it('makes the vendored CompressionStream / DecompressionStream work', async () => {
    const lines = await runBody(`
      const { CompressionStream, DecompressionStream } = require('stream/web');
      const data = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(300));
      const drain = async (stream) => {
        const parts = [];
        for await (const chunk of stream) parts.push(Buffer.from(chunk));
        return Buffer.concat(parts);
      };
      (async () => {
        for (const format of ['gzip', 'deflate', 'deflate-raw']) {
          const cs = new CompressionStream(format);
          const writer = cs.writable.getWriter();
          writer.write(data);
          writer.close();
          const compressed = await drain(cs.readable);
          const ds = new DecompressionStream(format);
          const writer2 = ds.writable.getWriter();
          writer2.write(compressed);
          writer2.close();
          const back = await drain(ds.readable);
          console.log(format + ' ' + back.equals(data));
        }
      })();
    `);
    expect(lines).toContain('gzip true');
    expect(lines).toContain('deflate true');
    expect(lines).toContain('deflate-raw true');
  });
});
