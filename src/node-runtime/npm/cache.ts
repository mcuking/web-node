/**
 * A persistent response cache for the npm registry client.
 *
 * npm install is dominated by network round trips: one packument (metadata)
 * fetch per package, then one tarball fetch per package. Everything else — the
 * semver resolution, the hoisting — is cheap and CPU-bound. So a repeat install,
 * or an `npm install <pkg>` on top of an existing tree, re-downloads bytes that
 * have not changed.
 *
 * This cache removes those round trips and, being persistent, survives a reload
 * (the runtime worker is recreated on every page load):
 *
 *  - **Metadata** (packuments) can move — a dist-tag points somewhere else
 *    tomorrow — so entries expire after a short TTL.
 *  - **Tarballs** are immutable: the URL pins an exact version, so the bytes at
 *    that URL never change. They are cached without expiry.
 *
 * The store is the **Cache Storage API** (`caches`) when available: it is the
 * place the platform provides for HTTP responses, it persists across reloads,
 * it is scoped to the runtime's origin (so all projects share it), and it does
 * not mix cached bytes into the user's project tree or its OPFS snapshot. A
 * memory store is used otherwise, so the cache still helps within a session and
 * the code is testable without a browser.
 */

/** A response captured for later replay, with the time it was stored. */
export interface StoredResponse {
  status: number;
  statusText?: string;
  body: Uint8Array;
  /** `Date.now()` at store time, for TTL checks. */
  storedAt: number;
}

export interface ResponseCacheStats {
  hits: number;
  misses: number;
  /** Entries written on a miss. */
  stores: number;
  /** Bodies too large to cache (served, but not stored). */
  oversize: number;
}

/** A key/value store for captured responses. */
export interface ResponseCache {
  get(key: string): Promise<StoredResponse | null>;
  put(key: string, value: StoredResponse): Promise<void>;
  readonly stats: ResponseCacheStats;
}

/** In-memory store: helps within a session, and backs tests. */
export function memoryResponseCache(): ResponseCache {
  const entries = new Map<string, StoredResponse>();
  const stats: ResponseCacheStats = { hits: 0, misses: 0, stores: 0, oversize: 0 };
  return {
    stats,
    async get(key) {
      return entries.get(key) ?? null;
    },
    async put(key, value) {
      entries.set(key, value);
    },
  };
}

/** The minimal slice of the Cache Storage API this uses. */
interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

function cacheStorage(): CacheStorageLike | null {
  const c = (globalThis as { caches?: CacheStorageLike }).caches;
  return c && typeof c.open === 'function' ? c : null;
}

/**
 * The Cache Storage API only accepts a *valid absolute URL* as a request key
 * (it cannot cache a custom scheme), so a logical cache key is mapped onto a
 * synthetic https URL. It is opaque — nothing ever fetches it — it just has to
 * be stable and unique. Keys can be long (a tarball URL), so the URL is
 * percent-encoded into a single path segment.
 */
function toRequestUrl(key: string): string {
  return `https://web-node-npm.invalid/${encodeURIComponent(key)}`;
}

/**
 * A {@link ResponseCache} backed by the platform Cache Storage API. Bodies are
 * stored as a `Response` so the browser manages the bytes; the metadata that
 * `Response` cannot carry (the original status text, the store time) rides in
 * custom headers.
 */
export function cacheStorageResponseCache(name = 'web-node-npm'): ResponseCache {
  const stats: ResponseCacheStats = { hits: 0, misses: 0, stores: 0, oversize: 0 };
  let opened: Promise<CacheLike | null> | null = null;
  const cache = (): Promise<CacheLike | null> => {
    if (!opened) {
      const store = cacheStorage();
      opened = store ? store.open(name).catch(() => null) : Promise.resolve(null);
    }
    return opened;
  };
  return {
    stats,
    async get(key) {
      const c = await cache();
      if (!c) return null;
      try {
        const res = await c.match(toRequestUrl(key));
        if (!res) return null;
        const body = new Uint8Array(await res.arrayBuffer());
        return {
          status: res.status,
          statusText: res.headers.get('x-wn-status-text') ?? undefined,
          body,
          storedAt: Number(res.headers.get('x-wn-stored-at') ?? '0'),
        };
      } catch {
        return null;
      }
    },
    async put(key, value) {
      const c = await cache();
      if (!c) return;
      try {
        await c.put(
          toRequestUrl(key),
          new Response(value.body as unknown as BodyInit, {
            status: value.status,
            statusText: value.statusText,
            headers: { 'x-wn-stored-at': String(value.storedAt) },
          }),
        );
      } catch {
        // Quota exceeded or an opaque/uncacheable response — the install still
        // succeeds, it just refetches next time.
      }
    },
  };
}

/**
 * The cache a runtime uses: Cache Storage when the platform has it (persistent,
 * and shared across runtime instances by name, so it survives a reload), else a
 * memory store for the lifetime of the instance. Built per runtime rather than
 * once globally so two independent runtimes cannot see each other's entries.
 */
export function createNpmResponseCache(): ResponseCache {
  return cacheStorage() ? cacheStorageResponseCache() : memoryResponseCache();
}
