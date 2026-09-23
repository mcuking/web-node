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
    expect(typeof g.params).toBe('function');
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

describe('http.OutgoingMessage surface', () => {
  it('exposes the shared header/plumbing members', () => {
    const { req } = boot();
    const http = req('http');
    const proto = http.OutgoingMessage.prototype;
    for (const m of [
      '_finish',
      '_flush',
      '_flushOutput',
      '_implicitHeader',
      '_isLenientHeaderValidation',
      '_renderHeaders',
      '_send',
      '_storeHeader',
      '_writeRaw',
      'addTrailers',
      'appendHeader',
      'flushHeaders',
      'getHeader',
      'getHeaderNames',
      'getHeaders',
      'getRawHeaderNames',
      'hasHeader',
      'headersSent',
      'removeHeader',
      'setHeader',
      'setHeaders',
      'setTimeout',
      'socket',
      'connection',
    ]) {
      expect(m in proto).toBe(true);
    }

    const m = new http.OutgoingMessage();
    expect(m.headersSent).toBe(false);
    expect(m.socket).toBeNull();
    m.setHeader('X-A', '1');
    m.appendHeader('X-A', '2');
    expect(m.getHeader('x-a')).toEqual(['1', '2']);
    expect(m.getHeaderNames()).toEqual(['x-a']);
    expect(m.getRawHeaderNames()).toEqual(['X-A']);
    expect(m.getHeaders()).toEqual({ 'x-a': ['1', '2'] });
    m.setHeaders({ 'X-B': 'b' });
    expect(m.hasHeader('x-b')).toBe(true);
    m.removeHeader('x-b');
    expect(m.hasHeader('x-b')).toBe(false);

    m._storeHeader('GET / HTTP/1.1\r\n', m._renderHeaders());
    expect(m.headersSent).toBe(true);
    expect(m._header).toContain('x-a: 1\r\n');
    expect(() => m.setHeader('a', 'b')).toThrowError(/after they are sent/);
    expect(() => m._renderHeaders()).toThrowError(/after they are sent/);

    const fresh = new http.OutgoingMessage();
    expect(() => fresh._implicitHeader()).toThrowError(/not implemented/i);
    expect(fresh._isLenientHeaderValidation()).toBe(false);
  });
});

describe('http.IncomingMessage header folding', () => {
  it('folds duplicates the way Node does', () => {
    const http = boot().req('http');
    const msg = new http.IncomingMessage();
    msg._addHeaderLine('Set-Cookie', 'a=1', msg.headers);
    msg._addHeaderLine('Set-Cookie', 'b=2', msg.headers);
    expect(msg.headers['set-cookie']).toEqual(['a=1', 'b=2']);
    msg._addHeaderLine('X-Multi', '1', msg.headers);
    msg._addHeaderLine('X-Multi', '2', msg.headers);
    expect(msg.headers['x-multi']).toBe('1, 2');
    msg._addHeaderLine('Cookie', 'a=1', msg.headers);
    msg._addHeaderLine('Cookie', 'b=2', msg.headers);
    expect(msg.headers['cookie']).toBe('a=1; b=2');
    msg._addHeaderLine('Content-Type', 'text/plain', msg.headers);
    msg._addHeaderLine('Content-Type', 'text/html', msg.headers);
    // Content-Type is a drop-duplicates field: the first value wins.
    expect(msg.headers['content-type']).toBe('text/plain');

    const distinct: Record<string, string[]> = {};
    msg._addHeaderLineDistinct('X-D', '1', distinct);
    msg._addHeaderLineDistinct('X-D', '2', distinct);
    expect(distinct['x-d']).toEqual(['1', '2']);

    const msg2 = new http.IncomingMessage();
    msg2._addHeaderLines(['A', '1', 'B', '2'], 4);
    expect(msg2.rawHeaders).toEqual(['A', '1', 'B', '2']);
    expect(msg2.headers).toEqual({ a: '1', b: '2' });
  });
});

describe('https Server / Agent subclasses', () => {
  it('Server keeps a real ticket-key store and records TLS config', () => {
    const { req } = boot();
    const http = req('http');
    const https = req('https');
    expect(https.Server).not.toBe(http.Server);
    expect(https.Agent).not.toBe(http.Agent);

    const server = new https.Server();
    expect(server instanceof http.Server).toBe(true);
    expect(server.getTicketKeys().byteLength).toBe(48);

    const keys = new Uint8Array(48).fill(7);
    server.setTicketKeys(keys);
    expect(server.getTicketKeys()).toBe(keys);
    expect(server._getServerData()).toEqual({ ticketKeys: '07'.repeat(48) });
    server._setServerData({ ticketKeys: '0a'.repeat(48) });
    expect(server.getTicketKeys()[0]).toBe(0x0a);
    expect(() => server.setTicketKeys(new Uint8Array(47))).toThrowError(/48-byte/);

    server.addContext('example.com', { ca: 'x' });
    expect(() => server.addContext('', {})).toThrowError(/servername/i);
    server.setSecureContext({ key: 'k', cert: 'c' });
    expect(server.key).toBe('k');
    expect(server.cert).toBe('c');
  });

  it('Agent is an LRU TLS session cache', () => {
    const { req } = boot();
    const http = req('http');
    const https = req('https');
    const agent = new https.Agent({ maxCachedSessions: 2 });
    expect(agent instanceof http.Agent).toBe(true);
    expect(agent.maxCachedSessions).toBe(2);
    agent._cacheSession('k1', 's1');
    expect(agent._getSession('k1')).toBe('s1');
    agent._cacheSession('k2', 's2');
    agent._cacheSession('k3', 's3');
    // k1 is evicted (LRU) once the cache is full.
    expect(agent._getSession('k1')).toBeUndefined();
    expect(agent._getSession('k3')).toBe('s3');
    agent._evictSession('k3');
    expect(agent._getSession('k3')).toBeUndefined();

    const disabled = new https.Agent({ maxCachedSessions: 0 });
    disabled._cacheSession('k', 's');
    expect(disabled._getSession('k')).toBeUndefined();
  });
});

describe('module surface', () => {
  it('provides wrap/wrapper/constants and the loader statics', () => {
    const mod = boot().req('module');
    expect(mod).toBe(mod.Module);
    expect(mod.wrapper).toEqual([
      '(function (exports, require, module, __filename, __dirname) { ',
      '\n});',
    ]);
    expect(mod.wrap('x = 1;')).toBe(`${mod.wrapper[0]}x = 1;${mod.wrapper[1]}`);
    expect(mod.wrap.length).toBe(1);
    expect(mod.constants.compileCacheStatus).toEqual({
      FAILED: 0,
      ENABLED: 1,
      ALREADY_ENABLED: 2,
      DISABLED: 3,
    });
    expect(mod._pathCache instanceof Map).toBe(true);
    expect(mod.isBuiltin('fs')).toBe(true);
    expect(mod.builtinModules).toContain('fs');

    const M = new mod.Module('a/b.js', null);
    expect(M.parent).toBeNull();
    expect(M.isPreloading).toBe(false);
    expect('parent' in mod.Module.prototype).toBe(true);
    for (const m of ['_compile', 'isPreloading', 'load', 'parent', 'require']) {
      expect(m in mod.Module.prototype).toBe(true);
    }
    for (const m of [
      'SourceMap',
      'wrap',
      'wrapper',
      'constants',
      '_pathCache',
      '_findPath',
      '_initPaths',
      '_load',
      '_preloadModules',
      '_readPackage',
      '_resolveLookupPaths',
      '_stat',
      'enableCompileCache',
      'findPackageJSON',
      'findSourceMap',
      'flushCompileCache',
      'getCompileCacheDir',
      'getSourceMapsSupport',
      'registerHooks',
      'runMain',
      'setSourceMapsSupport',
      'stripTypeScriptTypes',
    ]) {
      expect(m in mod.Module).toBe(true);
    }

    expect(() => M._compile()).toThrowError(/not implemented/i);
    expect(() => M.load()).toThrowError(/not implemented/i);
    // Still unimplemented: `runMain`.
    expect(() => mod.runMain()).toThrowError(/not implemented/i);
    // The TypeScript strip transform is implemented (strip-only mode).
    expect(mod.stripTypeScriptTypes('const a: number = 1')).toBe('const a         = 1');
    // Loader-backed statics now delegate to the web-node loader.
    expect(mod._stat('/x')).toBe(-2);
    expect(mod._findPath('x', ['/'], false)).toBe(false);
    expect(mod._readPackage('/x')).toMatchObject({ type: 'none', exists: false });
    expect(typeof mod.registerHooks({}).deregister).toBe('function');
    // Requiring a missing request reports MODULE_NOT_FOUND, not a stub error.
    expect(() => mod._load('x', null, false)).toThrowError(/Cannot find module/);
    expect(() => mod.findPackageJSON('/project')).toThrowError(/Cannot find package/);
    expect(Array.isArray(mod._resolveLookupPaths('x', {}))).toBe(true);
    expect(mod._initPaths()).toBeUndefined();
    expect(mod.globalPaths).toEqual([]);
  });

  it('tracks source-map support flags and the compile cache', () => {
    const mod = boot().req('module');
    expect(mod.getSourceMapsSupport()).toEqual({
      enabled: false,
      nodeModules: false,
      generatedCode: false,
    });
    mod.setSourceMapsSupport(true, { nodeModules: false, generatedCode: true });
    expect(mod.getSourceMapsSupport()).toEqual({
      enabled: true,
      nodeModules: false,
      generatedCode: true,
    });
    expect(() => mod.setSourceMapsSupport('yes')).toThrowError(/boolean/);
    expect(mod.findSourceMap('/x.js')).toBeUndefined();
    expect(mod.getCompileCacheDir()).toBeUndefined();
    expect(mod.flushCompileCache()).toBeUndefined();
    expect(mod.enableCompileCache('/tmp').status).toBe(mod.constants.compileCacheStatus.FAILED);
  });

  it('exposes a working SourceMap', () => {
    const mod = boot().req('module');
    expect(typeof mod.SourceMap).toBe('function');
    expect(mod.SourceMap.length).toBe(1);
    for (const m of ['findEntry', 'findOrigin', 'lineLengths', 'payload']) {
      expect(m in mod.SourceMap.prototype).toBe(true);
    }
    const sm = new mod.SourceMap({
      version: 3,
      sources: ['a.ts'],
      names: [],
      mappings: 'AAAA',
    });
    expect(sm.payload.version).toBe(3);
    expect(sm.lineLengths).toBeUndefined();
    const origin = sm.findOrigin(1, 1);
    expect(origin.fileName).toBe('a.ts');
    expect(origin.lineNumber).toBe(1);
    expect(origin.columnNumber).toBe(1);

    const withLines = new mod.SourceMap(
      { version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' },
      { lineLengths: [10, 20] },
    );
    expect(withLines.lineLengths).toEqual([10, 20]);
  });
});

describe('tls surface', () => {
  it('builds the class hierarchy on net.Server / net.Socket', () => {
    const { req } = boot();
    const tls = req('tls');
    const net = req('net');
    expect(tls.Server.prototype instanceof net.Server).toBe(true);
    expect(tls.TLSSocket.prototype instanceof net.Socket).toBe(true);
    expect(tls.SecureContext.length).toBe(4);
    expect(tls.Server.length).toBe(2);
    expect(tls.TLSSocket.length).toBe(2);

    for (const m of [
      'getCipher',
      'getProtocol',
      'getPeerCertificate',
      'getSession',
      'setServername',
      'setSession',
      'disableRenegotiation',
      'exportKeyingMaterial',
      'isSessionReused',
      'renegotiate',
    ]) {
      expect(m in tls.TLSSocket.prototype).toBe(true);
    }

    expect(() => new tls.TLSSocket()).toThrowError(/not implemented/i);
    expect(() => new tls.SecureContext()).toThrowError(/not implemented/i);
  });

  it('Server records TLS config and keeps a ticket-key store', () => {
    const { req } = boot();
    const tls = req('tls');
    const server = tls.createServer();
    expect(server instanceof tls.Server).toBe(true);
    expect(server.getTicketKeys().byteLength).toBe(48);
    const keys = new Uint8Array(48).fill(3);
    server.setTicketKeys(keys);
    expect(server.getTicketKeys()).toBe(keys);
    expect(server._getServerData()).toEqual({ ticketKeys: '03'.repeat(48) });
    server._setServerData({ ticketKeys: '0b'.repeat(48) });
    expect(server.getTicketKeys()[0]).toBe(0x0b);
    server.addContext('example.com', { ca: 'x' });
    expect(() => server.addContext('', {})).toThrowError(/servername/i);
    server.setSecureContext({ key: 'k', cert: 'c' });
    expect(server.key).toBe('k');
    expect(server.cert).toBe('c');
  });

  it('convertALPNProtocols encodes; engine-backed calls throw', () => {
    const tls = boot().req('tls');
    expect(tls.convertALPNProtocols.length).toBe(2);
    const out: Record<string, unknown> = {};
    expect(tls.convertALPNProtocols(['h2'], out)).toBeUndefined();
    expect(Array.from(out.ALPNProtocols as Uint8Array)).toEqual([2, 0x68, 0x32]);
    expect(() => tls.convertALPNProtocols([''], {})).toThrowError(/non-empty string/);

    for (const call of [
      () => tls.getCiphers(),
      () => tls.getCACertificates(),
      () => tls.getCertificateCompressionAlgorithms(),
      () => tls.checkServerIdentity('h', {}),
      () => tls.createSecureContext({}),
      () => tls.connect(),
      () => tls.setDefaultCACertificates([]),
    ]) {
      expect(call).toThrowError(/not implemented/i);
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
    expect(() => new net.BoundSocket()).not.toThrowError();
    // A default bind is a live, releasable virtual handle.
    const bound = new net.BoundSocket();
    expect(bound.isPipe).toBe(false);
    expect(bound.fd()).toBe(-1);
    expect(bound.address().family).toBe('IPv4');
    bound.close();
    expect(() => bound.close()).toThrowError(/already been adopted/i);
    // Unix-domain/pipe binds have no virtual counterpart and stay loud.
    expect(() => new net.BoundSocket({ path: '/tmp/sock' })).toThrowError(/not implemented/i);

    expect(net._normalizeArgs.length).toBe(1);
    expect(net._normalizeArgs([])).toEqual([{}, null]);
    expect(net._normalizeArgs([8080])).toEqual([{ port: 8080 }, null]);
    expect(net._normalizeArgs([8080, 'h'])[0]).toEqual({ port: 8080, host: 'h' });
    expect(net._normalizeArgs(['/tmp/sock'])).toEqual([{ path: '/tmp/sock' }, null]);

    expect(net._createServerHandle.length).toBe(5);
    expect(() => net._createServerHandle()).toThrowError(/not implemented/i);
  });
});
