// Differential observation program for `zlib`. Runs on real Node AND in web-node.
//
// Only the public API is touched. Output is printed as a single `__OBS__<json>`
// line once every (sync and async) observation has been recorded, so the async
// one-shot helpers and streams are covered too.
const zlib = require('zlib');

const out = {};
const hex = (b) => b.toString('hex');
const brief = (b) => b.length + ':' + b.toString('hex').slice(0, 40);
// The gzip header's OS byte (offset 9) is metadata about the *producing* platform
// — macOS-built Node writes 19, zlib's fallback is 3, Windows 10. web-node has no
// OS identity (it is a wasm module), so the byte is normalized away here; every
// other byte, including the XFL and MTIME fields, is compared verbatim.
const gzHex = (b) => { const c = Buffer.from(b); c[9] = 0; return c.toString('hex'); };
const gzBrief = (b) => { const c = Buffer.from(b); c[9] = 0; return c.length + ':' + c.toString('hex').slice(0, 40); };

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
/** Reserve a slot for an async observation; call `done()` when it lands. */
const async1 = () => { pending++; };
const done = () => { pending--; maybeFinish(); };

// --- constants / codes ------------------------------------------------------

out.constantKeys = Object.keys(zlib.constants).sort();
out.verNum = zlib.constants.ZLIB_VERNUM;
out.codes = JSON.stringify(zlib.codes);

// --- crc32 ------------------------------------------------------------------

out.crc = [zlib.crc32('hello'), zlib.crc32(Buffer.from('hello')), zlib.crc32(Buffer.from('hello'), 0xffffffff), zlib.crc32(''), zlib.crc32('', 7)];

// --- sync one-shots ---------------------------------------------------------

out.sync = {
  gzipHello: gzHex(zlib.gzipSync(HELLO)),
  gzipEmpty: gzHex(zlib.gzipSync(EMPTY)),
  deflateHello: hex(zlib.deflateSync(HELLO)),
  deflateRawHello: hex(zlib.deflateRawSync(HELLO)),
  gzipFox: gzBrief(zlib.gzipSync(FOX)),
  deflateFox: brief(zlib.deflateSync(FOX)),
  deflateRawFox: brief(zlib.deflateRawSync(FOX)),
  gzipString: gzHex(zlib.gzipSync('hello hello hello hello')),
};

out.syncRoundtrip = {
  gzip: zlib.gunzipSync(zlib.gzipSync(FOX)).equals(FOX),
  inflate: zlib.inflateSync(zlib.deflateSync(FOX)).equals(FOX),
  inflateRaw: zlib.inflateRawSync(zlib.deflateRawSync(FOX)).equals(FOX),
  unzipGzip: zlib.unzipSync(zlib.gzipSync(HELLO)).toString(),
  unzipZlib: zlib.unzipSync(zlib.deflateSync(HELLO)).toString(),
};

// --- codec parameters -------------------------------------------------------

out.levels = [-1, 0, 1, 6, 9].map((level) => level + '=' + brief(zlib.deflateSync(FOX, { level })));
out.windowBits = [9, 12, 15].map((windowBits) => windowBits + '=' + brief(zlib.deflateSync(FOX, { windowBits })));
out.memLevel = [1, 5, 9].map((memLevel) => memLevel + '=' + brief(zlib.deflateSync(FOX, { memLevel })));
out.strategy = [0, 1, 2, 3, 4].map((strategy) => strategy + '=' + brief(zlib.deflateSync(FOX, { strategy })));
out.gzipWindowBits = [9, 11, 15].map((windowBits) => zlib.gzipSync(FOX, { windowBits }).length);
out.chunkSize = [64, 256, 16384].map((chunkSize) => brief(zlib.deflateSync(FOX, { chunkSize })));
out.rawParams = brief(zlib.deflateRawSync(FOX, { level: 9, windowBits: 11, memLevel: 9, strategy: 1 }));

// --- dictionary -------------------------------------------------------------

{
  const dict = Buffer.from('quick brown fox jumps');
  const withDict = zlib.deflateSync(FOX, { dictionary: dict });
  out.dictDeflate = brief(withDict);
  out.dictInflate = zlib.inflateSync(withDict, { dictionary: dict }).equals(FOX);
  out.dictRaw = brief(zlib.deflateRawSync(FOX, { dictionary: dict }));
  out.dictRawInflate = zlib.inflateRawSync(zlib.deflateRawSync(FOX, { dictionary: dict }), { dictionary: dict }).equals(FOX);
  try {
    zlib.inflateSync(withDict, { dictionary: Buffer.from('wrong dictionary!!!!!') });
    out.dictWrong = 'no-error';
  } catch (e) {
    out.dictWrong = [e.name, e.code, e.errno].join('|');
  }
}

// --- async one-shots --------------------------------------------------------

out.async = {};
async1();
zlib.gzip(FOX, (e, b) => { out.async.gzip = e ? 'ERR ' + e.code : gzBrief(b); done(); });
async1();
zlib.deflate(FOX, { level: 9 }, (e, b) => { out.async.deflate9 = e ? 'ERR ' + e.code : brief(b); done(); });
async1();
zlib.gunzip(zlib.gzipSync(FOX), (e, b) => { out.async.gunzip = e ? 'ERR ' + e.code : b.equals(FOX); done(); });
async1();
zlib.inflateRaw(zlib.deflateRawSync(FOX), (e, b) => { out.async.inflateRaw = e ? 'ERR ' + e.code : b.equals(FOX); done(); });

// --- streams ----------------------------------------------------------------

async1();
{
  const g = zlib.createGzip();
  const parts = [];
  g.on('data', (c) => parts.push(c));
  g.on('end', () => {
    out.streamChunked = gzBrief(Buffer.concat(parts));
    out.streamChunkedEqualsSync = Buffer.concat(parts).equals(zlib.gzipSync(FOX));
    done();
  });
  g.on('error', (e) => { out.streamChunked = 'ERR ' + e.code; done(); });
  for (let i = 0; i < FOX.length; i += 977) g.write(FOX.subarray(i, i + 977));
  g.end();
}

async1();
{
  // `.flush(Z_SYNC_FLUSH)` must produce a decompressible prefix mid-stream.
  const g = zlib.createDeflateRaw({ level: 9 });
  const parts = [];
  g.on('data', (c) => parts.push(c));
  g.write(HELLO.subarray(0, 8));
  g.flush(zlib.constants.Z_SYNC_FLUSH, () => {
    g.write(HELLO.subarray(8));
    g.end();
  });
  g.on('end', () => {
    const all = Buffer.concat(parts);
    out.streamFlushRoundtrip = zlib.inflateRawSync(all).equals(HELLO);
    out.streamFlushLen = all.length;
    done();
  });
  g.on('error', (e) => { out.streamFlushRoundtrip = 'ERR ' + e.code; done(); });
}

async1();
{
  const g = zlib.createDeflate({ chunkSize: 64 });
  const parts = [];
  g.on('data', (c) => parts.push(c));
  g.on('end', () => {
    out.streamEqualsSync = Buffer.concat(parts).equals(zlib.deflateSync(FOX));
    g.close(() => {
      setTimeout(() => { out.streamClosedAfterClose = g._closed; done(); }, 0);
    });
  });
  g.on('error', (e) => { out.streamClose = 'ERR ' + e.code; done(); });
  g.write(FOX);
  g.end();
}

async1();
{
  // `params()` changes the level mid-stream (after a Z_SYNC_FLUSH).
  const g = zlib.createDeflate({ level: 1 });
  const parts = [];
  g.on('data', (c) => parts.push(c));
  g.on('error', (e) => { out.params = 'ERR ' + e.code; done(); });
  g.write(FOX.subarray(0, 1000));
  g.params(9, 0, () => { g.end(FOX.subarray(1000)); });
  g.on('end', () => {
    out.params = {
      roundtrip: zlib.inflateSync(Buffer.concat(parts)).equals(FOX),
      len: Buffer.concat(parts).length,
      smallerThanLevel1: Buffer.concat(parts).length < zlib.deflateSync(FOX, { level: 1 }).length,
    };
    done();
  });
}

async1();
{
  // One byte at a time through a decoder.
  const gz = zlib.gzipSync(HELLO);
  const gun = zlib.createGunzip();
  const parts = [];
  gun.on('data', (c) => parts.push(c));
  gun.on('end', () => { out.streamOneByte = Buffer.concat(parts).toString(); done(); });
  gun.on('error', (e) => { out.streamOneByte = 'ERR ' + e.code; done(); });
  for (const byte of gz) gun.write(Buffer.from([byte]));
  gun.end();
}

// --- unzip auto-detection ---------------------------------------------------

out.unzip = {
  gzip: zlib.unzipSync(zlib.gzipSync(HELLO)).toString(),
  zlib: zlib.unzipSync(zlib.deflateSync(HELLO)).toString(),
};

// --- multi-member gzip ------------------------------------------------------

const twoGz = Buffer.concat([zlib.gzipSync(Buffer.from('abc')), zlib.gzipSync(Buffer.from('def'))]);
out.multiMember = zlib.gunzipSync(twoGz).toString();
out.multiMemberUnzip = zlib.unzipSync(twoGz).toString();

// --- errors -----------------------------------------------------------------

const errOf = (fn) => {
  try {
    fn();
    return 'no-error';
  } catch (e) {
    return [e.name, e.code, e.errno, e.message].join('|');
  }
};

out.errors = {
  badGzip: errOf(() => zlib.gunzipSync(Buffer.from('not gzip'))),
  emptyGunzip: errOf(() => zlib.gunzipSync(EMPTY)),
  badInflate: errOf(() => zlib.inflateSync(Buffer.from('nope'))),
  truncated: errOf(() => zlib.inflateSync(zlib.deflateSync(FOX).subarray(0, 12))),
  notBuffer: errOf(() => zlib.gzipSync(42)),
  noCallback: errOf(() => zlib.gzip(Buffer.from('x'))),
  badLevel: errOf(() => zlib.deflateSync(HELLO, { level: 12 })),
  badWindowBits: errOf(() => zlib.createGzip({ windowBits: 9 })),
  badChunkSize: errOf(() => zlib.gzipSync(HELLO, { chunkSize: 8 })),
  badStrategy: errOf(() => zlib.deflateSync(HELLO, { strategy: 9 })),
  badDictionary: errOf(() => zlib.deflateSync(HELLO, { dictionary: 'nope' })),
  badData: errOf(() => zlib.crc32(42)),
  badValue: errOf(() => zlib.crc32('x', -1)),
};

async1();
zlib.gunzip(Buffer.from('not gzip'), (e) => {
  out.errors.asyncBad = e ? [e.name, e.code, e.errno, e.message].join('|') : 'no-error';
  done();
});

// --- brotli (M118) ----------------------------------------------------------

const C = zlib.constants;

out.brotli = {
  hello: hex(zlib.brotliCompressSync(HELLO)),
  empty: hex(zlib.brotliCompressSync(EMPTY)),
  fox: brief(zlib.brotliCompressSync(FOX)),
  head: hex(zlib.brotliCompressSync(FOX).subarray(0, 16)),
  string: hex(zlib.brotliCompressSync('hello hello hello hello')),
  roundtrip: zlib.brotliDecompressSync(zlib.brotliCompressSync(FOX)).equals(FOX),
  roundtripEmpty: zlib.brotliDecompressSync(zlib.brotliCompressSync(EMPTY)).equals(EMPTY),
  isTransform: zlib.BrotliCompress.prototype instanceof require('stream').Transform,
};

const brotliParam = (key, value) => brief(zlib.brotliCompressSync(FOX, { params: { [key]: value } }));
out.brotliQuality = [0, 1, 5, 9, 11].map((q) => q + '=' + brotliParam(C.BROTLI_PARAM_QUALITY, q));
out.brotliMode = [C.BROTLI_MODE_GENERIC, C.BROTLI_MODE_TEXT, C.BROTLI_MODE_FONT].map((m) => m + '=' + brotliParam(C.BROTLI_PARAM_MODE, m));
out.brotliLgwin = [10, 16, 22].map((w) => w + '=' + brotliParam(C.BROTLI_PARAM_LGWIN, w));
out.brotliSizeHint = brotliParam(C.BROTLI_PARAM_SIZE_HINT, FOX.length);
out.brotliDisableLiteral = brotliParam(C.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING, 1);

{
  const dict = Buffer.from('quick brown fox jumps');
  const withDict = zlib.brotliCompressSync(FOX, { dictionary: dict });
  out.brotliDictLen = withDict.length;
  out.brotliDictRoundtrip = zlib.brotliDecompressSync(withDict, { dictionary: dict }).equals(FOX);
}

out.brotliErrors = {
  badParam: errOf(() => zlib.brotliCompressSync(HELLO, { params: { 999: 1 } })),
  badParamType: errOf(() => zlib.brotliCompressSync(HELLO, { params: { [C.BROTLI_PARAM_QUALITY]: 'x' } })),
  badDecode: errOf(() => zlib.brotliDecompressSync(Buffer.from('not brotli'))),
  truncated: errOf(() => zlib.brotliDecompressSync(zlib.brotliCompressSync(FOX).subarray(0, 10))),
};

async1();
zlib.brotliCompress(FOX, (e, b) => { out.brotliAsync = e ? 'ERR ' + e.code : brief(b); done(); });

async1();
{
  const g = zlib.createBrotliCompress();
  const parts = [];
  g.on('data', (c) => parts.push(c));
  g.on('end', () => {
    out.brotliStream = {
      equalsSync: Buffer.concat(parts).equals(zlib.brotliCompressSync(FOX)),
      len: Buffer.concat(parts).length,
    };
    done();
  });
  g.on('error', (e) => { out.brotliStream = 'ERR ' + e.code; done(); });
  for (let i = 0; i < FOX.length; i += 977) g.write(FOX.subarray(i, i + 977));
  g.end();
}

// --- zstd (M118) ------------------------------------------------------------

out.zstd = {
  hello: hex(zlib.zstdCompressSync(HELLO)),
  empty: hex(zlib.zstdCompressSync(EMPTY)),
  fox: brief(zlib.zstdCompressSync(FOX)),
  head: hex(zlib.zstdCompressSync(FOX).subarray(0, 16)),
  string: hex(zlib.zstdCompressSync('hello hello hello hello')),
  roundtrip: zlib.zstdDecompressSync(zlib.zstdCompressSync(FOX)).equals(FOX),
  roundtripEmpty: zlib.zstdDecompressSync(zlib.zstdCompressSync(EMPTY)).equals(EMPTY),
  isTransform: zlib.ZstdCompress.prototype instanceof require('stream').Transform,
};

const zstdParam = (key, value) => brief(zlib.zstdCompressSync(FOX, { params: { [key]: value } }));
out.zstdLevel = [1, 3, 10, 19].map((l) => l + '=' + zstdParam(C.ZSTD_c_compressionLevel, l));
out.zstdChecksum = [0, 1].map((c) => c + '=' + zstdParam(C.ZSTD_c_checksumFlag, c));
out.zstdWindowLog = [10, 18, 23].map((w) => w + '=' + zstdParam(C.ZSTD_c_windowLog, w));
out.zstdStrategy = [C.ZSTD_fast, C.ZSTD_btultra2].map((s) => s + '=' + zstdParam(C.ZSTD_c_strategy, s));
out.zstdPledge = brief(zlib.zstdCompressSync(FOX, { pledgedSrcSize: FOX.length }));

{
  const dict = Buffer.from('quick brown fox jumps');
  const withDict = zlib.zstdCompressSync(FOX, { dictionary: dict });
  out.zstdDictLen = withDict.length;
  out.zstdDictRoundtrip = zlib.zstdDecompressSync(withDict, { dictionary: dict }).equals(FOX);
}

out.zstdErrors = {
  badParam: errOf(() => zlib.zstdCompressSync(HELLO, { params: { 999: 1 } })),
  badParamType: errOf(() => zlib.zstdCompressSync(HELLO, { params: { [C.ZSTD_c_compressionLevel]: 'x' } })),
  badDecode: errOf(() => zlib.zstdDecompressSync(Buffer.from('not zstd'))),
  truncated: errOf(() => zlib.zstdDecompressSync(zlib.zstdCompressSync(FOX).subarray(0, 10))),
  pledgedWrong: errOf(() => zlib.zstdCompressSync(HELLO, { pledgedSrcSize: 999 })),
};

async1();
zlib.zstdCompress(FOX, (e, b) => { out.zstdAsync = e ? 'ERR ' + e.code : brief(b); done(); });

async1();
{
  const g = zlib.createZstdCompress();
  const parts = [];
  g.on('data', (c) => parts.push(c));
  g.on('end', () => {
    out.zstdStream = {
      equalsSync: Buffer.concat(parts).equals(zlib.zstdCompressSync(FOX)),
      len: Buffer.concat(parts).length,
    };
    done();
  });
  g.on('error', (e) => { out.zstdStream = 'ERR ' + e.code; done(); });
  for (let i = 0; i < FOX.length; i += 977) g.write(FOX.subarray(i, i + 977));
  g.end();
}

// rejectGarbageAfterEnd
out.rejectGarbage = errOf(() => zlib.gunzipSync(Buffer.concat([zlib.gzipSync(HELLO), Buffer.from([1, 2, 3])]), { rejectGarbageAfterEnd: true }));
// Trailing NUL padding is allowed (a new member would have to start with a non-zero byte).
out.allowGarbage = zlib.gunzipSync(Buffer.concat([zlib.gzipSync(HELLO), Buffer.from([0, 0, 0])])).toString();
// Non-zero trailing bytes are treated as another gzip member, so a bad one errors.
out.badTrailing = errOf(() => zlib.gunzipSync(Buffer.concat([zlib.gzipSync(HELLO), Buffer.from([1, 2, 3])])));

maybeFinish();
