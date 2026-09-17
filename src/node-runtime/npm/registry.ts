/**
 * npm registry client.
 *
 * Talks to the public registry over a `fetch`-shaped function so the client is
 * testable without network access and swappable for a proxied/offline registry.
 * Packuments and tarballs are memoized per client instance.
 */

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
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export function createRegistry(fetchImpl: FetchLike, baseUrl: string = DEFAULT_REGISTRY): RegistryClient {
  const base = baseUrl.replace(/\/+$/, '');
  const packuments = new Map<string, Promise<Packument>>();
  const tarballs = new Map<string, Promise<Uint8Array>>();

  const packumentUrl = (name: string): string => `${base}/${name.replace('/', '%2f')}`;

  return {
    baseUrl: base,

    packument(name: string): Promise<Packument> {
      let pending = packuments.get(name);
      if (pending) return pending;
      pending = (async () => {
        const res = await fetchImpl(packumentUrl(name), {
          headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
        });
        if (!res.ok) throw new Error(`registry request for "${name}" failed: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
        const body = (await res.json()) as Packument | null;
        if (!body || !body.versions || Object.keys(body.versions).length === 0) {
          throw new Error(`registry returned no versions for "${name}"`);
        }
        return body;
      })();
      packuments.set(name, pending);
      return pending;
    },

    tarball(url: string): Promise<Uint8Array> {
      let pending = tarballs.get(url);
      if (pending) return pending;
      pending = (async () => {
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`tarball download failed: HTTP ${res.status} ${url}`);
        return new Uint8Array(await res.arrayBuffer());
      })();
      tarballs.set(url, pending);
      return pending;
    },
  };
}
