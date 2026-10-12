# M149 — Runtime isolation: user code on its own origin

## Goal

Move the runtime — the realm that **executes user code** and owns the project
OPFS — off the app shell's own origin and onto an **independent origin**, so
untrusted code can no longer reach the shell's cookies, storage or credentials.
This mirrors WebContainer, which runs the workbench in a `credentialless` iframe
on `*.webcontainer-api.io`.

Before M149 the runtime worker (and therefore the OPFS holding every project)
lived on the app's origin; a project's `index.js` was same-origin with the page
that holds the user's session.

## Shape

```
app shell (origin A) ⇄ [runtime host frame (origin B)] ⇄ runtime worker (origin B)
```

The host frame is a **transparent pipe**: it relays the worker request/response
messages verbatim (it never inspects the payload) and, separately, relays HMR
frames — which travel on a `BroadcastChannel` scoped to the *runtime's* origin
and are therefore invisible to the app shell.

## Pieces

- `src/ui/runtime-host-url.ts` — a pure decision (unit-tested) of where the host
  lives: `rt.localhost:<devport>` under the dev server on loopback; `rt.<domain>`
  when `VITE_WEB_NODE_RUNTIME_DOMAIN` (or the preview domain) is configured;
  **null** otherwise (a sub-path deploy like GitHub Pages has no wildcard DNS) —
  and then the runtime honestly stays on the app origin.
- `src/runtime-host-protocol.ts` — the bridge protocol
  (`boot`/`post`/`terminate`/`hmr` ↔ `up`/`data`/`error`/`hmr`), every message
  tagged `__wnHost` so it cannot be confused with the preview iframe's own
  `__wnHmr` traffic.
- `src/ui/runtime-host.ts` + `runtime-host.html` — the frame shell. Workers are
  created lazily by name (`''` shared, `web-node-build` throwaway); before any is
  created it makes *itself* cross-origin isolated (registering `sw.js` so a
  static host that cannot send COOP/COEP still works, reloading at most a few
  times, then degrading).
- `src/client/transport.ts` — `RuntimeTransport` (`post`/`onData`/`onError`/
  `terminate`); `WorkerTransport` is the pre-M149 same-origin path (kept as the
  no-host fallback); `RuntimeHostBridge` owns the frame and mints one
  `FrameTransport` per worker name; `FrameTransport` buffers until the frame is
  up, then sends `boot` before flushing (ordering holds on the
  source→target queue).
- `src/client/index.ts` — `RuntimeClient` now obtains its transport from a
  `TransportFactory` (sync or async; pre-attach messages are queued). Everything
  else is unchanged.
- `src/ui/main.ts`, `vite.config.ts`, `public/sw.js`,
  `plugins/dev-subdomains.ts` — wiring, the second HTML entry, and switching dev
  COEP from `require-corp` to `credentialless`.

## The gotcha (found by live repro)

A cross-origin child frame **does not inherit** the parent's *restricted*
cross-origin isolation from COEP alone. The `<iframe>` must additionally delegate
the **Permissions-Policy** feature `cross-origin-isolated`
(`allow="cross-origin-isolated"`). Minimal repro: parent COI=true; four
COEP/COOP/`credentialless` combinations all report `coi:false` **without** the
`allow` attribute, and all report `coi:true` (frame *and* worker) **with** it.
Confirmed on both the real Chrome build and the in-app browser.

## Out of scope

- Sub-path deploys (GitHub Pages) keep the runtime on the app origin; there is no
  wildcard DNS there. They keep the prior SW-header isolation.
- The preview iframe is marked `credentialless` too (its dev-server output is
  potentially third-party), but it stays on the preview subdomain as before.

## Correction (M149.1): the frame must **not** be `credentialless`

Marking the host frame `credentialless` — as the original design did, mirroring
WebContainer — gave it an **ephemeral storage partition**. The runtime owns the
project OPFS, so every reload discarded every project (the boot banner went back
to "fresh project").

Minimal repro (a cross-origin parent embedding a child that writes an OPFS
marker, then reloaded): with `credentialless` the child reads `prev = null`
every load; with a **plain cross-origin** frame that carries CORP it reads the
previous marker back. So the fix keeps the independent origin (the frame still
cannot reach the shell's cookies/storage/credentials) but **drops the
`credentialless` attribute**; `allow="cross-origin-isolated"` stays (the
delegation above is still required).

A second, related fix: the host document needs `Cross-Origin-Resource-Policy` to
be treated as cross-origin isolated when embedded. Dev adds it in
`plugins/dev-subdomains.ts`; `public/sw.js` (`withIsolationHeaders`) adds it for
`/runtime-host.html` on a static wildcard host. Both add it **only when absent**,
never overwriting a host's own header.

After the fix: the facts line reads `runtime: isolated origin`, the frame reports
`crossOriginIsolated = true` **and** its OPFS marker survives a reload;
install / run / preview / HMR all pass.
