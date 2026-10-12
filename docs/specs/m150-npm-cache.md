# M150 — npm registry response cache (P2a)

## Goal

An `npm install` in web-node fetches the packument and every tarball straight
from the registry on each run (~110 requests for the demo vue project). Make a
repeated install — including after a reload — reuse the bytes already received.

## Shape

The cache sits **behind the `FetchLike` seam**, not inside the resolver:

```
resolveInstall() ──► createRegistry(fetchImpl, registry, { cache }) ──► fetchImpl ──► network
                                                   │
                                                   └── cache.get(key) → hit? return stored
```

`createRegistry(fetchImpl, { cache, packumentTtlMs, maxCacheBytes })` consults
the cache before fetching and writes the response back after. Nothing else about
resolution changes; a registry built without `cache` behaves exactly as before.

## Storage backend

`Cache Storage` via `caches.open('web-node-npm')`, falling back to an in-memory
`Map` when the API is absent (`memoryResponseCache`). Bodies are stored as a
`Response`, so the browser owns the bytes; metadata the `Response` cannot carry
(original status text, store time) rides in custom headers.

> **Trap (found only on device, not in units):** the Cache Storage API only
> accepts a *valid absolute URL* as a request key — it rejects a custom scheme
> (`tgz:<url>`, `pkg:<name>`). A rejected `put` threw, and the `try/catch` around
> it swallowed the error, so the cache looked present (`caches.keys()` → the
> name) but was always empty (`0 hit / 110 miss`). Keys are now mapped onto
> `https://web-node-npm.invalid/<encodeURIComponent(key)>`; a unit asserts the
> key parses as a URL.

## Policy

- **packument**: TTL 5 min by default (`packumentTtlMs`); a stale entry refetches.
- **tarball**: never expires (TTL 0) — the URL pins a version, so the bytes are
  immutable.
- **size cap**: a body over `maxCacheBytes` (default 8 MiB) is served but not
  stored (`oversize` in the stats).
- **scope**: one cache per runtime instance (`createNpmResponseCache`), never a
  global singleton — that would leak bytes across runtimes and across tests.

## Evidence

Dev server, real browser:

| install | result |
| --- | --- |
| first | `22457ms` — `0 hit / 110 miss` |
| immediately again | `817ms` — `80 hit / 0 miss` |
| after a reload | `~800ms` — `80 hit / 0 miss` |

`80` is the tarball count; the packument(s) are the misses on the very first run.

Units: `test/npm-cache.test.ts` (7) — second client hits without refetch, TTL
expiry, immutable tarballs, oversize not stored, no store ⇒ no caching at all,
Cache-Storage-like round trip (key asserted to be a URL), absent API ⇒ no-op.
