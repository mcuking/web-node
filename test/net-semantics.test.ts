import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

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
  const req = (id: string): any => runtime.realm.require(id);
  return { runtime, req };
}

describe('net.Socket / net.Server Node defaults', () => {
  it('defaults allowHalfOpen, timeout, maxConnections like Node', () => {
    const net = boot().req('net');
    const s = new net.Socket();
    expect(s.allowHalfOpen).toBe(false);
    expect(s.timeout).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(s, 'timeout')).toBe(false);
    expect(new net.Socket({ allowHalfOpen: true }).allowHalfOpen).toBe(true);
    expect(s.readyState).toBe('open');
    expect(s.pending).toBe(true);
    s.setTimeout(1234);
    expect(s.timeout).toBe(1234);

    const server = net.createServer();
    expect(server.maxConnections).toBeUndefined();
    expect('setTimeout' in net.Server.prototype).toBe(false);
    server.close();
  });

  it('accepts an options object in connect()/createConnection()', async () => {
    const { req } = boot();
    const net = req('net');
    const events: string[] = [];
    const server = net.createServer((socket: any) => {
      socket.on('data', (d: any) => socket.end(d));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const text = await new Promise<string>((resolve) => {
      const client = net.connect({ port, host: '127.0.0.1' });
      expect(client).toBeInstanceOf(net.Socket);
      client.setEncoding('utf8');
      client.on('connect', () => events.push('connect'));
      client.on('ready', () => events.push('ready'));
      let acc = '';
      client.on('data', (d: string) => {
        acc += d;
        client.end();
      });
      client.on('close', () => {
        events.push('close');
        resolve(acc);
      });
      client.write('pong');
    });
    expect(text).toBe('pong');
    expect(events).toEqual(['connect', 'ready', 'close']);
    await new Promise<void>((r) => server.close(() => r()));
  });
});

/**
 * Differential test for `net` semantics — see test/http-semantics.test.ts for
 * the pattern. `tools/net-semantics-probe.cjs` runs unchanged on real Node
 * (oracle -> test/fixtures/net-semantics.json) and inside web-node; the two
 * JSON blobs must be equal.
 */
describe('net semantics (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/net-semantics-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/net-semantics.json', 'utf8'));

    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: () => {},
    });
    runtime.runMain('/project/index.js');

    let stdout = out.join('');
    for (let i = 0; i < 200 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, 'probe produced no observation line').toBeTruthy();
    expect(JSON.parse(line!.slice('__OBS__'.length))).toEqual(expected);
  });
});
