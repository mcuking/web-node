import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * The `process` object is hand-written (there is no `lib/process.js`), and it
 * was missing a slice of the public surface Node exposes. Every expectation
 * below was read off Node v26.9.0 first.
 */
function boot(program = '', files: Record<string, string> = {}) {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  for (const [path, body] of Object.entries(files)) vfs.writeFile(path, new TextEncoder().encode(body));
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
  return { runtime, out, err };
}

const tick = (ms = 80) => new Promise((res) => setTimeout(res, ms));

describe('process surface', () => {
  it('resolves builtin modules the way process.getBuiltinModule does', () => {
    const { runtime } = boot();
    const proc = (runtime.sandboxGlobals.process as unknown) as Record<string, (...a: unknown[]) => unknown>;
    const fs = runtime.realm.require('fs');
    expect(proc.getBuiltinModule('fs')).toBe(fs);
    expect(proc.getBuiltinModule('node:fs')).toBe(fs);
    // Only public modules resolve — not `internal/*`, not unknown ids.
    expect(proc.getBuiltinModule('internal/util')).toBeUndefined();
    expect(proc.getBuiltinModule('nope-nope')).toBeUndefined();
    try {
      proc.getBuiltinModule(42);
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('ERR_INVALID_ARG_TYPE');
      expect((e as Error).message).toBe('The "id" argument must be of type string. Received type number (42)');
    }
  });

  it('reports the active timer handles, like libuv would', () => {
    const { runtime } = boot();
    const g = runtime.sandboxGlobals as Record<string, (...a: unknown[]) => unknown>;
    const proc = (g.process as unknown) as { getActiveResourcesInfo: () => string[] };
    expect(proc.getActiveResourcesInfo()).toEqual([]);
    const t = g.setTimeout(() => {}, 10000);
    const i = g.setInterval(() => {}, 10000);
    const im = g.setImmediate(() => {});
    expect(proc.getActiveResourcesInfo()).toEqual(['Timeout', 'Timeout', 'Immediate']);
    g.clearTimeout(t);
    g.clearInterval(i);
    g.clearImmediate(im);
    expect(proc.getActiveResourcesInfo()).toEqual([]);
  });

  it('tracks the uncaught-exception capture callback exactly as Node does', () => {
    const { runtime } = boot();
    const proc = (runtime.sandboxGlobals.process as unknown) as Record<string, (...a: unknown[]) => unknown>;
    expect(proc.hasUncaughtExceptionCaptureCallback()).toBe(false);
    proc.setUncaughtExceptionCaptureCallback(() => {});
    expect(proc.hasUncaughtExceptionCaptureCallback()).toBe(true);
    // A second install without clearing is an error, not a silent replace.
    try {
      proc.setUncaughtExceptionCaptureCallback(() => {});
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET');
      expect((e as Error).message).toBe(
        '`process.setupUncaughtExceptionCapture()` was called while a capture callback was already active',
      );
    }
    proc.setUncaughtExceptionCaptureCallback(null);
    expect(proc.hasUncaughtExceptionCaptureCallback()).toBe(false);
    // Auxiliary callbacks coexist with (and do not count as) the primary one.
    proc.addUncaughtExceptionCaptureCallback(() => {});
    expect(proc.hasUncaughtExceptionCaptureCallback()).toBe(false);
    try {
      proc.setUncaughtExceptionCaptureCallback(42);
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('ERR_INVALID_ARG_TYPE');
      expect((e as Error).message).toBe(
        'The "fn" argument must be of type function or null. Received type number (42)',
      );
    }
  });

  it('exposes the diagnostics surface that was missing', () => {
    const { runtime } = boot();
    const proc = (runtime.sandboxGlobals.process as unknown) as Record<string, unknown>;
    expect(typeof proc.ref).toBe('function');
    expect(typeof proc.unref).toBe('function');
    // On the main thread both are no-ops; Node still returns undefined.
    expect((proc.ref as () => unknown)()).toBeUndefined();
    expect((proc.unref as () => unknown)()).toBeUndefined();
    expect(proc.debugPort).toBe(9229);
    expect(proc.domain).toBeNull();
    expect(proc._exiting).toBe(false);
    expect((proc.openStdin as () => unknown)()).toBe(proc.stdin);
    expect(Object.keys(proc.report as object).sort().join(',')).toBe(
      'compact,directory,excludeEnv,excludeNetwork,filename,getReport,reportOnFatalError,' +
        'reportOnSignal,reportOnUncaughtException,signal,writeReport',
    );
    // Node removed the deprecated deprecation toggles; they are not own props.
    expect('noDeprecation' in proc).toBe(false);
    expect('throwDeprecation' in proc).toBe(false);
    expect('traceDeprecation' in proc).toBe(false);
  });

  it('loads a .env file without overriding the environment', () => {
    const { runtime } = boot('', { '/project/.env': 'A=1\nB="two words"\nEXISTING=from_file\n' });
    const proc = (runtime.sandboxGlobals.process as unknown) as {
      env: Record<string, string>;
      loadEnvFile: (p?: string) => void;
    };
    proc.env.EXISTING = 'already';
    expect(proc.loadEnvFile()).toBeUndefined();
    expect(proc.env.A).toBe('1');
    expect(proc.env.B).toBe('two words');
    expect(proc.env.EXISTING).toBe('already');
    try {
      proc.loadEnvFile('/project/nope.env');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('ENOENT');
      expect((e as Error).message).toBe("ENOENT: no such file or directory, open '/project/nope.env'");
    }
  });
});

describe('uncaught exceptions are routed, not swallowed', () => {
  it('hands a throw from a timer callback to the capture callback', async () => {
    const { out, err } = boot(`
      const seen = [];
      process.setUncaughtExceptionCaptureCallback((e) => seen.push('captured:' + e.message));
      setTimeout(() => { throw new Error('boom'); }, 0);
      setTimeout(() => console.log('survived|' + seen.join(',')), 30);
    `);
    await tick();
    expect(out.join('').trim()).toBe('survived|captured:boom');
    expect(err.join('')).toBe('');
  });

  it('hands a throw from a timer callback to an uncaughtException listener', async () => {
    const { out } = boot(`
      process.on('uncaughtException', (e) => console.log('handler|' + e.message));
      setTimeout(() => { throw new Error('boom2'); }, 0);
      setTimeout(() => console.log('still here'), 30);
    `);
    await tick();
    expect(out.join('').trim().split('\n')).toEqual(['handler|boom2', 'still here']);
  });

  it('hands a throw from a nextTick callback to an uncaughtException listener', async () => {
    const { out } = boot(`
      process.on('uncaughtException', (e) => console.log('from tick|' + e.message));
      process.nextTick(() => { throw new Error('tick-boom'); });
      setTimeout(() => console.log('after tick'), 20);
    `);
    await tick();
    expect(out.join('').trim().split('\n')).toEqual(['from tick|tick-boom', 'after tick']);
  });
});
