import { afterEach, describe, expect, it } from 'vitest';
import {
  cacheStorageResponseCache,
  createRegistry,
  memoryResponseCache,
  type FetchLike,
  type FetchResponseLike,
} from '../src/node-runtime/npm';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function jsonResponse(value: unknown): FetchResponseLike {
  const bytes = encoder.encode(JSON.stringify(value));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(decoder.decode(bytes)),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

function bytesResponse(bytes: Uint8Array): FetchResponseLike {
  const copy = bytes.slice();
  return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => copy.buffer };
}

const PACKUMENT = { name: 'tiny', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'tiny', version: '1.0.0', dist: { tarball: 'https://r/tiny-1.0.0.tgz' } } } };

describe('npm registry response cache', () => {
  it('serves a packument from the cache on a second client (no refetch)', async () => {
    const store = memoryResponseCache();
    let fetches = 0;
    const fetchImpl: FetchLike = async () => {
      fetches += 1;
      return jsonResponse(PACKUMENT);
    };

    const a = createRegistry(fetchImpl, 'https://registry.example', { cache: store });
    await a.packument('tiny');
    expect(fetches).toBe(1);
    expect(a.cacheStats).toMatchObject({ hits: 0, misses: 1, stores: 1 });

    // A fresh client (as after a reload) with the same persistent store.
    const b = createRegistry(fetchImpl, 'https://registry.example', { cache: store });
    const pack = await b.packument('tiny');
    expect(fetches).toBe(1); // still one network request total
    expect(pack.versions['1.0.0'].version).toBe('1.0.0');
    expect(b.cacheStats).toMatchObject({ hits: 1, misses: 0 });
  });

  it('expires a stale packument after its TTL', async () => {
    const store = memoryResponseCache();
    let clock = 1_000_000;
    let fetches = 0;
    const fetchImpl: FetchLike = async () => {
      fetches += 1;
      return jsonResponse(PACKUMENT);
    };
    const opts = { cache: store, packumentTtlMs: 1000, now: () => clock };

    await createRegistry(fetchImpl, 'https://r', opts).packument('tiny');
    clock += 500; // still fresh
    await createRegistry(fetchImpl, 'https://r', opts).packument('tiny');
    expect(fetches).toBe(1);

    clock += 2000; // now stale
    await createRegistry(fetchImpl, 'https://r', opts).packument('tiny');
    expect(fetches).toBe(2);
  });

  it('caches tarballs without expiry (URLs pin a version)', async () => {
    const store = memoryResponseCache();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    let fetches = 0;
    const fetchImpl: FetchLike = async () => {
      fetches += 1;
      return bytesResponse(bytes);
    };
    const url = 'https://r/tiny-1.0.0.tgz';
    let clock = 0;
    const opts = { cache: store, now: () => clock };

    const first = await createRegistry(fetchImpl, 'https://r', opts).tarball(url);
    expect([...first]).toEqual([1, 2, 3, 4, 5]);
    clock = 10_000_000_000; // far future — tarballs never go stale
    const second = await createRegistry(fetchImpl, 'https://r', opts).tarball(url);
    expect([...second]).toEqual([1, 2, 3, 4, 5]);
    expect(fetches).toBe(1);
  });

  it('does not cache a body over the size cap (but still serves it)', async () => {
    const store = memoryResponseCache();
    const big = new Uint8Array(4096);
    let fetches = 0;
    const fetchImpl: FetchLike = async () => {
      fetches += 1;
      return bytesResponse(big);
    };
    const url = 'https://r/big-1.0.0.tgz';
    const opts = { cache: store, maxCacheBytes: 1024 };

    await createRegistry(fetchImpl, 'https://r', opts).tarball(url);
    await createRegistry(fetchImpl, 'https://r', opts).tarball(url);
    expect(fetches).toBe(2); // never stored, so never a hit

    const client = createRegistry(fetchImpl, 'https://r', opts);
    await client.tarball(url);
    expect(client.cacheStats).toMatchObject({ oversize: 1, stores: 0 });
  });

  it('caches nothing when no store is supplied (unchanged behaviour)', async () => {
    let fetches = 0;
    const fetchImpl: FetchLike = async () => {
      fetches += 1;
      return jsonResponse(PACKUMENT);
    };
    await createRegistry(fetchImpl, 'https://r').packument('tiny');
    await createRegistry(fetchImpl, 'https://r').packument('tiny');
    expect(fetches).toBe(2);
    // Without a store nothing is looked up or written.
    expect(createRegistry(fetchImpl, 'https://r').cacheStats).toMatchObject({ hits: 0, misses: 0, stores: 0 });
  });
});

describe('Cache Storage backed store', () => {
  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
  });

  it('round-trips a stored response through a Cache Storage-like API', async () => {
    const store = new Map<string, Response>();
    const fakeCache = {
      async match(key: string) {
        return store.get(key);
      },
      async put(key: string, response: Response) {
        store.set(key, response);
      },
    };
    (globalThis as { caches?: unknown }).caches = {
      open: async () => fakeCache,
    };

    const cache = cacheStorageResponseCache('test-cache');
    const body = encoder.encode('hello');
    await cache.put('k', { status: 200, body, storedAt: 12345 });
    const got = await cache.get('k');
    expect(got).not.toBeNull();
    expect(decoder.decode(got!.body)).toBe('hello');
    expect(got!.status).toBe(200);
    expect(got!.storedAt).toBe(12345);
    // The real Cache Storage API rejects a non-URL request key, so the store must
    // hand it a *valid absolute URL* (a regression guard: a bare `tgz:…` key made
    // every `put` throw and every lookup miss).
    const key = [...store.keys()][0];
    expect(() => new URL(key)).not.toThrow();
    expect(key).toContain('k');
  });

  it('degrades to a no-op when the Cache Storage API is absent', async () => {
    const cache = cacheStorageResponseCache('absent');
    await cache.put('k', { status: 200, body: encoder.encode('x'), storedAt: 1 });
    expect(await cache.get('k')).toBeNull();
  });
});
