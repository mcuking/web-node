import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

function makeProject(files: Record<string, string>): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, new TextEncoder().encode(content));
  }
  return vfs;
}

function boot(files: Record<string, string>, entry = '/project/index.js') {
  const vfs = makeProject(files);
  const out: string[] = [];
  const err: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: [entry],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => err.push(c),
  });
  const run = () => {
    try {
      runtime.runMain(entry);
    } catch {
      /* tests assert on output/state */
    }
  };
  capturedOut.set(runtime, out);
  return { runtime, vfs, out, err, run };
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));
const decoder = new TextDecoder();

async function waitFor(predicate: () => boolean, ms = 300): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await tick(2);
  }
  return predicate();
}

interface StreamModule {
  Readable: any;
  Writable: any;
  Duplex: any;
  Transform: any;
  PassThrough: any;
  pipeline: (...args: any[]) => any;
  finished: (stream: any, cb?: (err?: Error | null) => void) => any;
}

interface HttpModule {
  _request(
    port: number,
    init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ): Promise<{ status: number; statusMessage: string; headers: Record<string, string | string[]>; body: Uint8Array }>;
}

function streams(runtime: NodeRuntime): StreamModule {
  return runtime.realm.require('stream') as unknown as StreamModule;
}

function httpModule(runtime: NodeRuntime): HttpModule {
  return runtime.realm.require('http') as unknown as HttpModule;
}

describe('stream (base classes)', () => {
  it('Readable.from delivers chunks in order, then end', async () => {
    const { runtime } = boot({});
    const { Readable } = streams(runtime);

    const seen: string[] = [];
    const readable = Readable.from(['one', 'two', 'three']);
    let ended = false;
    readable.on('data', (c: unknown) => seen.push(String(c)));
    readable.on('end', () => {
      ended = true;
    });

    expect(await waitFor(() => ended)).toBe(true);
    expect(seen).toEqual(['one', 'two', 'three']);
  });

  it('push() past the high-water mark reports backpressure', async () => {
    const { runtime } = boot({});
    const { Readable } = streams(runtime);

    const readable = new Readable({ objectMode: true, highWaterMark: 2 });
    expect(readable.push('a')).toBe(true);
    expect(readable.push('b')).toBe(false);
    expect(readable.readableLength).toBe(2);
  });

  it('Writable returns false past the high-water mark, then drains', async () => {
    const { runtime } = boot({});
    const { Writable } = streams(runtime);

    const completions: Array<() => void> = [];
    const writable = new Writable({
      objectMode: true,
      highWaterMark: 3,
      write(_chunk: unknown, _enc: string, cb: () => void) {
        completions.push(cb);
      },
    });

    let drained = false;
    writable.on('drain', () => {
      drained = true;
    });

    // The first write is dispatched immediately; the rest queue up. Node flags
    // the write that reaches the high-water mark (`length < highWaterMark`
    // afterwards), so the third write already reports backpressure.
    expect(writable.write('1')).toBe(true);
    expect(writable.write('2')).toBe(true);
    expect(writable.write('3')).toBe(false);
    expect(writable.write('4')).toBe(false);
    expect(writable.writableNeedDrain).toBe(true);

    while (completions.length > 0) completions.shift()!();
    await tick();
    expect(drained).toBe(true);
  });

  it('pipe() forwards every chunk and ends the destination', async () => {
    const { runtime } = boot({});
    const { Readable, Writable } = streams(runtime);

    const received: string[] = [];
    const writable = new Writable({
      write(chunk: unknown, _enc: string, cb: () => void) {
        received.push(String(chunk));
        cb();
      },
    });

    const done = new Promise<void>((resolve) => writable.on('finish', () => resolve()));
    Readable.from(['a', 'b', 'c']).pipe(writable);
    await done;

    expect(received).toEqual(['a', 'b', 'c']);
    expect(writable.writableFinished).toBe(true);
  });

  it('pipe() pauses the source while the destination is backed up', async () => {
    const { runtime } = boot({});
    const { Readable, Writable } = streams(runtime);

    const chunks = Array.from({ length: 24 }, (_, i) => `chunk-${i};`);
    const writable = new Writable({
      highWaterMark: 4,
      write(_chunk: unknown, _enc: string, cb: () => void) {
        setTimeout(cb, 1);
      },
    });

    // Observe the raw return value the pipe sees.
    let backpressureSignals = 0;
    const rawWrite = writable.write.bind(writable);
    writable.write = (chunk: unknown, enc?: unknown, cb?: unknown) => {
      const ok = rawWrite(chunk, enc, cb);
      if (ok === false) backpressureSignals++;
      return ok;
    };

    const source = Readable.from(chunks);
    const done = new Promise<void>((resolve) => writable.on('finish', () => resolve()));
    source.pipe(writable);
    await done;

    expect(backpressureSignals).toBeGreaterThan(0);
  });

  it('Transform rewrites chunks and _flush appends a tail', async () => {
    const { runtime } = boot({});
    const { Readable, Transform } = streams(runtime);

    const upper = new Transform({
      transform(chunk: unknown, _enc: string, cb: (err?: Error | null, data?: unknown) => void) {
        cb(null, String(chunk).toUpperCase());
      },
      flush(cb: (err?: Error | null, data?: unknown) => void) {
        cb(null, '|END');
      },
    });

    const received: string[] = [];
    upper.on('data', (c: unknown) => received.push(String(c)));
    const ended = new Promise<void>((resolve) => upper.on('end', () => resolve()));

    Readable.from(['ab', 'cd']).pipe(upper);
    await ended;

    expect(received.join('')).toBe('ABCD|END');
  });

  it('PassThrough is an identity transform', async () => {
    const { runtime } = boot({});
    const { Readable, PassThrough } = streams(runtime);

    const pass = new PassThrough();
    const received: string[] = [];
    pass.on('data', (c: unknown) => received.push(String(c)));
    const ended = new Promise<void>((resolve) => pass.on('end', () => resolve()));

    Readable.from(['x', 'y']).pipe(pass);
    await ended;
    expect(received.join('')).toBe('xy');
  });

  it('pipeline() calls back once the whole chain finishes', async () => {
    const { runtime } = boot({});
    const { Readable, Transform, Writable, pipeline } = streams(runtime);

    const received: string[] = [];
    const result = await new Promise<Error | null>((resolve) => {
      pipeline(
        Readable.from(['a', 'b']),
        new Transform({
          transform(chunk: unknown, _e: string, cb: (e?: Error | null, d?: unknown) => void) {
            cb(null, String(chunk).toUpperCase());
          },
        }),
        new Writable({
          write(chunk: unknown, _e: string, cb: () => void) {
            received.push(String(chunk));
            cb();
          },
        }),
        (err?: Error | null) => resolve(err ?? null),
      );
    });

    expect(result).toBeNull();
    expect(received).toEqual(['A', 'B']);
  });

  it('exposes the same surface through stream/promises', async () => {
    const { runtime } = boot({});
    const promises = runtime.realm.require('stream/promises') as unknown as {
      pipeline: (...a: unknown[]) => Promise<void>;
      finished: (s: unknown) => Promise<void>;
    };
    const { Readable, Writable } = streams(runtime);

    const received: string[] = [];
    const sink = new Writable({
      write(chunk: unknown, _e: string, cb: () => void) {
        received.push(String(chunk));
        cb();
      },
    });

    await promises.pipeline(Readable.from(['p', 'q']), sink);
    expect(received).toEqual(['p', 'q']);
  });

  it('finished() resolves a promise when a stream ends', async () => {
    const { runtime } = boot({});
    const { Readable } = streams(runtime);
    const promises = runtime.realm.require('stream/promises') as unknown as {
      finished: (s: unknown) => Promise<void>;
    };

    const readable = Readable.from([]);
    readable.resume();
    await expect(promises.finished(readable)).resolves.toBeUndefined();
  });

  it('read(n) is byte-exact and splits buffered chunks', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Readable } = require('stream');
        const r = new Readable({ read() {} });
        r.push('ab');
        r.push(Buffer.from('cd'));
        r.push(null);
        console.log('A', r.read(3).toString());
        console.log('B', r.read(3).toString());
        console.log('C', r.read());
        console.log('len', r.readableLength);
      `,
    });
    run();
    await waitFor(() => out.join('').includes('len'));
    expect(out.join('')).toContain('A abc');
    expect(out.join('')).toContain('B d');
    expect(out.join('')).toContain('C null');
    expect(out.join('')).toContain('len 0');
  });

  it('read() with no argument drains everything buffered', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Readable } = require('stream');
        // A _read that pushes synchronously must be observed by the same read().
        const r = new Readable({ read() { this.push('hello'); this.push(null); } });
        console.log('A', String(r.read()));
        console.log('B', r.read());
      `,
    });
    run();
    await waitFor(() => out.join('').includes('B'));
    expect(out.join('')).toContain('A hello');
    expect(out.join('')).toContain('B null');
  });

  it('drives a paused consumer with the readable event', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Readable } = require('stream');
        const r = new Readable({ read() {} });
        r.push('ab');
        r.push(null);
        let signals = 0;
        r.on('readable', () => {
          signals++;
          let c;
          while ((c = r.read(1)) !== null) console.log('chunk', String(c));
        });
        r.on('end', () => console.log('end signals=' + signals));
      `,
    });
    run();
    await waitFor(() => out.join('').includes('end signals'));
    // A paused reader sees `readable` when data arrives. Whether a second,
    // empty `readable` is emitted before `end` is version-specific: the vendored
    // lib/ checkout (Node 26.x) skips an unobserved EOF emission, so a listener
    // attached after `push(null)` sees it exactly once here.
    expect(out.join('')).toContain('chunk a');
    expect(out.join('')).toContain('chunk b');
    expect(out.join('')).toContain('end signals=1');
  });

  it('delivers byte chunks as Buffers, not bare Uint8Arrays', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Readable } = require('stream');
        const r = new Readable({ read() {} });
        r.on('data', (c) => console.log('data', Buffer.isBuffer(c), c.toString(), c.toString('hex')));
        r.push('ab');
        r.push(new Uint8Array([101, 102]));
        r.push(null);
      `,
    });
    run();
    await waitFor(() => out.join('').split('data').length >= 3);
    expect(out.join('')).toContain('data true ab 6162');
    expect(out.join('')).toContain('data true ef 6566');
  });

  it('exposes readableObjectMode and writableObjectMode', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Readable, Writable } = require('stream');
        const r = new Readable({ objectMode: true, read() {} });
        const w = new Writable({ objectMode: true, write(c, e, cb) { cb(); } });
        console.log('r', r.readableObjectMode, 'w', w.writableObjectMode);
        const rb = new Readable({ read() {} });
        console.log('byte r', rb.readableObjectMode);
      `,
    });
    run();
    await waitFor(() => out.join('').includes('byte r'));
    expect(out.join('')).toContain('r true w true');
    expect(out.join('')).toContain('byte r false');
  });

  it('passes object-mode values through untouched, strings included', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Writable, Readable } = require('stream');
        const seen = [];
        const w = new Writable({
          objectMode: true,
          write(c, e, cb) { seen.push(typeof c + ':' + JSON.stringify(c)); cb(); },
        });
        w.write({ a: 1 });
        w.write('plain string');
        w.end();
        w.on('finish', () => console.log(seen.join(' | ')));
        const r = new Readable({ objectMode: true, read() {} });
        r.push('still a string');
        r.push(42);
        r.push(null);
        r.on('data', (c) => console.log('r', typeof c, JSON.stringify(c)));
      `,
    });
    run();
    await waitFor(() => out.join('').includes('still a string'));
    // An object-mode writable must not re-encode a string as a Buffer.
    expect(out.join('')).toContain('object:{"a":1} | string:"plain string"');
    expect(out.join('')).toContain('r string "still a string"');
    expect(out.join('')).toContain('r number 42');
  });

  it('autoDestroys: end/finish is followed by close with destroyed === true', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Readable, Writable } = require('stream');
        const w = new Writable({ write(c, e, cb) { cb(); } });
        w.on('finish', () => console.log('finish'));
        w.on('close', () => console.log('w close destroyed=' + w.destroyed));
        w.end('x');
        const r = new Readable({ read() {} });
        r.on('end', () => console.log('end destroyed=' + r.destroyed));
        r.on('close', () => console.log('r close destroyed=' + r.destroyed));
        r.resume();
        r.push('x');
        r.push(null);
      `,
    });
    run();
    await waitFor(() => out.join('').includes('r close'));
    // `end`/`finish` fire while the stream is still open, then `destroyed`
    // flips before `close` — exactly Node's ordering.
    expect(out.join('')).toContain('end destroyed=false');
    expect(out.join('')).toContain('r close destroyed=true');
    expect(out.join('')).toContain('w close destroyed=true');
  });

  it('honours autoDestroy: false (no close until destroyed explicitly)', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Writable } = require('stream');
        const w = new Writable({ autoDestroy: false, write(c, e, cb) { cb(); } });
        w.on('finish', () => console.log('finish destroyed=' + w.destroyed));
        w.on('close', () => console.log('close'));
        w.end('x');
        setTimeout(() => console.log('later destroyed=' + w.destroyed), 20);
      `,
    });
    run();
    await waitFor(() => out.join('').includes('later'));
    expect(out.join('')).toContain('finish destroyed=false');
    expect(out.join('')).toContain('later destroyed=false');
    expect(out.join('')).not.toContain('close');
  });

  it('Readable.from defaults to objectMode and stays lazy', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const { Readable } = require('stream');
        const f = Readable.from(['a', 'b']);
        console.log('default', f.readableObjectMode, f.readableHighWaterMark);
        const bytes = Readable.from([Buffer.from('ab')], { objectMode: false });
        console.log('byte', bytes.readableObjectMode, bytes.readableHighWaterMark);
      `,
    });
    run();
    await waitFor(() => out.join('').includes('byte'));
    expect(out.join('')).toContain('default true 1');
    expect(out.join('')).toContain('byte false 1');
  });
});

describe('stream (integration)', () => {
  it('fs.createReadStream emits Buffer chunks for a file', async () => {
    const { runtime, run } = boot({
      '/project/data.txt': 'hello stream world',
      '/project/index.js': `
        const fs = require('fs');
        const chunks = [];
        const rs = fs.createReadStream('/project/data.txt', { highWaterMark: 4 });
        rs.on('data', (c) => chunks.push(c));
        rs.on('end', () => {
          const all = Buffer.concat(chunks);
          console.log('bytes=' + all.length);
          console.log('text=' + all.toString('utf8'));
          console.log('isBuffer=' + Buffer.isBuffer(chunks[0]));
        });
      `,
    });
    run();
    expect(await waitFor(() => runtimeOut(runtime).includes('text='))).toBe(true);
    const text = runtimeOut(runtime);
    expect(text).toContain('bytes=18');
    expect(text).toContain('text=hello stream world');
    expect(text).toContain('isBuffer=true');
  });

  it('fs.createReadStream().pipe(fs.createWriteStream()) copies a file', async () => {
    const { runtime, vfs, run } = boot({
      '/project/src.txt': 'copy me across the pipe',
      '/project/index.js': `
        const fs = require('fs');
        fs.createReadStream('/project/src.txt').pipe(fs.createWriteStream('/project/dest.txt'));
        console.log('started');
      `,
    });
    run();
    expect(await waitFor(() => vfs.exists('/project/dest.txt'))).toBe(true);
    await tick(20);
    expect(decoder.decode(vfs.readFile('/project/dest.txt'))).toBe('copy me across the pipe');
  });

  it('fs.createWriteStream writes and reports bytesWritten', async () => {
    const { runtime, vfs, run } = boot({
      '/project/index.js': `
        const fs = require('fs');
        const ws = fs.createWriteStream('/project/out.txt');
        ws.write('12345');
        ws.write('67890');
        ws.end();
        ws.on('finish', () => console.log('bytesWritten=' + ws.bytesWritten));
      `,
    });
    run();
    expect(await waitFor(() => runtimeOut(runtime).includes('bytesWritten='))).toBe(true);
    expect(runtimeOut(runtime)).toContain('bytesWritten=10');
    expect(decoder.decode(vfs.readFile('/project/out.txt'))).toBe('1234567890');
  });

  it('serves a streamed response as chunked and de-chunks it on the client', async () => {
    const { runtime, run } = boot({
      '/project/data.txt': 'streamed-from-file',
      '/project/index.js': `
        const http = require('http');
        const fs = require('fs');
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          fs.createReadStream('/project/data.txt').pipe(res);
        });
        server.listen(3000, () => console.log('listening'));
      `,
    });
    run();
    await tick(5);

    const res = await httpModule(runtime)._request(3000, { path: '/' });
    expect(res.status).toBe(200);
    expect(res.headers['transfer-encoding']).toBe('chunked');
    expect(decoder.decode(res.body)).toBe('streamed-from-file');
  });

  it('concatenates several res.write() calls into one body', async () => {
    const { runtime, run } = boot({
      '/project/index.js': `
        const http = require('http');
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.write('first;');
          res.write('second;');
          setTimeout(() => { res.write('third;'); res.end('fourth'); }, 5);
        });
        server.listen(3000, () => console.log('listening'));
      `,
    });
    run();
    await tick(5);

    const res = await httpModule(runtime)._request(3000, { path: '/' });
    expect(res.status).toBe(200);
    expect(decoder.decode(res.body)).toBe('first;second;third;fourth');
  });

  it('streams a POST body into a file with req.pipe(fs.createWriteStream())', async () => {
    const { runtime, vfs, run } = boot({
      '/project/index.js': `
        const http = require('http');
        const fs = require('fs');
        const server = http.createServer((req, res) => {
          fs.mkdirSync('/project/output', { recursive: true });
          const out = fs.createWriteStream('/project/output/upload.txt');
          req.pipe(out);
          out.on('finish', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ bytes: out.bytesWritten }));
          });
        });
        server.listen(3000, () => console.log('listening'));
      `,
    });
    run();
    await tick(5);

    const res = await httpModule(runtime)._request(3000, {
      method: 'POST',
      path: '/upload',
      body: 'streamed upload payload',
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(decoder.decode(res.body))).toEqual({ bytes: 23 });
    expect(await waitFor(() => vfs.exists('/project/output/upload.txt'))).toBe(true);
    expect(decoder.decode(vfs.readFile('/project/output/upload.txt'))).toBe('streamed upload payload');
  });

  it('streams a request body through a Transform on the server', async () => {
    const { runtime, run } = boot({
      '/project/index.js': `
        const http = require('http');
        const { Transform } = require('stream');
        const upper = () => new Transform({
          transform(chunk, enc, cb) { cb(null, String(chunk).toUpperCase()); },
        });
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          req.pipe(upper()).pipe(res);
        });
        server.listen(3000, () => console.log('listening'));
      `,
    });
    run();
    await tick(5);

    const res = await httpModule(runtime)._request(3000, { method: 'POST', path: '/', body: 'shout this' });
    expect(res.status).toBe(200);
    expect(decoder.decode(res.body)).toBe('SHOUT THIS');
  });
});

/** Concatenated stdout seen so far for a runtime created by `boot()`. */
function runtimeOut(runtime: NodeRuntime): string {
  return (capturedOut.get(runtime) ?? []).join('');
}

/** Set by `boot()` so helpers can read the captured stdout back. */
const capturedOut = new WeakMap<NodeRuntime, string[]>();
