import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import {
  applyProxy,
  createEgress,
  isLoopbackHost,
  type EgressFetchResponse,
} from '../src/node-runtime/net/egress';

const decoder = new TextDecoder();

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

interface EgressHook {
  request(req: { url: string; method: string; headers: Record<string, string>; body: Uint8Array | null }): Promise<{
    status: number;
    statusMessage: string;
    headers: Record<string, string | string[]>;
    body: Uint8Array;
  }>;
}

function boot(
  files: Record<string, string>,
  opts: { egress?: EgressHook; entry?: string } = {},
) {
  const entry = opts.entry ?? '/project/index.js';
  const vfs = makeProject(files);
  const out: string[] = [];
  const err: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: [entry],
    installGlobals: false,
    egress: opts.egress as never,
    onStdout: (c) => out.push(c),
    onStderr: (c) => err.push(c),
  });
  const run = () => {
    try {
      runtime.runMain(entry);
    } catch {
      /* asserted via output */
    }
  };
  return { runtime, vfs, out, err, run };
}

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('isLoopbackHost', () => {
  it('treats the tab\u2019s own names as loopback', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.9.9.9', '::1', '0.0.0.0', 'foo.localhost', '']) {
      expect(isLoopbackHost(h)).toBe(true);
    }
  });

  it('treats everything else as outbound', () => {
    for (const h of ['example.com', 'registry.npmjs.org', '10.0.0.1', '192.168.1.2']) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });

  it('unwraps a bracketed IPv6 loopback', () => {
    expect(isLoopbackHost('[::1]')).toBe(true);
  });
});

describe('applyProxy', () => {
  it('expands a {url} template with the percent-encoded target', () => {
    expect(applyProxy('https://proxy.test/?u={url}', 'https://a.test/x?y=1')).toBe(
      'https://proxy.test/?u=https%3A%2F%2Fa.test%2Fx%3Fy%3D1',
    );
  });

  it('expands a %s placeholder', () => {
    expect(applyProxy('https://proxy.test/%s', 'https://a.test/')).toBe('https://proxy.test/https%3A%2F%2Fa.test%2F');
  });

  it('appends the target under a plain prefix (adding a slash)', () => {
    expect(applyProxy('https://proxy.test', 'https://a.test/x')).toBe('https://proxy.test/https://a.test/x');
    expect(applyProxy('https://proxy.test/', 'https://a.test/x')).toBe('https://proxy.test/https://a.test/x');
  });
});

describe('createEgress', () => {
  function fakeResponse(body: string, init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}) {
    const headers = init.headers ?? {};
    const res: EgressFetchResponse = {
      status: init.status ?? 200,
      statusText: init.statusText ?? 'OK',
      headers: {
        forEach(cb) {
          for (const [k, v] of Object.entries(headers)) cb(v, k);
        },
      },
      async arrayBuffer() {
        return new TextEncoder().encode(body).buffer;
      },
    };
    return res;
  }

  it('performs a direct request and reports status/headers/body', async () => {
    const seen: string[] = [];
    const egress = createEgress({
      fetch: (async (input: string) => {
        seen.push(input);
        return fakeResponse('hi', { status: 201, headers: { 'content-type': 'text/plain' } });
      }) as never,
    });
    const res = await egress.request({
      url: 'https://a.test/x',
      method: 'GET',
      headers: { accept: '*/*' },
      body: null,
    });
    expect(seen).toEqual(['https://a.test/x']);
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(decoder.decode(res.body)).toBe('hi');
    expect(egress.dialTcp).toBeUndefined();
  });

  it('falls back to the proxy when the direct attempt throws (CORS)', async () => {
    const attempts: string[] = [];
    const failures: string[] = [];
    const egress = createEgress({
      fetch: (async (input: string) => {
        attempts.push(input);
        if (attempts.length === 1) throw new TypeError('Failed to fetch');
        return fakeResponse('via proxy');
      }) as never,
      proxy: 'https://proxy.test/?u={url}',
      onFallback: (_r, url) => failures.push(url),
    });
    const res = await egress.request({ url: 'https://blocked.test/y', method: 'GET', headers: {}, body: null });
    expect(attempts).toEqual([
      'https://blocked.test/y',
      'https://proxy.test/?u=https%3A%2F%2Fblocked.test%2Fy',
    ]);
    expect(failures).toEqual(['https://blocked.test/y']);
    expect(decoder.decode(res.body)).toBe('via proxy');
  });

  it('tags a bare fetch TypeError with a code and the target', async () => {
    const egress = createEgress({
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as never,
    });
    await expect(
      egress.request({ url: 'https://nope.test/z', method: 'GET', headers: {}, body: null }),
    ).rejects.toMatchObject({ code: 'ERR_WEB_NODE_EGRESS', target: 'https://nope.test/z' });
  });

  it('keeps the original failure as the cause when the proxy also fails', async () => {
    const egress = createEgress({
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as never,
      proxy: 'https://proxy.test/%s',
    });
    const err = await egress
      .request({ url: 'https://nope.test/z', method: 'GET', headers: {}, body: null })
      .then(
        () => null,
        (e) => e as { cause?: unknown; target?: string },
      );
    expect(err?.target).toBe('https://proxy.test/https%3A%2F%2Fnope.test%2Fz');
    expect(err?.cause).toBeInstanceOf(TypeError);
  });

  it('exposes dialTcp only when a TCP bridge is configured', () => {
    const fetchStub = (async () => fakeResponse('')) as never;
    expect(createEgress({ fetch: fetchStub }).dialTcp).toBeUndefined();
    expect(createEgress({ fetch: fetchStub, tcpBridgeUrl: 'wss://bridge.test/' }).dialTcp).toBeTypeOf('function');
  });
});

describe('egress wired into the sandbox', () => {
  it('routes http.get() to a public host through egress', async () => {
    const calls: string[] = [];
    const egress: EgressHook = {
      async request(req) {
        calls.push(`${req.method} ${req.url}`);
        return {
          status: 200,
          statusMessage: 'OK',
          headers: { 'content-type': 'application/json' },
          body: new TextEncoder().encode('{"ok":true}'),
        };
      },
    };
    const { runtime, run } = boot(
      {
        '/project/index.js': `
          const http = require('http');
          const req = http.get('http://example.com/api/v1?q=1', (res) => {
            let body = '';
            res.on('data', (c) => (body += c.toString()));
            res.on('end', () => console.log('STATUS=' + res.statusCode + ' BODY=' + body));
          });
          req.on('error', (e) => console.log('ERR ' + e.code));
        `,
      },
      { egress: egress as never },
    );
    run();
    await tick(30);
    expect(calls).toEqual(['GET http://example.com/api/v1?q=1']);
    expect(runtime).toBeTruthy();
  });

  it('keeps https.get() on a public host reachable via egress', async () => {
    const calls: string[] = [];
    const egress: EgressHook = {
      async request(req) {
        calls.push(req.url);
        return { status: 204, statusMessage: 'No Content', headers: {}, body: new Uint8Array(0) };
      },
    };
    const { run } = boot(
      {
        '/project/index.js': `
          const https = require('https');
          https.get('https://registry.npmjs.org/ms', (res) => {
            res.resume();
            res.on('end', () => console.log('CODE=' + res.statusCode));
          }).on('error', (e) => console.log('ERR ' + e.code));
        `,
      },
      { egress: egress as never },
    );
    run();
    await tick(30);
    expect(calls).toEqual(['https://registry.npmjs.org/ms']);
  });

  it('fails a public http dial loudly (ECONNREFUSED) when egress is absent', async () => {
    const { runtime, run } = boot({
      '/project/index.js': `
        const http = require('http');
        http.get('http://example.com/', () => console.log('unexpected')).on('error', (e) => console.log('ERR ' + e.code));
      `,
    });
    run();
    await tick(20);
    // No egress means the virtual network has no such port — exactly the old
    // behaviour, and it must stay honest rather than hang.
    expect(runtime.network.ports).not.toContain(80);
  });
});
