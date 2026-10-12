/**
 * npm registry client.
 *
 * Talks to the public registry over a `fetch`-shaped function so the client is
 * testable without network access and swappable for a proxied/offline registry.
 * Packuments and tarballs are memoized per client instance, and — when a
 * {@link ResponseCache} is supplied — also persisted across installs and
 * reloads (see `cache.ts`).
 */

import type { ResponseCache, ResponseCacheStats } from './cache';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: unknown },
) => Promise<FetchResponseLike>;

export interface Dist {
  tarball: string;
  integrity?: string;
  shasum?: string;
}

/** The subset of a package `version` document the installer actually reads. */
export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bin?: string | Record<string, string>;
  main?: string;
  type?: string;
  os?: string[];
  cpu?: string[];
  dist: Dist;
}

export interface Packument {
  name: string;
  'dist-tags'?: Record<string, string>;
  versions: Record<string, PackageManifest>;
}

export interface RegistryClient {
  readonly baseUrl: string;
  packument(name: string): Promise<Packument>;
  tarball(url: string): Promise<Uint8Array>;
  /**
   * Cache activity for this client: how many registry round trips were avoided
   * by a cache hit vs. taken (all zero when no cache was supplied).
   */
  readonly cacheStats: ResponseCacheStats;
}

export interface RegistryOptions {
  /** Persistent (or in-session) response cache. Omit to disable caching. */
  cache?: ResponseCache;
  /** How long a packument stays fresh. Tarballs never expire (immutable). */
  packumentTtlMs?: number;
  /** Do not cache a body larger than this (bytes). 0 disables the cap. */
  maxCacheBytes?: number;
  /** Clock, for tests. */
  now?: () => number;
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_PACKUMENT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_BYTES = 8 * 1024 * 1024;

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function createRegistry(
  fetchImpl: FetchLike,
  baseUrl: string = DEFAULT_REGISTRY,
  opts: RegistryOptions = {},
): RegistryClient {
  const base = baseUrl.replace(/\/+$/, '');
  const packuments = new Map<string, Promise<Packument>>();
  const tarballs = new Map<string, Promise<Uint8Array>>();

  const cache = opts.cache;
  const packumentTtlMs = opts.packumentTtlMs ?? DEFAULT_PACKUMENT_TTL_MS;
  const maxCacheBytes = opts.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
  const now = opts.now ?? (() => Date.now());
  const stats: ResponseCacheStats = { hits: 0, misses: 0, stores: 0, oversize: 0 };

  const packumentUrl = (name: string): string => `${base}/${name.replace('/', '%2f')}`;

  /** Read `key` from the cache if present and fresh; count hit/miss. */
  const cacheGet = async (key: string, ttlMs: number): Promise<Uint8Array | null> => {
    if (!cache) return null;
    let stored;
    try {
      stored = await cache.get(key);
    } catch {
      stored = null;
    }
    if (stored && (ttlMs === 0 || now() - stored.storedAt <= ttlMs)) {
      stats.hits += 1;
      return stored.body;
    }
    stats.misses += 1;
    return null;
  };

  const cachePut = async (key: string, body: Uint8Array, status = 200): Promise<void> => {
    if (!cache) return;
    if (maxCacheBytes > 0 && body.length > maxCacheBytes) {
      stats.oversize += 1;
      return;
    }
    try {
      await cache.put(key, { status, body, storedAt: now() });
      stats.stores += 1;
    } catch {
      // A store failure must never fail the install.
    }
  };

  return {
    baseUrl: base,
    cacheStats: stats,

    packument(name: string): Promise<Packument> {
      let pending = packuments.get(name);
      if (pending) return pending;
      pending = (async () => {
        const key = `pkg:${base}/${name}`;
        const hit = await cacheGet(key, packumentTtlMs);
        if (hit) return JSON.parse(decode(hit)) as Packument;
        const res = await fetchImpl(packumentUrl(name), {
          headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
        });
        if (!res.ok) throw new Error(`registry request for "${name}" failed: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
        const body = (await res.json()) as Packument | null;
        if (!body || !body.versions || Object.keys(body.versions).length === 0) {
          throw new Error(`registry returned no versions for "${name}"`);
        }
        await cachePut(key, new TextEncoder().encode(JSON.stringify(body)));
        return body;
      })();
      packuments.set(name, pending);
      return pending;
    },

    tarball(url: string): Promise<Uint8Array> {
      let pending = tarballs.get(url);
      if (pending) return pending;
      pending = (async () => {
        const key = `tgz:${url}`;
        // Tarball URLs pin an exact version, so the bytes never change: cache
        // without expiry (ttl 0 = always fresh).
        const hit = await cacheGet(key, 0);
        if (hit) return hit;
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`tarball download failed: HTTP ${res.status} ${url}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        await cachePut(key, bytes);
        return bytes;
      })();
      tarballs.set(url, pending);
      return pending;
    },
  };
}
