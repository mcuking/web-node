import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * M124 — "loading OK != usable" behavioural guard.
 *
 * `tools/behavior-smoke-probe.cjs` makes one real first call into each builtin
 * the runtime claims to implement. It runs unchanged on real Node
 * (oracle -> test/fixtures/behavior-smoke.json) and here inside web-node.
 *
 * The point is the WebContainer lesson: `require()` succeeding proves nothing.
 * `http2` loaded then crashed on connect; `node:sqlite` exposed classes whose
 * prototypes had no methods; `node:sea` was a stub. This test compares the two
 * observation blobs and fails on any API the oracle can call but web-node
 * cannot — so a module that degrades to "loads but throws on first use" is
 * caught here instead of in a user's build.
 *
 * Intentional gaps are listed in DEVIATIONS with a reason. A deviation must be
 * narrow: it names the exact observation, not a whole module.
 */

/** observation key -> why web-node legitimately differs from real Node. */
const DEVIATIONS: Record<string, string> = {
  // No HTTP/2 stack (HPACK + frames/streams) and no bundled native SQLite. Both
  // modules still *load* (safe for side-effect imports) and throw a typed
  // ERR_WEB_NODE_NOT_IMPLEMENTED on use — see builtins/unsupported.ts. If either
  // is ever implemented these entries stop matching and the third test fails,
  // forcing the deviation to be deleted.
  'http2:createServer:call': 'node:http2 is not implemented in the tab',
  'http2:getDefaultSettings:call': 'node:http2 is not implemented in the tab',
  'sqlite:DatabaseSync:new': 'node:sqlite needs a bundled native SQLite',
  'trace_events:createTracing': 'V8 tracing does not exist in the tab (node:trace_events loads, throws typed on use)',
};

async function observe(): Promise<Record<string, unknown>> {
  const program = fs.readFileSync('tools/behavior-smoke-probe.cjs', 'utf8');
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: () => {},
  });
  runtime.runMain('/project/index.js');
  let stdout = out.join('');
  for (let i = 0; i < 400 && !stdout.includes('__OBS__'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    stdout = out.join('');
  }
  const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
  expect(line, 'probe produced no observable line').toBeTruthy();
  return JSON.parse(line!.slice('__OBS__'.length));
}

describe('behavioural smoke (differential vs real Node)', () => {
  it('every API real Node can call, web-node can call too', async () => {
    const expected = JSON.parse(fs.readFileSync('test/fixtures/behavior-smoke.json', 'utf8')) as Record<string, unknown>;
    const actual = await observe();

    const failures: string[] = [];
    for (const [key, want] of Object.entries(expected)) {
      const got = actual[key];
      if (got === undefined) {
        failures.push(`${key}: missing from web-node observation`);
        continue;
      }
      if (DEVIATIONS[key]) continue;
      // A value mismatch is as much a bug as a throw: the API "works" but lies.
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures.push(`${key}: oracle=${JSON.stringify(want)} web-node=${JSON.stringify(got)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('does not observe anything the oracle does not (no stray keys)', async () => {
    const expected = JSON.parse(fs.readFileSync('test/fixtures/behavior-smoke.json', 'utf8')) as Record<string, unknown>;
    const actual = await observe();
    const stray = Object.keys(actual).filter((k) => !(k in expected));
    expect(stray).toEqual([]);
  });

  it('documents every deviation in DEVIATIONS', async () => {
    const expected = JSON.parse(fs.readFileSync('test/fixtures/behavior-smoke.json', 'utf8')) as Record<string, unknown>;
    const actual = await observe();
    const undocumented: string[] = [];
    for (const key of Object.keys(DEVIATIONS)) {
      if (!(key in expected)) {
        undocumented.push(`${key}: listed as a deviation but not an observation`);
        continue;
      }
      const got = actual[key];
      if (JSON.stringify(got) === JSON.stringify(expected[key])) {
        undocumented.push(`${key}: listed as a deviation but server matches the oracle`);
      }
    }
    expect(undocumented).toEqual([]);
  });

  it('fails deviations with the typed not-implemented error, not MODULE_NOT_FOUND', async () => {
    // A core module we choose not to ship must still *resolve* (so a side-effect
    // `import 'node:http2'` cannot take the module graph down) and must fail on
    // *use* with the honest, typed error. A bare MODULE_NOT_FOUND would instead
    // look like a missing file and break innocent imports.
    const actual = await observe();
    const wrong: string[] = [];
    for (const key of Object.keys(DEVIATIONS)) {
      const got = actual[key];
      if (typeof got !== 'string' || !got.startsWith('throw:ERR_WEB_NODE_NOT_IMPLEMENTED')) {
        wrong.push(`${key}: expected throw:ERR_WEB_NODE_NOT_IMPLEMENTED, got ${JSON.stringify(got)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
