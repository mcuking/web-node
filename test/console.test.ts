import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `console` is now Node's real `lib/console.js` (+ `internal/console/*`,
 * `internal/cli_table`, `internal/util/debuglog`), replacing a hand-written
 * shell whose `count`/`group`/`table`/`time` were stubs. Expected output was
 * read off Node v26.9.0 first (`node /tmp/probe-console.js 1>out 2>err`).
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
  try {
    runtime.runMain('/project/index.js');
  } catch (e) {
    error = e;
  }
  return { stdout: out.join(''), stderr: err.join(''), error };
}

describe('vendored: console', () => {
  it('formats log/info/debug to stdout and warn/error to stderr', () => {
    const { stdout, stderr, error } = run(`
      console.log('log'); console.info('info'); console.debug('debug');
      console.warn('warn'); console.error('err');
    `);
    expect(error).toBeNull();
    expect(stdout).toBe('log\ninfo\ndebug\n');
    expect(stderr).toBe('warn\nerr\n');
  });

  it('interpolates with the real util.format', () => {
    const { stdout } = run(`console.log('%s:%d', 'x', 3); console.log('%o', {a:1});`);
    expect(stdout).toBe('x:3\n{ a: 1 }\n');
  });

  it('counts, resets and indents like Node', () => {
    const { stdout } = run(`
      console.count('x'); console.count('x'); console.countReset('x'); console.count('x');
      console.group('g'); console.log('in'); console.groupEnd(); console.log('out');
    `);
    expect(stdout).toBe('x: 1\nx: 2\nx: 1\ng\n  in\nout\n');
  });

  it('renders console.table as a real box table', () => {
    const { stdout } = run(`console.table([{a:1,b:'two'},{a:22,b:'x'}]);`);
    expect(stdout).toBe(
      '┌─────────┬────┬───────┐\n' +
        '│ (index) │ a  │ b     │\n' +
        '├─────────┼────┼───────┤\n' +
        "│ 0       │ 1  │ 'two' │\n" +
        "│ 1       │ 22 │ 'x'   │\n" +
        '└─────────┴────┴───────┘\n',
    );
  });

  it('measures column width in Unicode columns, not code units', () => {
    // '中文' is two code points but four terminal columns. Read off Node
    // v26.9.0; the ICU column width has to reach `console.table` for the box
    // borders to line up.
    const { stdout } = run(`console.table([{name:'中文',n:1},{name:'ab',n:2}]);`);
    expect(stdout).toBe(
      '┌─────────┬────────┬───┐\n' +
        '│ (index) │ name   │ n │\n' +
        '├─────────┼────────┼───┤\n' +
        "│ 0       │ '中文' │ 1 │\n" +
        "│ 1       │ 'ab'   │ 2 │\n" +
        '└─────────┴────────┴───┘\n',
    );
  });

  it('only prints a failed assertion, on stderr', () => {
    const { stdout, stderr } = run(`console.assert(true, 'no'); console.assert(false, 'boom %s', 'x');`);
    expect(stdout).toBe('');
    expect(stderr).toBe('Assertion failed: boom x\n');
  });

  it('dirs with inspect options', () => {
    const { stdout } = run(`console.dir({a:1}, {depth:0});`);
    expect(stdout).toBe('{ a: 1 }\n');
  });

  it('times with the real debuglog time store', () => {
    const { stdout } = run(`console.time('t'); console.timeEnd('t');`);
    // The elapsed value is wall-clock; only the label and unit are deterministic.
    expect(stdout).toMatch(/^t: \d+(\.\d+)?(ms|s)\n$/);
  });

  it('exposes a Console constructor that is instanceof the global console', () => {
    const { stdout } = run(`
      const { Console } = require('console');
      console.log(console instanceof Console, new Console({ stdout: process.stdout }).constructor === Console);
    `);
    expect(stdout).toBe('true true\n');
  });
});
