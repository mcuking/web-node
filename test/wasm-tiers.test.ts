import { describe, expect, it, vi, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  WASM_MODULES,
  DEFERRED_WASM_MODULES,
  loadDeferredWasmModules,
} from '../src/node-runtime/wasm';
import { instantiateWasm } from '../src/node-runtime/wasm/loader';
import { wasmLoaded, wasmModule, resetWasm, installWasm } from '../src/node-runtime/wasm/registry';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const ARTIFACTS = 'src/node-runtime/wasm/artifacts';

/** Re-install every committed artifact, exactly like `test/setup-wasm.ts`. */
function installAllFromDisk(): void {
  for (const e of readdirSync(ARTIFACTS, { withFileTypes: true })) {
    if (e.isDirectory() || !e.name.endsWith('.wasm')) continue;
    const name = e.name.slice(0, -'.wasm'.length);
    installWasm(name, instantiateWasm(readFileSync(`${ARTIFACTS}/${e.name}`) as unknown as BufferSource));
  }
}

afterAll(() => installAllFromDisk());

function fakeWasmBytes(): Uint8Array {
  // A minimal valid reactor module: `(module)`. Instantiating it yields an empty
  // exports table, which is all `loadDeferredWasmModules` needs to install.
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
}

describe('wasm module tiers (M107)', () => {
  it('keeps the boot-critical set small and free of the big codecs', () => {
    const eager = Object.keys(WASM_MODULES);
    const deferred = Object.keys(DEFERRED_WASM_MODULES);
    // The heavy codecs must live in the deferred tier — that is the whole point:
    // they were ~563 KB gzip on the boot-critical path.
    for (const big of ['wn_brotli', 'wn_zstd', 'wn_histogram']) {
      expect(deferred).toContain(big);
      expect(eager).not.toContain(big);
    }
    // And the two tiers must not overlap.
    expect(eager.filter((n) => deferred.includes(n))).toEqual([]);
  });

  it('fetches and installs the deferred modules (low priority, idempotent)', async () => {
    const name = '__wn_test_deferred';
    const bytes = fakeWasmBytes();
    const calls: Array<{ url: string; init: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: unknown) => {
      calls.push({ url, init });
      return { ok: true, arrayBuffer: async () => bytes.buffer } as unknown as Response;
    });

    await loadDeferredWasmModules({
      modules: { [name]: 'http://x/' + name + '.wasm' },
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Deferred means "off the critical path": the fetch must yield to the eager
    // payloads rather than compete with them.
    expect((calls[0].init as { priority?: string }).priority).toBe('low');
    expect(wasmLoaded(name)).toBe(true);
    expect(typeof wasmModule(name)).toBe('object');

    // Idempotent: a second call must not re-fetch an installed module.
    await loadDeferredWasmModules({
      modules: { [name]: 'http://x/' + name + '.wasm' },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces a bad deferred module instead of swallowing it', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404 }) as unknown as Response) as typeof fetch;
    await expect(
      loadDeferredWasmModules({ modules: { __wn_missing: 'http://x/missing.wasm' }, fetch: fetchImpl }),
    ).rejects.toThrow(/__wn_missing/);
  });

  it('builds a realm and runs JS with none of the deferred modules installed', () => {
    // The whole optimisation rests on this: the realm and the binding table must
    // not touch brotli / zstd / histogram at construction. If they did, booting
    // without them would break — not merely lose a feature.
    resetWasm();
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('/project/index.js', new TextEncoder().encode(`console.log('booted ' + (1 + 1));`));
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
    });
    runtime.runMain('/project/index.js');
    expect(out.join('')).toContain('booted 2');
    // Only the deferred tier is absent: requiring zlib is fine, using its brotli
    // half is what needs the module — and says so honestly.
    expect(wasmLoaded('wn_zlib')).toBe(false);
    const zlib = runtime.realm.require('zlib') as { brotliCompressSync: (b: Uint8Array) => Uint8Array };
    expect(() => zlib.brotliCompressSync(new Uint8Array([120]))).toThrow(/wn_brotli/);
    installAllFromDisk();
  });
});
