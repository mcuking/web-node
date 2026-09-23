// Differential observation program for the iterable zlib API — `zlib/iter`
// (which is `lib/zlib/iter.js` over `lib/internal/streams/iter/transform.js`).
//
// Runs on real Node (with `--experimental-stream-iter`) AND inside web-node;
// both must print the same `__OBS__<json>` line. Only the public API is
// touched: the transforms are consumed through `stream/iter`'s `pull()`.
const {
  from,
  fromSync,
  pull,
  pullSync,
  bytes,
  bytesSync,
  text,
  textSync,
} = require('stream/iter');

const {
  compressGzip,
  compressDeflate,
  compressBrotli,
  compressZstd,
  decompressGzip,
  decompressDeflate,
  decompressBrotli,
  decompressZstd,
  compressGzipSync,
  compressDeflateSync,
  compressBrotliSync,
  compressZstdSync,
  decompressGzipSync,
  decompressDeflateSync,
  decompressBrotliSync,
  decompressZstdSync,
} = require('zlib/iter');

const C = require('zlib').constants;

const out = {};
const hex = (b) => Buffer.from(b).toString('hex');
const brief = (b) => {
  const c = Buffer.from(b);
  return c.length + ':' + c.toString('hex').slice(0, 40);
};
// The gzip OS byte (offset 9) is producer-platform metadata: a macOS-built Node
// writes 19, zlib's fallback (and the wasm module) writes 3. Normalize it away;
// every other byte is compared verbatim.
const gzBrief = (b) => {
  const c = Buffer.from(b);
  c[9] = 0;
  return c.length + ':' + c.toString('hex').slice(0, 40);
};
const errOf = (fn) => {
  try {
    fn();
    return 'NO_THROW';
  } catch (e) {
    return (e && e.code) || (e && e.name) || 'ERR';
  }
};

const FOX = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(300));
const HELLO = Buffer.from('hello hello hello hello');
const EMPTY = Buffer.alloc(0);

let pending = 0;
let finished = false;
const maybeFinish = () => {
  if (pending === 0 && !finished) {
    finished = true;
    console.log('__OBS__' + JSON.stringify(out));
  }
};
const async1 = () => {
  pending++;
};
const done = () => {
  pending--;
  maybeFinish();
};

// --- sync round-trips -------------------------------------------------------

const rt = (input, c, d) => textSync(pullSync(pullSync(fromSync(input), c), d));
const rtBytes = (buf, c, d) => bytesSync(pullSync(pullSync(fromSync(buf), c), d));

out.syncRoundtrip = {
  gzip: rt('Hello, sync gzip!', compressGzipSync(), decompressGzipSync()),
  deflate: rt('Hello, sync deflate!', compressDeflateSync(), decompressDeflateSync()),
  brotli: rt('Hello, sync brotli!', compressBrotliSync(), decompressBrotliSync()),
  zstd: rt('Hello, sync zstd!', compressZstdSync(), decompressZstdSync()),
};
out.syncLarge = {
  gzip: rtBytes(FOX, compressGzipSync(), decompressGzipSync()).equals(FOX),
  brotli: rtBytes(FOX, compressBrotliSync(), decompressBrotliSync()).equals(FOX),
};

// --- sync compressed bytes --------------------------------------------------

out.syncBytes = {
  gzipHello: gzBrief(bytesSync(pullSync(fromSync(HELLO), compressGzipSync()))),
  deflateHello: brief(bytesSync(pullSync(fromSync(HELLO), compressDeflateSync()))),
  brotliHello: brief(bytesSync(pullSync(fromSync(HELLO), compressBrotliSync()))),
  zstdHello: brief(bytesSync(pullSync(fromSync(HELLO), compressZstdSync()))),
  gzipEmpty: gzBrief(bytesSync(pullSync(fromSync(EMPTY), compressGzipSync()))),
  gzipFox: gzBrief(bytesSync(pullSync(fromSync(FOX), compressGzipSync()))),
  deflateFox: brief(bytesSync(pullSync(fromSync(FOX), compressDeflateSync()))),
  zstdFox: brief(bytesSync(pullSync(fromSync(FOX), compressZstdSync()))),
};

// Deflate output of the iter transform is deterministic and independent of the
// output buffer size, so a small `chunkSize` must not change the bytes.
out.syncChunkSizeInvariant = {
  default: brief(bytesSync(pullSync(fromSync(FOX), compressDeflateSync()))),
  small: brief(bytesSync(pullSync(fromSync(FOX), compressDeflateSync({ chunkSize: 1024 })))),
  large: brief(bytesSync(pullSync(fromSync(FOX), compressDeflateSync({ chunkSize: 1 << 20 })))),
};

// --- sync options -----------------------------------------------------------

out.syncOptions = {
  level1: brief(bytesSync(pullSync(fromSync(FOX), compressDeflateSync({ level: 1 })))),
  level9: brief(bytesSync(pullSync(fromSync(FOX), compressDeflateSync({ level: 9 })))),
  level0: brief(bytesSync(pullSync(fromSync(FOX), compressDeflateSync({ level: 0 })))),
  windowBits9: brief(bytesSync(pullSync(fromSync(FOX), compressDeflateSync({ windowBits: 9 })))),
  brotliQuality11: brief(
    bytesSync(pullSync(fromSync(FOX), compressBrotliSync({ params: { [C.BROTLI_PARAM_QUALITY]: 11 } }))),
  ),
  zstdLevel9: brief(
    bytesSync(pullSync(fromSync(HELLO), compressZstdSync({ params: { [C.ZSTD_c_compressionLevel]: 9 } }))),
  ),
};

// --- sync validation / error shapes -----------------------------------------

out.syncErrors = {
  brotliBadParam: errOf(() => bytesSync(pullSync(fromSync(HELLO), compressBrotliSync({ params: { 999: 1 } })))),
  zstdBadParam: errOf(() => bytesSync(pullSync(fromSync(HELLO), compressZstdSync({ params: { 999: 1 } })))),
  brotliBadParamType: errOf(() =>
    bytesSync(pullSync(fromSync(HELLO), compressBrotliSync({ params: { [C.BROTLI_PARAM_QUALITY]: 'x' } }))),
  ),
  deflateBadInput: errOf(() => bytesSync(pullSync(fromSync(Buffer.from('not deflate')), decompressDeflateSync()))),
  gzipBadInput: errOf(() => bytesSync(pullSync(fromSync(Buffer.from('not gzip')), decompressGzipSync()))),
  chunkSizeTooSmall: errOf(() =>
    bytesSync(pullSync(fromSync(HELLO), compressDeflateSync({ chunkSize: 1 }))),
  ),
};

// --- async round-trips ------------------------------------------------------

async1();
(async () => {
  const art = async (input, c, d) => text(pull(pull(from(input), c), d));

  out.asyncRoundtrip = {
    gzip: await art('Hello, async gzip!', compressGzip(), decompressGzip()),
    deflate: await art('Hello, async deflate!', compressDeflate(), decompressDeflate()),
    brotli: await art('Hello, async brotli!', compressBrotli(), decompressBrotli()),
    zstd: await art('Hello, async zstd!', compressZstd(), decompressZstd()),
  };

  out.asyncBytes = {
    gzipHello: gzBrief(await bytes(pull(from(HELLO), compressGzip()))),
    deflateHello: brief(await bytes(pull(from(HELLO), compressDeflate()))),
    brotliHello: brief(await bytes(pull(from(HELLO), compressBrotli()))),
    zstdHello: brief(await bytes(pull(from(HELLO), compressZstd()))),
    gzipFox: gzBrief(await bytes(pull(from(FOX), compressGzip()))),
    deflateFox: brief(await bytes(pull(from(FOX), compressDeflate()))),
  };

  // Sync and async transforms must produce byte-identical output.
  out.asyncMatchesSync = {
    gzip: gzBrief(await bytes(pull(from(FOX), compressGzip()))) === out.syncBytes.gzipFox,
    deflate: brief(await bytes(pull(from(FOX), compressDeflate()))) === out.syncBytes.deflateFox,
  };

  // Chained transforms inside a single pull().
  out.asyncChained = gzBrief(await bytes(pull(from(FOX), compressDeflate(), compressGzip())));

  // Large async round-trip.
  out.asyncLargeRoundtrip = (await bytes(pull(pull(from(FOX), compressGzip()), decompressGzip()))).equals(FOX);

  done();
})().catch((e) => {
  out.asyncError = String((e && e.code) || e);
  done();
});

maybeFinish();
