import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

function makeProject(files: Record<string, string>): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, new TextEncoder().encode(content));
  }
  return vfs;
}

function run(files: Record<string, string>, entry = '/project/index.js') {
  const vfs = makeProject(files);
  const out: string[] = [];
  const err: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: [entry],
    env: { NODE_ENV: 'test' },
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => err.push(c),
  });
  let error: unknown = null;
  try {
    runtime.runMain(entry);
  } catch (e) {
    error = e;
  }
  return { runtime, vfs, out, err, stdout: out.join(''), stderr: err.join(''), error };
}

describe('NodeRuntime — core', () => {
  it('runs a script and captures stdout', () => {
    const { stdout, error } = run({ '/project/index.js': `console.log('hello web-node');` });
    expect(error).toBeNull();
    expect(stdout).toBe('hello web-node\n');
  });

  it('exposes process globals', () => {
    const { stdout } = run({
      '/project/index.js': `console.log(process.platform, process.argv.length, process.env.NODE_ENV);`,
    });
    expect(stdout).toBe('linux 2 test\n');
  });

  it('gives process.stdin an EventEmitter surface (tools call stdin.off)', () => {
    // Vite's dev server adds and then removes a SIGTERM listener on close().
    const { stdout, error } = run({
      '/project/index.js': `
        process.stdin.on('data', () => {});
        process.stdin.off('data', () => {});
        process.stdin.removeListener('data', () => {});
        console.log('stdin-ok', process.stdin.isTTY, process.stdin.read(), typeof process.stdin.resume());
      `,
    });
    expect(error).toBeNull();
    expect(stdout).toBe('stdin-ok false null object\n');
  });

  it('fs.watch surfaces VFS writes (the hook a dev server watches with)', () => {
    const { stdout, error } = run({
      '/project/index.js': `
        const fs = require('fs');
        fs.mkdirSync('/project/src/nested', { recursive: true });
        const seen = [];
        const w = fs.watch('/project/src', { recursive: true }, (event, filename) => {
          seen.push(event + ':' + filename);
        });
        fs.writeFileSync('/project/src/a.js', 'x');
        fs.writeFileSync('/project/src/nested/b.js', 'y');
        fs.writeFileSync('/project/outside.js', 'z');
        fs.rmSync('/project/src/a.js');
        w.close();
        fs.writeFileSync('/project/src/c.js', 'w');
        console.log(seen.join(' '));
      `,
    });
    expect(error).toBeNull();
    // create and delete both map to Node's 'rename'; edits to 'change'.
    expect(stdout).toBe('rename:a.js rename:nested/b.js rename:a.js\n');
  });

  it('runs real vendored node path.js', () => {
    const { stdout, error } = run({
      '/project/index.js': `
        const path = require('path');
        console.log(path.join('/a', 'b', '..', 'c'));
        console.log(path.basename('/x/y/z.txt'));
        console.log(path.extname('a/b.md'));
        console.log(path.posix.normalize('/a/./b/../c'));
        console.log(path.isAbsolute('/a'));
      `,
    });
    expect(error).toBeNull();
    expect(stdout).toBe('/a/c\nz.txt\n.md\n/a/c\ntrue\n');
  });

  it('runs real vendored node querystring.js', () => {
    const { stdout, error } = run({
      '/project/index.js': `
        const qs = require('querystring');
        console.log(qs.stringify({ a: 1, b: 'x y' }));
        console.log(JSON.stringify(qs.parse('a=1&b=2')));
      `,
    });
    expect(error).toBeNull();
    expect(stdout).toBe('a=1&b=x%20y\n{"a":"1","b":"2"}\n');
  });

  it('supports Buffer', () => {
    const { stdout } = run({
      '/project/index.js': `
        const b = Buffer.from('hello');
        console.log(b.length, b.toString('hex'), b.toString('base64'));
        console.log(Buffer.isBuffer(b), Buffer.byteLength('héllo'));
      `,
    });
    expect(stdout).toBe("5 68656c6c6f aGVsbG8=\ntrue 6\n");
  });

  it('does fs round-trips through the VFS', () => {
    const { stdout, vfs } = run({
      '/project/index.js': `
        const fs = require('fs');
        fs.mkdirSync('/project/tmp', { recursive: true });
        fs.writeFileSync('/project/tmp/out.txt', 'written by web-node');
        console.log(fs.readFileSync('/project/tmp/out.txt', 'utf8'));
        fs.mkdirSync('/project/tmp/sub', { recursive: true });
        fs.writeFileSync('/project/tmp/sub/n.txt', '1');
        console.log(fs.readdirSync('/project/tmp').sort().join(','));
        console.log(fs.statSync('/project/tmp/out.txt').isFile());
        console.log(fs.existsSync('/project/tmp/nope.txt'));
      `,
    });
    expect(stdout).toBe('written by web-node\nout.txt,sub\ntrue\nfalse\n');
    expect(new TextDecoder().decode(vfs.readFile('/project/tmp/out.txt'))).toBe('written by web-node');
  });

  it('resolves local CJS modules', () => {
    const { stdout, error } = run({
      '/project/index.js': `
        const { answer, greet } = require('./lib/math.js');
        console.log(answer, greet('world'));
      `,
      '/project/lib/math.js': `
        exports.answer = 42;
        exports.greet = (name) => 'hi ' + name;
      `,
    });
    expect(error).toBeNull();
    expect(stdout).toBe('42 hi world\n');
  });

  it('supports ESM syntax in user files', () => {
    const { stdout, error } = run(
      {
        '/project/index.mjs': `
        import { double } from './lib.mjs';
        import path from 'path';
        export const value = double(21);
        console.log('value', value, path.basename('/a/b.js'));
      `,
        '/project/lib.mjs': `
        export function double(n) { return n * 2; }
      `,
      },
      '/project/index.mjs',
    );
    expect(error).toBeNull();
    expect(stdout).toBe('value 42 b.js\n');
  });

  it('emits a loud error for modules outside the whitelist', () => {
    const { error } = run({
      '/project/index.js': `require('cluster');`,
    });
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toContain('cluster');
  });

  it('loads stub modules for side-effect imports but throws when used', () => {
    // Bundlers do `import 'node:tty'` purely to keep the dependency; that must
    // not explode. Actually *calling* the unsupported API must.
    const { stdout, error } = run({
      '/project/index.js': `
        const tty = require('tty');
        const cp = require('child_process');
        console.log('isatty', tty.isatty(1));
        try { cp.execSync('ls'); } catch (e) { console.log('threw', /child_process\.execSync/.test(e.message)); }
      `,
    });
    expect(error).toBeNull();
    expect(stdout).toBe('isatty false\nthrew true\n');
  });

  it('resolves every hostname to loopback in the virtual network', async () => {
    // The dev server calls dns.promises.lookup('localhost') during buildStart.
    const { out, error } = run({
      '/project/index.js': `
        const dns = require('dns');
        const p = require('dns/promises');
        dns.lookup('localhost', (err, address, family) => console.log('cb', address, family));
        p.lookup('anything.example').then((r) => console.log('promise', r.address, r.family));
      `,
    });
    // Both lookups settle on a microtask.
    await new Promise((r) => setTimeout(r, 10));
    expect(error).toBeNull();
    expect(out.join('')).toContain('cb 127.0.0.1 4');
    expect(out.join('')).toContain('promise 127.0.0.1 4');
  });

  it('exposes an internalBinding table covering the whitelist', () => {
    const { runtime } = run({ '/project/index.js': `console.log('ok');` });
    const desc = runtime.describe();
    expect(desc.bindings).toContain('fs');
    expect(desc.bindings).toContain('buffer');
    expect(desc.bindings).toContain('timers');
    expect(desc.bindings).not.toContain('crypto');
  });

  it('lists vendored node-source modules as such', () => {
    const { runtime } = run({ '/project/index.js': `require('path'); console.log('ok');` });
    const mods = runtime.describe().modules;
    const pathMod = mods.find((m) => m.id === 'path');
    expect(pathMod?.origin).toBe('node-source');
    expect(pathMod?.state).toBe('loaded');
  });

  it('re-executes the entry module on every run (no stale cache)', () => {
    const vfs = makeProject({
      '/project/index.js': `console.log('run');`,
      '/project/lib/counter.js': `globalThis.__n = (globalThis.__n || 0) + 1; console.log('lib ' + globalThis.__n);`,
    });
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
    });

    runtime.runMain('/project/index.js');
    runtime.runMain('/project/index.js');
    runtime.runMain('/project/index.js');

    // A cached entry would print once. `node index.js` three times prints three times.
    expect(out.join('')).toBe('run\nrun\nrun\n');
  });

  it('resets exitCode between runs', () => {
    const vfs = makeProject({
      '/project/index.js': `if (!globalThis.__exited) { globalThis.__exited = true; process.exit(3); } console.log('second run');`,
    });
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
    });

    runtime.runMain('/project/index.js');
    expect(runtime.exitCode).toBe(3);

    runtime.runMain('/project/index.js');
    expect(out.join('')).toBe('second run\n');
  });
});
