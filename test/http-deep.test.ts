import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 69: `http` object semantics — the client/server member surface that
 * real apps touch (interim responses, trailers, raw header names, socket
 * getters, connection lifecycle). Expected values were read off a real Node
 * v26.9.0.
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

function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('http.STATUS_CODES', () => {
  it('mirrors the full Node table', () => {
    const http = boot();
    expect(http.STATUS_CODES[102]).toBe('Processing');
    expect(http.STATUS_CODES[103]).toBe('Early Hints');
    expect(http.STATUS_CODES[226]).toBe('IM Used');
    expect(http.STATUS_CODES[418]).toBe("I'm a Teapot");
    expect(http.STATUS_CODES[511]).toBe('Network Authentication Required');
    expect(Object.keys(http.STATUS_CODES)).toHaveLength(63);
  });
});

describe('http.Server semantics', () => {
  it('has Node defaults and connection-closing methods', () => {
    const http = boot();
    const server = http.createServer();
    expect(server.requestTimeout).toBe(300000);
    expect(server.headersTimeout).toBe(60000);
    expect(server.keepAliveTimeout).toBe(5000);
    expect(server.maxRequestsPerSocket).toBe(0);
    expect(server.timeout).toBe(0);
    expect(server.setTimeout(1234)).toBe(server);
    expect(server.timeout).toBe(1234);
    expect(typeof server.closeAllConnections).toBe('function');
    expect(typeof server.closeIdleConnections).toBe('function');
  });

  it('closes idle keep-alive connections without dropping active ones', async () => {
    const http = boot();
    const seen: string[] = [];
    const server = http.createServer((req: any, res: any) => {
      seen.push('req');
      // Hold the response open until told, so the connection stays "active".
      setTimeout(() => res.end('ok'), 30);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get({ port, host: '127.0.0.1' }, (res: any) => {
        let data = '';
        res.on('data', (c: Uint8Array) => (data += new TextDecoder().decode(c)));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      // While the request is in flight the connection is active: it must survive
      // a closeIdleConnections() call.
      setTimeout(() => server.closeIdleConnections(), 5);
    });
    expect(seen).toEqual(['req']);
    expect(body).toBe('ok');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe('http.ServerResponse semantics', () => {
  it('exposes the missing members and writes interim/trailer framing', async () => {
    const http = boot();
    let captured: any = null;
    const server = http.createServer((_req: any, res: any) => {
      captured = {
        statusMessage: res.statusMessage,
        connection: res.connection === res.socket,
        chunked0: res.chunkedEncoding,
        writeContinue: typeof res.writeContinue,
        writeProcessing: typeof res.writeProcessing,
        writeEarlyHints: typeof res.writeEarlyHints,
        assignSocket: typeof res.assignSocket,
        detachSocket: typeof res.detachSocket,
        setHeaders: typeof res.setHeaders,
        appendHeader: typeof res.appendHeader,
        addTrailers: typeof res.addTrailers,
        getRawHeaderNames: typeof res.getRawHeaderNames,
      };
      res.writeContinue();
      res.setHeaders({ 'X-One': '1' });
      res.appendHeader('X-Multi', 'a');
      res.appendHeader('X-Multi', 'b');
      res.statusMessage = 'Custom';
      res.addTrailers({ 'X-Trailer': 'yes' });
      // Trailers only ride a chunked body, so stream instead of `end('body')`
      // (a known length would frame it with Content-Length, like Node).
      res.write('bo');
      res.end('dy');
      captured.raw = res.getRawHeaderNames();
      captured.chunked1 = res.chunkedEncoding;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const result = await new Promise<{ status: number; statusMessage: string; trailers: any; text: string }>(
      (resolve, reject) => {
        const req = http.get({ port, host: '127.0.0.1' }, (res: any) => {
          let text = '';
          res.on('data', (c: Uint8Array) => (text += new TextDecoder().decode(c)));
          res.on('end', () =>
            resolve({ status: res.statusCode, statusMessage: res.statusMessage, trailers: res.trailers, text }),
          );
        });
        req.on('error', reject);
      },
    );

    expect(captured.statusMessage).toBeUndefined();
    expect(captured.connection).toBe(true);
    expect(captured.chunked0).toBe(false);
    expect(captured.chunked1).toBe(true);
    expect(captured.raw).toEqual(['X-One', 'X-Multi']);
    for (const k of [
      'writeContinue',
      'writeProcessing',
      'writeEarlyHints',
      'assignSocket',
      'detachSocket',
      'setHeaders',
      'appendHeader',
      'addTrailers',
      'getRawHeaderNames',
    ]) {
      expect(captured[k]).toBe('function');
    }

    expect(result.status).toBe(200);
    expect(result.statusMessage).toBe('Custom');
    expect(result.text).toBe('body');
    expect(result.trailers['x-trailer']).toBe('yes');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('validates writeInformation status codes', () => {
    const http = boot();
    const server = http.createServer();
    const res = new (http.ServerResponse as any)(null);
    expect(() => res.writeInformation(200)).toThrowError(/out of range/);
    expect(() => res.writeInformation(99)).toThrowError(/out of range/);
  });
});

describe('http.IncomingMessage semantics', () => {
  it('exposes signal, distinct headers/trailers and setTimeout', async () => {
    const http = boot();
    let serverReq: any = null;
    const server = http.createServer((req: any, res: any) => {
      serverReq = req;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    await new Promise<void>((resolve, reject) => {
      const req = http.get({ port, host: '127.0.0.1', headers: { 'X-A': '1' } }, (res: any) => {
        res.resume();
        res.on('end', () => resolve());
      });
      req.on('error', reject);
    });

    expect(serverReq.signal).toBeInstanceOf(AbortSignal);
    expect(serverReq.signal.aborted).toBe(false);
    expect(serverReq.headersDistinct).toBeTypeOf('object');
    expect(serverReq.headersDistinct['x-a']).toEqual(['1']);
    expect(serverReq.trailersDistinct).toBeTypeOf('object');
    expect(serverReq.setTimeout(15000)).toBe(serverReq);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe('http.ClientRequest semantics', () => {
  it('exposes socket/connection, timers and header helpers', async () => {
    const http = boot();
    const server = http.createServer((_req: any, res: any) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const req = http.request({ port, host: '127.0.0.1', path: '/x' });
    expect(req.protocol).toBe('http:');
    expect(req.path).toBe('/x');
    expect(req.maxHeadersCount).toBeNull();
    req.setHeader('X-Case', 'v');
    // Node seeds `Host` at construction, so it precedes user-set headers.
    expect(req.getRawHeaderNames()).toEqual(['Host', 'X-Case']);
    expect(req.setNoDelay()).toBe(req);
    expect(req.setSocketKeepAlive(true, 10)).toBe(req);
    expect(req.setTimeout(5000)).toBe(req);

    await new Promise<void>((resolve, reject) => {
      req.on('response', (res: any) => {
        res.resume();
        res.on('end', () => {
          // The socket getter resolves once the request has been sent.
          expect(req.socket).not.toBeNull();
          expect(req.connection).toBe(req.socket);
          req.clearTimeout();
          resolve();
        });
      });
      req.on('error', reject);
      req.end();
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe('http header store / framing fidelity', () => {
  it('validates names/values and null-prototypes the header map', async () => {
    const http = boot();
    const server = http.createServer((_req: any, res: any) => {
      expect(Object.getPrototypeOf(res.getHeaders())).toBeNull();
      expect(res.setHeader('X-One', '1')).toBe(res);
      expect(res.getHeader('x-ONE')).toBe('1');
      expect(res.hasHeader('X-one')).toBe(true);
      expect(() => res.setHeader('X Bad', '1')).toThrowError(/valid HTTP token/);
      expect(() => res.setHeader('X-Ok', 'a\nb')).toThrowError(/Invalid character/);
      expect(() => res.setHeader('X-Ok', undefined)).toThrowError(/Invalid value/);
      expect(res.appendHeader('X-Multi', 'a')).toBe(res);
      res.appendHeader('X-Multi', 'b');
      expect(res.getHeader('x-multi')).toEqual(['a', 'b']);
      res.end('body');
      // `end('body')` knows the length, so Node frames it, not chunks it.
      expect(res.chunkedEncoding).toBe(false);
      expect(() => res.writeHead(200)).toThrowError(/Cannot write headers/);
      expect(() => res.setHeader('X-Late', '1')).toThrowError(/Cannot set headers/);
      expect(() => res.removeHeader('X-One')).toThrowError(/Cannot remove headers/);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const res = await new Promise<any>((resolve, reject) => {
      http
        .get({ port, host: '127.0.0.1' }, (r: any) => {
          r.resume();
          r.on('end', () => resolve(r));
        })
        .on('error', reject);
    });
    expect(res.headers['content-length']).toBe('4');
    expect(res.headers['transfer-encoding']).toBeUndefined();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('exposes QUERY and the outgoing-message prototype surface', () => {
    const http = boot();
    expect(http.METHODS).toContain('QUERY');
    expect(http.METHODS.length).toBe(35);
    for (const m of [
      'setHeader',
      'getHeader',
      'getHeaders',
      'getHeaderNames',
      'getRawHeaderNames',
      'hasHeader',
      'removeHeader',
      'setHeaders',
      'appendHeader',
      'addTrailers',
      'flushHeaders',
    ]) {
      expect(m in http.OutgoingMessage.prototype).toBe(true);
    }
  });
});
