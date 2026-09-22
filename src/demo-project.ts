/**
 * The demo project mounted into the VFS on first boot.
 * Everything here runs inside the browser worker — no server involved.
 *
 * NOTE for maintainers: the embedded sources are TS template literals, so any
 * backtick / `${` / backslash in them would need escaping. Keep the demo code
 * free of all three (use separate `console.log('')` calls instead of `\n`).
 */
export const DEMO_FILES: Record<string, string> = {
  '/project/package.json': JSON.stringify(
    {
      name: 'web-node-demo',
      version: '1.0.0',
      type: 'commonjs',
      main: 'index.js',
      scripts: { start: 'node index.js', postinstall: 'node lib/report.js > postinstall.txt' },
      dependencies: {
        ms: '^2.1.3',
        // Pinned to the 0.21 line: Vite 5.4 drives esbuild through its 0.21 API,
        // and a mismatched esbuild-wasm throws on transforms Vite asks for.
        'esbuild-wasm': '^0.21.5',
        '@rollup/wasm-node': '^4.63.3',
        vite: '^5.4.0',
        vue: '^3.5.0',
        '@vitejs/plugin-vue': '^5.2.0',
        postcss: '^8.4.43',
        picocolors: '^1.0.0',
        'source-map-js': '^1.2.0',
        nanoid: '^3.3.7',
        // A `file:` dependency: installed straight out of this virtual file
        // system (see lib/greeting) instead of the registry.
        '@demo/greeting': 'file:lib/greeting',
      },
      // Root overrides pin a transitive dependency's version (npm `overrides`,
      // or yarn's `resolutions`). This one keeps nanoid on the 3.x line.
      overrides: { nanoid: '^3.3.7' },
    },
    null,
    2,
  ),

  '/project/lib/greeting/package.json': JSON.stringify(
    { name: '@demo/greeting', version: '1.2.3', main: 'index.js' },
    null,
    2,
  ),
  '/project/lib/greeting/index.js': `// Installed with "file:lib/greeting", so this file is copied into
// node_modules/@demo/greeting by the installer.
module.exports = 'hello from file:lib/greeting@1.2.3';
`,

  // The worker a `new Worker(...)` in index.js boots. It runs in its own module
  // registry with its own globals, and talks to the parent over its parentPort.
  '/project/lib/worker-demo.js': `const { parentPort, workerData, isMainThread, threadId } = require('worker_threads');
parentPort.postMessage({
  workerData: workerData,
  isMainThread: isMainThread,
  threadIdPositive: threadId > 0,
});
parentPort.on('message', function (m) {
  parentPort.postMessage('re:' + m);
  parentPort.close();
});
`,

  // The worker for the stdio demo: its console.log travels over `worker.stdout`
  // (piped to the parent's by default), and `process.stdin` reads what the parent
  // writes to `worker.stdin`.
  '/project/lib/worker-io.js': `const { parentPort } = require('worker_threads');
console.log('worker: hi over stdout');
process.stdin.on('data', function (d) { parentPort.postMessage('stdin:' + String(d).trim()); });
process.stdin.on('end', function () { parentPort.postMessage('end'); parentPort.close(); });
`,

  '/project/index.js': `// Runs on Node.js compiled-in-browser. No server. No install.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');
const { Transform, pipeline, Readable, Writable } = require('stream');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

console.log('=== web-node demo ===');
console.log('project     :', pkg.name, pkg.version);
console.log('platform    :', process.platform, '/', process.arch);
console.log('node        :', process.version);
console.log('cwd         :', process.cwd());
console.log('');

// --- real vendored Node path.js ---
console.log('-- path (vendored from Node source) --');
console.log('join        :', path.join('/a', 'b', '..', 'c'));
console.log('normalize   :', path.normalize('/a/./b/../c//'));
console.log('extname     :', path.extname('archive.tar.gz'));
console.log('');

// --- Buffer ---
console.log('-- buffer --');
const buf = Buffer.from('hello web-node');
console.log('hex         :', buf.toString('hex'));
console.log('base64      :', buf.toString('base64'));
console.log('slice       :', buf.slice(0, 5).toString());
// slice/subarray alias the backing store, like Node: writing the view writes
// the original.
const backing = Buffer.from([1, 2, 3, 4]);
const view = backing.subarray(1, 3);
view[0] = 99;
console.log('view shares :', backing[1] === 99);
// Small allocations are carved from one 64 KiB slab, as in Node, so the
// backing store is shared and byteOffset is meaningful (and 8-byte aligned).
const pooled = Buffer.allocUnsafe(8);
console.log('pool slab   :', pooled.buffer.byteLength === Buffer.poolSize + 64, 'byteOffset', pooled.byteOffset);
console.log('');

// --- fs over the virtual file system ---
console.log('-- fs (virtual, persisted to OPFS) --');
const dir = '/project/output';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'report.txt'), 'generated at ' + new Date().toISOString());
console.log('written     :', fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'));
console.log('readdir     :', fs.readdirSync('/project').sort().join(', '));
console.log('stat.size   :', fs.statSync(path.join(dir, 'report.txt')).size, 'bytes');
console.log('');

// --- local module + ESM ---
const { fib } = require('./lib/fib.js');
console.log('-- local require --');
console.log('fib(10)     :', fib(10));
console.log('');

// --- events + timers (async) ---
const emitter = new EventEmitter();
emitter.on('tick', (n) => console.log('event       : tick #' + n));
let n = 0;
const timer = setInterval(() => {
  emitter.emit('tick', ++n);
  if (n === 3) {
    clearInterval(timer);
    console.log('done. platform:', os.platform(), '| uptime:', process.uptime().toFixed(3) + 's');
  }
}, 120);

console.log('scheduled 3 async ticks...');
console.log('');

// --- streams (milestone 4) ---
// Readable/Writable/Transform/pipe are real here: chunk sizes are bounded by a
// high-water mark and pipe() propagates backpressure.
console.log('-- stream --');
const { Readable: DefaultsReadable } = require('stream');
console.log(
  'hwm default : ' +
    new DefaultsReadable().readableHighWaterMark +
    ' bytes / ' +
    new DefaultsReadable({ objectMode: true }).readableHighWaterMark +
    ' objects'
);
// Readable.from is Node's own source: a string is one chunk, not per char.
(function () {
  const readableFrom = require('stream').Readable.from;
  const chunks = [];
  const r = readableFrom('abc');
  r.on('data', function (c) { chunks.push(String(c)); });
  r.on('end', function () {
    console.log('from(string): ' + chunks.length + ' chunk(s) -> ' + JSON.stringify(chunks));
  });
})();
// stream.isReadable/isWritable/isDisturbed/isErrored are Node's own predicates
// (internal/streams/utils.js), reading our _readableState/_writableState.
(function () {
  const stream = require('stream');
  const live = new stream.Readable({ read: function () {} });
  const done = new stream.Readable({ read: function () {} });
  done.push('x');
  done.push(null);
  done.resume();
  done.on('end', function () {
    console.log(
      'predicates  : live isReadable=' + stream.isReadable(live) +
        ' / ended isReadable=' + stream.isReadable(done) +
        ' isDisturbed=' + stream.isDisturbed(done)
    );
  });
})();
// destroy() / finished() run on Node's own destroy source
// (internal/streams/destroy.js): a destroy emits 'error' then 'close' on the
// next tick, and finished() flags a close that beats the writable half as
// ERR_STREAM_PREMATURE_CLOSE.
(function () {
  const stream = require('stream');
  const order = [];
  const r = new stream.Readable({ read: function () {} });
  r.on('error', function (e) { order.push('error:' + e.message); });
  r.on('close', function () { order.push('close'); });
  r.destroy(new Error('boom'));
  console.log(
    'destroy sync: destroyed=' + r.destroyed + ' closed=' + r.closed +
      ' errored=' + (r.errored && r.errored.message)
  );
  process.nextTick(function () {
    console.log(
      'destroy async: ' + order.join(' then ') +
        ' (isDestroyed=' + stream.isDestroyed(r) + ')'
    );
  });

  const w = new stream.Writable({ write: function (_c, _e, cb) { cb(); } });
  stream.promises.finished(w).then(
    function () { console.log('premature  : resolved'); },
    function (e) { console.log('premature  : ' + e.code + ' (' + e.message + ')'); }
  );
  w.destroy();
})();
// finished() IS Node's end-of-stream (internal/streams/end-of-stream.js): a real
// AbortSignal rejects it with an AbortError, and it runs its own options object.
// As in Node, finished takes a callback — the promise form is stream/promises.
(function () {
  const stream = require('stream');
  const r = new stream.Readable({ read: function () {} });
  const ac = new AbortController();
  const p = stream.promises.finished(r, { signal: ac.signal });
  ac.abort();
  p.then(
    function () { console.log('end-of-strm: resolved'); },
    function (e) { console.log('end-of-strm: ' + e.name + ' / ' + e.code); }
  );
  const w = new stream.Writable({ write: function (_c, _e, cb) { cb(); } });
  stream.promises.finished(w, { readable: false }).then(function () {
    console.log('end-of-strm: readable:false waited for the writable half');
  });
  w.end('done');
})();
// events is Node's real events.js (not a Map-backed shim): prependListener
// really pre-empts, and captureRejections routes a rejected listener to error.
// stream.addAbortSignal is the real internal/streams/add-abort-signal.js.
(function () {
  const EventEmitter = require('events');
  const ee = new EventEmitter();
  const order = [];
  ee.on('x', function () { order.push('on'); });
  ee.prependListener('x', function () { order.push('prepend'); });
  ee.emit('x');
  console.log('events     : ' + order.join(' then ') + ' (maxListeners=' + ee.getMaxListeners() + ')');

  const stream = require('stream');
  const r = new stream.Readable({ read: function () {} });
  const ac = new AbortController();
  r.on('error', function (e) { console.log('abortsignal: ' + e.name + ' / ' + e.code); });
  stream.addAbortSignal(ac.signal, r);
  ac.abort();
})();
// Readable/Writable/Duplex/Transform/PassThrough are Node's own classes now, and
// so are compose() and the async operators (map/filter): the whole module is the
// vendored lib/stream.js, not a hand-written stand-in.
(function () {
  const stream = require('stream');
  const upper = new stream.Transform({
    transform: function (chunk, _enc, cb) { cb(null, String(chunk).toUpperCase()); },
  });
  const out = [];
  upper.on('data', function (chunk) { out.push(String(chunk)); });
  upper.end('duplex');
  const composite = stream.compose(
    new stream.Transform({
      transform: function (chunk, _enc, cb) { cb(null, String(chunk) + '!'); },
    })
  );
  const composed = [];
  composite.on('data', function (chunk) { composed.push(String(chunk)); });
  composite.end('compose');
  setTimeout(function () {
    console.log('stream fam : transform=' + out.join('') + ' compose=' + composed.join(''));
  }, 10);
})();
// async_hooks is real Node source too (lib/async_hooks.js + internal/async_hooks.js
// + internal/async_local_storage/*), on a JS async_wrap binding. Each tick and
// timer is a real async resource, so a hook fires for them and AsyncLocalStorage
// carries its store across the async boundary.
(function () {
  const ah = require('async_hooks');
  const seen = [];
  const hook = ah.createHook({
    init: function (_id, type) { seen.push('init:' + type); },
  });
  hook.enable();
  const als = new ah.AsyncLocalStorage();
  als.run({ user: 'tang' }, function () {
    process.nextTick(function () { seen.push('tick=' + JSON.stringify(als.getStore())); });
    setTimeout(function () { seen.push('timer=' + JSON.stringify(als.getStore())); }, 5);
  });
  // Synchronous, so only the tick + timer scheduled above are reported.
  hook.disable();
  setTimeout(function () {
    console.log('async_hooks: ' + seen.join(' / '));
    console.log('als outside : ' + als.getStore());
  }, 15);
})();
const factsFile = path.join(dir, 'facts.txt');
fs.writeFileSync(factsFile, require('./lib/facts.js')().map(function (r) {
  return r[0] + ' = ' + r[1];
}).join('; ') + ';');

let streamed = 0;
let chunkCount = 0;
fs.createReadStream(factsFile, { highWaterMark: 16 })
  .on('data', function (chunk) { streamed += chunk.length; chunkCount++; })
  .on('end', function () {
    console.log('read stream : ' + streamed + ' bytes in ' + chunkCount + ' chunks of <=16');
  });

pipeline(
  fs.createReadStream(factsFile),
  new Transform({
    transform: function (chunk, enc, cb) { cb(null, chunk.toString().toUpperCase()); },
  }),
  fs.createWriteStream(path.join(dir, 'facts-upper.txt')),
  function (err) {
    console.log('pipeline    : ' + (err ? 'error ' + err.message : 'facts-upper.txt written'));
  }
);

// The pull API: a paused consumer driven by the 'readable' event, reading an
// exact byte count at a time (never a whole buffered chunk), and closing itself
// when the stream ends.
const pull = new Readable({ read: function () {} });
pull.push(fs.readFileSync(factsFile));
pull.push(null);
let pulled = 0;
let pulls = 0;
pull.on('readable', function () {
  let chunk;
  while ((chunk = pull.read(32)) !== null) {
    pulled += chunk.length;
    pulls++;
  }
});
pull.on('end', function () {
  console.log('read(32)    : ' + pulled + ' bytes in ' + pulls + ' exact reads');
});
pull.on('close', function () {
  // autoDestroy (on by default) closes the stream once it has ended.
  console.log('autoDestroy : closed, destroyed=' + pull.destroyed);
});
console.log('');

// --- child_process (milestone 7) ---
// A spawned program is a second module registry on the same event loop, with
// its own process view (argv/env/cwd/stdout/stderr) and its own pipes. There is
// no OS process, so what can be spawned is exactly what the VFS can run:
// JavaScript. Anything else is refused by name.
console.log('-- child_process --');
const { execFileSync, spawnSync, exec } = require('child_process');

// Synchronous listener, exactly like the desktop — output is printed here and
// now because the child finished without ever needing the event loop.
const report = execFileSync('node', [path.join(__dirname, 'lib', 'report.js')], { encoding: 'utf8' });
console.log('child out   : ' + report.trim());

// npm's own .bin entries are shell scripts, which a tab cannot execute. They are
// refused by name instead of half-run — which is exactly why the installer
// writes JavaScript shims into node_modules/.bin instead.
const refused = spawnSync('./tool.sh', []);
console.log('sh script   : ' + (refused.error ? refused.error.code : 'unexpectedly ran'));

// The shell is a real (small) parser: pipe the output of one virtual program
// into the next, asynchronously.
exec('node -e "process.stdout.write(String(6 * 7))" | node ' + path.join(__dirname, 'lib', 'upper.js'), function (err, stdout) {
  console.log('shell pipe  : ' + (err ? 'error ' + err.code : stdout));
});
console.log('');

// --- fork IPC (milestone 40) ---
// fork() runs a module the way 'node <module>' would and gives both sides a
// channel: the parent gets child.send / child.on('message') / child.disconnect,
// the child gets process.send / process.on('message') / process.disconnect.
// Messages are JSON by default (Node's default), and an open channel keeps the
// child alive instead of letting it exit the moment its module returns.
console.log('-- fork IPC (milestone 40) --');
const { fork } = require('child_process');
const kid = fork(path.join(__dirname, 'lib', 'ipc-child.js'));
kid.on('message', function (m) {
  console.log('child says  : ' + JSON.stringify(m));
  if (m.step === 2) kid.disconnect();
});
kid.on('disconnect', function () {
  console.log('disconnect  : connected=' + kid.connected);
});
kid.on('exit', function (code) {
  console.log('child exits : ' + code);
});
kid.send({ n: 21 });
console.log('');

// --- worker_threads (milestone 30) ---
// A MessageChannel is a real entangled port pair: messages are structured
// clones, a port can be transferred to the other side (and shows up in the
// event's ports array), and receiveMessageOnPort reads synchronously without
// starting the port. Only the thread-spawning half of worker_threads (Worker,
// postMessageToThread) is out of reach in a browser tab, and it says so.
console.log('-- worker_threads --');
const { MessageChannel, receiveMessageOnPort } = require('worker_threads');

const syncChannel = new MessageChannel();
syncChannel.port1.postMessage({ answer: 42 });
console.log('sync receive : ' + JSON.stringify(receiveMessageOnPort(syncChannel.port2).message));

const channel = new MessageChannel();
const handoff = new MessageChannel();
handoff.port2.onmessage = function (e) {
  console.log('transferred  : ' + e.data);
};
channel.port2.onmessage = function (e) {
  console.log('channel msg  : ' + JSON.stringify(e.data.payload) + ' ports=' + e.ports.length);
  // The received port is entangled with handoff.port2, so this is the round trip.
  e.ports[0].postMessage('round trip through the transferred port');
};
channel.port1.postMessage({ payload: { hello: 'world' }, port: handoff.port1 }, [handoff.port1]);
console.log('');

// --- Worker (milestone 57) ---
// A browser tab cannot start a thread, so a Worker here is a second module
// registry on the same event loop with its own globals and a real MessageChannel
// to the parent. workerData, the online/message/error/exit lifecycle and
// terminate() all behave as in Node; what is missing is parallelism, and that
// message-passing half is the whole point here.
console.log('-- worker_threads.Worker (milestone 57) --');
const { Worker } = require('worker_threads');
(async function () {
  const worker = new Worker(path.join(__dirname, 'lib/worker-demo.js'), {
    workerData: { from: 'main' },
  });
  const seen = [];
  worker.on('online', function () { seen.push('online'); worker.postMessage('ping'); });
  worker.on('message', function (m) { seen.push('message:' + JSON.stringify(m)); });
  worker.on('error', function (e) { seen.push('error:' + e.message); });
  await new Promise(function (resolve) { worker.on('exit', function (code) { seen.push('exit:' + code); resolve(); }); });
  console.log('events      : ' + seen.join(' '));
  console.log('');
})();

// --- worker stdio (milestone 59) ---
// A worker's stdout/stderr are real streams: their bytes cross a second
// MessageChannel. By default they are piped to the parent's, so the worker's
// console.log shows up right here; stdin: true hands the parent a Writable the
// worker reads as process.stdin.
console.log('-- worker stdio (milestone 59) --');
(async function () {
  const ioWorker = new Worker(path.join(__dirname, 'lib/worker-io.js'), { stdin: true });
  const ioEvents = [];
  ioWorker.on('message', function (m) { ioEvents.push(m); });
  ioWorker.on('online', function () {
    ioWorker.stdin.write('ping to the worker\\n');
    ioWorker.stdin.end();
  });
  await new Promise(function (resolve) { ioWorker.on('exit', function () { resolve(); }); });
  console.log('stdio       : ' + ioEvents.join(' '));
  console.log('');
})();

// --- internal/errors (milestone 58) ---
// The internal/errors table now covers every code the vendored modules ask for.
// Each entry is a real constructor: name is the built-in base it extends and
// code rides on the instance, exactly as in Node (previously a code that was
// referenced but not declared came back undefined and new threw).
console.log('-- internal/errors (milestone 58) --');
const { codes } = require('internal/errors');
const useAfterClose = new codes.ERR_USE_AFTER_CLOSE('readline');
const notIterable = new codes.ERR_ARG_NOT_ITERABLE('value');
console.log('use-after-close : ' + useAfterClose.name + ' ' + useAfterClose.code + ' - ' + useAfterClose.message);
console.log('not-iterable    : ' + notIterable.name + ' ' + notIterable.code + ' - ' + notIterable.message);
console.log('');

// --- internal/errors: SystemError codes (milestone 60) ---
// Codes Node declares with E(code, msg, SystemError) build their message from a
// *context object* and call themselves "SystemError" (the suffix is
// ": syscall returned code (message) path => dest"). The table used to build
// them like ordinary codes, which dropped both, and two sibling codes had each
// other's wording.
console.log('-- internal/errors: SystemError codes (milestone 60) --');
const cpConflict = new codes.ERR_FS_CP_EINVAL({
  message: 'src and dest cannot be the same',
  path: '/a',
  dest: '/b',
  syscall: 'cp',
  code: 'EINVAL',
});
console.log('system-error    : ' + cpConflict.name + ' [' + cpConflict.code + '] ' + cpConflict.message);
console.log('');

// --- binding surface (milestone 61) ---
// Node's internal code reaches the host only through internalBinding(id), then
// reads named properties off it. A name the binding doesn't define is
// undefined, and the call site throws "is not a function" the first time that
// path runs. The surface is now complete for everything the vendored tree reads:
// the full libuv errno set, the V8 heap-profiler sampling flags, the
// extensionless-module format table, and util's markPromiseAsHandled (which
// stream/iter relies on for promises it deliberately abandons).
console.log('-- binding surface (milestone 61) --');
const util = require('util');
console.log('libuv errnos    : ' + util.getSystemErrorMap().size + ' (e.g. -28 = "' + util.getSystemErrorName(-28) + '")');
(async function () {
  const { from } = require('stream/iter');
  const symbol = Symbol.for('Stream.toAsyncStreamable');
  const source = {};
  source[symbol] = function () { return Promise.reject(new Error('abandoned')); };
  const iterable = from(source);
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  console.log('markPromiseAsHandled: ok (stream/iter tolerated ' + typeof iterable + ' from a rejected protocol)');
  console.log('');
})();

// --- readline (milestone 31) ---
// A "terminal" here is just an { input, output } stream pair - a tab has no TTY,
// but the line editor, the keypress decoder, the ANSI cursor writers and the
// history ring are all plain Node code running on streams.
console.log('-- readline --');
const readline = require('readline');

let ansi = '';
const term = new Writable({ write: function (c, e, cb) { ansi += c.toString(); cb(); } });
readline.cursorTo(term, 3, 2);
readline.clearLine(term, 0);
console.log('cursor      : ' + JSON.stringify(ansi));

const keys = [];
const keyboard = new Readable({ read: function () {} });
readline.emitKeypressEvents(keyboard);
keyboard.on('keypress', function (s, k) {
  keys.push(k.name + (k.ctrl ? '+ctrl' : '') + (k.shift ? '+shift' : ''));
});
['a', '\u001b[A', '\u0003'].forEach(function (seq) { keyboard.push(Buffer.from(seq)); });
// Key decoding happens when the stream's 'data' event fires, so it lands a tick
// later - exactly as on the desktop (a synchronous read here still sees []).
setImmediate(function () { console.log('keypress    : ' + keys.join(', ')); });

const editor = readline.createInterface({ input: Readable.from(['first\\nsecond\\n']), terminal: false });
const seen = [];
editor.on('line', function (line) { seen.push(line); });
editor.on('close', function () { console.log('edit lines  : ' + JSON.stringify(seen)); });
console.log('');

// --- glob (milestone 33) ---
// path.matchesGlob and fs.glob* are Node's real glob walker (internal/fs/glob.js)
// over the bundled minimatch matcher, walking the virtual filesystem. cwd is
// given explicitly so the walk does not depend on how the host process resolves
// relative paths.
console.log('-- glob (milestone 33) --');
const fsm = require('fs');
const pathm = require('path');
const globRoot = process.cwd() + '/globdemo';
fsm.mkdirSync(globRoot + '/src/deep', { recursive: true });
fsm.writeFileSync(globRoot + '/index.js', '');
fsm.writeFileSync(globRoot + '/src/a.js', '');
fsm.writeFileSync(globRoot + '/src/notes.txt', '');
fsm.writeFileSync(globRoot + '/src/deep/c.js', '');
console.log('matchesGlob : ' + pathm.matchesGlob('/a/b/c.txt', '**/*.txt') + ' ' + pathm.matchesGlob('a/b.js', '*.js'));
console.log('globSync    : ' + JSON.stringify(fsm.globSync('**/*.js', { cwd: globRoot })));
console.log('exclude     : ' + JSON.stringify(fsm.globSync('**/*.js', { cwd: globRoot, exclude: function (p) { return p.indexOf('deep') !== -1; } })));
(async function () {
  const out = [];
  for await (const match of fsm.promises.glob('src/*.js', { cwd: globRoot })) out.push(match);
  console.log('async glob  : ' + JSON.stringify(out));
})();
console.log('');

// --- crypto (milestone 34) ---
// The digest/MAC/KDF half of node:crypto has to be synchronous, and WebCrypto
// is promise-only, so SHA-2, HMAC, PBKDF2, HKDF and scrypt are implemented in
// plain JS (src/node-runtime/crypto/hash.ts). Randomness still rides on the
// platform's WebCrypto, exactly like Node rides on OpenSSL's RAND_bytes.
console.log('-- crypto (milestone 34) --');
const crypto = require('crypto');
console.log('sha256(abc) : ' + crypto.createHash('sha256').update('abc').digest('hex'));
console.log('sha512(abc) : ' + crypto.createHash('sha512').update('abc').digest('hex').slice(0, 40) + '...');
console.log('md5(abc)    : ' + crypto.createHash('md5').update('abc').digest('hex'));
console.log('hmac-sha256 : ' + crypto.createHmac('sha256', 'secret-key').update('hello world').digest('hex'));
console.log('pbkdf2      : ' + crypto.pbkdf2Sync('password', 'salt', 1000, 16, 'sha256').toString('hex'));
console.log('hkdf        : ' + Buffer.from(crypto.hkdfSync('sha256', 'key', 'salt', 'info', 16)).toString('hex'));
console.log('scrypt      : ' + crypto.scryptSync('password', 'salt', 16, { N: 1024, r: 8, p: 1 }).toString('hex'));
console.log('timingSafe  : ' + crypto.timingSafeEqual(Buffer.from('abcd'), Buffer.from('abcd')));
console.log('randomInt   : ' + (crypto.randomInt(1, 7) >= 1 ? 'in range (1..6)' : 'OUT OF RANGE'));
console.log('randomUUID  : ' + crypto.randomUUID().length + ' chars, ' + crypto.getHashes().length + ' hashes available');
console.log('');

// --- perf_hooks (milestone 35) ---
// Node's real perf_hooks: the marks/measures/observers half runs on a JS
// performance binding (the browser clock stands in for uv_hrtime). The
// histogram-backed createHistogram/monitorEventLoopDelay need the native
// hdr_histogram and throw.
console.log('-- perf_hooks (milestone 35) --');
const perfHooks = require('perf_hooks');
const perf = perfHooks.performance;
perf.mark('start');
let spin = 0;
for (let i = 0; i < 200000; i++) spin += i;
perf.mark('end');
const span = perf.measure('spin', 'start', 'end');
console.log('measure     : ' + span.entryType + ' ' + span.name + ' in ' + span.duration.toFixed(3) + 'ms');
console.log('marks       : ' + perf.getEntriesByType('mark').length + ' marks, ' + perf.getEntriesByType('measure').length + ' measure');
console.log('isMark      : ' + (perf.getEntriesByName('start')[0] instanceof perfHooks.PerformanceMark));
console.log('nodeTiming  : nodeStart=' + perf.nodeTiming.nodeStart + ' loopStart=' + perf.nodeTiming.loopStart);
console.log('createHistogram() -> ' + (function () { try { perfHooks.createHistogram(); return 'ok'; } catch (err) { return err.code || err.name; } })());
console.log('');

// --- stream/web (milestone 36) ---
// stream/web is the real WHATWG implementation (lib/stream/web.js + the whole
// internal/webstreams/* group): ReadableStream / WritableStream /
// TransformStream, the queuing strategies and the text codecs. The classic <->
// web bridges work too, so Readable.toWeb(stream) hands back a real web stream.
console.log('-- stream/web (milestone 36) --');
const webStreams = require('stream/web');
const nodeStream = require('stream');
(async function () {
  const rs = new webStreams.ReadableStream({
    start: function (c) { c.enqueue('node '); c.enqueue('in '); c.enqueue('the browser'); c.close(); },
  });
  const reader = rs.getReader();
  const parts = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    parts.push(r.value);
  }
  console.log('readable    : ' + parts.join(''));

  const ts = new webStreams.TransformStream({
    transform: function (chunk, c) { c.enqueue(String(chunk).toUpperCase()); },
  });
  const w = ts.writable.getWriter();
  const collected = (async function () {
    const out = [];
    const r = ts.readable.getReader();
    for (;;) { const x = await r.read(); if (x.done) break; out.push(x.value); }
    return out;
  })();
  await w.write('hello');
  await w.write(' web');
  await w.close();
  console.log('transform   : ' + (await collected).join(''));

  const toWeb = nodeStream.Readable.toWeb(nodeStream.Readable.from(['classic ', 'to ', 'web']));
  const tw = toWeb.getReader();
  const tparts = [];
  for (;;) { const x = await tw.read(); if (x.done) break; tparts.push(Buffer.from(x.value).toString()); }
  console.log('toWeb       : ' + tparts.join(''));
})();
console.log('');

// --- zlib (milestone 45) ---
// zlib is a real module now. The codec is the platform's CompressionStream /
// DecompressionStream, so the streaming and one-shot async forms match Node
// byte for byte with the default options; the sync forms have no platform
// counterpart and throw a typed error instead of guessing.
console.log('-- zlib (milestone 45) --');
const zlib = require('zlib');
zlib.gzip(Buffer.from('hello hello hello hello'), function (err, gz) {
  if (err) { console.log('gzip        : ' + err.message); return; }
  console.log('gzip hex    : ' + gz.toString('hex'));
  zlib.gunzip(gz, function (e2, back) {
    console.log('gunzip      : ' + (e2 ? e2.code : back.toString()));
  });
});
console.log('crc32       : ' + zlib.crc32('hello'));
const webZlib = require('stream/web');
(async function () {
  const cs = new webZlib.CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(Buffer.from('hello hello hello hello'));
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) { const r = await reader.read(); if (r.done) break; chunks.push(Buffer.from(r.value)); }
  console.log('CS deflate  : ' + Buffer.concat(chunks).toString('hex'));
})();
try { zlib.gzipSync('x'); } catch (e) { console.log('gzipSync    : ' + e.code); }
console.log('');

// --- AES ciphers (milestone 47) ---
// The symmetric half of node:crypto is here too: createCipheriv/
// createDecipheriv over AES in ECB/CBC/CTR/CFB/OFB/GCM. Node's ciphers are
// synchronous and streaming, so WebCrypto (promise-only) cannot stand in;
// they are implemented in plain JS (src/node-runtime/crypto/cipher.ts) and
// match OpenSSL byte for byte.
console.log('-- AES ciphers (milestone 47) --');
const cKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const cIv = Buffer.from('0f0e0d0c0b0a09080706050403020100', 'hex');
const cbc = crypto.createCipheriv('aes-128-cbc', cKey, cIv);
const cbcCt = Buffer.concat([cbc.update('The quick brown fox jumps over the lazy dog'), cbc.final()]);
console.log('cbc ct      : ' + cbcCt.toString('hex').slice(0, 40) + '...');
const cbcBack = crypto.createDecipheriv('aes-128-cbc', cKey, cIv);
console.log('cbc pt      : ' + Buffer.concat([cbcBack.update(cbcCt), cbcBack.final()]).toString());
const gcm = crypto.createCipheriv('aes-128-gcm', cKey, Buffer.from('0f0e0d0c0b0a090807060504', 'hex'));
gcm.setAAD(Buffer.from('header-v1'));
const gcmCt = Buffer.concat([gcm.update('hello world'), gcm.final()]);
console.log('gcm tag     : ' + gcm.getAuthTag().toString('hex'));
console.log('gcm ciphers : ' + crypto.getCiphers().filter(function (n) { return n.indexOf('aes-') === 0; }).length + ' aes entries');
console.log('');

// --- url (milestone 53) ---
// url is Node's real lib/url.js now: the legacy Url/parse/format/resolve API
// next to the WHATWG classes, and pathToFileURL/fileURLToPath. The WHATWG side
// comes from internal/url, which is bridged to the tab's own URL parser (Node's
// is native Ada; a browser already ships a spec-compliant one).
console.log('-- url (milestone 53) --');
var nodeUrl = require('url');
var parsedUrl = nodeUrl.parse('http://u:p@h.com:81/p/q?x=1#f');
console.log('parse       : ' + parsedUrl.hostname + ':' + parsedUrl.port + ' query=' + parsedUrl.query);
console.log('format      : ' + nodeUrl.format({ protocol: 'https:', host: 'h.com', pathname: '/p', query: { a: '1' } }));
console.log('resolve     : ' + nodeUrl.resolve('http://h.com/a/b', '../c'));
console.log('file url    : ' + nodeUrl.pathToFileURL('/project/a b.js').href + ' -> ' + nodeUrl.fileURLToPath('file:///project/a%20b.js'));
console.log('idna        : ' + nodeUrl.domainToASCII('münchen.de') + ' <- ' + nodeUrl.domainToUnicode('xn--mnchen-3ya.de'));
console.log('');

// --- v8 (milestone 54) ---
// v8 is Node's real lib/v8.js. serialize/deserialize are the real V8
// structured-clone wire format (version 15), reimplemented in JS in the
// 'serdes' binding because a page cannot reach V8's ValueSerializer. The heap
// and profiler surface is native-only, so it throws instead of inventing
// numbers.
console.log('-- v8 (milestone 54) --');
function wireVersionOf(v8mod) {
  var der = new v8mod.Deserializer(v8mod.serialize(1));
  der.readHeader();
  return der.getWireFormatVersion();
}
var nodeV8 = require('v8');
var wire = nodeV8.serialize({ a: [1, 2], when: new Date(0), re: /ab+c/gi });
console.log('serialize   : ' + wire.toString('hex'));
var backAgain = nodeV8.deserialize(wire);
console.log('deserialize : a=' + JSON.stringify(backAgain.a) + ' when=' + backAgain.when.toISOString() + ' re=' + backAgain.re.source + '/' + backAgain.re.flags);
var sharedRef = { v: 1 };
var twoRefs = nodeV8.deserialize(nodeV8.serialize({ x: sharedRef, y: sharedRef }));
console.log('references  : same=' + (twoRefs.x === twoRefs.y) + ' value=' + twoRefs.x.v);
console.log('typed array : ' + nodeV8.serialize(Buffer.from([1, 2, 3])).toString('hex'));
console.log('wire version: ' + wireVersionOf(nodeV8));
var oneByte = nodeV8.isStringOneByteRepresentation('abc');
console.log('one byte    : abc=' + oneByte + ' cjk=' + nodeV8.isStringOneByteRepresentation('中文'));
try {
  nodeV8.getHeapStatistics();
  console.log('heap stats  : unexpectedly available');
} catch (err) {
  console.log('heap stats  : throws (' + err.code + ')');
}
console.log('');

// --- tty (milestone 55) ---
// tty is Node's real lib/tty.js. A tab has no file descriptor and no terminal,
// so isatty answers false and the Read/WriteStream classes throw rather than
// pretend to be a console; the colour-depth logic (internal/tty) is real.
console.log('-- tty (milestone 55) --');
var nodeTty = require('tty');
function colorDepthOf(mod, env) {
  return mod.WriteStream.prototype.getColorDepth(env);
}
console.log('isatty      : 0=' + nodeTty.isatty(0) + ' 1=' + nodeTty.isatty(1) + ' -1=' + nodeTty.isatty(-1));
console.log('depth plain : ' + colorDepthOf(nodeTty));
console.log('depth force3: ' + colorDepthOf(nodeTty, { FORCE_COLOR: '3' }));
console.log('depth xterm : ' + colorDepthOf(nodeTty, { TERM: 'xterm-256color' }));
console.log('depth dumb  : ' + colorDepthOf(nodeTty, { TERM: 'dumb' }));
console.log('hasColors256: ' + nodeTty.WriteStream.prototype.hasColors(256, { FORCE_COLOR: '2' }));
try {
  new nodeTty.WriteStream(1);
  console.log('stream      : unexpectedly built');
} catch (err) {
  console.log('stream      : throws (' + err.code + ')');
}
console.log('');

// --- vm (milestone 56) ---
// vm is Node's real lib/vm.js. A page cannot build a second V8 realm, so the
// 'contextify' binding emulates a context: the sandbox object *is* the context
// (tagged with Node's contextify symbol), and a script runs inside a with-scope
// over it. Writes land on the sandbox, this/globalThis are the scope, and the
// completion value comes back; realm identity is the documented deviation.
console.log('-- vm (milestone 56) --');
var nodeVm = require('vm');
var sandbox = { seed: 41 };
console.log('expr        : ' + nodeVm.runInNewContext('seed + 1', sandbox));
nodeVm.runInNewContext('assigned = "yes"', sandbox);
console.log('sandbox     : seed=' + sandbox.seed + ' assigned=' + JSON.stringify(sandbox.assigned));
console.log('isolation   : typeof process=' + nodeVm.runInNewContext('typeof process'));
console.log('this===self : ' + nodeVm.runInNewContext('this===globalThis'));
console.log('isContext   : plain=' + nodeVm.isContext({}) + ' created=' + nodeVm.isContext(nodeVm.createContext({})));
console.log('script      : ' + new nodeVm.Script('6*7').runInThisContext());
var compiled = nodeVm.compileFunction('return a + b', ['a', 'b']);
console.log('compileFn   : ' + compiled(20, 22));
var parsing = nodeVm.createContext({ base: 100 });
console.log('parsingCtx  : ' + nodeVm.compileFunction('return base + 1', [], { parsingContext: parsing })());
try {
  nodeVm.runInNewContext('while(true){}', {}, { timeout: 10 });
  console.log('timeout     : unexpectedly allowed');
} catch (err) {
  console.log('timeout     : throws (' + err.code + ')');
}
console.log('');

// --- Blob (milestone 37) ---
// Blob and File are now the real lib/internal/blob.js + lib/internal/file.js
// running on a JS 'blob' binding. Blob is a global (and require('buffer').Blob
// agrees on identity); blob.stream() chunks on the original part boundaries.
console.log('-- Blob (milestone 37) --');
(async function () {
  const b = new Blob(['node ', 'in ', 'the browser']);
  console.log('size        : ' + b.size + ' type=' + JSON.stringify(b.type));
  console.log('text        : ' + (await b.text()));
  const chunks = [];
  const r = b.stream().getReader();
  for (;;) { const x = await r.read(); if (x.done) break; chunks.push(Buffer.from(x.value).toString()); }
  console.log('stream      : ' + JSON.stringify(chunks));
  const f = new File(['data'], 'demo.txt', { type: 'text/plain' });
  console.log('file        : ' + f.name + ' ' + f.size + ' ' + f.type);
  const sliced = b.slice(5, 7);
  console.log('slice       : ' + (await sliced.text()));
  const ob = await require('fs').openAsBlob('/project/index.js').catch(function () { return null; });
  console.log('openAsBlob  : ' + (ob ? ob.size + ' bytes from /project/index.js' : 'n/a'));
})();
console.log('');

// --- stream/iter (milestone 38) ---
// stream/iter is the new experimental iterable-streams API, and stream/consumers
// is the six-function consumer surface (text/json/buffer/bytes/arrayBuffer/blob).
// Both are the real Node source now; consumers only became possible once Blob
// (milestone 37) was real.
console.log('-- stream/iter (milestone 38) --');
(async function () {
  const si = require('stream/iter');
  const p = si.push();
  const collected = si.text(p.readable);
  await p.writer.write('node ');
  await p.writer.write('iter');
  await p.writer.end();
  console.log('iter text   : ' + (await collected));
  const up = si.pull(si.from(['a', 'b', 'c']), function (chunk) { return chunk; });
  console.log('iter pull   : ' + (await si.text(up)));
  console.log('iter merge  : ' + (await si.text(si.merge(si.from(['x']), si.from(['y'])))));
  const cons = require('stream/consumers');
  const R = require('stream').Readable;
  console.log('consumers   : ' + (await cons.text(R.from(['h', 'i']))) + ' / ' + JSON.stringify(await cons.json(R.from(['{"n"', ':1}']))));
})();
console.log('');

// --- npm (milestone 4) ---
// The npm client downloads and unpacks packages into the virtual node_modules.
// require() already resolves node_modules from the VFS, so once "Install deps"
// has run this call works exactly like it would on the desktop.
console.log('-- npm --');
try {
  const ms = require('ms');
  console.log('require(ms) :', ms(60000), '|', ms('2h') + 'ms');
} catch (err) {
  console.log('require(ms) : not installed yet - click "Install deps"');
}
console.log('');

// --- npm resolution (milestone 39) ---
// The installer understands two more things a real project uses: a "file:" (or
// "link:") dependency installed straight from this virtual file system, and a
// root "overrides"/"resolutions" table that pins a transitive dependency.
console.log('-- npm resolution (milestone 39) --');
try {
  console.log('file: dep   : ' + require('@demo/greeting'));
} catch (err) {
  console.log('file: dep   : not installed yet - click "Install deps"');
}
console.log('overrides   : ' + JSON.stringify(pkg.overrides || null));
console.log('');

// --- util.inspect / ICU column width (milestone 42) ---
// util.inspect is Node's real source; what sits under it is now faithful too.
// An async function* is both a generator and async in V8, so it is labelled
// AsyncGeneratorFunction; and the ICU width function measures columns, not
// code units, so double-width CJK lines up in console.table.
console.log('-- inspect (milestone 42) --');
const { inspect } = require('util');
console.log('async gen fn:', inspect(async function* named() {}));
// console.table widths come from the same ICU measure: '中文' is four columns,
// so the box borders line up even for double-width text.
console.table([{ name: '中文', n: 1 }, { name: 'ab', n: 2 }]);
console.log('');

// --- X.509 certificate parsing (milestone 87) ---
// crypto.X509Certificate is a real DER/PEM parser (Node's sits on OpenSSL,
// which a page does not have). The subject, serial, fingerprints, validity,
// SANs and signature all match a real Node field for field.
console.log('-- X509 certificate (milestone 87) --');
const certPem = [
  '-----BEGIN CERTIFICATE-----',
  'MIIEfTCCA2WgAwIBAgITA+BF231Dy7XYHGVb7KOu6ZLDfjANBgkqhkiG9w0BAQsF',
  'ADBgMQswCQYDVQQGEwJDTjERMA8GA1UECAwIWmhlamlhbmcxEDAOBgNVBAoMB05l',
  'dGVhc2UxETAPBgNVBAsMCENvZGVXYXZlMRkwFwYDVQQDDBBXZWItTm9kZSBUZXN0',
  'IENBMB4XDTI2MDkyMjA2MDIzMloXDTI4MTIyNTA2MDIzMlowbjELMAkGA1UEBhMC',
  'Q04xETAPBgNVBAgMCFpoZWppYW5nMREwDwYDVQQHDAhIYW5nemhvdTEQMA4GA1UE',
  'CgwHTmV0ZWFzZTERMA8GA1UECwwIQ29kZVdhdmUxFDASBgNVBAMMC2V4YW1wbGUu',
  'Y29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArjsOg8MVAkA1E+rM',
  'g+W/rwW+nIhx4TlBw1gG4VHSiUbTDtc3IVej+S7ohdURypGKZE7SjF9ibxLrCJ4C',
  'T9+UjCzjsQqZ23lkOJqYjv79juxgwvHTX9u6UtwHHKhIjk8dBV4lpNJKCXmr3ULn',
  'lAx6JeB76Kbos4hU/4Oe/+/LfRbAUDY7lJY7CwkqUXgy+H9O0hdFTB2w1fA47Fl/',
  'PCyZS7np+FEr5YNIK4FuH9ayBc3dgNbe4GdEx1Jaf9Tx7WhO75dM+zUCOU+FydcM',
  'LVs6AK9uVVnJSlLbgRY3u5ZK2lPDNpOmqBEshvPlKRRvSV2omP1c4ru69pKFgFZ1',
  'PvrWewIDAQABo4IBIDCCARwwPgYDVR0RBDcwNYILZXhhbXBsZS5jb22CDSouZXhh',
  'bXBsZS5jb22HBH8AAAGBEWFkbWluQGV4YW1wbGUuY29tMAwGA1UdEwEB/wQCMAAw',
  'DgYDVR0PAQH/BAQDAgWgMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjBd',
  'BggrBgEFBQcBAQRRME8wIwYIKwYBBQUHMAGGF2h0dHA6Ly9vY3NwLmV4YW1wbGUu',
  'Y29tMCgGCCsGAQUFBzAChhxodHRwOi8vY2EuZXhhbXBsZS5jb20vY2EuY3J0MB0G',
  'A1UdDgQWBBRA8/GtIvkOSDs/w2hkWok31yzwczAfBgNVHSMEGDAWgBQSG/yS6cGd',
  'LhRBAgG44KVorj6icjANBgkqhkiG9w0BAQsFAAOCAQEAAE6A9A74GLTPipCHroxi',
  'ARKVr60qebZBoGTvNfa+j+XsC4+Lne+eJJX+8rAhLdz4Wx3xt8ImPMt83W84kF4b',
  'GeOmnv9jCyvWASzpLWhpplXFKmmgpbAlap8bLaNyZrk4/EqtBY6ptN7Er5LBDlbF',
  'y+4PScCQZ3DgAr2bXPjivtHj9KbXDXwPzFM0xfdFpx9Da1WYnEQ9z3N8mRNWCWDC',
  'rfPVAfbM5beH+s9ShE7mBo6AsKIcNPl+QgvvgXL30jFzOYW7b2e14gv21lABXVBF',
  'D28VLxZR1iZXsoBG1RsVUnaNkRIzIbIowbK5/M2VYco56zXzCWAQ2L5QYmFfu+Ad',
  'ng==',
  '-----END CERTIFICATE-----',
].join('\\n');
const leafCert = new (require('crypto').X509Certificate)(certPem);
console.log('subject   :', leafCert.subject.split('\\n').join(' / '));
console.log('serial    :', leafCert.serialNumber);
console.log('sha256 fp :', leafCert.fingerprint256);
console.log('SAN       :', leafCert.subjectAltName);
console.log('valid     :', leafCert.validFrom, '->', leafCert.validTo);
console.log('checkHost :', leafCert.checkHost('www.example.com'), '/', leafCert.checkHost('nope.test'));
console.log('');

// --- prime generation / primality testing (milestone 88) ---
// generatePrimeSync / checkPrimeSync sit on pure BigInt maths here; in Node
// OpenSSL is underneath. The primality answers are exact (Miller-Rabin with a
// deterministic base set) and { safe: true } yields a safe prime whose half is
// prime too.
console.log('-- primes (milestone 88) --');
const primeCrypto = require('crypto');
console.log('checkPrimeSync 97n  :', primeCrypto.checkPrimeSync(97n));
console.log('checkPrimeSync 91n  :', primeCrypto.checkPrimeSync(91n));
const prime128 = primeCrypto.generatePrimeSync(128, { bigint: true });
console.log('generatePrimeSync128:', prime128.toString(16).slice(0, 20) + '...', '(' + prime128.toString(2).length + ' bits, prime=' + primeCrypto.checkPrimeSync(prime128) + ')');
const primeSafe = primeCrypto.generatePrimeSync(64, { safe: true, bigint: true });
console.log('safe prime (64 bit) :', primeSafe.toString());
console.log('  (p-1)/2 is prime  :', primeCrypto.checkPrimeSync((primeSafe - 1n) / 2n));
const primeCongruent = primeCrypto.generatePrimeSync(96, { add: 30n, rem: 11n, bigint: true });
console.log('p congruent 11 mod30:', primeCongruent % 30n === 11n);
console.log('');

// --- Argon2 password hashing (milestone 89) ---
// crypto.argon2Sync runs RFC 9106 in pure JS (BLAKE2b + the BlaMka compression
// function). The first vector below is RFC 9106 section 5.3 and matches Node
// byte for byte.
console.log('-- Argon2 (milestone 89) --');
const rfcTag = primeCrypto.argon2Sync('argon2id', {
  message: new Uint8Array(32).fill(1),
  nonce: new Uint8Array(16).fill(2),
  secret: new Uint8Array(8).fill(3),
  associatedData: new Uint8Array(12).fill(4),
  parallelism: 4,
  tagLength: 32,
  memory: 32,
  passes: 3,
});
console.log('RFC 9106 argon2id   :', rfcTag.toString('hex'));
const pwTag = primeCrypto.argon2Sync('argon2id', {
  message: 'password',
  nonce: 'somesalt',
  parallelism: 1,
  tagLength: 32,
  memory: 64,
  passes: 2,
});
console.log('argon2id("password"):', pwTag.toString('hex'));
console.log('tag length         :', pwTag.length);
console.log('');

// --- MAC (milestone 90.1) ---
// crypto.createMac is the OpenSSL provider MAC API. Here HMAC and BLAKE2b MAC
// are computed in JS; getMacs() lists every provider Node exposes.
console.log('-- MAC (milestone 90.1) --');
const macCrypto = require('crypto');
console.log('getMacs count       :', macCrypto.getMacs().length);
const hmacTag = macCrypto.createMac('hmac', Buffer.from('key'), { digest: 'sha256' }).update('data').final();
console.log('hmac sha256         :', hmacTag.toString('hex'));
const b2mac = macCrypto.createMac('blake2bmac', Buffer.alloc(64, 1), { outputLength: 16 });
b2mac.update('data');
console.log('blake2bmac (16B)    :', b2mac.final('hex'));
const kmacTag = macCrypto.createMac('kmac256', Buffer.alloc(32, 7), { customization: Buffer.from('demo'), outputLength: 32 });
kmacTag.update('data');
console.log('kmac256 (32B)       :', kmacTag.final('hex'));
const cmacTag = macCrypto.createMac('cmac', Buffer.alloc(16, 9), { cipher: 'aes-128-cbc' });
cmacTag.update('data');
console.log('cmac aes128         :', cmacTag.final('hex'));
const gmacTag = macCrypto.createMac('gmac', Buffer.alloc(16, 9), { cipher: 'aes-128-gcm', iv: Buffer.alloc(12, 5) });
gmacTag.update('data');
console.log('gmac aes128         :', gmacTag.final('hex'));
const b2sTag = macCrypto.createMac('blake2smac', Buffer.alloc(16, 9));
b2sTag.update('data');
console.log('blake2smac          :', b2sTag.final('hex'));
const polyTag = macCrypto.createMac('poly1305', Buffer.alloc(32, 1));
polyTag.update('data');
console.log('poly1305            :', polyTag.final('hex'));
const sipTag = macCrypto.createMac('siphash', Buffer.alloc(16, 1));
sipTag.update('data');
console.log('siphash             :', sipTag.final('hex'));
console.log('');

// --- http server (milestone 3: virtual TCP) ---
// listen(3000) binds a port inside this runtime. The ServiceWorker bridge at
// /preview/3000/ dials it, so this URL is reachable from the browser tab.
function page() {
  const rows = require('./lib/facts.js')()
    .map(function (row) {
      return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td></tr>';
    })
    .join('');
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>web-node preview</title>',
    '<style>',
    'body{margin:0;font:14px/1.6 ui-monospace,Menlo,monospace;background:#0b0e14;color:#d7dee9;padding:32px}',
    'h1{font-size:18px;color:#5ef1a5;margin:0 0 4px}',
    '.sub{color:#7b8798;margin-bottom:20px}',
    'table{border-collapse:collapse;width:100%;max-width:560px}',
    'td{padding:7px 10px;border-bottom:1px solid #232a3a}',
    'td:first-child{color:#7b8798;width:40%}',
    'a{color:#5ef1a5}',
    '</style></head><body>',
    '<h1>Hello from your in-browser Node.js server</h1>',
    '<div class="sub">This HTML was rendered inside the runtime worker and piped through a virtual TCP socket.</div>',
    '<table>' + rows + '</table>',
    '<p style="margin-top:24px"><a href="/api/info">GET /api/info</a> &middot; <a href="/api/fib?n=20">GET /api/fib?n=20</a></p>',
    '<p><a href="/download/facts.txt">GET /download/facts.txt</a> (fs.createReadStream().pipe(res))</p>',
    '<p><a href="/api/stream">GET /api/stream</a> (5 x res.write() -> Transfer-Encoding: chunked)</p>',
    '<p><a href="/api/ls?dir=/project/output">GET /api/ls?dir=/project/output</a> (what the streams wrote)</p>',
    '</body></html>',
  ].join('');
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost:3000');

  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      time: new Date().toISOString(),
    }, null, 2));
    return;
  }

  if (url.pathname === '/api/fib') {
    const value = Number(url.searchParams.get('n') || 10);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ n: value, fib: fib(value) }));
    return;
  }

  // Streamed straight off the virtual file system. No Content-Length is set,
  // so the response is framed as chunked and backpressure flows from the
  // socket back into the read stream.
  if (url.pathname === '/download/facts.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    fs.createReadStream(factsFile).pipe(res);
    return;
  }

  // Several writes over time: proves the server can stream a body it cannot
  // know the length of up front.
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    let i = 0;
    const timer = setInterval(function () {
      res.write('tick ' + (++i) + ';');
      if (i === 5) {
        clearInterval(timer);
        res.end('done');
      }
    }, 30);
    return;
  }

  // Reads the virtual file system back out, so the effects of the stream /
  // upload endpoints are visible from the browser.
  if (url.pathname === '/api/ls') {
    const target = url.searchParams.get('dir') || '/project';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fs.readdirSync(target).sort(), null, 2));
    return;
  }

  // Upload: the request body is a Readable, so it pipes straight to a file.
  if (url.pathname === '/api/upload') {
    fs.mkdirSync(dir, { recursive: true });
    const out = fs.createWriteStream(path.join(dir, 'upload.txt'));
    req.pipe(out);
    out.on('finish', function () {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ bytes: out.bytesWritten }));
    });
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
});

server.listen(3000, function () {
  console.log('http server  : listening on http://localhost:3000');
  console.log('preview      : open the Preview tab (or /preview/3000/)');
});
`,

  '/project/lib/fib.js': `// A plain CommonJS module resolved out of the virtual file system.
function fib(n) {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}

exports.fib = fib;
exports.default = { fib };
`,

  // A program that the demo spawns, and that spawns one more level from inside
  // the spawned program - the surface nests, because a child gets its own
  // module registry and its own `child_process`.
  '/project/lib/report.js': `// Runs as a *child* program (see index.js), and spawns a child of its own.
const { execFileSync } = require('child_process');

const nested = execFileSync('node', ['-e', 'process.stdout.write(String(6 * 7))'], { encoding: 'utf8' });
console.log('spawned pid ' + process.pid + ' in ' + process.cwd() + '; its own child said ' + nested);
`,

  // The second stage of the shell pipeline demoed from index.js.
  '/project/lib/upper.js': `let buf = '';
process.stdin.on('data', (chunk) => (buf += chunk.toString()));
process.stdin.on('end', () => process.stdout.write(buf.toUpperCase().trim() + ' (via pipe)'));
`,

  // The child half of the fork() IPC demo in index.js: it answers every message
  // it gets, and the parent hangs up after the second one.
  '/project/lib/ipc-child.js': `process.on('message', (m) => {
  process.send({ step: 1, doubled: m.n * 2 });
  process.send({ step: 2 });
});
`,

  // A shell script - the shape npm uses for its own .bin entries. A browser tab
  // cannot execute it, and the runtime says so rather than guessing.
  '/project/tool.sh': `#!/bin/sh
echo "this would run on a real POSIX host"
`,

  '/project/lib/facts.js': `// Feeds the HTML that the virtual HTTP server renders.
module.exports = function facts() {
  return [
    ['process.version', process.version],
    ['process.platform', process.platform],
    ['process.arch', process.arch],
    ['process.cwd()', process.cwd()],
    ['module resolution', 'CJS from the virtual file system'],
    ['transport', 'virtual TCP (no real socket)'],
  ];
};
`,

  '/project/src/greet.ts': `// TypeScript, compiled by esbuild inside the tab (see build.js).
export interface Greeting {
  to: string;
  message: string;
}

export function greet(to: string): Greeting {
  return { to: to, message: 'hello, ' + to + '!' };
}
`,

  '/project/src/app.ts': `import { greet, Greeting } from './greet';
import ms from 'ms';

const names: string[] = ['world', 'web-node', 'browser'];

const greetings: Greeting[] = names.map(function (n) {
  return greet(n);
});

export function banner(): string {
  return greetings.map(function (g) { return g.message; }).join(' | ');
}

console.log(banner() + '  (ms: ' + ms('2h') + 'ms)');
`,

  // Milestone 5: a real build tool — esbuild's WASM build — running in the tab.
  // It reads the virtual file system through a plugin and writes the bundle back.
  '/project/build.js': `// Click "Build" to run this: it bundles src/app.ts with esbuild-wasm.
const fs = require('fs');
const path = require('path');

const ROOT = '/project';
const WASM_PATH = path.join(ROOT, 'node_modules', 'esbuild-wasm', 'esbuild.wasm');

function dirname(p) {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

// esbuild's browser build has no file system, so everything it reads is served
// out of the virtual file system through a resolve/load plugin.
function vfsPlugin() {
  return {
    name: 'web-node-vfs',
    setup: function (build) {
      build.onResolve({ filter: /.*/ }, function (args) {
        if (args.kind === 'entry-point') return { path: args.path, namespace: 'vfs' };
        const base = args.resolveDir || dirname(args.importer) || ROOT;
        if (args.path.charAt(0) === '.' || args.path.charAt(0) === '/') {
          const joined = args.path.charAt(0) === '/' ? args.path : path.join(base, args.path);
          return { path: path.normalize(joined), namespace: 'vfs' };
        }
        try {
          return { path: require.resolve(args.path, { paths: [base] }), namespace: 'vfs' };
        } catch (err) {
          return { errors: [{ text: 'vfs: cannot resolve ' + args.path }] };
        }
      });
      build.onLoad({ filter: /.*/, namespace: 'vfs' }, function (args) {
        const tries = [
          args.path,
          args.path + '.ts',
          args.path + '.tsx',
          args.path + '.js',
          args.path + '.json',
          path.join(args.path, 'index.ts'),
          path.join(args.path, 'index.js'),
        ];
        for (let i = 0; i < tries.length; i++) {
          if (fs.existsSync(tries[i]) && fs.statSync(tries[i]).isFile()) {
            const file = tries[i];
            const ext = path.extname(file);
            const loader = ext === '.ts' ? 'ts' : ext === '.tsx' ? 'tsx' : ext === '.json' ? 'json' : 'js';
            return { contents: fs.readFileSync(file, 'utf8'), loader: loader, resolveDir: dirname(file) };
          }
        }
        return { errors: [{ text: 'vfs: cannot find ' + args.path }] };
      });
    },
  };
}

(async function () {
  console.log('-- build (milestone 5) --');
  if (!fs.existsSync(WASM_PATH)) {
    console.log('esbuild-wasm: not installed yet - click "Install deps" first');
    return;
  }
  const bytes = fs.readFileSync(WASM_PATH);
  const esbuild = require('esbuild-wasm');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'esbuild-wasm', 'package.json'), 'utf8')).version;
  console.log('tool        : esbuild-wasm v' + version + ' (' + (bytes.length / 1048576).toFixed(1) + ' MB wasm)');

  const t0 = Date.now();
  await esbuild.initialize({ wasmModule: await WebAssembly.compile(bytes), worker: false });
  console.log('wasm        : compiled + service started in ' + (Date.now() - t0) + 'ms');

  const t1 = Date.now();
  const result = await esbuild.build({
    entryPoints: [ROOT + '/src/app.ts'],
    bundle: true,
    format: 'cjs',
    target: 'es2020',
    write: false,
    plugins: [vfsPlugin()],
  });
  const code = result.outputFiles[0].text;
  fs.mkdirSync(ROOT + '/dist', { recursive: true });
  fs.writeFileSync(ROOT + '/dist/app.js', code);
  console.log('bundle      : ' + code.length + ' bytes in ' + (Date.now() - t1) + 'ms');
  console.log('written     : /project/dist/app.js');
  console.log('');
  console.log(code.trim());
})().catch(function (err) {
  console.log('build failed : ' + err.message);
});
`,

  '/project/app/text.js': `// A plain ES module, consumed by rollup (see bundle.js).
export const TITLE = 'web-node';

export function slugify(value) {
  return String(value).toLowerCase();
}

// Dead code: never imported, so rollup drops it from the bundle (tree-shaking).
export function explode() {
  throw new Error('never called');
}
`,

  '/project/app/main.js': `// ESM entry point for the rollup build.
import { slugify, TITLE } from './text.js';

const parts = ['Web', 'Node', 'Bundled'];

export const heading = TITLE + ': ' + parts.map(function (p) { return slugify(p); }).join('-');
`,

  // Milestone 5b: a real bundler — rollup's official WASM build — in the tab.
  // It reads project sources straight out of the virtual file system (our `fs`
  // is the VFS) and writes the bundle back.
  '/project/bundle.js': `// Click "Bundle" to run this: it bundles app/main.js with rollup-wasm.
const fs = require('fs');
const path = require('path');

const ROOT = '/project';
const OUT = path.join(ROOT, 'dist', 'app.esm.js');

(async function () {
  console.log('-- bundle (milestone 5b) --');
  if (!fs.existsSync(path.join(ROOT, 'node_modules', '@rollup', 'wasm-node'))) {
    console.log('rollup: not installed yet - click "Install deps" first');
    return;
  }
  const rollup = require('@rollup/wasm-node');
  console.log('tool        : rollup v' + rollup.VERSION + ' (official WASM build)');

  const t0 = Date.now();
  const bundle = await rollup.rollup({
    input: path.join(ROOT, 'app', 'main.js'),
    onwarn: function () {},
  });
  const result = await bundle.generate({ format: 'es', compact: true });
  const code = result.output[0].code;

  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(OUT, code);
  console.log('bundle      : ' + code.length + ' bytes in ' + (Date.now() - t0) + 'ms');
  console.log('tree-shaken : ' + (code.indexOf('explode') === -1 ? 'yes (dead export dropped)' : 'no'));
  console.log('written     : /project/dist/app.esm.js');
  console.log('');
  console.log(code.trim());
})().catch(function (err) {
  console.log('bundle failed : ' + (err && err.message ? err.message : err));
});
`,

  // Milestone 5c: the real thing — Vite itself builds the `site/` project in
  // the tab. Vite is pure ESM and expects the native esbuild addon; the runtime
  // aliases `esbuild`→`esbuild-wasm` and `rollup`→`@rollup/wasm-node`, so all
  // the tooling Vite reaches for resolves to a WASM build that a tab can run.
  '/project/vite-build.mjs': `// Click "Vite build" to run this: Vite bundles site/ inside the tab.
// Vite is loaded with a dynamic import() so the guard below can run first;
// a static import would be evaluated eagerly and fail before the check.
import fs from 'fs';
import path from 'path';

const ROOT = '/project';
const SITE = path.join(ROOT, 'site');
const NM = path.join(ROOT, 'node_modules');

(async function () {
  console.log('-- vite build (milestone 5c) --');
  if (!fs.existsSync(path.join(NM, 'vite'))) {
    console.log('vite: not installed yet - click "Install deps" first');
    return;
  }
  const vite = await import('vite');
  const { default: vue } = await import('@vitejs/plugin-vue');
  console.log('tool        : vite v' + vite.version + ' (running in the tab)');

  // Vite expects the native esbuild addon. A tab cannot load one, so the runtime
  // aliases 'esbuild' to its WASM build, which must be started explicitly first.
  const esbuild = await import('esbuild');
  const wasm = fs.readFileSync(path.join(NM, 'esbuild-wasm', 'esbuild.wasm'));
  const t0 = Date.now();
  await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });
  console.log('esbuild     : wasm started in ' + (Date.now() - t0) + 'ms');

  const t1 = Date.now();
  const result = await vite.build({
    root: SITE,
    logLevel: 'silent',
    plugins: [vue()],
    build: { write: false, minify: false },
  });
  const bundle = Array.isArray(result) ? result[0] : result;

  for (const chunk of bundle.output) {
    const dest = path.join(SITE, 'dist', chunk.fileName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, chunk.type === 'asset' ? String(chunk.source) : chunk.code);
  }
  console.log('built in    : ' + (Date.now() - t1) + 'ms');
  console.log('written     : /project/site/dist/');
  for (const chunk of bundle.output) console.log('  ' + chunk.fileName);
})().catch(function (err) {
  console.log('vite failed : ' + (err && err.message ? err.message : err));
});
`,

  // The project Vite builds. Deliberately plain ES modules so the interesting
  // part is the toolchain, not the source.
  '/project/site/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>web-node · vue + vite</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,

  // Milestone 18: a real framework. The app is a Vue 3 single-file component;
  // @vitejs/plugin-vue compiles the SFC (script setup + template) inside the
  // tab, so the same Vite buttons now drive a real Vue app.
  '/project/site/src/App.vue': `<script setup>
import { ref } from 'vue';

defineProps({ greeting: { type: String, default: 'Hello' } });
const count = ref(0);
</script>

<template>
  <h1>{{ greeting }}</h1>
  <button type="button" @click="count++">count is {{ count }}</button>
  <p class="hint">A real Vue 3 single-file component, compiled by Vite in the tab.</p>
</template>
`,

  '/project/site/src/main.js': `import { createApp } from 'vue';
import App from './App.vue';
import { greet } from './message.js';
import './style.css';

// App.vue is compiled by @vitejs/plugin-vue; the greeting comes from the plain
// module below, so the Vue plugin cannot hot-swap that one for us.
const app = createApp(App, { greeting: greet('vite') });
app.mount('#app');

// Accept updates to message.js and remount with the *new* greeting - no full
// reload. The callback gets the fresh module, so read the export from it.
if (import.meta.hot) {
  import.meta.hot.accept('./message.js', function (mod) {
    app.unmount();
    createApp(App, { greeting: mod.greet('vite') }).mount('#app');
  });
}
`,

  '/project/site/src/style.css': `/* Edited by the HMR CSS button: Vite sends a css-update and the preview
   restyles in place - no reload, no lost page state. */
#app {
  color: #5ef1a5;
  font: 600 22px/1.4 ui-monospace, Menlo, monospace;
}
`,

  '/project/site/src/message.js': `export function greet(who) {
  return 'Hello from ' + who + ', bundled in the browser';
}
`,

  // Milestone 5e: HMR over a *non-WebSocket* channel.
  //
  // A ServiceWorker cannot proxy a WebSocket (fetch never sees the upgrade), so
  // Vite's HMR socket is unreachable through the preview bridge. The preview
  // iframe is same-origin, though, so the injected shim swaps WebSocket for a
  // BroadcastChannel. Vite still *computes* the updates; we only carry them.
  '/project/vite-dev.mjs': `// Click "Vite dev" to run: Vite's dev server serves site/ in the tab (HMR on).
import fs from 'fs';
import path from 'path';

const ROOT = '/project';
const SITE = path.join(ROOT, 'site');
const NM = path.join(ROOT, 'node_modules');
const PORT = 5173;
// One HMR channel per port, so two dev servers on different ports never see
// each other's clients. Must match the name the preview shim builds
// (web-node-hmr:<port> in public/sw.js).
const HMR_CHANNEL = 'web-node-hmr:' + PORT;

// The object Vite treats as its HMR server (the shape createWebSocketServer
// returns: send / on / off / clients / close). The transport underneath is a
// BroadcastChannel to the preview iframe, not a socket.
function createHmrBridge() {
  const channel = new BroadcastChannel(HMR_CHANNEL);
  const clients = new Set();
  let onConnection = null;
  channel.onmessage = function (event) {
    const msg = event.data;
    if (!msg) return;
    if (msg.t === 'open') {
      clients.add(msg.id);
      channel.postMessage({ t: 'open', id: msg.id });
      // Vite's client waits for "connected" before flushing queued operations.
      channel.postMessage({ t: 'message', id: msg.id, data: JSON.stringify({ type: 'connected' }) });
      console.log('hmr         : preview connected (' + clients.size + ' client/s)');
      if (onConnection) onConnection({ send: function () {} }, {});
    } else if (msg.t === 'send') {
      let parsed = null;
      try { parsed = JSON.parse(msg.data); } catch (e) {}
      if (parsed && parsed.type === 'ping') {
        channel.postMessage({ t: 'message', id: msg.id, data: JSON.stringify({ type: 'pong' }) });
      }
    } else if (msg.t === 'close') {
      clients.delete(msg.id);
    }
  };
  return {
    name: 'web-node-hmr',
    get clients() { return clients; },
    send(payload) {
      const data = JSON.stringify(payload);
      clients.forEach(function (id) { channel.postMessage({ t: 'message', id: id, data: data }); });
    },
    on(event, fn) { if (event === 'connection') onConnection = fn; },
    off(event, fn) { if (event === 'connection' && onConnection === fn) onConnection = null; },
    listen() {},
    close() { clients.clear(); channel.close(); },
    handleUpgrade() {},
  };
}

// Vite's real watcher is chokidar, which wants fs.watch + inotify the tab does
// not have. Watch the VFS ourselves and forward events into Vite's (no-op)
// watcher, which is where the HMR pipeline is wired up.
function vfsWatchPlugin() {
  return {
    name: 'web-node-vfs-watch',
    configureServer(server) {
      const watcher = fs.watch(SITE, { recursive: true }, function (eventType, filename) {
        if (!filename) return;
        console.log('vfs-change  : ' + eventType + ' ' + filename);
        server.watcher.emit(eventType === 'change' ? 'change' : 'add', path.join(SITE, filename));
      });
      if (server.httpServer) server.httpServer.on('close', function () { watcher.close(); });
      console.log('watching    : ' + SITE + ' (VFS events -> Vite HMR)');
    },
  };
}

(async function () {
  console.log('-- vite dev server (milestone 5e) --');
  if (!fs.existsSync(path.join(NM, 'vite'))) {
    console.log('vite: not installed yet - click "Install deps" first');
    return;
  }
  const vite = await import('vite');
  const { default: vue } = await import('@vitejs/plugin-vue');
  console.log('tool        : vite v' + vite.version + ' dev server (in the tab)');

  const esbuild = await import('esbuild');
  const wasm = fs.readFileSync(path.join(NM, 'esbuild-wasm', 'esbuild.wasm'));
  const t0 = Date.now();
  await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });
  console.log('esbuild     : wasm started in ' + (Date.now() - t0) + 'ms');

  const server = await vite.createServer({
    root: SITE,
    logLevel: 'error',
    plugins: [vue(), vfsWatchPlugin()],
    // Vite pre-bundles bare deps with esbuild, and esbuild-wasm has no file
    // system (its reads throw "not implemented on js"). With a framework in the
    // graph that pre-bundling is required, so turn it off and let Vite serve
    // the dependencies' own ESM sources straight out of node_modules instead.
    optimizeDeps: { disabled: true },
    server: {
      host: '127.0.0.1',
      port: PORT,
      // No chokidar (see vfsWatchPlugin); HMR stays on but rides our bridge.
      watch: null,
      hmr: { protocol: 'ws', host: '127.0.0.1', port: PORT },
    },
  });

  // Replace Vite's WebSocket channel with the BroadcastChannel bridge. Vite
  // reads server.hot on every update, so swapping the reference is enough.
  const bridge = createHmrBridge();
  server.hot = bridge;
  server.ws = bridge;

  await server.listen();

  console.log('listening   : http://127.0.0.1:' + PORT);
  console.log('hmr         : BroadcastChannel "' + HMR_CHANNEL + '" (no WebSocket)');
  console.log('preview     : open Preview (:5173), then edit site/src/message.js');
})().catch(function (err) {
  console.log('vite dev failed : ' + (err && err.message ? err.message : err));
});
`,

  '/project/notes.md': `# web-node demo project

This project is mounted into an in-browser VFS. Edit any file and hit **Run**.

## What works today (milestone 3 + the streams prerequisite)

- Real Node.js core source (lib/path.js, lib/querystring.js, primordials) vendored and executed
- internalBinding() backed by TypeScript implementations over a virtual file system
- path / fs / buffer / events / util / console / timers / process / os / string_decoder / assert / querystring
- **net + http over a virtual TCP layer** — http.createServer().listen(3000) is reachable at /preview/3000/
- **ServiceWorker bridge** — a browser URL is routed into the runtime's port table
- **stream** — Readable / Writable / Duplex / Transform / PassThrough, real backpressure,
  pipe(), pipeline(), finished(), stream/promises, plus fs.createReadStream and
  fs.createWriteStream; the request is a Readable and the response a Writable,
  so req.pipe(res) works. Several pieces of Node's own stream core are vendored
  and run as-is: Readable.from, high-water-mark resolution, the state predicates,
  and now the real destroy/close chain
- **destroy() + finished()** — destroy, _undestroy and the error/close emit order
  come from Node's internal/streams/destroy.js; finished() is Node's real
  internal/streams/end-of-stream.js, so it honours the options object (readable/
  writable overrides, an AbortSignal → AbortError) and rejects a close that beats
  the writable half with ERR_STREAM_PREMATURE_CLOSE
- **Streams are the real thing** — the entire stream module is Node's own source
  (lib/stream.js + internal/streams/*): Readable, Writable, Duplex, Transform,
  PassThrough, pipeline, finished, compose, duplexPair, the async operators
  (map/filter/toArray), and stream/promises. There is no hand-written stream left
- **Events** — events is Node's real events.js (the _events/_eventsCount shape,
  prependListener, errorMonitor, captureRejections, the once/on helpers), and
  stream.addAbortSignal is the real internal/streams/add-abort-signal.js
- **async_hooks (milestone 12)** — async_hooks is Node's real source too
  (lib/async_hooks.js + internal/async_hooks.js + internal/async_local_storage/*),
  running on a JS async_wrap binding that keeps the async id stack. Each
  nextTick and timer is a real async resource, so createHook fires
  init/before/after for them and AsyncLocalStorage carries its store across a
  nextTick / setTimeout boundary
- **Chunked transfer-encoding** — a response without Content-Length streams as chunked,
  and the client side de-chunks it again
- **npm client (milestone 4)** — "Install deps" fetches the dependencies declared in
  package.json from the registry, gunzips + untars them into the virtual node_modules
  (npm-style hoisting, nesting on version conflicts), after which require('ms') just works
- **npm lockfiles + integrity (milestone 6)** — install records package-lock.json
  (lockfileVersion 3); a second install reuses the locked versions instead of
  re-resolving, and every tarball is checked against the registry's sha512/sha1
  before it is written. Missing peer dependencies are installed at the root too
- **npm resolution (milestone 39)** — the installer honours a root "overrides"
  (or yarn "resolutions") table, so a transitive dependency can be pinned without
  editing the package that asked for it; "file:"/"link:" specifiers install a
  package straight out of the virtual file system (see the demo's @demo/greeting);
  and tarballs download with bounded concurrency instead of one at a time
- **fork() IPC (milestone 40)** — fork() starts a module the way node <module>
  would and wires a channel between the two sides: child.send / child.on('message')
  / child.disconnect on the parent, process.send / process.on('message') /
  process.disconnect in the child, with Node's default JSON serialization (and
  'advanced' for structured clone). An open channel keeps the child alive past
  its module returning, and the parent hears disconnect then exit then close
- **Buffer slab pooling (milestone 41)** — allocations under half of Buffer.poolSize
  (64 KiB) are carved from one shared, 8-byte-aligned slab, so buf.byteOffset is
  meaningful and buf.buffer.byteLength matches what Node reports; allocUnsafeSlow,
  alloc and large requests still bypass the pool
- **util.inspect / ICU width (milestone 42)** — util.inspect is Node's real source,
  and the layer under it is now faithful: an async function* is both a generator
  and async in V8, so it is labelled [AsyncGeneratorFunction: name], and the ICU
  width function counts display columns (CJK and emoji are two), so console.table
  borders and CJK line wrapping line up
- **Build tools (milestone 5)** — "Build" runs esbuild (the WASM build, the same
  transformer Vite uses) inside the tab: it compiles src/app.ts, bundles a real
  node_modules dependency, and writes /project/dist/app.js. The browser field in
  package.json is honoured, which is what lets esbuild resolve to its browser build
- **Real bundler (milestone 5b)** — "Bundle" runs rollup (its official WASM build)
  in the tab: it tree-shakes an ES module graph read straight out of the virtual
  file system and writes /project/dist/app.esm.js
- **Vite itself (milestone 5c)** — "Vite build" runs the real Vite (v5) in the tab.
  Vite is pure ESM and reaches for the *native* esbuild addon; the runtime aliases
  esbuild→esbuild-wasm and rollup→@rollup/wasm-node, so Vite boots on the virtual
  file system and produces a real production bundle (site/index.html +
  site/dist/assets/*.js) — no server, no Node process
- **Vue 3 single-file components (milestone 18)** — the demo site is a real Vue
  SFC (a script-setup block plus a template). @vitejs/plugin-vue compiles it in
  the tab, so "Vite build" produces a production Vue bundle and "Vite dev"
  serves a live, interactive Vue app in the Preview (the counter button works),
  HMR included. esbuild-wasm is pinned to the 0.21 line that Vite 5.4 expects
- CommonJS + a subset of ESM (static import/export)
- In-memory VFS persisted to OPFS (reload the page and your files are still here)

## Not yet

- Subdomain preview routing on a static host (only the dev server has the wildcard DNS)
- Real TLS (the https module is the http surface under a TLS-shaped name)
- Promise hooks (async_hooks sees timers/ticks, but V8 promises are not
  instrumented, so promiseResolve never fires)
- git specs in package.json (git+, git:)
- IPC send handles (a socket or server cannot cross a fork() channel: there is no
  OS handle here), and 'advanced' serialization keeps Map/Set/Date but not the
  Buffer subclass (V8's serializer does; structuredClone does not)
- webpack (esbuild, rollup and Vite are milestones 5/5b/5c)
`,
};
