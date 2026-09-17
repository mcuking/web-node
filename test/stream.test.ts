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

    // The first write is dispatched immediately; the rest queue up.
    expect(writable.write('1')).toBe(true);
    expect(writable.write('2')).toBe(true);
    expect(writable.write('3')).toBe(true);
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
    const { Readable, finished } = streams(runtime);

    const readable = Readable.from([]);
    readable.resume();
    await expect(finished(readable)).resolves.toBeUndefined();
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
