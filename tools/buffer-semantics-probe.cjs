// Differential observation program for `buffer`. Runs on real Node AND in web-node.
const { Buffer } = require('buffer');

const out = {};

const b = Buffer.from('hello world');
out.fromString = b.toString();
out.length = b.length;
out.isBuffer = Buffer.isBuffer(b);
out.isBufferArray = Buffer.isBuffer([1, 2]);
out.byteLengthUtf8 = Buffer.byteLength('€');
out.byteLengthAscii = Buffer.byteLength('abc', 'ascii');
out.byteLengthUtf16 = Buffer.byteLength('abc', 'utf16le');

out.encodings = ['utf8', 'utf-8', 'hex', 'base64', 'base64url', 'ascii', 'latin1', 'binary', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le'].map((e) => `${e}:${Buffer.isEncoding(e)}`);
out.encodingBad = Buffer.isEncoding('bogus');

out.fromHex = Buffer.from('616263', 'hex').toString();
out.fromBase64 = Buffer.from('YWJj', 'base64').toString();
out.fromBase64Url = Buffer.from('YWJj', 'base64url').toString();
out.hexRoundtrip = Buffer.from([0, 255, 16]).toString('hex');
out.base64Roundtrip = Buffer.from([0, 255, 16]).toString('base64');
out.latin1Roundtrip = Buffer.from([0, 255, 16]).toString('latin1');
out.utf16leRoundtrip = Buffer.from('ab').toString('utf16le');
out.asciiRoundtrip = Buffer.from('abc').toString('ascii');
out.binaryAlias = Buffer.from('abc').toString('binary');

const arr = Buffer.alloc(4);
arr.fill(7);
out.allocFilled = [...arr];
out.allocZero = [...Buffer.alloc(3)];
out.fromArray = [...Buffer.from([1, 2, 3])];
out.fromArrayBuffer = [...Buffer.from(new Uint8Array([9, 8, 7]).buffer)];

const a1 = Buffer.from('ab');
const a2 = Buffer.from('cd');
out.concat = Buffer.concat([a1, a2]).toString();
out.concatLen = Buffer.concat([a1, a2], 3).toString();

out.compare = [Buffer.compare(Buffer.from('a'), Buffer.from('b')), Buffer.from('b').compare(Buffer.from('a')), Buffer.from('a').compare(Buffer.from('a'))];
out.equals = [Buffer.from('x').equals(Buffer.from('x')), Buffer.from('x').equals(Buffer.from('y'))];

const sl = Buffer.from('hello');
out.sliceIsView = sl.slice(1, 3).toString();
out.sliceSharesMemory = (() => { const s = sl.slice(0, 1); s[0] = 0x48 - 0x48 + 74; return sl.toString(); })();
out.subarrayIsView = sl.subarray(0, 2).toString();
out.sliceParent = Buffer.prototype.slice.call(sl) === sl ? 'same' : 'different';

out.indexOf = [Buffer.from('hello').indexOf('ll'), Buffer.from('hello').indexOf('z'), Buffer.from('hello').includes('ell')];
out.indexOfBuffer = Buffer.from('hello').indexOf(Buffer.from('ll'));

const w = Buffer.alloc(8);
w.write('abc', 1);
out.write = w.toString('latin1');
w.writeUInt8(255, 0);
w.writeUInt16BE(0x0102, 2);
w.writeUInt32LE(0x01020304, 4);
out.writeInts = w.toString('hex');
out.readUInt16BE = w.readUInt16BE(2);
out.readUInt32LE = w.readUInt32LE(4);
out.readInt8 = w.readInt8(0);

const f = Buffer.alloc(16);
f.writeDoubleBE(1.5, 0);
f.writeFloatLE(2.5, 8);
out.readDoubleBE = f.readDoubleBE(0);
out.readFloatLE = f.readFloatLE(8);
const big = Buffer.alloc(16);
big.writeBigInt64BE(123456789012345n, 0);
out.readBigInt64BE = big.readBigInt64BE(0).toString();
out.readBigUInt64LE = big.readBigUInt64LE(0).toString();

const c = Buffer.alloc(6);
Buffer.from('abcdef').copy(c, 0, 1, 4);
out.copy = c.toString('latin1', 0, 3);

const sw = Buffer.from([1, 2, 3, 4]);
sw.swap16();
out.swap16 = [...sw];
const sw32 = Buffer.from([1, 2, 3, 4]);
sw32.swap32();
out.swap32 = [...sw32];

out.toJSON = JSON.stringify(Buffer.from([1, 2]).toJSON());
out.keysType = [...Buffer.from('ab').keys()];
out.valuesType = [...Buffer.from('ab').values()];
out.entriesType = [...Buffer.from('ab').entries()];

out.poolSize = Buffer.poolSize;
out.poolSizeIsNumber = typeof Buffer.poolSize === 'number';
out.byteOffsetIsNumber = typeof Buffer.from('abcd').byteOffset === 'number';
out.hasParent = typeof Buffer.from('abcd').parent;
out.protoMethods = ['toString', 'write', 'slice', 'subarray', 'copy', 'fill', 'equals', 'compare', 'indexOf', 'includes', 'swap16', 'swap32', 'swap64', 'toJSON', 'readUInt8', 'writeUInt8', 'readBigInt64BE', 'writeBigInt64BE'].filter((m) => m in Buffer.prototype).length;
out.statics = ['from', 'alloc', 'allocUnsafe', 'allocUnsafeSlow', 'concat', 'compare', 'isBuffer', 'isEncoding', 'byteLength', 'copyBytesFrom', 'of'].filter((m) => typeof Buffer[m] === 'function').length;
out.badOffset = (() => { try { Buffer.alloc(2).writeUInt8(1, 5); return 'no-throw'; } catch (e) { return e.code; } })();
out.badEncoding = (() => { try { Buffer.alloc(2).toString('bogus'); return 'no-throw'; } catch (e) { return e.code; } })();

console.log('__OBS__' + JSON.stringify(out));
