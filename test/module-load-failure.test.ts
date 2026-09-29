import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Node does not keep a module whose evaluation threw: the error propagates out
 * of `require`, the cache entry is dropped and a later `require` of the same id
 * re-evaluates the file from scratch (verified against fnm Node v26.9.0, which
 * prints `caught1 boom` then `second {"ok":true,"n":2}`).
 *
 * web-node used to leave the record in its `loading` state, so the second
 * `require` quietly returned the half-built exports instead of re-running — a
 * silent wrong answer. M126's source tiering leans on the retry path (the realm
 * is retried after the lazy tier lands), so the rollback was fixed there.
 */
function runIndex(bad: string, index: string): string {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/bad.js', new TextEncoder().encode(bad));
  vfs.writeFile('/project/index.js', new TextEncoder().encode(index));
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => out.push(c),
  });
  runtime.runMain('/project/index.js');
  return out.join('');
}

const BAD = `globalThis.__n = (globalThis.__n || 0) + 1;\nif (globalThis.__n === 1) throw new Error('boom');\nmodule.exports = { ok: true, n: globalThis.__n };\n`;

describe('a module that throws while loading is not cached', () => {
  it('re-evaluates on the next require, like Node', () => {
    const out = runIndex(
      BAD,
      `try { require('./bad.js'); } catch (e) { console.log('caught1 ' + e.message); }\n` +
        `try { console.log('second ' + JSON.stringify(require('./bad.js'))); } catch (e) { console.log('caught2 ' + e.message); }\n`,
    );
    expect(out).toBe('caught1 boom\nsecond {"ok":true,"n":2}\n');
  });

  it('re-throws every time while the module keeps failing', () => {
    const out = runIndex(
      `globalThis.__n = (globalThis.__n || 0) + 1;\nthrow new Error('always ' + globalThis.__n);\n`,
      `for (let i = 0; i < 3; i++) { try { require('./bad.js'); } catch (e) { console.log(e.message); } }\n`,
    );
    expect(out).toBe('always 1\nalways 2\nalways 3\n');
  });
});
