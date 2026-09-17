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
      /* the test asserts on output/errors instead */
    }
  };
  return { runtime, vfs, out, err, run };
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));
const decoder = new TextDecoder();

interface HttpModule {
  _request(
    port: number,
    init: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; statusMessage: string; headers: Record<string, string | string[]>; body: Uint8Array }>;
}

describe('net (virtual TCP)', () => {
  it('binds a port and echoes bytes back', async () => {
    const { runtime, run } = boot({
      '/project/index.js': `
        const net = require('net');
        const server = net.createServer((socket) => {
          socket.on('data', (chunk) => socket.write('echo:' + chunk.toString()));
          socket.on('end', () => socket.end());
        });
        server.listen(4000, () => console.log('listening'));
      `,
    });
    run();

    expect(runtime.network.ports).toContain(4000);

    const client = runtime.network.dial(4000);
    let received = '';
    client.onData((c) => {
      received += decoder.decode(c);
    });
    client.write('ping');
    await tick();

    expect(received).toBe('echo:ping');
  });

  it('refuses connections to an unbound port with ECONNREFUSED', () => {
    const { runtime } = boot({ '/project/index.js': `console.log('noop');` });
    expect(() => runtime.network.dial(9900)).toThrowError(/ECONNREFUSED/);
  });

  it('throws EADDRINUSE when two servers claim the same port', () => {
    const { runtime, run } = boot({
      '/project/index.js': `
        const net = require('net');
        net.createServer(() => {}).listen(4100);
        const second = net.createServer(() => {});
        second.on('error', (err) => console.log('error:' + err.code));
        second.listen(4100);
      `,
    });
    run();
    expect(runtime.network.ports.filter((p) => p === 4100)).toHaveLength(1);
  });

  it('drops every binding on resetRunState (fresh process per run)', () => {
    const { runtime, run } = boot({
      '/project/index.js': `require('net').createServer(() => {}).listen(4200);`,
    });
    run();
    expect(runtime.network.isListening(4200)).toBe(true);
    runtime.resetRunState();
    expect(runtime.network.isListening(4200)).toBe(false);
  });
});

describe('http (server + client over the virtual network)', () => {
  const SERVER = `
    const http = require('http');
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c.toString(); });
        req.on('end', () => {
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ echo: body }));
        });
        return;
      }
      if (req.url === '/missing') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('nope');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello ' + req.url);
    });
    server.listen(3000, () => console.log('listening'));
  `;

  it('answers a GET round-trip', async () => {
    const { runtime, run } = boot({ '/project/index.js': SERVER });
    run();

    const http = runtime.realm.require('http') as unknown as HttpModule;
    const res = await http._request(3000, { path: '/world' });

    expect(res.status).toBe(200);
    expect(decoder.decode(res.body)).toBe('hello /world');
    expect(res.headers['content-type']).toBe('text/plain');
    // No `Content-Length` was set by the handler, so the response is framed as
    // chunked — and our client reader has to de-chunk it back to `12` bytes.
    expect(res.headers['transfer-encoding']).toBe('chunked');
    expect(res.headers['content-length']).toBeUndefined();
  });

  it('honours an explicit Content-Length instead of chunking', async () => {
    const { runtime, run } = boot({
      '/project/index.js': `
        const http = require('http');
        const server = http.createServer((req, res) => {
          const body = 'measured precisely';
          res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(body.length) });
          res.end(body);
        });
        server.listen(3000, () => console.log('listening'));
      `,
    });
    run();

    const http = runtime.realm.require('http') as unknown as HttpModule;
    const res = await http._request(3000, { path: '/' });

    expect(res.status).toBe(200);
    expect(decoder.decode(res.body)).toBe('measured precisely');
    expect(res.headers['content-length']).toBe('18');
    expect(res.headers['transfer-encoding']).toBeUndefined();
  });

  it('carries a POST body through to the handler', async () => {
    const { runtime, run } = boot({ '/project/index.js': SERVER });
    run();

    const http = runtime.realm.require('http') as unknown as HttpModule;
    const res = await http._request(3000, { method: 'POST', path: '/submit', body: 'payload' });

    expect(res.status).toBe(201);
    expect(JSON.parse(decoder.decode(res.body))).toEqual({ echo: 'payload' });
  });

  it('lets handlers choose the status code', async () => {
    const { runtime, run } = boot({ '/project/index.js': SERVER });
    run();

    const http = runtime.realm.require('http') as unknown as HttpModule;
    const res = await http._request(3000, { path: '/missing' });

    expect(res.status).toBe(404);
    expect(decoder.decode(res.body)).toBe('nope');
  });

  it('exposes the url and headers on IncomingMessage', async () => {
    const { runtime, run } = boot({
      '/project/index.js': `
        const http = require('http');
        http.createServer((req, res) => {
          res.end(req.method + ' ' + req.url + ' x-custom=' + req.headers['x-custom']);
        }).listen(3001);
      `,
    });
    run();

    const http = runtime.realm.require('http') as unknown as HttpModule;
    const res = await http._request(3001, { path: '/p?a=1', headers: { 'x-custom': 'yes' } });

    expect(decoder.decode(res.body)).toBe('GET /p?a=1 x-custom=yes');
  });

  it('supports http.get() from inside the sandbox', async () => {
    const { runtime, out, run } = boot({
      '/project/index.js': `
        const http = require('http');
        const server = http.createServer((req, res) => res.end('pong'));
        server.listen(3002, () => {
          http.get('http://127.0.0.1:3002/ping', (res) => {
            res.on('data', (c) => process.stdout.write('got:' + c.toString() + '\\n'));
          });
        });
      `,
    });
    run();
    await tick(20);

    expect(runtime.network.isListening(3002)).toBe(true);
    expect(out.join('')).toContain('got:pong');
  });

  it('emits EADDRINUSE for a conflicting http server', async () => {
    const { runtime, run, out } = boot({
      '/project/index.js': `
        const http = require('http');
        http.createServer((_, res) => res.end('a')).listen(3003);
        const second = http.createServer((_, res) => res.end('b'));
        second.on('error', (err) => process.stdout.write('boom:' + err.code + '\\n'));
        second.listen(3003);
      `,
    });
    run();
    await tick();

    expect(out.join('')).toContain('boom:EADDRINUSE');
  });
});

interface HttpStreamModule {
  _stream(
    port: number,
    init: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
    handlers: {
      onHead: (h: { status: number; statusMessage: string; headers: Record<string, string | string[]> }) => void;
      onData: (c: Uint8Array) => void;
      onEnd: () => void;
      onError: (e: Error) => void;
    },
  ): void;
}


describe('http keep-alive (persistent connections)', () => {
  const SERVER = `
    const http = require('http');
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end('path:' + req.url + ' conn:' + req.socket.remotePort);
    });
    server.on('connection', () => process.stdout.write('conn\\n'));
    server.listen(3010);
  `;

  it('serves several requests over a single socket by default', async () => {
    const { runtime, run, out } = boot({ '/project/index.js': SERVER });
    run();
    await tick();

    const http = runtime.realm.require('http') as unknown as HttpModule;
    for (const path of ['/a', '/b', '/c']) {
      const res = await http._request(3010, { path });
      expect(decoder.decode(res.body)).toMatch(new RegExp('^path:' + path + ' conn:'));
      expect(res.headers['connection']).toBe('keep-alive');
    }

    expect(out.join('')).toBe('conn\n'); // exactly one TCP connection
  });

  it('honours Connection: close and reconnects afterwards', async () => {
    const { runtime, run, out } = boot({ '/project/index.js': SERVER });
    run();
    await tick();

    const http = runtime.realm.require('http') as unknown as HttpModule;

    const first = await http._request(3010, { path: '/one', headers: { connection: 'close' } });
    expect(first.headers['connection']).toBe('close');

    const second = await http._request(3010, { path: '/two' });
    expect(second.headers['connection']).toBe('keep-alive');

    expect(out.join('')).toBe('conn\nconn\n'); // two connections
  });

  it('answers pipelined requests written to one raw socket', async () => {
    const { runtime, run } = boot({ '/project/index.js': SERVER });
    run();
    await tick();

    const chunks: Uint8Array[] = [];
    const socket = runtime.network.dial(3010);
    socket.onData((c) => chunks.push(c));
    socket.write(
      'GET /alpha HTTP/1.1\r\nHost: x\r\n\r\n' + 'GET /beta HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    );
    await tick(30);

    const text = chunks.map((c) => decoder.decode(c)).join('');
    expect(text).toContain('path:/alpha');
    expect(text).toContain('path:/beta');
    // Both responses ride the same connection.
    const firstPort = /path:\/alpha conn:(\d+)/.exec(text)?.[1];
    const secondPort = /path:\/beta conn:(\d+)/.exec(text)?.[1];
    expect(firstPort).toBeDefined();
    expect(secondPort).toBe(firstPort);
  });
});

describe('https (http surface, no TLS in the virtual network)', () => {
  it('serves and requests over the virtual network', async () => {
    const { runtime, run } = boot({
      '/project/index.js': `
        const https = require('https');
        https.createServer((req, res) => {
          res.setHeader('content-type', 'text/plain');
          res.end('secure-ish ' + req.url);
        }).listen(3012);
      `,
    });
    run();
    await tick();

    const https = runtime.realm.require('https') as unknown as HttpModule;
    const res = await https._request(3012, { path: '/x' });
    expect(res.status).toBe(200);
    expect(decoder.decode(res.body)).toBe('secure-ish /x');
  });
});

describe('http streaming client (_stream)', () => {
  const STREAM_SERVER = `
    const http = require('http');
    http.createServer((req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write('a');
      setTimeout(() => { res.write('b'); res.end('c'); }, 10);
    }).listen(3011);
  `;

  it('delivers the head and each body chunk before the request ends', async () => {
    const { runtime, run } = boot({ '/project/index.js': STREAM_SERVER });
    run();
    await tick();

    const http = runtime.realm.require('http') as unknown as HttpStreamModule;
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      http._stream(
        3011,
        { path: '/' },
        {
          onHead: (h) => events.push('head:' + h.status + ':' + String(h.headers['content-type'])),
          onData: (c) => events.push('data:' + decoder.decode(c)),
          onEnd: () => {
            events.push('end');
            resolve();
          },
          onError: (e) => {
            events.push('error:' + e.message);
            resolve();
          },
        },
      );
    });

    expect(events[0]).toBe('head:200:text/event-stream');
    expect(events.at(-1)).toBe('end');
    expect(events.join('|')).toBe('head:200:text/event-stream|data:a|data:b|data:c|end');
  });

  it('surfaces a connect failure through onError', async () => {
    const { runtime, run } = boot({ '/project/index.js': STREAM_SERVER });
    run();
    await tick();

    const http = runtime.realm.require('http') as unknown as HttpStreamModule;
    const err = await new Promise<Error>((resolve) => {
      http._stream(9999, { path: '/' }, {
        onHead: () => resolve(new Error('unexpected head')),
        onData: () => undefined,
        onEnd: () => resolve(new Error('unexpected end')),
        onError: (e) => resolve(e),
      });
    });
    expect((err as Error & { code?: string }).code).toBe('ECONNREFUSED');
  });
});
