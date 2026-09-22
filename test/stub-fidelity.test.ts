import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 71: feature-detection fidelity for the surface we deliberately do
 * not implement. Stubs should still *look* like Node — right class-ness, right
 * members, right arity — so `x instanceof`, `'m' in obj`, `typeof f` checks
 * behave, while every actually-unimplemented call still throws loudly.
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
  const req = (id: string) => runtime.realm.require(id) as any;
  return { req };
}

describe('http.Agent is an EventEmitter', () => {
  it('inherits the emitter surface and exposes defaultMaxSockets', () => {
    const { req } = boot();
    const http = req('http');
    const { EventEmitter } = req('events');
    const agent = new http.Agent({ keepAlive: true });
    expect(agent).toBeInstanceOf(EventEmitter);
    expect(agent).toBeInstanceOf(http.Agent);
    expect(typeof agent.on).toBe('function');
    expect(typeof agent.emit).toBe('function');
    expect(http.Agent.defaultMaxSockets).toBe(Infinity);
    let seen = 0;
    agent.on('ping', () => (seen += 1));
    agent.emit('ping');
    expect(seen).toBe(1);
  });
});

describe('net.SocketAddress.parse', () => {
  it('parses like Node (URL-based, default port dropped)', () => {
    const net = boot().req('net');
    expect(net.SocketAddress.parse('127.0.0.1:80').toJSON()).toEqual({
      address: '127.0.0.1',
      port: 0, // :80 is the http default and is stripped by the URL parser
      family: 'ipv4',
      flowlabel: 0,
    });
    expect(net.SocketAddress.parse('[::1]:443').toJSON()).toEqual({
      address: '::1',
      port: 443,
      family: 'ipv6',
      flowlabel: 0,
    });
    expect(net.SocketAddress.parse('1.2.3.4').port).toBe(0);
    // A hostname is not an IP -> the constructor throws -> parse returns undefined
    expect(net.SocketAddress.parse('localhost:8080')).toBeUndefined();
    expect(() => net.SocketAddress.parse(123)).toThrowError(/string/);
  });
});

describe('dns.Resolver query surface', () => {
  it('has every query method; loopback ones resolve, others throw', async () => {
    const dns = boot().req('dns');
    const resolver = new dns.Resolver();
    for (const m of [
      'resolve',
      'resolve4',
      'resolve6',
      'resolveAny',
      'resolveCaa',
      'resolveCname',
      'resolveMx',
      'resolveNaptr',
      'resolveNs',
      'resolvePtr',
      'resolveSoa',
      'resolveSrv',
      'resolveTlsa',
      'resolveTxt',
      'reverse',
      'setLocalAddress',
    ]) {
      expect(typeof resolver[m]).toBe('function');
    }
    expect(() => resolver.resolveMx('x')).toThrowError(/not implemented/i);
    resolver.setLocalAddress('127.0.0.1');
    const v4 = await new Promise((res) => resolver.resolve4('example.com', (e: Error | null, r: unknown) => res(r)));
    expect(v4).toEqual(['127.0.0.1']);
  });
});

describe('zlib stub classes look like Node', () => {
  it('Brotli/Zstd classes extend Transform but throw from the constructor', () => {
    const { req } = boot();
    const zlib = req('zlib');
    const { Transform } = req('stream');
    for (const name of ['BrotliCompress', 'BrotliDecompress', 'ZstdCompress', 'ZstdDecompress']) {
      const Ctor = zlib[name];
      expect(typeof Ctor).toBe('function');
      expect(Ctor.name).toBe(name);
      expect(Ctor.prototype).toBeInstanceOf(Transform);
      expect(typeof Ctor.prototype.pipe).toBe('function');
      expect(() => new Ctor()).toThrowError(/not implemented/i);
    }
    // Zip classes are plain classes (no codec), still throwing and named.
    expect(zlib.ZipBuffer.name).toBe('ZipBuffer');
    expect(typeof zlib.ZipBuffer).toBe('function');
  });
});
