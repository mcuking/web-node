import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { runVmCorpus } from './fixtures/vm-corpus.mjs';
import expected from './fixtures/vm-corpus.json';

/**
 * Parity for `vm` across the whole corpus.
 *
 * `test/fixtures/vm-corpus.json` is written by `tools/vm-corpus-oracle.mjs`
 * running a real Node (oracle fnm v26.9.0) over `fixtures/vm-corpus.mjs`. This
 * test replays the identical function through the web-node runtime's vendored
 * `lib/vm.js` (backed by the `contextify` binding), so a regression in context
 * creation, the `with`-scope semantics, or the argument validation shows up as a
 * difference rather than a passing eyeball.
 */
function boot(): (id: string) => unknown {
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
  return (id: string): unknown => runtime.realm.require(id);
}

describe('vm matches a real Node', () => {
  const results = expected.results as Record<string, unknown>;

  it('has an expectation for every corpus entry, and vice versa', () => {
    const actual = runVmCorpus(boot()('vm') as never) as Record<string, unknown>;
    expect(Object.keys(actual).sort()).toEqual(Object.keys(results).sort());
  });

  it('produces the same result for every entry', () => {
    const actual = runVmCorpus(boot()('vm') as never) as Record<string, unknown>;
    for (const [name, value] of Object.entries(results)) {
      expect(actual[name], name).toEqual(value);
    }
  });
});
