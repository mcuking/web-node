import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `os` is now Node's real `lib/os.js` on top of a static `os` binding, replacing
 * the hand-written builtin. The shape assertions below (freeze/props, the
 * `Symbol.toPrimitive` hooks, the flat-tuple decoding) are what the vendored
 * source adds over the old shim.
 */
function run(source: string) {
  const vfs = new MemoryVfs({ cwd: '/project' });
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
  let error: unknown = null;
  // Vendored modules are compiled with a fixed parameter list, so `process` is a
  // *free* variable for them — the embedder's global, not an injected one. The
  // worker installs the sandbox `process` on the global, so mirror that here for
  // the duration of the run (the sandbox process is what `os.platform()` reads).
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = host.process;
  host.process = runtime.sandboxGlobals.process;
  try {
    runtime.runMain('/project/index.js');
  } catch (e) {
    error = e;
  } finally {
    host.process = previous;
  }
  return { stdout: out.join(''), stderr: err.join(''), error };
}

describe('vendored: os', () => {
  it('reports the sandbox identity', () => {
    const { stdout, error } = run(`
      const os = require('os');
      console.log([os.type(), os.version(), os.release(), os.machine(), os.platform(), os.arch()].join(' '));
    `);
    expect(error).toBeNull();
    expect(stdout).toBe('Browser web-node browser wasm32 linux wasm32\n');
  });

  it('reports the sandbox paths and endianness', () => {
    const { stdout } = run(`
      const os = require('os');
      console.log(os.homedir(), os.tmpdir(), os.hostname(), os.endianness(), JSON.stringify(os.EOL), os.devNull);
    `);
    expect(stdout).toBe('/home/web-node /tmp web-node LE "\\n" /dev/null\n');
  });

  it('exposes a frozen constants object with the os signals table', () => {
    const { stdout } = run(`
      const os = require('os');
      console.log(
        Object.isFrozen(os.constants.signals),
        Object.isFrozen(os.constants),
        os.constants.UV_UDP_REUSEADDR,
        typeof os.constants.signals.SIGTERM,
      );
    `);
    expect(stdout).toBe('true false 4 number\n');
  });

  it('answers the numeric host facts', () => {
    const { stdout } = run(`
      const os = require('os');
      console.log(
        os.totalmem() === 1024 * 1024 * 1024,
        os.freemem() === 512 * 1024 * 1024,
        os.availableParallelism() >= 1,
        JSON.stringify(os.loadavg()),
        os.getPriority(),
        os.cpus().length,
      );
    `);
    expect(stdout).toBe('true true true [0,0,0] 0 0\n');
  });

  it('answers userInfo and networkInterfaces', () => {
    const { stdout } = run(`
      const os = require('os');
      const u = os.userInfo();
      console.log(u.uid, u.gid, u.username, u.homedir, u.shell);
      console.log(JSON.stringify(os.networkInterfaces()));
    `);
    expect(stdout).toBe('0 0 web-node /home/web-node null\n{}\n');
  });

  it('keeps the String() coercion hooks the vendored source installs', () => {
    const { stdout } = run(`
      const os = require('os');
      console.log(
        String(os.type()), String(os.platform()), String(os.arch()),
        String(os.hostname()), String(os.totalmem()), String(os.uptime()) !== '',
      );
    `);
    expect(stdout).toBe('Browser linux wasm32 web-node 1073741824 true\n');
  });

  it('validates setPriority like Node does', () => {
    const { stdout, error } = run(`
      const os = require('os');
      try { os.setPriority(99); } catch (e) { console.log(e.code); }
      console.log(typeof os.setPriority(10));
    `);
    expect(error).toBeNull();
    expect(stdout).toBe('ERR_OUT_OF_RANGE\nundefined\n');
  });
});
