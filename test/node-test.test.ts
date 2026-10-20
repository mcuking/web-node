/**
 * `node:test` — the real vendored harness (M152).
 *
 * Node's `--test` runs each file in a child process. A tab cannot spawn, so
 * `run()` loads the files in this realm instead (`isolation: 'none'`, which Node
 * also supports). Everything else — the tree of suites/tests, the assertions,
 * the reporters — is Node's own source, so the observable behaviour (ordering,
 * hooks, skip/todo, the spec text) is the real thing rather than a lookalike.
 */

import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const encoder = new TextEncoder();
const DONE = '__WN_TEST_DONE__';

/**
 * Run `body` as `/project/index.js` and collect everything written to stdout /
 * stderr until the process would have exited.
 *
 * `drain()` is what the worker calls after `runMain()`: it is where the runtime
 * emits `beforeExit` and then `exit`, which is exactly when `node:test`'s
 * reporter flushes. Without it the assertions would see the test side effects
 * but not the report — a test artifact, not a runtime bug.
 */
function runBody(body: string, waitMs = 15000): Promise<string> {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', encoder.encode(body));
  const parts: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (chunk) => parts.push(chunk),
    onStderr: (chunk) => parts.push(chunk),
  });
  runtime.runMain('/project/index.js');
  const drained = runtime.drain(waitMs).catch(() => false);
  return drained.then(() => parts.join(''));
}

/** A body that ends by printing the sentinel, so collection has a clear end. */
function body(source: string): string {
  // A distinct name: the source conventionally binds `test` itself.
  return `${source}
const __sentinelSuite = require('node:test');
__sentinelSuite.test('zz-sentinel', () => console.log(${JSON.stringify(DONE)}));
`;
}

describe('node:test', () => {
  it('runs a passing test and reports it through the spec reporter', async () => {
    const out = await runBody(
      body(`
const test = require('node:test');
test('adds', () => {
  if (1 + 1 !== 2) throw new Error('math is broken');
});
`),
    );
    // The spec reporter's shape: a check mark and the name, then the count line.
    expect(out).toContain('adds');
    expect(out).toMatch(/✔|ok 1/);
    expect(out).toMatch(/pass 2/);
    expect(out).not.toMatch(/fail [1-9]/);
  }, 30000);

  it('reports a failing assertion with its message', async () => {
    const out = await runBody(
      body(`
const test = require('node:test');
const assert = require('node:assert');
test('fails', () => assert.strictEqual(1, 2));
`),
    );
    expect(out).toContain('fails');
    expect(out).toMatch(/fail 1/);
    // Node's own assertion text, not a re-implementation.
    expect(out).toMatch(/Expected values to be strictly equal/);
  }, 30000);

  it('supports describe/it and before hooks', async () => {
    const out = await runBody(
      body(`
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
describe('suite', () => {
  let state = 0;
  before(() => { state = 41; });
  it('sees the hook', () => assert.strictEqual(state + 1, 42));
});
`),
    );
    expect(out).toContain('suite');
    expect(out).toContain('sees the hook');
    // Verified against real Node v26.9.0: a passing suite is *not* counted in
    // `pass` (the `it` inside it and the sentinel are).
    expect(out).toMatch(/pass 2/);
  }, 30000);

  it('honours skip and todo', async () => {
    const out = await runBody(
      body(`
const { test } = require('node:test');
test('skipped', { skip: true }, () => { throw new Error('must not run'); });
test('planned', { todo: true }, () => {});
`),
    );
    expect(out).toMatch(/skipped 1/);
    expect(out).toMatch(/todo 1/);
    expect(out).not.toContain('must not run');
  }, 30000);

  it('exposes run() with the documented stream events', async () => {
    const out = await runBody(`
const { run } = require('node:test');
const fs = require('node:fs');
fs.writeFileSync('/project/one.test.js', "const t = require('node:test'); t('from-file', () => {});");
const stream = run({ files: ['/project/one.test.js'] });
stream.on('test:pass', (event) => console.log('EVENT-PASS ' + event.name));
stream.on('test:summary', (event) => {
  console.log('EVENT-SUMMARY ' + JSON.stringify(event.counts));
  console.log(${JSON.stringify(DONE)});
});
`);
    expect(out).toContain('EVENT-PASS from-file');
    expect(out).toContain('EVENT-SUMMARY');
    expect(out).toContain('"passed":1');
  }, 30000);

  it('runs test files through test/reporters', async () => {
    const out = await runBody(`
const { run } = require('node:test');
const { tap } = require('node:test/reporters');
const fs = require('node:fs');
fs.writeFileSync('/project/two.test.js', "const t = require('node:test'); t('via-tap', () => {});");
const stream = run({ files: ['/project/two.test.js'] });
stream.compose(tap).pipe(process.stdout);
stream.on('test:summary', () => console.log(${JSON.stringify(DONE)}));
`);
    // Real TAP, produced by Node's own reporter.
    expect(out).toMatch(/^ok 1 - via-tap/m);
  }, 30000);
});
