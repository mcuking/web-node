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

  it('carries the full ZlibBase surface (accessors + methods)', () => {
    const zlib = boot().req('zlib');
    const g = zlib.createGzip();
    for (const m of [
      '_closed',
      '_flush',
      '_processChunk',
      'close',
      'flush',
      'params',
      'reset',
    ]) {
      expect(m in g).toBe(true);
    }
    expect(g._closed).toBe(false);
    expect(g.reset()).toBeUndefined();
    expect(() => g.params(9, 0)).toThrowError(/not implemented/i);
    g.close();
    expect(g._closed).toBe(true);
    expect(() => g.reset()).toThrowError(/zlib binding closed/);
  });

  it('gives the Zip classes their full member surface', () => {
    const zlib = boot().req('zlib');
    for (const m of ['add', 'entries', 'toBufferSync', 'size', 'writable']) {
      expect(m in zlib.ZipBuffer.prototype).toBe(true);
    }
    for (const m of ['create', 'read']) {
      expect(m in zlib.ZipEntry).toBe(true);
    }
    for (const m of ['name', 'contentSync']) {
      expect(m in zlib.ZipEntry.prototype).toBe(true);
    }
    expect('open' in zlib.ZipFile).toBe(true);
    expect('openSync' in zlib.ZipFile).toBe(true);
    expect('addEntry' in zlib.ZipFile.prototype).toBe(true);
    expect('closeSync' in zlib.ZipFile.prototype).toBe(true);
    expect(() => new zlib.ZipFile()).toThrowError(/not implemented/i);
  });
});

describe('console inspector extensions', () => {
  it('grafts context/createTask/profile/profileEnd/timeStamp', () => {
    const console = boot().req('console');
    for (const m of ['context', 'createTask', 'profile', 'profileEnd', 'timeStamp']) {
      expect(typeof console[m]).toBe('function');
    }
    expect(console.context.length).toBe(1);
    expect(console.createTask.length).toBe(0);
    expect(console.profile('p')).toBeUndefined();
    expect(console.timeStamp()).toBeUndefined();

    expect(() => console.createTask(123)).toThrowError(/non-empty string/);
    const task = console.createTask('TASK');
    expect(Object.keys(task)).toEqual(['run']);
    expect(task.run.length).toBe(0);
    let seen = 0;
    expect(task.run(() => 42)).toBe(42);
    task.run(() => (seen = 1));
    expect(seen).toBe(1);
    expect(() => task.run(123)).toThrowError(/must be a function/);

    const ctx = console.context('NS');
    expect(ctx.log).not.toBe(console.log);
    expect(typeof ctx.log).toBe('function');
    expect('log' in ctx).toBe(true);
    expect('dirXml' in ctx).toBe(true);
    expect('Console' in ctx).toBe(false);
    expect('context' in ctx).toBe(false);
    expect('createTask' in ctx).toBe(false);
    expect(() => console.context(123)).toThrowError(/non-empty string/);
  });
});

describe('child_process surface', () => {
  it('exports _forkChild and ChildProcess#spawn', () => {
    const cp = boot().req('child_process');
    expect(typeof cp._forkChild).toBe('function');
    expect(cp._forkChild.length).toBe(2);
    expect(() => cp._forkChild(3, 'json')).toThrowError(/not implemented/i);
    expect(typeof cp.ChildProcess.prototype.spawn).toBe('function');
    expect(cp.ChildProcess.prototype.spawn.length).toBe(1);
    expect(() => new cp.ChildProcess('node', []).spawn({})).toThrowError(/not implemented/i);
  });
});

describe('v8 coverage entry points', () => {
  it('exposes takeCoverage/stopCoverage that throw (no inspector)', () => {
    const v8 = boot().req('v8');
    for (const m of ['takeCoverage', 'stopCoverage']) {
      expect(typeof v8[m]).toBe('function');
      expect(v8[m].length).toBe(0);
      expect(() => v8[m]()).toThrowError(/not implemented/i);
    }
  });
});

describe('net.Socket / net.Server prototype fidelity', () => {
  it('Socket carries Node\'s accessors and internal methods', () => {
    const net = boot().req('net');
    const proto = net.Socket.prototype;
    for (const m of [
      '_bytesDispatched',
      '_connecting',
      '_getpeername',
      '_getsockname',
      '_handle',
      '_onTimeout',
      '_reset',
      '_unrefTimer',
      '_writeGeneric',
      'bufferSize',
      'bytesRead',
      'bytesWritten',
      'destroySoon',
      'getTypeOfService',
      'localAddress',
      'localFamily',
      'localPort',
      'pending',
      'readyState',
      'remoteAddress',
      'remoteFamily',
      'remotePort',
      'resetAndDestroy',
      'setTypeOfService',
    ]) {
      expect(m in proto).toBe(true);
    }
    const s = new net.Socket();
    expect(s._handle).toBeNull();
    expect(s._connecting).toBe(false);
    expect(s.pending).toBe(true);
    expect(s.readyState).toBe('open');
    expect(s.bufferSize).toBeUndefined();
    expect(s.bytesRead).toBe(0);
    expect(s.getTypeOfService()).toBe(0);
    expect(s.setTypeOfService(4)).toBe(s);
    expect(s.getTypeOfService()).toBe(4);
    expect(() => s.setTypeOfService(999)).toThrowError(/out of range/);
  });

  it('Server carries listening + the internal lifecycle hooks', () => {
    const net = boot().req('net');
    const proto = net.Server.prototype;
    for (const m of ['_emitCloseIfDrained', '_listen2', '_setupWorker', 'listening']) {
      expect(m in proto).toBe(true);
    }
    const server = new net.Server();
    expect(server.listening).toBe(false);
    expect(() => server._setupWorker()).toThrowError(/not implemented/i);
  });

  it('exports BoundSocket and the internal helpers', () => {
    const net = boot().req('net');
    expect(typeof net.BoundSocket).toBe('function');
    for (const m of ['address', 'close', 'fd', 'isPipe']) {
      expect(m in net.BoundSocket.prototype).toBe(true);
    }
    expect(() => new net.BoundSocket()).toThrowError(/not implemented/i);

    expect(net._normalizeArgs.length).toBe(1);
    expect(net._normalizeArgs([])).toEqual([{}, null]);
    expect(net._normalizeArgs([8080])).toEqual([{ port: 8080 }, null]);
    expect(net._normalizeArgs([8080, 'h'])[0]).toEqual({ port: 8080, host: 'h' });
    expect(net._normalizeArgs(['/tmp/sock'])).toEqual([{ path: '/tmp/sock' }, null]);

    expect(net._createServerHandle.length).toBe(5);
    expect(() => net._createServerHandle()).toThrowError(/not implemented/i);
  });
});
