import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { colorDepthCases, hasColorsCases } from './fixtures/tty-corpus.mjs';
import expected from './fixtures/tty-corpus.json';

/**
 * Parity for `getColorDepth`/`hasColors` across the whole corpus.
 *
 * `test/fixtures/tty-corpus.json` is written by `tools/tty-corpus-oracle.mjs`
 * running a real Node (oracle fnm v26.9.0) over `fixtures/tty-corpus.mjs`. This
 * test replays the identical list through the web-node runtime, so a regression
 * in the vendored `internal/tty` — a missing TERM entry, the wrong CI table, an
 * off-by-one in the `FORCE_COLOR` switch — shows up as a difference rather than
 * a passing eyeball.
 *
 * The functions are reached through `WriteStream.prototype`, exactly as the
 * oracle does: `lib/tty.js` assigns the real `internal/tty` functions there, so
 * no terminal is required on either side.
 */
function ttyPrototype(): {
  getColorDepth: (env?: Record<string, string>) => number;
  hasColors: (...args: unknown[]) => boolean;
} {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  const tty = runtime.realm.require('tty') as { WriteStream: { prototype: never } };
  return tty.WriteStream.prototype as unknown as {
    getColorDepth: (env?: Record<string, string>) => number;
    hasColors: (...args: unknown[]) => boolean;
  };
}

describe('tty colour depth matches a real Node', () => {
  const depth = expected.getColorDepth as Record<string, number>;
  const colors = expected.hasColors as Record<string, boolean>;

  it('has an expectation for every corpus entry, and vice versa', () => {
    const depthNames = (colorDepthCases() as [string, unknown][]).map(([name]) => name);
    expect([...depthNames].sort()).toEqual(Object.keys(depth).sort());
    const colorNames = (hasColorsCases() as [string, unknown][]).map(([name]) => name);
    expect([...colorNames].sort()).toEqual(Object.keys(colors).sort());
  });

  it('gets the same colour depth for every environment', () => {
    const { getColorDepth } = ttyPrototype();
    for (const [name, env] of colorDepthCases() as [string, Record<string, string>][]) {
      expect(getColorDepth(env), name).toBe(depth[name]);
    }
  });

  it('gets the same hasColors answer for every argument list', () => {
    const { hasColors } = ttyPrototype();
    for (const [name, args] of hasColorsCases() as [string, unknown[]][]) {
      expect(hasColors(...args), name).toBe(colors[name]);
    }
  });
});
