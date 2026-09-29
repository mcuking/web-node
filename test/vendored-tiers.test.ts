import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { VENDORED, installVendored } from '../src/node-runtime/vendored';
import { CORE_VENDORED, splitVendoredSources } from '../plugins/vendored-source';

/**
 * The vendored sources ship in two tiers (M126): a small **core** set the realm
 * reads while booting (preloaded, awaited before `ready`) and a **lazy** set only
 * user code reaches (fetched in the background, awaited before user code runs).
 *
 * The split is only sound if the core tier really does cover everything the realm
 * touches at construction — otherwise the browser (which builds the realm from
 * core alone) would diverge from the tests. These gates pin that.
 */

function bootRuntime(installGlobals = true): NodeRuntime {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  return new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals,
    onStdout: () => {},
    onStderr: () => {},
  });
}

/** Construct the realm with `VENDORED` instrumented, returning the files it read. */
function bootReads(): string[] {
  const reads = new Set<string>();
  const saved: Array<[string, PropertyDescriptor | undefined]> = [];
  for (const key of Object.keys(VENDORED)) {
    const value = VENDORED[key];
    saved.push([key, Object.getOwnPropertyDescriptor(VENDORED, key)]);
    Object.defineProperty(VENDORED, key, {
      configurable: true,
      enumerable: true,
      get() {
        reads.add(key);
        return value;
      },
    });
  }
  try {
    bootRuntime(true);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(VENDORED, key, descriptor);
    }
  }
  return [...reads].sort();
}

describe('vendored source tiers (M126)', () => {
  it('lists every core file exactly once, and every one exists', () => {
    expect(new Set(CORE_VENDORED).size).toBe(CORE_VENDORED.length);
    for (const rel of CORE_VENDORED) expect(VENDORED[rel], rel).toBeTypeOf('string');
  });

  it('boots the realm reading only files from the core tier', () => {
    const boot = bootReads();
    // Sanity: the instrumentation actually captured a non-trivial boot set.
    expect(boot.length).toBeGreaterThan(20);
    const outside = boot.filter((rel) => !CORE_VENDORED.includes(rel));
    // If this fails, add the named file(s) to CORE_VENDORED in
    // plugins/vendored-source.ts — a boot dependency landed in the lazy tier.
    expect(outside).toEqual([]);
  });

  it('partitions every vendored file into exactly one tier', () => {
    const { core, rest } = splitVendoredSources();
    const all = Object.keys(VENDORED).sort();
    expect(Object.keys(core).sort()).toEqual([...CORE_VENDORED].sort());
    expect([...Object.keys(core), ...Object.keys(rest)].sort()).toEqual(all);
    for (const rel of Object.keys(core)) expect(rel in rest).toBe(false);
  });

  it('keeps the core tier a small minority of the payload', () => {
    const { core, rest } = splitVendoredSources();
    const size = (o: Record<string, string>) =>
      Object.values(o).reduce((n, s) => n + s.length, 0);
    expect(size(core)).toBeLessThan(size(rest));
    // The point of the split: the critical path is well under half the sources.
    expect(size(core) / (size(core) + size(rest))).toBeLessThan(0.4);
  });

  it('builds from the core tier alone and fails loudly for a lazy-only module', () => {
    const full = { ...VENDORED };
    const { core, rest } = splitVendoredSources();
    for (const key of Object.keys(VENDORED)) delete VENDORED[key];
    for (const [key, src] of Object.entries(core)) VENDORED[key] = src;
    try {
      const runtime = bootRuntime(true);
      // The realm is live: a core builtin resolves.
      expect(runtime.realm.bindingIds.length).toBeGreaterThan(0);
      expect(typeof (runtime.realm.require('util') as { inspect: unknown }).inspect).toBe('function');
      // A lazy-only builtin cannot run yet — and says *why*, naming the file.
      expect(() => runtime.realm.require('fs')).toThrowError(/Vendored file .* is missing/);
      // Once the lazy tier lands, the same require works.
      installVendored(rest);
      const fs = runtime.realm.require('fs') as { readFileSync: unknown };
      expect(typeof fs.readFileSync).toBe('function');
    } finally {
      for (const key of Object.keys(VENDORED)) delete VENDORED[key];
      for (const [key, src] of Object.entries(full)) VENDORED[key] = src;
    }
  });
});
