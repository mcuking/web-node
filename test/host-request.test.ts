/**
 * Host requests and the child exit decision.
 *
 * A spawned child is considered finished when its synchronous phase has
 * returned *and* the runtime's active-work delta is back to zero. That delta
 * covers sandbox timers and the child's own sockets — but not a promise that
 * belongs to the *host*, such as an in-flight `fetch()`. Without tracking those,
 * a child whose only remaining work is a download was reported as exited before
 * the response landed, and its output was lost.
 *
 * The grounding is real Node v26.9.0: an in-flight `fetch()` keeps the process
 * alive until it settles, while promises that resolve on the microtask queue
 * (`crypto.subtle.digest()`, `Blob.prototype.arrayBuffer()`, a bare pending
 * promise) do not. The tests below pin both halves of that distinction, so the
 * fix cannot drift into over-counting.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const encoder = new TextEncoder();
const tick = (ms = 8): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const realFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as unknown as Record<string, unknown>).fetch = realFetch;
});

function makeVfs(files: Record<string, string>): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, encoder.encode(content));
  }
  return vfs;
}

/** A host `fetch` that resolves only after a *host* macrotask. */
function installSlowFetch(delayMs: number, body = 'body'): void {
  (globalThis as unknown as Record<string, unknown>).fetch = (url: string): Promise<unknown> =>
    new Promise((resolve) => {
      setTimeout(() => resolve({ ok: true, url, text: async () => body }), delayMs);
    });
}

async function runProject(files: Record<string, string>, waitMs = 250): Promise<string> {
  const vfs = makeVfs(files);
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => out.push(c),
  });
  runtime.runMain('/project/index.js');
  const deadline = Date.now() + waitMs;
  let last = '';
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

describe('a child whose remaining work is a host request', () => {
  it('waits for an in-flight fetch instead of exiting early', async () => {
    installSlowFetch(40);
    const out = await runProject({
      '/project/index.js': `
        const { exec } = require('child_process');
        exec('node /project/child.js', (err, stdout) => {
          console.log('done|' + JSON.stringify(stdout.trim()) + '|err=' + err);
        });
      `,
      '/project/child.js': `
        fetch('http://example.test/data').then((r) => console.log('fetched|' + r.url));
      `,
    });
    expect(out.trim()).toBe('done|"fetched|http://example.test/data"|err=null');
  });

  it('does not count a promise that only resolves on the microtask queue', async () => {
    // Real Node exits with this promise still pending; so must a child.
    const out = await runProject({
      '/project/index.js': `
        const { exec } = require('child_process');
        exec('node /project/child.js', (err, stdout) => {
          console.log('done|' + JSON.stringify(stdout.trim()) + '|err=' + err);
        });
      `,
      '/project/child.js': `
        new Promise(() => {});
        console.log('sync-only');
      `,
    });
    expect(out.trim()).toBe('done|"sync-only"|err=null');
  });

  it('releases the count when the request fails, so the child still finishes', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = (): Promise<unknown> =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('network down')), 30);
      });
    const out = await runProject({
      '/project/index.js': `
        const { exec } = require('child_process');
        exec('node /project/child.js', (err, stdout) => {
          console.log('done|' + JSON.stringify(stdout.trim()) + '|err=' + err);
        });
      `,
      '/project/child.js': `
        fetch('http://example.test/data').catch((e) => console.log('caught|' + e.message));
      `,
    });
    expect(out.trim()).toBe('done|"caught|network down"|err=null');
  });

  it("does not let the parent's own in-flight fetch hold a child open", async () => {
    // The delta is the child's, not the runtime's: work the parent started
    // before the spawn must not keep the child alive.
    installSlowFetch(150);
    const out = await runProject({
      '/project/index.js': `
        const { exec } = require('child_process');
        let parentFetchDone = false;
        fetch('http://example.test/parent').then(() => { parentFetchDone = true; });
        exec('node -e "process.stdout.write(String(6 * 7))"', (err, stdout) => {
          console.log('done|' + stdout + '|parentFetchDone=' + parentFetchDone);
        });
      `,
    });
    expect(out.trim()).toBe('done|42|parentFetchDone=false');
  });
});
