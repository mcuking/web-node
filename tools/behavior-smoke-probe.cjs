'use strict';
/**
 * M124 — behavioural smoke probe, "loading OK != usable".
 *
 * WebContainer's lesson (docs/webcontainer-research.md §9-11): a module can
 * `require()` fine and still be unusable — `http2` connected-crash, `node:sqlite`
 * classes with no prototype methods, `node:sea` a stub. Loading succeeded, so
 * nothing complained until the first real call.
 *
 * This program makes one *real first call* into each builtin the runtime claims
 * to implement and records the outcome (`value` | `throw:CODE` | `undefined`).
 * It runs unchanged on real Node (oracle -> test/fixtures/behavior-smoke.json)
 * and inside web-node; test/behavior-smoke.test.ts compares the two blobs and
 * flags any API that the oracle can call but web-node cannot — unless the
 * deviation is explicitly documented in that test.
 *
 * Rules for the checks: deterministic and environment-independent. Where a real
 * value legitimately differs between the host and a browser (platform, arch,
 * tmpdir), observe the *shape*, not the value.
 */
const os = require('os');

const out = {};
const tmp = os.tmpdir();
/** Hide the throwaway dir so oracle (host tmp) and web-node (VFS tmp) agree. */
const norm = (s) => String(s).split(tmp).join('<tmp>');
const shape = (v) => (v === null ? 'null' : typeof v);
const safe = (fn) => {
  try {
    const v = fn();
    return v === undefined ? 'undefined' : v;
  } catch (e) {
    return 'throw:' + ((e && (e.code || e.name)) || 'Error');
  }
};
const rep = (key, fn) => {
  out[key] = safe(fn);
};

// --- assert ---------------------------------------------------------------
rep('assert:ok', () => {
  const a = require('assert');
  a(true);
  return 'ok';
});
rep('assert:strictEqual', () => {
  require('assert').strictEqual('x', 'x');
  return 'ok';
});
rep('assert:throws', () => {
  require('assert').throws(() => {
    throw new Error('boom');
  });
  return 'ok';
});
rep('assert:deepStrictEqual', () => {
  require('assert').deepStrictEqual({ a: [1, 2] }, { a: [1, 2] });
  return 'ok';
});

// --- buffer ---------------------------------------------------------------
rep('buffer:fromBase64', () => Buffer.from('abc').toString('base64'));
rep('buffer:allocLen', () => Buffer.alloc(4).length);
rep('buffer:concat', () => Buffer.concat([Buffer.from('a'), Buffer.from('b')]).toString());
rep('buffer:indexOf', () => Buffer.from('hello').indexOf('ll'));
rep('buffer:isBuffer', () => Buffer.isBuffer(Buffer.from('')));
rep('buffer:kMaxLength:shape', () => shape(Buffer.kMaxLength));

// --- string_decoder -------------------------------------------------------
rep('string_decoder:write', () => {
  const { StringDecoder } = require('string_decoder');
  return new StringDecoder('utf8').write(Buffer.from('h\u00e9llo'));
});

// --- querystring ----------------------------------------------------------
rep('querystring:parse', () => JSON.stringify(require('querystring').parse('a=1&b=2&c')));
rep('querystring:stringify', () => require('querystring').stringify({ a: '1', b: 'x y' }));

// --- path -----------------------------------------------------------------
rep('path:join', () => require('path').join('a', 'b', '..', 'c'));
rep('path:extname', () => require('path').extname('/x/y.tar.gz'));
rep('path:relative', () => require('path').relative('/a/b', '/a/c'));
rep('path:parseBase', () => require('path').parse('/x/y.txt').base);
rep('path:posixJoin', () => require('path').posix.join('/a/', '/b'));

// --- url ------------------------------------------------------------------
rep('url:URL:searchParams', () => new URL('https://h:8443/p?q=1#f').searchParams.get('q'));
rep('url:URL:origin', () => new URL('https://h/p').origin);
rep('url:URL:host', () => new URL('https://u:p@h:8443/p').host);
rep('url:pathToFileURL', () => norm(require('url').pathToFileURL(tmp + '/a b').href));
rep('url:fileURLToPath', () => require('url').fileURLToPath('file:///x/a%20b'));
rep('url:URLSearchParams', () => new URLSearchParams('a=1&b=2').get('b'));

// --- util -----------------------------------------------------------------
rep('util:format', () => require('util').format('%s=%d', 'x', 2));
rep('util:inspect:shape', () => shape(require('util').inspect({ a: 1 })));
rep('util:types:isDate', () => require('util').types.isDate(new Date()));
rep('util:promisify:shape', () => shape(require('util').promisify));
rep('util:styleText:shape', () => shape(require('util').styleText));
rep('util:parseArgs:shape', () => shape(require('util').parseArgs));
rep('util:isDeepStrictEqual', () => require('util').isDeepStrictEqual({ a: 1 }, { a: 1 }));

// --- events ---------------------------------------------------------------
rep('events:onEmit', () => {
  const { EventEmitter } = require('events');
  const e = new EventEmitter();
  let got;
  e.on('x', (v) => (got = v));
  e.emit('x', 7);
  return got;
});
rep('events:once:shape', () => shape(require('events').once));
rep('events:captureRejections:shape', () => shape(require('events').captureRejections));

// --- os (host-dependent -> shape) ----------------------------------------
rep('os:EOL', () => JSON.stringify(os.EOL));
rep('os:tmpdir:shape', () => shape(os.tmpdir()));
rep('os:platform:shape', () => shape(os.platform()));
rep('os:arch:shape', () => shape(os.arch()));
rep('os:constants:signals:SIGINT', () => os.constants.signals.SIGINT);

// --- crypto ---------------------------------------------------------------
rep('crypto:sha256', () => require('crypto').createHash('sha256').update('abc').digest('hex'));
rep('crypto:hmac', () => require('crypto').createHmac('sha256', 'key').update('x').digest('hex'));
rep('crypto:randomUUID:shape', () => {
  const u = require('crypto').randomUUID();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u);
});
rep('crypto:timingSafeEqual', () => require('crypto').timingSafeEqual(Buffer.from('ab'), Buffer.from('ab')));
rep('crypto:pbkdf2Sync', () => require('crypto').pbkdf2Sync('p', 's', 1, 16, 'sha256').toString('hex'));
rep('crypto:aesGcm', () => {
  const crypto = require('crypto');
  const c = crypto.createCipheriv('aes-128-gcm', Buffer.alloc(16, 1), Buffer.alloc(12, 2));
  const ct = Buffer.concat([c.update(Buffer.from('secret')), c.final()]);
  return ct.toString('hex') + ':' + c.getAuthTag().toString('hex');
});
rep('crypto:getCiphers:hasGcm', () => require('crypto').getCiphers().includes('aes-256-gcm'));
rep('crypto:sign:shape', () => shape(require('crypto').sign));

// --- zlib -----------------------------------------------------------------
rep('zlib:gzipRoundtrip', () => require('zlib').gunzipSync(require('zlib').gzipSync(Buffer.from('hello'))).toString());
rep('zlib:deflateRaw', () => require('zlib').inflateRawSync(require('zlib').deflateRawSync(Buffer.from('x'))).toString());
rep('zlib:brotli', () => require('zlib').brotliDecompressSync(require('zlib').brotliCompressSync(Buffer.from('y'))).toString());
rep('zlib:constants:Z_BEST_SPEED', () => require('zlib').constants.Z_BEST_SPEED);

// --- stream / timers ------------------------------------------------------
rep('stream:Readable:shape', () => shape(require('stream').Readable));
rep('stream:pipeline:shape', () => shape(require('stream').pipeline));
rep('stream:readableFrom:read:shape', () => shape(require('stream').Readable.from(['a']).read));
rep('timers:setTimeout:shape', () => shape(require('timers').setTimeout));
rep('timers/promises:setTimeout:shape', () => shape(require('timers/promises').setTimeout));

// --- tty ------------------------------------------------------------------
rep('tty:isatty:shape', () => shape(require('tty').isatty(1)));

// --- net / http / https / tls / dns --------------------------------------
rep('net:createServer:shape', () => shape(require('net').createServer));
rep('net:createServer:call', () => shape(require('net').createServer().listen));
rep('net:Socket:shape', () => shape(require('net').Socket));
rep('http:STATUS_CODES:200', () => require('http').STATUS_CODES['200']);
rep('http:createServer:shape', () => shape(require('http').createServer));
rep('http:createServer:call', () => shape(require('http').createServer().listen));
rep('http:METHODS:hasGET', () => require('http').METHODS.includes('GET'));
rep('https:createServer:shape', () => shape(require('https').createServer));
rep('https:Agent:shape', () => shape(require('https').Agent));
rep('tls:createServer:shape', () => shape(require('tls').createServer));
rep('tls:connect:shape', () => shape(require('tls').connect));
rep('dns:lookup:shape', () => shape(require('dns').lookup));
rep('dns/promises:lookup:shape', () => shape(require('dns/promises').lookup));

// --- worker_threads / module / process / perf_hooks ----------------------
rep('worker_threads:isMainThread', () => require('worker_threads').isMainThread);
rep('worker_threads:Worker:shape', () => shape(require('worker_threads').Worker));
// cluster: this probe runs as the primary in both runtimes.
rep('cluster:isPrimary', () => require('cluster').isPrimary);
rep('cluster:isWorker', () => require('cluster').isWorker);
rep('cluster:Worker:shape', () => shape(require('cluster').Worker));
rep('cluster:fork:shape', () => shape(require('cluster').fork));
rep('cluster:disconnect:shape', () => shape(require('cluster').disconnect));
rep('cluster:workers:shape', () => shape(require('cluster').workers));
rep('module:builtinModules:hasFs', () => require('module').builtinModules.includes('fs'));
rep('module:builtinModules:hasNodeFs', () => require('module').builtinModules.includes('node:fs'));
rep('module:createRequire:shape', () => shape(require('module').createRequire));
rep('module:isBuiltin', () => require('module').isBuiltin('node:fs'));
rep('process:platform:shape', () => shape(process.platform));
rep('process:nextTick:shape', () => shape(process.nextTick));
rep('process:version:shape', () => shape(process.version));
rep('process:hrtime:shape', () => shape(process.hrtime));
rep('process:env:shape', () => shape(process.env));
rep('perf_hooks:now:shape', () => shape(require('perf_hooks').performance.now()));
rep('perf_hooks:PerformanceObserver:shape', () => shape(require('perf_hooks').PerformanceObserver));

// --- v8 ------------------------------------------------------------------
rep('v8:serializeRoundtrip', () => {
  const v8 = require('v8');
  return v8.deserialize(v8.serialize({ a: [1, 'x'], b: true })).a[1];
});
rep('v8:getHeapStatistics:shape', () => shape(require('v8').getHeapStatistics));

// --- child_process -------------------------------------------------------
rep('child_process:spawn:shape', () => shape(require('child_process').spawn));
rep('child_process:execSync:shape', () => shape(require('child_process').execSync));

// --- fs (roundtrip in a self-created dir under the host/VFS tmp) ---------
// Create the working dir up front so the same checks work whether the tmp dir
// already exists (real Node) or must be synthesised inside the VFS (web-node).
const fsdir = tmp + '/wn-bsmoke';
rep('fs:mkdirRecursive', () => {
  require('fs').mkdirSync(fsdir, { recursive: true });
  return 'ok';
});
rep('fs:writeReadRoundtrip', () => {
  const fs = require('fs');
  const f = fsdir + '/a.txt';
  fs.writeFileSync(f, 'hi');
  const v = fs.readFileSync(f, 'utf8');
  fs.rmSync(f, { force: true });
  return v;
});
rep('fs:existsSync:dir', () => require('fs').existsSync(fsdir));
rep('fs:statSync:isDir', () => require('fs').statSync(fsdir).isDirectory());
rep('fs:readdirSync:isArray', () => Array.isArray(require('fs').readdirSync(fsdir)));
rep('fs:realpathSync:shape', () => shape(require('fs').realpathSync(fsdir)));
rep('fs/promises:readFile:shape', () => shape(require('fs/promises').readFile));
rep('fs:constants:O_RDWR', () => require('fs').constants.O_RDWR);

// --- vm / wasi / readline / http2 / sqlite --------------------------------
rep('vm:createContext:shape', () => shape(require('vm').createContext));
rep('vm:runInNewContext', () => require('vm').runInNewContext('1+1'));
rep('wasi:WASI:shape', () => shape(require('node:wasi').WASI));
rep('readline:createInterface:shape', () => shape(require('readline').createInterface));
// These two are the modules the guard exists for: `shape()` alone would only
// prove the name is *present* (the WebContainer trap). Make a real first call.
rep('http2:createServer:call', () => {
  require('http2').createServer();
  return 'server';
});
rep('http2:getDefaultSettings:call', () => {
  const s = require('http2').getDefaultSettings();
  return shape(s);
});
rep('sqlite:DatabaseSync:new', () => {
  const { DatabaseSync } = require('node:sqlite');
  return shape(new DatabaseSync(':memory:'));
});

// --- node: prefix interop -------------------------------------------------
rep('nodePrefix:fsSame', () => require('node:fs') === require('fs'));
rep('nodePrefix:pathSame', () => require('node:path') === require('path'));

// =========================================================================
// M127 — depth pass.
//
// M124 proved a module can `require()` and still be unusable, and guarded that
// with one *first call* per builtin. But most of those checks only measured the
// *shape* of a name (`shape(fn)`), which is itself the WebContainer trap: a
// present-but-broken function passes `shape()`. This pass adds observations that
// must produce the same **value** — real round-trips, real parsed output, real
// error `code`/`name`/`message` — across more modules, so an implementation that
// resolves names but computes the wrong thing fails the gate too.
// Values are kept deterministic and host-independent (normalise tmp/abs paths).
// =========================================================================

// --- constants (tables the other modules read) ----------------------------
rep('constants:fs:O_RDWR', () => require('constants').fs.O_RDWR);
rep('constants:fs:O_CREAT', () => require('constants').fs.O_CREAT);
rep('constants:os:signals:SIGTERM', () => require('constants').os.signals.SIGTERM);
rep('constants:dns:ADDRCONFIG', () => require('constants').dns.ADDRCONFIG);
rep('constants:zlib:Z_BEST_COMPRESSION', () => require('constants').zlib.Z_BEST_COMPRESSION);
rep('constants:zlib:Z_SYNC_FLUSH', () => require('constants').zlib.Z_SYNC_FLUSH);

// --- path deeper ----------------------------------------------------------
rep('path:normalize', () => require('path').normalize('/a//b/../c/./d'));
rep('path:resolveRel', () => require('path').resolve('/a/b', '../c'));
rep('path:parseFormatRoundtrip', () => require('path').format(require('path').parse('/x/y/z.txt')));
rep('path:win32Join', () => require('path').win32.join('C:\\a', 'b', '..', 'c'));
rep('path:dirname', () => require('path').dirname('/a/b/c.txt'));
rep('path:basenameExt', () => require('path').basename('/a/b.c.txt', '.txt'));
rep('path:sep', () => require('path').sep);

// --- buffer deeper --------------------------------------------------------
rep('buffer:compare', () => Buffer.compare(Buffer.from('a'), Buffer.from('b')));
rep('buffer:equals', () => Buffer.from('x').equals(Buffer.from('x')));
rep('buffer:readInt32BE', () => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(-123456, 0);
  return b.readInt32BE(0);
});
rep('buffer:swap16', () => {
  const b = Buffer.from([1, 2, 3, 4]);
  b.swap16();
  return b.toString('hex');
});
rep('buffer:latin1', () => Buffer.from([0xe9, 0xff]).toString('latin1'));
rep('buffer:utf16le', () => Buffer.from('h\u00e9', 'utf16le').toString('hex'));
rep('buffer:writeUInt16LE', () => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(0x1234, 0);
  return b.toString('hex');
});
rep('buffer:indexOfBuffer', () => Buffer.from('hello world').indexOf(Buffer.from('world')));

// --- url deeper -----------------------------------------------------------
rep('url:resolve', () => require('url').resolve('https://a/b/c', '../d'));
rep('url:parseFormatRoundtrip', () => require('url').format(require('url').parse('https://h:8443/p?q=1#f')));
rep('url:URLSearchParams:toString', () => new URLSearchParams([['a', '1'], ['b', 'x y']]).toString());
rep('url:URL:pathname', () => new URL('https://h/a%20b/c?x#y').pathname);
rep('url:domainToASCII', () => require('url').domainToASCII('ma\u00f1ana.com'));

// --- querystring / string_decoder deeper ----------------------------------
rep('querystring:escape', () => require('querystring').escape('a b&c'));
rep('string_decoder:splitMultibyte', () => {
  const { StringDecoder } = require('string_decoder');
  const d = new StringDecoder('utf8');
  const full = Buffer.from('h\u00e9llo', 'utf8');
  return d.write(full.subarray(0, 2)) + d.write(full.subarray(2)) + d.end();
});
rep('string_decoder:endFlush', () => {
  const { StringDecoder } = require('string_decoder');
  const d = new StringDecoder('utf8');
  return d.write(Buffer.from([0xe2, 0x82])) + '|' + d.end() + '|';
});

// --- util deeper ----------------------------------------------------------
rep('util:format:percentJ', () => require('util').format('%j', { a: 1 }));
rep('util:inspect:depth', () => require('util').inspect({ a: { b: { c: { d: 1 } } } }, { depth: 2 }));
rep('util:stripVT', () => require('util').stripVTControlCharacters('\u001b[31mred\u001b[0m'));
rep('util:types:isTypedArray', () => require('util').types.isTypedArray(new Uint8Array(1)));
rep('util:types:isPromise', () => require('util').types.isPromise(Promise.resolve()));
rep('util:types:isArrayBuffer', () => require('util').types.isArrayBuffer(new ArrayBuffer(1)));

// --- assert deeper (error shape, not just success) ------------------------
rep('assert:AssertionError:name', () => {
  try {
    require('assert').strictEqual(1, 2);
  } catch (e) {
    return e.name;
  }
});
rep('assert:AssertionError:code', () => {
  try {
    require('assert').strictEqual(1, 2);
  } catch (e) {
    return e.code;
  }
});
rep('assert:AssertionError:message', () => {
  try {
    require('assert').strictEqual('a', 'b');
  } catch (e) {
    return e.message;
  }
});
rep('assert:ok:throwsName', () => {
  try {
    require('assert').ok(0);
  } catch (e) {
    return e.code;
  }
});

// --- events deeper --------------------------------------------------------
rep('events:errorMonitor:shape', () => shape(require('events').errorMonitor));
rep('events:listenerCount', () => {
  const { EventEmitter } = require('events');
  const e = new EventEmitter();
  e.on('x', () => {});
  e.on('x', () => {});
  return e.listenerCount('x');
});
rep('events:onceFiresOnce', () => {
  const { EventEmitter } = require('events');
  const e = new EventEmitter();
  let n = 0;
  e.once('x', () => n++);
  e.emit('x');
  e.emit('x');
  return n;
});
rep('events:prependListener:order', () => {
  const { EventEmitter } = require('events');
  const e = new EventEmitter();
  const seen = [];
  e.on('x', () => seen.push('a'));
  e.prependListener('x', () => seen.push('b'));
  e.emit('x');
  return seen.join(',');
});
rep('events:removeListenerCount', () => {
  const { EventEmitter } = require('events');
  const e = new EventEmitter();
  const h = () => {};
  e.on('x', h);
  e.off('x', h);
  return e.listenerCount('x');
});

// --- perf_hooks deeper ----------------------------------------------------
rep('perf_hooks:markMeasure', () => {
  const { performance } = require('perf_hooks');
  performance.mark('a');
  performance.measure('m', 'a');
  const e = performance.getEntriesByName('m')[0];
  return e.name + ':' + e.entryType;
});
rep('perf_hooks:clearMarks', () => {
  const { performance } = require('perf_hooks');
  performance.mark('b');
  performance.clearMarks('b');
  return performance.getEntriesByName('b').length;
});
rep('perf_hooks:timeOrigin:shape', () => shape(require('perf_hooks').performance.timeOrigin));

// --- v8 deeper (structured-clone formats) ---------------------------------
rep('v8:serializeMap', () => {
  const v8 = require('v8');
  return v8.deserialize(v8.serialize(new Map([['a', 1]]))).get('a');
});
rep('v8:serializeSet:size', () => {
  const v8 = require('v8');
  return v8.deserialize(v8.serialize(new Set([1, 2, 3]))).size;
});
rep('v8:serializeDate', () => {
  const v8 = require('v8');
  return v8.deserialize(v8.serialize(new Date(0))).getTime();
});
rep('v8:serializeRegExp:flags', () => {
  const v8 = require('v8');
  return v8.deserialize(v8.serialize(/ab+c/gi)).flags;
});
rep('v8:serializeError:name', () => {
  const v8 = require('v8');
  return v8.deserialize(v8.serialize(new TypeError('x'))).name;
});
rep('v8:serializeUndefined', () => {
  const v8 = require('v8');
  return v8.deserialize(v8.serialize(undefined)) === undefined;
});

// --- zlib deeper ----------------------------------------------------------
rep('zlib:crc32', () => require('zlib').crc32('hello'));
rep('zlib:deflateHexRawLen', () => require('zlib').deflateRawSync(Buffer.from('hello world')).length);
rep('zlib:unzipAuto:gzip', () => require('zlib').unzipSync(require('zlib').gzipSync(Buffer.from('z'))).toString());
rep('zlib:deflateRawInvalid:code', () => {
  try {
    require('zlib').inflateRawSync(Buffer.from([1, 2, 3, 4]));
    return 'no-throw';
  } catch (e) {
    return e.code;
  }
});

// --- console / domain / punycode / readline -------------------------------
rep('console:Console:shape', () => shape(require('console').Console));
rep('console:log:shape', () => shape(require('console').log));
rep('domain:create:shape', () => shape(require('domain').create));
rep('domain:run', () => {
  const d = require('domain').create();
  let ran = false;
  d.run(() => {
    ran = true;
  });
  return ran;
});
rep('punycode:toASCII', () => require('punycode').toASCII('ma\u00f1ana.com'));
rep('punycode:toUnicode', () => require('punycode').toUnicode('xn--maana-pta.com'));
rep('readline:createInterface:shape', () => shape(require('readline').createInterface));
rep('stream/web:ReadableStream:shape', () => shape(require('stream/web').ReadableStream));
rep('stream/web:TransformStream:shape', () => shape(require('stream/web').TransformStream));
// --- trace_events: real call, not a typeof check --------------------------
// `shape()` alone would pass even for a throwing stub, so this one *calls* it.
rep('trace_events:createTracing', () => {
  return require('trace_events').createTracing({ categories: ['node'] }).categories;
});

// --- worker_threads: synchronous port round-trip --------------------------
rep('worker_threads:receiveMessageOnPort', () => {
  const { MessageChannel, receiveMessageOnPort } = require('worker_threads');
  const { port1, port2 } = new MessageChannel();
  port1.unref();
  port2.unref();
  port1.postMessage({ hello: 'world', n: 42 });
  const m = receiveMessageOnPort(port2);
  return m && m.message ? m.message.hello + ':' + m.message.n : 'none';
});

// --- fs error shapes (code/name/syscall), not just success ----------------
rep('fs:readFileSync:missing:code', () => {
  try {
    require('fs').readFileSync(fsdir + '/nope-' + Date.now() + '.txt', 'utf8');
    return 'no-throw';
  } catch (e) {
    return e.code;
  }
});
rep('fs:readFileSync:missing:name', () => {
  try {
    require('fs').readFileSync(fsdir + '/nope-' + Date.now() + '.txt', 'utf8');
    return 'no-throw';
  } catch (e) {
    return e.name;
  }
});
rep('fs:readdirSync:missing:code', () => {
  try {
    require('fs').readdirSync(fsdir + '/nope-' + Date.now());
    return 'no-throw';
  } catch (e) {
    return e.code;
  }
});
rep('fs:rmdirSync:onFile:code', () => {
  const fs = require('fs');
  const f = fsdir + '/rmdir-target.txt';
  fs.writeFileSync(f, 'x');
  try {
    fs.rmdirSync(f);
    return 'no-throw';
  } catch (e) {
    return e.code;
  } finally {
    fs.rmSync(f, { force: true });
  }
});
rep('fs:mkdirSync:existsNoRecursive:code', () => {
  try {
    require('fs').mkdirSync(fsdir);
    return 'no-throw';
  } catch (e) {
    return e.code;
  }
});

async function main() {
  // M127 — async deep round-trips. These await real work (a timer, stream
  // consumers, fs/promises) and record the resolved value, so a promise-shaped
  // stub that never settles or resolves wrong is caught too.
  const arep = async (key, fn) => {
    try {
      const v = await fn();
      out[key] = v === undefined ? 'undefined' : v;
    } catch (e) {
      out[key] = 'throw:' + ((e && (e.code || e.name)) || 'Error');
    }
  };
  await arep('async:timers/promises:setTimeout', async () => {
    await require('timers/promises').setTimeout(1);
    return 'ok';
  });
  await arep('async:stream/consumers:text', () =>
    require('stream/consumers').text(require('stream').Readable.from(['a', 'b'])),
  );
  await arep('async:stream/consumers:json', async () =>
    JSON.stringify(await require('stream/consumers').json(require('stream').Readable.from(['{"a":', '1}']))),
  );
  await arep('async:stream/consumers:buffer', async () =>
    (await require('stream/consumers').buffer(require('stream').Readable.from([Buffer.from('hi')]))).toString(),
  );
  await arep('async:fs/promises:writeRead', async () => {
    const f = fsdir + '/promise.txt';
    await require('fs/promises').writeFile(f, 'yo');
    const v = await require('fs/promises').readFile(f, 'utf8');
    await require('fs/promises').rm(f);
    return v;
  });

  console.log('__OBS__ ' + JSON.stringify(out));
}

main().catch((e) => {
  console.log('__OBS__ ' + JSON.stringify({ __error: String((e && e.message) || e) }));
});
