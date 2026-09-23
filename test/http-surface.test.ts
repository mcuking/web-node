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

describe('http.Agent connection methods (M103)', () => {
  /** Minimal socket stand-in: enough for the agent's listener wiring. */
  function fakeSocket(): any {
    const listeners: Record<string, ((...a: any[]) => void)[]> = {};
    return {
      writable: true,
      timeout: 0,
      on(n: string, f: (...a: any[]) => void) {
        (listeners[n] ??= []).push(f);
        return this;
      },
      removeListener(n: string, f: (...a: any[]) => void) {
        listeners[n] = (listeners[n] ?? []).filter((x) => x !== f);
        return this;
      },
      emit(n: string, ...a: any[]) {
        for (const f of listeners[n] ?? []) f(...a);
        return true;
      },
      setKeepAlive() {},
      unref() {},
      ref() {},
      setTimeout() {},
      destroy() {},
    };
  }

  it('#createConnection forwards to net.createConnection', () => {
    const http = boot();
    const a = new http.Agent();
    expect(typeof a.createConnection).toBe('function');
    expect(a.createConnection.length).toBe(0);
    // The forward reaches `net`: an unlistened virtual port yields a Socket
    // that reports ECONNREFUSED.
    let sock: any;
    try {
      sock = a.createConnection({ host: '127.0.0.1', port: 123 });
    } catch (err: any) {
      expect(err.code).toBe('ECONNREFUSED');
      return;
    }
    expect(sock.constructor.name).toBe('Socket');
    sock.on('error', () => {});
  });

  it('#createSocket merges options, pools the socket and computes servername', () => {
    const http = boot();
    const a = new http.Agent({ keepAlive: true, timeout: 5000, keepAliveMsecs: 2500 });
    const created: any[] = [];
    const sock = fakeSocket();
    a.createConnection = (opts: any) => {
      created.push(opts);
      return sock;
    };

    let got: any = null;
    a.createSocket(
      { timeout: 1234, getHeader: (n: string) => (n === 'host' ? 'example.com:8080' : undefined) },
      { host: 'example.com', port: 8080 },
      (_err: any, s: any) => {
        got = s;
      },
    );

    expect(created).toHaveLength(1);
    const opts = created[0];
    expect(opts.servername).toBe('example.com');
    expect(opts.timeout).toBe(1234); // per-request timeout wins
    expect(opts.keepAlive).toBe(true);
    expect(opts.keepAliveInitialDelay).toBe(2500);
    expect(opts._agentKey).toBe('example.com:8080:');
    expect(opts.encoding).toBe(null);
    expect(got).toBe(sock);
    expect(a.totalSocketCount).toBe(1);
    expect(a.sockets['example.com:8080:']).toEqual([sock]);
  });

  it('#createSocket drops an IP servername and uses the agent timeout', () => {
    const http = boot();
    const a = new http.Agent({ timeout: 5000 });
    const created: any[] = [];
    a.createConnection = (opts: any) => {
      created.push(opts);
      return fakeSocket();
    };
    a.createSocket(
      { getHeader: () => '127.0.0.1:80' },
      { host: '127.0.0.1', port: 80 },
      () => {},
    );
    expect(created[0].servername).toBe('');
    expect(created[0].timeout).toBe(5000);
  });

  it('#removeSocket empties the pools and #keepSocketAlive honours the hint', () => {
    const http = boot();
    const a = new http.Agent({ timeout: 5000, agentKeepAliveTimeoutBuffer: 1000 });
    const s = fakeSocket();
    a.sockets['h:80:'] = [s];
    a.removeSocket(s, { host: 'h', port: 80 });
    expect(a.sockets['h:80:']).toBeUndefined();

    const calls: any = {};
    const sock: any = {
      setKeepAlive: (e: boolean, ms: number) => {
        calls.keepAlive = [e, ms];
      },
      unref: () => {},
      ref: () => {},
      setTimeout: (t: number) => {
        calls.timeout = t;
      },
      timeout: 0,
      _httpMessage: { res: { headers: { 'keep-alive': 'timeout=2' } } },
    };
    // hint 2s - 1s buffer = 1s, shorter than the 5s agent timeout.
    expect(a.keepSocketAlive(sock)).toBe(true);
    expect(calls.keepAlive).toEqual([true, 1000]);
    expect(calls.timeout).toBe(1000);
    // hint 1s - 1s buffer = 0 -> refuse to reuse.
    sock._httpMessage.res.headers['keep-alive'] = 'timeout=1';
    expect(a.keepSocketAlive(sock)).toBe(false);
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
