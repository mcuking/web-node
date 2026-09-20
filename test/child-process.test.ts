/**
 * The controlled spawn surface: command resolution, the mini-shell, the
 * `child_process` API, and the npm pieces built on top of them (`.bin` shims and
 * lifecycle scripts).
 *
 * These tests are deliberately concrete about the *failures*: a native binary,
 * a shell script we cannot run, a synchronous call on an asynchronous program,
 * and an unsupported shell construct each have an assertion, because "refuse by
 * name" is the property that makes this surface safe to expose.
 */

import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { expandWord, parse, runShell, runShellSync, tokenize, ShellUnsupportedError } from '../src/node-runtime/shell/sh';
import { resolveCommand, SHIM_MARKER } from '../src/node-runtime/proc/command';
import { binEntriesFor, renderShim, writeBinShims } from '../src/node-runtime/npm/bin';
import { runDependencyScripts, runRootScripts, lifecycleEnv } from '../src/node-runtime/npm/scripts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const tick = (ms = 8): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Wait until `out` has settled (no change for a couple of turns) or the deadline
// passes. A bare fixed sleep is racy under a loaded, parallel test run.
async function waitForOutput(out: string[], ms = 2000): Promise<string> {
  const deadline = Date.now() + ms;
  let last = out.join('');
  let stable = 0;
  while (Date.now() < deadline) {
    await tick(10);
    const now = out.join('');
    if (now !== last) {
      last = now;
      stable = 0;
    } else if (now.length > 0 && ++stable >= 3) {
      break;
    }
  }
  return out.join('');
}

function makeVfs(files: Record<string, string | Uint8Array>): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, typeof content === 'string' ? encoder.encode(content) : content);
  }
  return vfs;
}

interface Booted {
  runtime: NodeRuntime;
  out: string[];
  errors: string[];
}

function bootRuntime(vfs: MemoryVfs): Booted {
  const out: string[] = [];
  const errors: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => errors.push(c),
  });
  return { runtime, out, errors };
}

function childProcessOf(runtime: NodeRuntime): Record<string, any> {
  return runtime.realm.require('child_process') as Record<string, any>;
}

// ---------------------------------------------------------------------------
// shell: tokenizer + parser
// ---------------------------------------------------------------------------

describe('mini-shell: parsing', () => {
  it('splits words, keeps quotes and expands $VARS', () => {
    const ast = parse(`echo "a b" 'c d' $HOME \\$x`);
    expect(ast.items).toHaveLength(1);
    const words = ast.items[0].pipeline[0].words;
    const env = { HOME: '/root' };
    expect(words.map((w) => expandWord(w, env))).toEqual(['echo', 'a b', 'c d', '/root', '$x']);
  });

  it('keeps $VAR live inside double quotes but literal inside single quotes', () => {
    const ast = parse(`echo "v=$V" 'v=$V'`);
    const words = ast.items[0].pipeline[0].words;
    expect(words.map((w) => expandWord(w, { V: '1' }))).toEqual(['echo', 'v=1', 'v=$V']);
  });

  it('parses sequences, pipelines and redirections', () => {
    const ast = parse('a && b || c ; d | e > out.txt 2> err.txt < in.txt');
    expect(ast.items.map((i) => i.join)).toEqual(['always', 'and', 'or', 'always']);
    const last = ast.items[3].pipeline;
    expect(last).toHaveLength(2);
    expect(last[1].redirects.map((r) => `${r.fd}${r.op}`)).toEqual(['1>', '2>', '0<']);
  });

  it('treats a leading $ as literal and ignores trailing comments', () => {
    const ast = parse('echo $ # not a word');
    // `$` is its own word; everything after `#` is dropped.
    expect(ast.items[0].pipeline[0].words).toHaveLength(2);
    expect(expandWord(ast.items[0].pipeline[0].words[1], {})).toBe('$');
  });

  it('refuses what it cannot faithfully run', () => {
    expect(() => tokenize('echo $(date)')).toThrow(ShellUnsupportedError);
    expect(() => tokenize('echo `date`')).toThrow(ShellUnsupportedError);
    expect(() => tokenize('sleep 1 &')).toThrow(ShellUnsupportedError);
    expect(() => tokenize('( echo hi )')).toThrow(ShellUnsupportedError);
  });
});

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

describe('command resolution', () => {
  const base = { cwd: '/project', env: {}, execPath: '/bin/node' };

  it('recognises node itself, with and without a script', () => {
    const vfs = makeVfs({ '/project/a.js': 'console.log(1)' });
    const ctx = { ...base, vfs };
    expect(resolveCommand(ctx, 'node', ['--version'])).toEqual({ kind: 'node', script: null, args: ['--version'] });
    expect(resolveCommand(ctx, 'node', ['a.js'])).toEqual({ kind: 'program', path: '/project/a.js', args: [] });
  });

  it('refuses native binaries and shell scripts by name', () => {
    const vfs = makeVfs({
      '/project/native': new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]),
      '/project/host.sh': '#!/bin/sh\necho hi\n',
    });
    const ctx = { ...base, vfs };
    const native = resolveCommand(ctx, './native', []);
    expect(native.kind).toBe('unsupported');
    expect(native.kind === 'unsupported' && native.reason).toMatch(/native executable/);
    const shell = resolveCommand(ctx, './host.sh', []);
    expect(shell.kind).toBe('unsupported');
    expect(shell.kind === 'unsupported' && shell.reason).toMatch(/\/bin\/sh/);
  });

  it('reports a missing command rather than guessing', () => {
    const vfs = makeVfs({});
    expect(resolveCommand({ ...base, vfs }, 'definitely-not-here', []).kind).toBe('missing');
  });

  it('finds node_modules/.bin and follows the shim marker to the real entry', () => {
    const vfs = makeVfs({
      '/project/node_modules/hello/cli.js': '#!/usr/bin/env node\nconsole.log("hi")\n',
      '/project/node_modules/.bin/hello': renderShim('/project/node_modules/hello/cli.js', '/project/node_modules/.bin'),
    });
    const found = resolveCommand({ ...base, vfs }, 'hello', []);
    expect(found).toEqual({ kind: 'program', path: '/project/node_modules/hello/cli.js', args: [] });
    expect(decoder.decode(vfs.readFile('/project/node_modules/.bin/hello'))).toContain(SHIM_MARKER);
  });
});

// ---------------------------------------------------------------------------
// child_process
// ---------------------------------------------------------------------------

describe('child_process', () => {
  it('runs a script, streams stdout and reports the exit code', async () => {
    const vfs = makeVfs({
      '/project/child.js': 'console.log("from child"); process.exit(7);',
      '/project/index.js': `
        const { spawn } = require('child_process');
        const child = spawn('node', ['/project/child.js']);
        const events = [];
        child.on('spawn', () => events.push('spawn'));
        child.stdout.on('data', (d) => process.stdout.write('out:' + Buffer.from(d).toString()));
        child.on('exit', (code) => {
          events.push('exit:' + code);
          console.log('events ' + events.join(','));
        });
      `,
    });
    const { runtime, out } = bootRuntime(vfs);
    runtime.runMain('/project/index.js');
    await tick();
    expect(out.join('')).toBe('out:from child\nevents spawn,exit:7\n');
  });

  it('keeps stderr separate and passes cwd/env through', async () => {
    const vfs = makeVfs({
      '/project/deep/child.js': `
        console.error('cwd=' + process.cwd());
        console.log('mark=' + process.env.MARK);
      `,
      '/project/index.js': `
        const { execFile } = require('child_process');
        execFile('node', ['/project/deep/child.js'], { cwd: '/project/deep', env: { MARK: 'yes' } }, (err, stdout, stderr) => {
          console.log('cb', JSON.stringify(stdout), JSON.stringify(stderr));
        });
      `,
    });
    const { runtime, out } = bootRuntime(vfs);
    runtime.runMain('/project/index.js');
    await tick();
    expect(out.join('')).toBe('cb "mark=yes\\n" "cwd=/project/deep\\n"\n');
  });

  it('supports shell sequencing, pipelines and output redirection', async () => {
    const vfs = makeVfs({
      '/project/one.js': 'console.log("one")',
      '/project/upper.js': `
        let buf = '';
        process.stdin.on('data', (d) => (buf += d.toString()));
        process.stdin.on('end', () => console.log(buf.toUpperCase().trim()));
      `,
      '/project/index.js': `
        const { exec } = require('child_process');
        exec('node /project/one.js > /project/out.txt && node /project/upper.js < /project/out.txt', (err, stdout) => {
          console.log('rc', err ? err.code : 0, JSON.stringify(stdout));
        });
      `,
    });
    const { runtime, out } = bootRuntime(vfs);
    runtime.runMain('/project/index.js');
    expect(await waitForOutput(out)).toBe('rc 0 "ONE\\n"\n');
  });

  it('feeds a shell pipeline stage by stage', async () => {
    const vfs = makeVfs({
      '/project/upper.js': `
        let buf = '';
        process.stdin.on('data', (d) => (buf += d.toString()));
        process.stdin.on('end', () => process.stdout.write('<' + buf.trim().toUpperCase() + '>'));
      `,
      '/project/index.js': `
        const { exec } = require('child_process');
        exec('node -e "process.stdout.write(String(40+2))" | node /project/upper.js', (err, stdout) => {
          console.log('pipe', JSON.stringify(stdout));
        });
      `,
    });
    const { runtime, out } = bootRuntime(vfs);
    runtime.runMain('/project/index.js');
    expect(await waitForOutput(out)).toBe('pipe "<42>"\n');
  });

  it('emits an error event for a program that cannot start', async () => {
    const vfs = makeVfs({
      '/project/index.js': `
        const { spawn } = require('child_process');
        const child = spawn('no-such-tool', []);
        child.on('error', (err) => console.log('error', err.code));
      `,
    });
    const { runtime, out } = bootRuntime(vfs);
    runtime.runMain('/project/index.js');
    await tick();
    expect(out.join('')).toBe('error ENOENT\n');
  });

  it('delivers stdin written by the parent', async () => {
    const vfs = makeVfs({
      '/project/echo.js': `
        let buf = '';
        process.stdin.on('data', (d) => (buf += Buffer.from(d).toString()));
        process.stdin.on('end', () => console.log(buf.trim()));
      `,
      '/project/index.js': `
        const { spawn } = require('child_process');
        const child = spawn('node', ['/project/echo.js']);
        child.stdin.write('ping');
        child.stdin.end();
        child.stdout.on('data', (d) => process.stdout.write('stdin:' + Buffer.from(d).toString()));
      `,
    });
    const { runtime, out } = bootRuntime(vfs);
    runtime.runMain('/project/index.js');
    expect(await waitForOutput(out)).toBe('stdin:ping\n');
  });

  it('honours a timeout by killing a long-running program', async () => {
    const vfs = makeVfs({
      '/project/spin.js': 'setTimeout(() => console.log("never"), 5000);',
      '/project/index.js': `
        const { execFile } = require('child_process');
        execFile('node', ['/project/spin.js'], { timeout: 40 }, (err, stdout, stderr) => {
          console.log('killed', Boolean(err && /timed out/.test(stderr)));
        });
      `,
    });
    const { runtime, out } = bootRuntime(vfs);
    runtime.runMain('/project/index.js');
    expect(await waitForOutput(out)).toBe('killed true\n');
  });

  it('runs synchronously when the program is synchronous', () => {
    const vfs = makeVfs({ '/project/sync.js': 'console.log("sync " + (6 * 7));' });
    const { runtime } = bootRuntime(vfs);
    const cp = childProcessOf(runtime);
    const result = cp.spawnSync('node', ['/project/sync.js']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('sync 42\n');
    expect(cp.execFileSync('node', ['/project/sync.js'], { encoding: 'utf8' })).toBe('sync 42\n');
    expect(cp.execSync('node /project/sync.js')).toBe('sync 42\n');
  });

  it('refuses synchronous execution of anything asynchronous, and says why', () => {
    const vfs = makeVfs({
      '/project/later.js': 'setTimeout(() => console.log("later"), 1);',
      '/project/spin.js': 'setTimeout(() => console.log("later"), 1);',
    });
    const { runtime } = bootRuntime(vfs);
    const cp = childProcessOf(runtime);
    expect(() => cp.execFileSync('node', ['/project/later.js'])).toThrow(/cannot be run synchronously/);
    expect(() => cp.execSync('node /project/spin.js | node /project/spin.js')).toThrow();
  });

  it('refuses fork IPC instead of pretending', () => {
    const vfs = makeVfs({ '/project/child.js': 'console.log("hi")' });
    const { runtime } = bootRuntime(vfs);
    const cp = childProcessOf(runtime);
    const child = cp.fork('/project/child.js');
    expect(() => child.send('x')).toThrow(/IPC channel/);
    expect(() => child.disconnect()).toThrow(/IPC channel/);
  });
});

// ---------------------------------------------------------------------------
// shell through the host (exit codes, builtins, failures)
// ---------------------------------------------------------------------------

describe('mini-shell: execution', () => {
  it('reports command-not-found as 127 and keeps going with ||', async () => {
    const vfs = makeVfs({});
    const { runtime } = bootRuntime(vfs);
    const result = await runShell('nope || echo fallback', {
      host: runtime.spawn,
      vfs,
      cwd: '/project',
      env: {},
    });
    expect(result.code).toBe(0);
    expect(decoder.decode(result.stdout)).toBe('fallback\n');
    expect(decoder.decode(result.stderr)).toContain('command not found');
  });

  it('runs builtins and keeps cd for the rest of the script', async () => {
    const vfs = makeVfs({});
    const { runtime } = bootRuntime(vfs);
    const result = await runShell('cd /project && pwd && echo done', {
      host: runtime.spawn,
      vfs,
      cwd: '/',
      env: {},
    });
    expect(decoder.decode(result.stdout)).toBe('/project\ndone\n');
    expect(result.cwd).toBe('/project');
  });

  it('supports append redirection and synchronous single commands', () => {
    const vfs = makeVfs({ '/project/a.js': 'process.stdout.write("a")' });
    const { runtime } = bootRuntime(vfs);
    const options = { host: runtime.spawn, vfs, cwd: '/project', env: {} };
    runShellSync('node /project/a.js > out.txt', options);
    runShellSync('node /project/a.js >> out.txt', options);
    expect(decoder.decode(vfs.readFile('/project/out.txt'))).toBe('aa');
  });
});

// ---------------------------------------------------------------------------
// npm: .bin shims
// ---------------------------------------------------------------------------

describe('npm: bin shims', () => {
  it('derives command names from string and map `bin` fields', () => {
    const vfs = makeVfs({});
    expect(binEntriesFor(vfs, '/project/node_modules/tool', 'tool', 'cli.js')).toEqual([
      { name: 'tool', target: '/project/node_modules/tool/cli.js', package: 'tool' },
    ]);
    expect(binEntriesFor(vfs, '/project/node_modules/@s/tool', '@s/tool', 'cli.js')[0].name).toBe('tool');
    expect(
      binEntriesFor(vfs, '/project/node_modules/tool', 'tool', { t1: 'a.js', t2: 'b.js' }).map((e) => e.name),
    ).toEqual(['t1', 't2']);
  });

  it('writes an executable shim that the runtime can actually resolve and run', async () => {
    const vfs = makeVfs({
      '/project/node_modules/hello/cli.js':
        '#!/usr/bin/env node\n' +
        'console.log("hello from " + require("path").basename(process.argv[1]) + " argv=" + process.argv.slice(2).join(","));\n',
    });
    const entries = binEntriesFor(vfs, '/project/node_modules/hello', 'hello', 'cli.js');
    const result = writeBinShims(vfs, entries);
    expect(result.warnings).toEqual([]);
    expect(result.written.get('hello')).toBe('/project/node_modules/.bin/hello');
    expect(vfs.stat('/project/node_modules/.bin/hello').mode & 0o111).toBeGreaterThan(0);

    const { runtime, out } = bootRuntime(vfs);
    const cp = childProcessOf(runtime);
    const run = cp.spawnSync('hello', ['--flag']);
    expect(run.status).toBe(0);
    // argv[1] is the *entry point*, not the shim — the marker is followed.
    expect(run.stdout).toBe('hello from cli.js argv=--flag\n');
    expect(out).toEqual([]);
  });

  it('keeps the first shim on a name collision and warns', () => {
    const vfs = makeVfs({});
    const result = writeBinShims(vfs, [
      { name: 'dup', target: '/project/node_modules/a/cli.js', package: 'a' },
      { name: 'dup', target: '/project/node_modules/b/cli.js', package: 'b' },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/duplicate bin "dup"/);
  });
});

// ---------------------------------------------------------------------------
// npm: lifecycle scripts
// ---------------------------------------------------------------------------

describe('npm: lifecycle scripts', () => {
  it('exposes the environment npm promises a lifecycle script', () => {
    const env = lifecycleEnv(
      { host: null as never, vfs: null as never, cwd: '/project/pkg', initCwd: '/project', baseEnv: { BASE: '1' } },
      { name: 'pkg', version: '2.0.0' },
      'postinstall',
      'echo hi',
    );
    expect(env).toMatchObject({
      BASE: '1',
      INIT_CWD: '/project',
      npm_lifecycle_event: 'postinstall',
      npm_lifecycle_script: 'echo hi',
      npm_package_name: 'pkg',
      npm_package_version: '2.0.0',
      npm_package_json: '/project/pkg/package.json',
    });
  });

  it('runs a dependency postinstall and records its output', async () => {
    const vfs = makeVfs({ '/project/node_modules/dep/package.json': '{}' });
    const { runtime, out } = bootRuntime(vfs);
    const warnings: string[] = [];
    const outcomes = await runDependencyScripts(
      {
        host: runtime.spawn,
        vfs,
        cwd: '/project',
        initCwd: '/project',
        baseEnv: {},
        warnings,
        onOutput: (chunk, stream) => (stream === 'stdout' ? out.push(decoder.decode(chunk)) : undefined),
      },
      '/project/node_modules/dep',
      {
        name: 'dep',
        version: '1.0.0',
        scripts: {
          preinstall: 'echo pre$npm_lifecycle_event',
          postinstall: 'node -e "require(\'fs\').writeFileSync(\'/project/built.txt\', \'built\')"',
        },
      },
    );
    expect(outcomes.map((o) => o.event)).toEqual(['preinstall', 'postinstall']);
    expect(warnings).toEqual([]);
    expect(out.join('')).toBe('prepreinstall\n');
    expect(decoder.decode(vfs.readFile('/project/built.txt'))).toBe('built');
  });

  it('reports a failing script as a warning instead of failing the install', async () => {
    const vfs = makeVfs({});
    const { runtime } = bootRuntime(vfs);
    const warnings: string[] = [];
    await runRootScripts(
      { host: runtime.spawn, vfs, cwd: '/project', initCwd: '/project', baseEnv: {}, warnings },
      { name: 'root', version: '1.0.0', scripts: { postinstall: 'exit 3' } },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/exited with code 3/);
  });

  it('skips everything under ignoreScripts', async () => {
    const vfs = makeVfs({});
    const { runtime } = bootRuntime(vfs);
    const warnings: string[] = [];
    const outcomes = await runRootScripts(
      { host: runtime.spawn, vfs, cwd: '/project', initCwd: '/project', baseEnv: {}, warnings, ignoreScripts: true },
      { name: 'root', version: '1.0.0', scripts: { postinstall: 'exit 3' } },
    );
    expect(outcomes).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
