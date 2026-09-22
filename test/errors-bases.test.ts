import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import bases from './fixtures/errors-bases.json';

/**
 * Differential test for the *variant bases* of `internal/errors` codes.
 *
 * `E(code, msg, Base, ...Extra)` attaches each extra base as a static on the
 * generated class — `ERR_INVALID_ARG_VALUE.RangeError`, `ERR_INVALID_STATE
 * .TypeError`, and so on. Call sites use those statics directly, so an omission
 * is a latent "is not a constructor" crash. `tools/errors-bases-oracle.mjs`
 * (run under `node --expose-internals`) records which of the four permutation
 * bases every code exposes; this replays it through web-node's shim.
 *
 * Regenerate the fixture with:
 *
 *   node --expose-internals tools/errors-bases-oracle.mjs
 */

const PERMUTATIONS = ['TypeError', 'RangeError', 'SyntaxError', 'Error'];
const expected = bases as Record<string, string[]>;

function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('internal/errors') as { codes: Record<string, any> };
}

describe('internal/errors variant bases (differential vs Node v26.9.0)', () => {
  const { codes } = boot();

  it('every shared code exposes the same permutation statics', () => {
    const drift: string[] = [];
    for (const [code, wanted] of Object.entries(expected)) {
      if (typeof codes[code] !== 'function') continue; // module not carried here
      const got = PERMUTATIONS.filter((k) => typeof codes[code][k] === 'function');
      if (JSON.stringify(got) !== JSON.stringify(wanted)) {
        drift.push(`${code}: node=[${wanted.join(',')}] shim=[${got.join(',')}]`);
      }
    }
    expect(drift).toEqual([]);
  });
});
