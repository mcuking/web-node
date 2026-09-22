import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 64: the module-alias builtins Node ships as their own ids, plus the
 * deprecated `constants` umbrella and the widened dns surface. Each of these is
 * a one-line `require` of another builtin (or a small binding projection), but
 * `import x from 'node:assert/strict'` and friends are common enough that a
 * missing module id is a real compatibility hole.
 *
 * Expected values were read off a real Node v26.9.0 first.
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
  return runtime.realm as any;
}

describe('module aliases (node:assert/strict, node:path/posix, …)', () => {
  it('assert/strict is assert.strict and a callable namespace', () => {
    const realm = boot();
    const strict = realm.require('assert/strict');
    const assert = realm.require('assert');
    expect(typeof strict).toBe('function'); // callable, like Node
    expect(strict.strict).toBe(strict); // strict.strict === strict
    expect(strict.deepEqual).toBe(assert.strict.deepEqual);
    expect(strict.ok).toBe(assert.strict.ok);
    expect(strict.AssertionError).toBe(assert.AssertionError);
    // `node:` prefix resolves to the same module object.
    expect(realm.require('node:assert/strict')).toBe(strict);
  });

  it('path/posix and path/win32 are path.posix / path.win32', () => {
    const realm = boot();
    const path = realm.require('path');
    expect(realm.require('path/posix')).toBe(path.posix);
    expect(realm.require('path/win32')).toBe(path.win32);
    expect(realm.require('path/posix').join('a', 'b', '..', 'c')).toBe('a/c');
    // win32 keeps backslashes.
    expect(realm.require('path/win32').join('a', 'b')).toBe('a\\b');
  });

  it('sys is a deprecated alias of util', () => {
    const realm = boot();
    const util = realm.require('util');
    const sys = realm.require('sys');
    expect(sys.inspect).toBe(util.inspect);
    expect(sys.format).toBe(util.format);
    expect(sys.promisify).toBe(util.promisify);
  });

  it('constants exposes the os/fs umbrella Node documents', () => {
    const realm = boot();
    const constants = realm.require('constants');
    // os family
    expect(constants.RTLD_LAZY).toBe(1);
    expect(constants.RTLD_NOW).toBe(2);
    expect(constants.RTLD_GLOBAL).toBe(8);
    expect(constants.RTLD_LOCAL).toBe(4);
    expect(constants.SIGTERM).toBe(15);
    expect(constants.SIGABRT).toBe(6);
    expect(constants.PRIORITY_NORMAL).toBe(0);
    // platform errno (Node's `constants.os.errno`, distinct from libuv's table)
    expect(constants.EPERM).toBe(1);
    expect(constants.ENOENT).toBe(2);
    expect(constants.EOPNOTSUPP).toBe(102);
    expect(constants.EWOULDBLOCK).toBe(35); // alias of EAGAIN on darwin
    // fs family
    expect(constants.O_RDONLY).toBe(0);
    expect(constants.F_OK).toBe(0);
    expect(constants.R_OK).toBe(4);
    expect(constants.S_IFDIR).toBe(0o040000);
    expect(constants.S_IRGRP).toBe(0o040);
    expect(constants.S_IXOTH).toBe(0o001);
    expect(constants.COPYFILE_EXCL).toBe(1);
    expect(constants.UV_FS_COPYFILE_FICLONE).toBe(2);
    // the whole module is frozen, like Node
    expect(Object.isFrozen(constants)).toBe(true);
  });
});

describe('dns surface', () => {
  it('exposes the getaddrinfo flags and error codes on both namespaces', () => {
    const realm = boot();
    const dns = realm.require('dns');
    const promises = realm.require('dns/promises');
    for (const [k, v] of [
      ['ADDRCONFIG', 1024],
      ['V4MAPPED', 2048],
      ['ALL', 256],
    ] as const) {
      expect(dns[k]).toBe(v);
    }
    expect(dns.NODATA).toBe('ENODATA');
    expect(dns.SERVFAIL).toBe('ESERVFAIL');
    // the error codes live on the promise namespace too
    expect(promises.NODATA).toBe('ENODATA');
    expect(promises.REFUSED).toBe('EREFUSED');
  });

  it('lookup resolves loopback and defers the callback', async () => {
    const realm = boot();
    const dns = realm.require('dns');
    const sync = await new Promise<boolean>((resolve) => {
      let called = false;
      dns.lookup('localhost', (err: Error | null, address: string, family: number) => {
        expect(err).toBe(null);
        expect(address).toBe('127.0.0.1');
        expect(family).toBe(4);
        called = true;
        resolve(true);
      });
      // must not have fired synchronously
      expect(called).toBe(false);
    });
    expect(sync).toBe(true);
  });

  it('promises.lookup/all and the query-type stubs behave', async () => {
    const realm = boot();
    const promises = realm.require('dns/promises');
    expect(await promises.lookup('localhost')).toEqual({ address: '127.0.0.1', family: 4 });
    expect(await promises.lookup('localhost', { family: 6 })).toEqual({
      address: '::1',
      family: 6,
    });
    expect(await promises.lookup('localhost', { all: true })).toEqual([
      { address: '127.0.0.1', family: 4 },
    ]);
    expect(await promises.resolve4('example.com')).toEqual(['127.0.0.1']);
    expect(await promises.reverse('127.0.0.1')).toEqual(['localhost']);
    // a query type with no resolver behind it throws loudly rather than
    // silently returning an empty list.
    expect(() => promises.resolveMx('example.com')).toThrowError(/not implemented/i);
  });

  it('Resolver owns its own server list and validate input', () => {
    const realm = boot();
    const dns = realm.require('dns');
    const r = new dns.Resolver();
    expect(r.getServers()).toEqual(['127.0.0.1']);
    r.setServers(['8.8.8.8', '1.1.1.1']);
    expect(r.getServers()).toEqual(['8.8.8.8', '1.1.1.1']);
    expect(() => r.setServers('nope' as any)).toThrowError(/must be an instance of Array/);
    // module-level server list is separate
    dns.setServers(['9.9.9.9']);
    expect(dns.getServers()).toEqual(['9.9.9.9']);
    expect(r.getServers()).toEqual(['8.8.8.8', '1.1.1.1']);
  });
});
