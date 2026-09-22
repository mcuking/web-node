import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 67: the `http` module surface (`Agent`, `OutgoingMessage`, header
 * validators, `maxHeaderSize`, the re-exported globals and the internal
 * `_connectionListener`). Expected values were read off a real Node v26.9.0.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('http') as any;
}

describe('http header helpers', () => {
  it('maxHeaderSize and the validators match Node', () => {
    const http = boot();
    expect(http.maxHeaderSize).toBe(16384);

    expect(() => http.validateHeaderName('content-type')).not.toThrow();
    expect(() => http.validateHeaderName('bad name')).toThrowError(
      expect.objectContaining({
        code: 'ERR_INVALID_HTTP_TOKEN',
        message: 'Header name must be a valid HTTP token ["bad name"]',
      }),
    );
    expect(() => http.validateHeaderName('')).toThrowError(
      expect.objectContaining({
        code: 'ERR_INVALID_HTTP_TOKEN',
        message: 'Header name must be a valid HTTP token [""]',
      }),
    );

    expect(() => http.validateHeaderValue('x', 'ok')).not.toThrow();
    expect(() => http.validateHeaderValue('x', undefined)).toThrowError(
      expect.objectContaining({
        code: 'ERR_HTTP_INVALID_HEADER_VALUE',
        message: 'Invalid value "undefined" for header "x"',
      }),
    );
    expect(() => http.validateHeaderValue('x', 'a\nb')).toThrowError(
      expect.objectContaining({
        code: 'ERR_INVALID_CHAR',
        message: 'Invalid character in header content ["x"]',
      }),
    );
  });
});

describe('http classes', () => {
  it('ClientRequest/ServerResponse extend OutgoingMessage', () => {
    const http = boot();
    expect(typeof http.OutgoingMessage).toBe('function');
    expect(http.ClientRequest.prototype).toBeInstanceOf(http.OutgoingMessage);
    expect(http.ServerResponse.prototype).toBeInstanceOf(http.OutgoingMessage);
  });

  it('Agent tracks options/requests and globalAgent exists', () => {
    const http = boot();
    const a = new http.Agent();
    expect(a.maxSockets).toBe(Infinity);
    expect(a.maxFreeSockets).toBe(256);
    expect(a.keepAlive).toBe(false);
    expect(a.scheduling).toBe('lifo');
    expect(a.getName({})).toBe('localhost::');
    expect(a.getName({ host: 'a', port: '8080', localAddress: '1.2.3.4' })).toBe('a:8080:1.2.3.4');
    a.addRequest({}, { host: 'h', port: 80 });
    expect(a.requests['h:80:']).toHaveLength(1);
    expect(a.destroy()).toBeUndefined();

    expect(http.globalAgent).toBeInstanceOf(http.Agent);
    expect(http.globalAgent.keepAlive).toBe(true);
    expect(http.globalAgent.maxFreeSockets).toBe(256);
  });

  it('_connectionListener and the re-exported globals are present', () => {
    const http = boot();
    expect(typeof http._connectionListener).toBe('function');
    expect(http._connectionListener.length).toBe(1);
    expect(typeof http.setMaxIdleHTTPParsers).toBe('function');
    expect(typeof http.setGlobalProxyFromEnv).toBe('function');
    // MessageEvent / CloseEvent / WebSocket are the host globals
    expect(http.MessageEvent).toBe((globalThis as any).MessageEvent);
    expect(http.CloseEvent).toBe((globalThis as any).CloseEvent);
    expect(http.WebSocket).toBe((globalThis as any).WebSocket);
  });
});

describe('http agent option', () => {
  it('agent:false round-trips while disabling keep-alive', async () => {
    const http = boot();
    const server = http.createServer((_req: any, res: any) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get({ port, host: '127.0.0.1', agent: false }, (res: any) => {
        let data = '';
        res.on('data', (c: Uint8Array) => {
          data += new TextDecoder().decode(c);
        });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      // Node spins up a fresh one-off agent for `agent: false` (keep-alive off),
      // so `req.agent` is still an Agent instance.
      expect(req.agent).toBeInstanceOf(http.Agent);
      expect((req.agent as any).keepAlive).toBe(false);
    });
    expect(body).toBe('ok');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
