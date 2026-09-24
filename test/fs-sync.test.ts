import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `fs.fsyncSync` / `fs.fdatasyncSync` (M120).
 *
 * Two things are being pinned. The **shape** of the call — which descriptors
 * fail and with which error — is what Node v26.9.0 does; the differential
 * fixture (`test/fixtures/fs-errors.json`, via `tools/fs-errors-probe.cjs`)
 * covers it end-to-end. The **effect** is what makes this milestone more than a
 * stub: a real descriptor must reach the VFS's durable sink.
 */

function run(source: string, vfs: MemoryVfs) {
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(source));
  const out: string[] = [];
  const err: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => err.push(c),
  });
  runtime.runMain('/project/index.js');
  const line = out.join('').split('\n').find((l) => l.startsWith('__OBS__'));
  return { observation: line ? JSON.parse(line.slice('__OBS__'.length)) : null, stderr: err.join('') };
}

const decoder = new TextDecoder();

describe('MemoryVfs.sync', () => {
  function vfsWithProject(): MemoryVfs {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    return vfs;
  }

  it('hands the current bytes of a file to the durable sink', () => {
    const vfs = vfsWithProject();
    const calls: Array<{ path: string; text: string }> = [];
    vfs.setSyncSink((path, data) => calls.push({ path, text: decoder.decode(data) }));
    vfs.writeFile('/project/a.txt', new TextEncoder().encode('hello'));
    vfs.sync('/project/a.txt');
    expect(calls).toEqual([{ path: '/project/a.txt', text: 'hello' }]);
  });

  it('sends the latest bytes, not the bytes at write time', () => {
    const vfs = vfsWithProject();
    const seen: string[] = [];
    vfs.setSyncSink((_path, data) => seen.push(decoder.decode(data)));
    vfs.writeFile('/project/a.txt', new TextEncoder().encode('first'));
    vfs.appendFile('/project/a.txt', new TextEncoder().encode(' second'));
    vfs.sync('/project/a.txt');
    expect(seen).toEqual(['first second']);
  });

  it('resolves a relative path against the cwd', () => {
    const vfs = vfsWithProject();
    const seen: string[] = [];
    vfs.setSyncSink((path) => seen.push(path));
    vfs.writeFile('/project/a.txt', new Uint8Array(1));
    vfs.sync('a.txt');
    expect(seen).toEqual(['/project/a.txt']);
  });

  it('does nothing without a sink, or for paths with no file behind them', () => {
    const vfs = vfsWithProject();
    vfs.writeFile('/project/a.txt', new Uint8Array(1));
    expect(() => vfs.sync('/project/a.txt')).not.toThrow();

    const seen: string[] = [];
    vfs.mkdir('/project/dir', { recursive: true });
    vfs.setSyncSink((path) => seen.push(path));
    // An fd stays usable after its file is unlinked, and `fsync` on a directory
    // descriptor is legal on Linux — Node reports both as success.
    vfs.sync('/project/dir');
    vfs.sync('/project/missing.txt');
    expect(seen).toEqual([]);
  });
});

describe('fsync on descriptors', () => {
  const PROGRAM = `
    const fs = require('fs');
    const results = [];
    const record = (name, fn) => {
      try { results.push([name, 'ok', typeof fn()]); }
      catch (e) { results.push([name, e.code, e.message]); }
    };
    fs.writeFileSync('/project/a.txt', 'hello');
    const fd = fs.openSync('/project/a.txt', 'r+');
    record('fsync', () => fs.fsyncSync(fd));
    record('fdatasync', () => fs.fdatasyncSync(fd));
    fs.closeSync(fd);
    record('closed', () => fs.fsyncSync(fd));
    record('stdin', () => fs.fsyncSync(0));
    record('stdout', () => fs.fsyncSync(1));
    record('stderr', () => fs.fdatasyncSync(2));
    record('unknown', () => fs.fsyncSync(999));
    record('negative', () => fs.fsyncSync(-1));
    record('fractional', () => fs.fsyncSync(1.5));
    record('nan', () => fs.fsyncSync(NaN));
    record('tooBig', () => fs.fsyncSync(2147483648));
    record('undefined', () => fs.fsyncSync(undefined));
    record('string', () => fs.fsyncSync('3'));
    record('object', () => fs.fsyncSync({}));
    console.log('__OBS__' + JSON.stringify(results));
  `;

  it('routes a real descriptor to the durable sink and rejects the rest the way Node does', () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    const synced: string[] = [];
    vfs.setSyncSink((path) => synced.push(path));
    const { observation: results, stderr } = run(PROGRAM, vfs);
    expect(stderr).toBe('');
    expect(results).not.toBeNull();

    const byName = Object.fromEntries((results as [string, string, string][]).map(([n, code, msg]) => [n, [code, msg]]));
    expect(byName.fsync).toEqual(['ok', 'undefined']);
    expect(byName.fdatasync).toEqual(['ok', 'undefined']);
    expect(byName.closed).toEqual(['EBADF', 'EBADF: bad file descriptor, fsync']);
    expect(byName.stdin).toEqual(['EINVAL', 'EINVAL: invalid argument, fsync']);
    expect(byName.stdout).toEqual(['EINVAL', 'EINVAL: invalid argument, fsync']);
    // The syscall name follows the call, as in Node.
    expect(byName.stderr).toEqual(['EINVAL', 'EINVAL: invalid argument, fdatasync']);
    expect(byName.unknown).toEqual(['EBADF', 'EBADF: bad file descriptor, fsync']);
    // The fd is coerced by the *native* layer (`lib/fs.js` calls the binding
    // directly), so the conversion errors are ours to reproduce.
    expect(byName.negative).toEqual([
      'ERR_OUT_OF_RANGE',
      'The value of "fd" is out of range. It must be >= 0 && <= 2147483647. Received -1',
    ]);
    expect(byName.fractional).toEqual([
      'ERR_OUT_OF_RANGE',
      'The value of "fd" is out of range. It must be an integer. Received 1.5',
    ]);
    expect(byName.nan[0]).toBe('ERR_OUT_OF_RANGE');
    expect(byName.tooBig[0]).toBe('ERR_OUT_OF_RANGE');
    expect(byName.undefined).toEqual([
      'ERR_INVALID_ARG_TYPE',
      'The "fd" argument must be of type number. Received undefined',
    ]);
    expect(byName.string[0]).toBe('ERR_INVALID_ARG_TYPE');
    expect(byName.object[0]).toBe('ERR_INVALID_ARG_TYPE');

    // `fsync` and `fdatasync` on the one real descriptor; every other call
    // fails before it can reach storage.
    expect(synced).toEqual(['/project/a.txt', '/project/a.txt']);
  });

  it('is a no-op on a VFS with nowhere to flush to', () => {
    const { observation: results, stderr } = run(PROGRAM, new MemoryVfs({ cwd: '/project' }));
    expect(stderr).toBe('');
    const byName = Object.fromEntries((results as [string, string, string][]).map(([n, code]) => [n, code]));
    expect(byName.fsync).toBe('ok');
    expect(byName.closed).toBe('EBADF');
  });
});
