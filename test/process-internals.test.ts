import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 68: `process` semantic depth — the exotic `process.env` proxy
 * (`src/node_env_var.cc`) and the remaining `process` internals. Expected
 * values were read off a real Node v26.9.0.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const err: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: (c) => err.push(c),
  });
  return { proc: runtime.realm.require('process') as any, err };
}

describe('process.env is an exotic proxy', () => {
  it('coerces writes, supports delete/has, and keeps Object.prototype', () => {
    const { proc } = boot();
    const env = proc.env;
    env.__N = 1;
    expect(env.__N).toBe('1');
    expect(typeof env.__N).toBe('string');
    env.__U = undefined;
    expect(env.__U).toBe('undefined');
    env.__Z = null;
    expect(env.__Z).toBe('null');
    env.__O = { toString: () => 'x' };
    expect(env.__O).toBe('x');
    expect('__N' in env).toBe(true);
    delete env.__N;
    expect(env.__N).toBeUndefined();
    expect('__N' in env).toBe(false);
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(Array.isArray(Object.keys(env))).toBe(true);
    delete env.__U;
    delete env.__Z;
    delete env.__O;
  });

  it('rejects a symbol value and non-data descriptors', () => {
    const { proc } = boot();
    expect(() => {
      proc.env.__S = Symbol('x');
    }).toThrowError('Cannot convert a Symbol value to a string');
    expect(() =>
      Object.defineProperty(proc.env, '__D', { value: '1', writable: false, enumerable: true }),
    ).toThrowError(/'process\.env' only accepts a configurable, writable, and enumerable data descriptor/);
  });
});

describe('process internals', () => {
  it('_preload_modules / moduleLoadList start empty', () => {
    const { proc } = boot();
    expect(proc._preload_modules).toEqual([]);
    expect(proc.moduleLoadList).toEqual([]);
  });

  it('_rawDebug formats and writes to stderr', () => {
    const { proc, err } = boot();
    proc._rawDebug('a', 1, { b: 2 });
    expect(err.join('')).toBe('a 1 { b: 2 }\n');
  });

  it('_fatalException reports whether a handler claimed the error', () => {
    const { proc } = boot();
    // no handler -> false, error not consumed
    expect(proc._fatalException(new Error('boom'))).toBe(false);
    const seen: unknown[] = [];
    const listener = (e: unknown) => seen.push(e);
    proc.on('uncaughtException', listener);
    const err = new Error('boom2');
    expect(proc._fatalException(err)).toBe(true);
    expect(seen).toEqual([err]);
    proc.removeListener('uncaughtException', listener);
    expect(proc._fatalException(new Error('boom3'))).toBe(false);
  });

  it('finalization registers and unregisters without throwing', () => {
    const { proc } = boot();
    expect(typeof proc.finalization.register).toBe('function');
    expect(typeof proc.finalization.registerBeforeExit).toBe('function');
    expect(typeof proc.finalization.unregister).toBe('function');
    // unregister before any registration is a no-op
    expect(proc.finalization.unregister({})).toBeUndefined();
    const target = {};
    proc.finalization.register(target, () => {});
    proc.finalization.unregister(target);
  });

  it('native-only internals exist and throw loudly', () => {
    const { proc } = boot();
    for (const name of [
      '_getActiveHandles',
      '_getActiveRequests',
      '_tickCallback',
      '_kill',
      '_debugProcess',
      '_debugEnd',
      '_startProfilerIdleNotifier',
      '_stopProfilerIdleNotifier',
      'dlopen',
      'execve',
      'initgroups',
      'setegid',
      'seteuid',
      'setgroups',
    ]) {
      expect(typeof proc[name]).toBe('function');
      expect(() => proc[name]()).toThrowError(/not implemented/i);
    }
  });
});
