import { describe, expect, it } from 'vitest';
import oracle from './fixtures/wasi-surface.json';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `node:wasi` (M125) — a real `wasi_snapshot_preview1` host over the runtime's
 * VFS. It exists so a WASI program (notably `@rspack/binding-wasm32-wasi`'s Node
 * entry) can run in the page: `node:wasi` is the one builtin that path needs.
 *
 * `test/fixtures/wasi-surface.json` (from `tools/wasi-surface-oracle.mjs`, real
 * Node v26.9.0) is the shape oracle: export keys, the `WASI` class surface, the
 * 46 syscall names + arities, `getImportObject()` keys, and the constructor
 * error codes. The test runs the same probes here and diffs field by field.
 *
 * The behaviour test drives the syscalls directly against a real
 * `WebAssembly.Memory` and then reads the resulting file back through `fs` — so
 * it proves the WASI host really writes to web-node's own filesystem.
 */

const ORACLE = oracle as Record<string, unknown>;

function boot(program: string): { runtime: NodeRuntime; out: string[] } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (chunk) => out.push(chunk),
    onStderr: (chunk) => out.push('ERR:' + chunk),
  });
  runtime.runMain('/project/index.js');
  return { runtime, out };
}

const SURFACE_PROGRAM = `
  const wasiMod = require('node:wasi');
  const { WASI } = wasiMod;
  const protoOwnNames = Object.getOwnPropertyNames(WASI.prototype).sort();
  const protoLengths = {};
  for (const k of protoOwnNames) if (typeof WASI.prototype[k] === 'function') protoLengths[k] = WASI.prototype[k].length;
  const inst = new WASI({ version: 'preview1' });
  const wasiImport = inst.wasiImport;
  const arity = {};
  for (const k of Object.keys(wasiImport)) if (typeof wasiImport[k] === 'function') arity[k] = wasiImport[k].length;
  const code = (fn) => { try { fn(); return null; } catch (e) { return e.code ?? null; } };
  const report = {
    exportKeys: Object.keys(wasiMod).sort(),
    WASI_name: WASI.name,
    WASI_length: WASI.length,
    protoOwnNames,
    protoLengths,
    instanceOwnKeys: Object.keys(inst).sort(),
    getImportObjectKeys: Object.keys(inst.getImportObject()).sort(),
    wasiImportKeys: Object.keys(wasiImport).sort(),
    wasiImportArity: arity,
    errors: {
      noOptions: code(() => new WASI()),
      noVersion: code(() => new WASI({})),
      badVersion: code(() => new WASI({ version: 'nope' })),
      badArgs: code(() => new WASI({ version: 'preview1', args: 'x' })),
      badStdin: code(() => new WASI({ version: 'preview1', stdin: -1 })),
    },
  };
  console.log(JSON.stringify(report));
`;

describe('node:wasi surface', () => {
  it('matches Node v26.9.0 field by field', async () => {
    const { runtime, out } = boot(SURFACE_PROGRAM);
    await runtime.drain();
    expect(out.join(''), out.join('')).not.toContain('ERR:');
    const report = JSON.parse(out.join('').trim()) as Record<string, unknown>;
    expect(report).toEqual(ORACLE);
    expect((report.wasiImportKeys as string[]).length).toBe(46);
  });
});

const BEHAVIOUR_PROGRAM = `
  const { WASI } = require('node:wasi');
  const fs = require('fs');
  const w = new WASI({
    version: 'preview1',
    args: ['prog', 'a b'],
    env: { FOO: 'bar' },
    preopens: { '/': '/' },
  });
  const mem = new WebAssembly.Memory({ initial: 1 });
  w.finalizeBindings({ exports: { memory: mem } });
  const imp = w.wasiImport;
  const dv = () => new DataView(mem.buffer);
  const mem8 = () => new Uint8Array(mem.buffer);
  const put = (ptr, s) => mem8().set(new TextEncoder().encode(s), ptr);
  const readCstr = (p) => { let e = p; while (mem8()[e] !== 0) e++; return new TextDecoder().decode(mem8().subarray(p, e)); };

  imp.args_sizes_get(0, 4);
  console.log('ARGS ' + dv().getUint32(0, true) + ' ' + dv().getUint32(4, true));
  imp.args_get(64, 128);
  console.log('ARGV ' + readCstr(dv().getUint32(64, true)) + '|' + readCstr(dv().getUint32(68, true)));

  imp.environ_sizes_get(8, 12);
  console.log('ENVC ' + dv().getUint32(8, true));
  imp.environ_get(16, 256);
  console.log('ENV ' + readCstr(dv().getUint32(16, true)));

  imp.clock_time_get(1, 0n, 24);
  const t1 = dv().getBigUint64(24, true);
  imp.clock_time_get(1, 0n, 24);
  console.log('CLOCK ' + (dv().getBigUint64(24, true) >= t1));

  imp.random_get(400, 16);
  let nz = false; for (let i = 0; i < 16; i++) if (mem8()[400 + i]) nz = true;
  console.log('RANDOM ' + nz);

  imp.fd_prestat_get(3, 0);
  console.log('PRESTAT ' + dv().getUint8(0) + ' ' + dv().getUint32(4, true));
  imp.fd_prestat_dir_name(3, 32, 4);
  console.log('PREOPEN ' + readCstr(32));

  const path = '/project/wasi-out.txt';
  put(512, path);
  const rights = (1n << 1n) | (1n << 6n); // FD_READ | FD_WRITE
  let err = imp.path_open(3, 0, 512, path.length, 1 /* CREAT */, rights, 0n, 0, 600);
  const fd = dv().getUint32(600, true);
  console.log('OPEN ' + err + ' ' + fd);

  put(700, 'hello wasi\\n');
  dv().setUint32(800, 700, true);
  dv().setUint32(804, 11, true);
  err = imp.fd_write(fd, 800, 1, 820);
  console.log('WRITE ' + err + ' ' + dv().getUint32(820, true));

  err = imp.fd_seek(fd, 0n, 0, 824);
  console.log('SEEK ' + err + ' ' + dv().getBigUint64(824, true));
  dv().setUint32(840, 900, true);
  dv().setUint32(844, 32, true);
  err = imp.fd_read(fd, 840, 1, 860);
  const n = dv().getUint32(860, true);
  console.log('READ ' + err + ' ' + n + ' ' + JSON.stringify(new TextDecoder().decode(mem8().subarray(900, 900 + n))));
  console.log('CLOSE ' + imp.fd_close(fd));
  console.log('FS ' + fs.readFileSync(path, 'utf8').trim());
`;

describe('node:wasi syscalls over the VFS', () => {
  it('serves args/env/clock/random/preopens and reads/writes real files', async () => {
    const { runtime, out } = boot(BEHAVIOUR_PROGRAM);
    await runtime.drain();
    const text = out.join('');
    expect(text, text).not.toContain('ERR:');
    expect(text).toContain('ARGS 2 9');
    expect(text).toContain('ARGV prog|a b');
    expect(text).toContain('ENVC 1');
    expect(text).toContain('ENV FOO=bar');
    expect(text).toContain('CLOCK true');
    expect(text).toContain('RANDOM true');
    expect(text).toContain('PRESTAT 0 1');
    expect(text).toContain('PREOPEN /');
    expect(text).toContain('OPEN 0'); // errno SUCCESS
    expect(text).toContain('WRITE 0 11');
    expect(text).toContain('SEEK 0 0'); // errno SUCCESS, offset 0
    expect(text).toContain('READ 0 11 "hello wasi\\n"');
    expect(text).toContain('CLOSE 0');
    expect(text).toContain('FS hello wasi');
  });

  it('reports real errnos for missing paths and bad fds', async () => {
    const { runtime, out } = boot(`
      const { WASI } = require('node:wasi');
      const w = new WASI({ version: 'preview1', preopens: { '/': '/' } });
      const mem = new WebAssembly.Memory({ initial: 1 });
      w.finalizeBindings({ exports: { memory: mem } });
      const imp = w.wasiImport;
      const dv = new DataView(mem.buffer);
      const mem8 = new Uint8Array(mem.buffer);
      const put = (ptr, s) => mem8.set(new TextEncoder().encode(s), ptr);
      put(0, '/project/nope.txt');
      console.log('ENOENT ' + imp.path_open(3, 0, 0, 17, 0, 1n << 1n, 0n, 0, 64));
      console.log('EBADF ' + imp.fd_write(99, 0, 0, 0));
    `);
    await runtime.drain();
    const text = out.join('');
    expect(text).toContain('ENOENT 44'); // __WASI_ERRNO_NOENT
    expect(text).toContain('EBADF 8');
  });
});
