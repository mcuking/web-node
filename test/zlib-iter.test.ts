/**
 * `zlib/iter` — the iterable compression API (M101).
 *
 * Node's `lib/zlib/iter.js` is a thin layer over `lib/internal/streams/iter/
 * transform.js`, which builds *bare* native zlib handles and drives them through
 * `internalBinding('zlib')`. Both files are now vendored verbatim; the raw handle
 * surface (`new binding.Zlib(mode)` + `init`/`write`/`writeSync`/`close`) is
 * presented on top of the real wasm codecs from M116/M118.
 *
 * The gate is a shared observation program (`tools/zlib-iter-probe.cjs`) run both
 * on a real Node oracle (`--experimental-stream-iter`, which produced
 * `test/fixtures/zlib-iter.json`) and inside web-node: the two JSON blobs must be
 * equal.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const encoder = new TextEncoder();
const expected = JSON.parse(readFileSync('test/fixtures/zlib-iter.json', 'utf8')) as Record<string, unknown>;

/** Run a script inside the runtime and collect everything it prints. */
function runBody(body: string, waitMs = 8000): Promise<string[]> {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', encoder.encode(body));
  const lines: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (chunk) => lines.push(chunk),
    onStderr: (chunk) => lines.push(chunk),
  });
  runtime.runMain('/project/index.js');
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs;
    let joined = '';
    let stable = 0;
    const poll = (): void => {
      const now = lines.join('');
      if (now !== joined) {
        joined = now;
        stable = 0;
      } else if (now.length > 0 && ++stable >= 8) {
        resolve(joined.split('\n').filter((line) => line.length > 0));
        return;
      }
      if (Date.now() > deadline) {
        resolve(joined.split('\n').filter((line) => line.length > 0));
        return;
      }
      setTimeout(poll, 20);
    };
    setTimeout(poll, 20);
  });
}

describe('zlib/iter', () => {
  it('exposes the iterable transforms and round-trips through pull()', async () => {
    const result = await runBody(`
      const { fromSync, pullSync, bytesSync, textSync } = require('stream/iter');
      const { compressGzipSync, decompressGzipSync } = require('zlib/iter');
      const __report = (v) => console.log('RESULT ' + JSON.stringify(v));
      const out = textSync(pullSync(pullSync(fromSync('round trip'), compressGzipSync()), decompressGzipSync()));
      __report({ out, gz: bytesSync(pullSync(fromSync('round trip'), compressGzipSync())).length });
    `);
    const line = result.find((l) => l.startsWith('RESULT '));
    expect(line, `no RESULT line; output was:\n${result.join('\n')}`).toBeTruthy();
    expect(JSON.parse((line as string).slice('RESULT '.length))).toEqual({ out: 'round trip', gz: 30 });
  });

  it('matches the real-Node oracle on the shared observation corpus', async () => {
    const probe = readFileSync('tools/zlib-iter-probe.cjs', 'utf8');
    const lines = await runBody(probe, 12000);
    const line = lines.find((l) => l.startsWith('__OBS__'));
    expect(line, `the probe produced no __OBS__ line; output was:\n${lines.join('\n')}`).toBeTruthy();
    const observed = JSON.parse((line as string).slice('__OBS__'.length)) as Record<string, unknown>;
    expect(Object.keys(observed).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      expect(observed[key], `field "${key}"`).toEqual(expected[key]);
    }
  }, 30000);
});
