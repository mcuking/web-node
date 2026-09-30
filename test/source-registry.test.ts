import { describe, expect, it, beforeEach } from 'vitest';
import {
  SOURCE_REGISTRY_MAX_BYTES,
  clearCompiledSources,
  compiledSourcesStats,
  getCompiledSource,
  registerCompiledSource,
} from '../src/node-runtime/source-registry';

// The registry is process-global, so reset it around every case.
beforeEach(() => clearCompiledSources());

describe('source-registry', () => {
  it('returns what was registered under the same URL', () => {
    registerCompiledSource('node:internal/foo', 'const a = 1;');
    expect(getCompiledSource('node:internal/foo')).toBe('const a = 1;');
  });

  it('ignores undefined/null lookups', () => {
    expect(getCompiledSource(undefined)).toBeUndefined();
    expect(getCompiledSource(null)).toBeUndefined();
  });

  it('overwrites an entry without double-counting its bytes', () => {
    registerCompiledSource('u', 'x'.repeat(1000));
    registerCompiledSource('u', 'y'.repeat(10));
    expect(compiledSourcesStats()).toEqual({ entries: 1, bytes: 10 });
    expect(getCompiledSource('u')).toBe('y'.repeat(10));
  });

  it('stays within the byte budget', () => {
    const chunk = 'z'.repeat(256 * 1024);
    for (let i = 0; i < 64; i++) registerCompiledSource('node:mod/' + i, chunk);
    const stats = compiledSourcesStats();
    // Budget + at most one in-flight chunk over the line before the next eviction.
    expect(stats.bytes).toBeLessThanOrEqual(SOURCE_REGISTRY_MAX_BYTES + chunk.length);
    expect(stats.entries).toBeLessThan(64);
  });

  it('evicts the coldest entries first', () => {
    const chunk = 'q'.repeat(512 * 1024);
    registerCompiledSource('cold', chunk);
    for (let i = 0; i < 16; i++) registerCompiledSource('node:hot/' + i, chunk);
    expect(getCompiledSource('cold')).toBeUndefined();
    expect(getCompiledSource('node:hot/15')).toBeDefined();
  });

  it('refreshes recency on read', () => {
    const chunk = 'r'.repeat(512 * 1024);
    registerCompiledSource('a', chunk);
    registerCompiledSource('b', chunk);
    // Touch `a` so `b` becomes the coldest.
    expect(getCompiledSource('a')).toBeDefined();
    // 2 (a,b) + 7 = 9 chunks of 512 KiB = 4608 KiB: over budget by one chunk, so
    // exactly the coldest entry (`b`) is evicted while `a` survives.
    for (let i = 0; i < 7; i++) registerCompiledSource('node:n/' + i, chunk);
    expect(getCompiledSource('b')).toBeUndefined();
    expect(getCompiledSource('a')).toBeDefined();
  });

  it('keeps the newest entry even when it alone exceeds the budget', () => {
    const huge = 'h'.repeat(SOURCE_REGISTRY_MAX_BYTES + 1);
    registerCompiledSource('huge', huge);
    expect(getCompiledSource('huge')).toBe(huge);
    expect(compiledSourcesStats().entries).toBe(1);
  });
});
