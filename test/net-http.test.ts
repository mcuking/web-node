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
    expect(res.headers['content-length']).toBe('12');
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
