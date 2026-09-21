import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { runWorkerCorpus, WORKER_FILES } from './fixtures/worker-corpus.mjs';
import expected from './fixtures/worker-corpus.json';

/**
 * Parity for `worker_threads.Worker` across the whole corpus.
 *
 * `test/fixtures/worker-corpus.json` is written by `tools/worker-corpus-oracle.mjs`
 * running a real Node (oracle fnm v26.9.0) over `fixtures/worker-corpus.mjs`, one
 * real thread per worker. This test replays the identical function through the
 * web-node runtime's *cooperative* worker, so a regression in message delivery,
 * `workerData` cloning, the lifecycle events or the argument validation shows up
 * as a difference rather than a passing eyeball.
 */
function boot(): { require: (id: string) => unknown; vfs: MemoryVfs } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  for (const [name, contents] of Object.entries(WORKER_FILES)) {
    vfs.writeFile(`/project/${name}`, new TextEncoder().encode(contents));
  }
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return { require: (id: string) => runtime.realm.require(id), vfs };
}

describe('worker_threads.Worker matches a real Node', () => {
  it('produces the same result for every corpus entry', async () => {
    const { require: req } = boot();
    const vm = req('worker_threads') as never;
    const actual = (await runWorkerCorpus(vm, {
      pathFor: (name: string) => `/project/${name}`,
    })) as unknown as Record<string, unknown>;
    const results = expected.results as Record<string, unknown>;
    expect(Object.keys(actual).sort()).toEqual(Object.keys(results).sort());
    for (const [name, value] of Object.entries(results)) {
      expect(actual[name], name).toEqual(value);
    }
  });
});
