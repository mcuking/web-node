# web-node

Run Node.js source code in the browser — a WebContainer-style runtime.

[![live demo](https://img.shields.io/badge/live%20demo-mcuking.github.io%2Fweb--node-5ef1a5)](https://mcuking.github.io/web-node/)

**English** · [简体中文](README_zh.md)

- **Live demo**: <https://mcuking.github.io/web-node/> (install deps, run the
  demo project, hit **⚡ Vite build** — all inside the tab)
- **Dev log / progress / next steps**: [`docs/DEVLOG.md`](docs/DEVLOG.md) ← **append an entry after every change**
- Design doc: [`docs/superpowers/specs/2026-09-17-web-node-design.md`](docs/superpowers/specs/2026-09-17-web-node-design.md)
- Upstream sources: local checkout of Node.js (v26.9.1-dev, `v26.9.0-1-g7a3437d`), vendored via `tools/`

## How it works

WebContainer is **not** Node.js compiled to WASM. The real trick is to run user
code on the browser's own JS engine (no V8 port) and swap only the native /
syscall layer for a virtual one. `internalBinding()` is the single seam, and on
top of it sit three virtual subsystems:

```
┌──────────────────────────────── browser page ────────────────────────────────┐
│                                                                              │
│  UI (file tree / editor / terminal / preview)                                │
│        │                                                                     │
│        ▼                                                                     │
│  RuntimeClient (main thread)  ◄── ServiceWorker bridge (/preview/<port>/…)   │
│        │                                                                     │
│        ▼  postMessage                                                        │
│  Runtime Worker                                                              │
│    Realm ── internalBinding() dispatch ──┬─→ bindings/  (TS shims)           │
│                                          ├─→ builtins/  (node:* modules)     │
│                                          ├─→ VFS        (in-memory + OPFS)   │
│                                          └─→ VirtualNetwork (virtual TCP)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Realm** — the only engine-replacement point: a binding dispatch table plus a
  whitelist of internal bindings.
- **Loader** — CommonJS resolver + ESM→CJS transform, running on vendored real
  Node sources where practical and hand-written TS shims elsewhere.
- **VFS** — an in-memory inode tree as the source of truth, persisted to OPFS
  write-behind (debounced).
- **Virtual network** — a plain-TS port table and duplex byte pipes, exposed to
  the page through a ServiceWorker so `http.createServer().listen(3000)` is
  reachable at a real browser URL.
- **Streams** — `Readable` / `Writable` / `Duplex` / `Transform` / `PassThrough`
  with real backpressure, wired into `fs` and `http`.
- **npm client** — resolves `package.json` ranges against the registry, downloads
  and unpacks tarballs (gzip + tar) into the virtual `node_modules` with npm-style
  hoisting, so `require('pkg')` works with no server. Installs write a
  `package-lock.json` (lockfileVersion 3) that a repeat install reuses without
  re-resolving, verify every tarball against the registry's sha512/sha1 before
  writing it, install missing peer dependencies at the root, and skip
  optional dependencies built for another platform.
- **Build tools** — esbuild (the official WASM build, the same transformer Vite
  uses) runs inside the tab: it compiles TypeScript, bundles a real `node_modules`
  dependency and writes `/project/dist/app.js`. The `browser` field in
  `package.json` is honoured, which is what lets a Node-only `main` resolve to a
  package's browser build.
- **Real bundler** — rollup (its official WASM build) also runs inside the tab: it
  tree-shakes an ES module graph read straight out of the virtual file system and
  writes `/project/dist/app.esm.js`.
- **Vite itself** — the real Vite (v5) runs inside the tab. Vite is pure ESM and
  reaches for the *native* esbuild addon; the runtime aliases
  `esbuild`→`esbuild-wasm` and `rollup`→`@rollup/wasm-node`, so Vite boots on the
  virtual file system and produces a real production bundle
  (`site/dist/index.html` + `site/dist/assets/*.js`) — no server, no Node process.
- **Vite's dev server** — `createServer()` + `listen()` also boot in the tab,
  binding a virtual port and transforming modules on demand. The preview bridge
  routes the browser's absolute-path assets back to the virtual port, so the dev
  app renders in the Preview tab. **HMR** rides a `BroadcastChannel` (a
  ServiceWorker cannot proxy the WebSocket), so edits hot-update in place.

## Development

> ⚠️ Use an independent Node from fnm (v26.9.0, which matches the version the
> upstream sources are vendored from; v22.19.0 is also installed) — not the host
> app's bundled Electron Node. The Electron Node makes rollup's native module
> fail `dlopen` with a code-signing error.

```bash
export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v26.9.0/installation/bin:$PATH"

npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm run vendor     # re-vendor files from the Node.js sources
```

### Deploying (GitHub Pages)

Pages serves a project site from a sub-path, so the build takes a base path and
the script publishes it to a `gh-pages` branch (no Actions needed):

```bash
npm run deploy     # = BASE_PATH=/web-node/ tools/deploy-pages.sh
```

The site is then live at <https://mcuking.github.io/web-node/>.

## Layout

```
src/
  node-runtime/   Runtime core: realm (binding dispatch) / loader / runtime
    bindings/     TS implementations of internalBinding
    builtins/     node:* module implementations (real sources + TS shims)
    loader/       CJS resolver + ESM→CJS transform
    net/          Virtual TCP (VirtualNetwork / VirtualSocket)
    vfs/          Virtual file system (in-memory tree + OPFS persistence)
    npm/          npm client (semver / registry / tarball / installer)
  worker/         Dedicated Worker entry
  client/         Main-thread Runtime Client API (incl. ServiceWorker bridge)
  ui/             Demo UI (file tree / editor / terminal / preview)
public/sw.js      ServiceWorker: /preview/<port>/ → virtual network
vendor/node-lib/  Real files copied from the Node.js sources (with MANIFEST.json)
tools/            Dependency scan / vendoring tools
docs/             Design doc + dev log
test/             Vitest unit / integration tests
```

## Networking (M3)

Once `http.createServer().listen(3000)` is called, open the **Preview** tab in
the UI, or visit `/preview/3000/`:

```
browser URL → ServiceWorker → main thread → runtime worker → VirtualNetwork → your handler
```

Known MVP limits: on the **dev server** each preview gets its own origin,
`<port>.localhost`, so absolute paths, cookies and storage behave like a real
host (a small middleware serves a bootstrap shell that relays the subdomain's
requests back to the main origin, where the single runtime/VFS/OPFS live). A
static host has no `*.localhost` wildcard, so builds, `vite preview` and GitHub
Pages fall back to a `/preview/<port>/` path prefix, where absolute-path assets
(`/app.js`) land outside the prefix (HTML responses get a `<base>` tag injected
to fix *relative* paths).

Connections are persistent (HTTP/1.1 keep-alive) with pipelining on the server
side and a per-port client connection pool. Responses stream all the way: the
ServiceWorker hands the browser a `ReadableStream`, so `res.write()` / SSE /
large downloads arrive incrementally instead of as one blob (HTML is buffered
so the `<base>` tag can be injected). `https` is provided as the `http` surface
under a TLS-shaped name — the virtual network has no TLS.

## Streams

`req` is a `Readable` and `res` is a `Writable`, so the usual patterns just work:

```js
const fs = require('fs');
const { Transform, pipeline } = require('stream');

// 1) Stream a file straight to the response (no Content-Length → chunked framing)
http.createServer((req, res) => fs.createReadStream('/project/a.txt').pipe(res));

// 2) Stream a request body to disk
http.createServer((req, res) => {
  const out = fs.createWriteStream('/project/upload.txt');
  req.pipe(out);
  out.on('finish', () => res.end('saved ' + out.bytesWritten));
});

// 3) A three-stage chain with real backpressure
pipeline(fs.createReadStream('/project/a.txt'), new Transform({
  transform: (c, e, cb) => cb(null, c.toString().toUpperCase()),
}), fs.createWriteStream('/project/a-upper.txt'));
```

`Readable` / `Writable` / `Duplex` / `Transform` / `PassThrough`, `pipe()`,
`pipeline()`, `finished()`, `stream/promises`, and `fs.createReadStream` /
`fs.createWriteStream` are all implemented. `write()`/`push()` return `false`
above the high-water mark and emit `'drain'` once the buffer empties, so
backpressure propagates for real instead of buffering whole bodies in memory.

The whole `stream` module is Node's own source (`lib/stream.js` plus the
`internal/streams/*` internals) — `Readable`, `Writable`, `Duplex`, `Transform`,
`PassThrough`, `pipeline`, `finished`, `compose`, `duplexPair`, the async
operators (`map`/`filter`/`toArray`) and `stream/promises`. There is no
hand-written stream left. Several other pieces of Node's own core are vendored
and executed as-is (`events.js`, and in the stream layer `internal/streams/`
`state.js`, `from.js`, `utils.js`, `destroy.js`, `end-of-stream.js`,
`add-abort-signal.js`): the real `EventEmitter` (its `_events` shape,
`prependListener`, `errorMonitor`, `captureRejections`), the default high-water
marks, `Readable.from`, the
`isReadable`/`isWritable`/`isDisturbed`/`isErrored`/`isDestroyed` predicates,
the `destroy()` / `_undestroy()` lifecycle, `finished()` / `eos()`, and
`addAbortSignal()`.
`destroy(err)` therefore emits `error` then `close` on the next tick, and
`finished()` is the real end-of-stream: it takes the options object
(`readable`/`writable` overrides, an `AbortSignal` → `AbortError`) and rejects a
`close` that beats the writable half with `ERR_STREAM_PREMATURE_CLOSE`.

## npm

Hit **Install deps** and the client resolves your `package.json` dependencies
against the npm registry, downloads each tarball, gunzips + untars it into the
virtual `node_modules` (hoisting to the top level, nesting only on a version
conflict), after which a normal `require` picks it up:

```js
const ms = require('ms');
ms(60000); // '1m'
```

Not yet: `file:` / `git+` / `link:` specifiers. Lifecycle scripts and `.bin`
shims run against the runtime's own `child_process` surface (milestone 7).

## Build tools (M5)

Hit **Build** and the real esbuild — its official WASM build, the same
transformer Vite uses internally — runs inside the tab. It `require`s
`esbuild-wasm` (resolved to the self-contained browser build through the
`browser` field), initializes from the `esbuild.wasm` in the virtual file
system, then bundles `src/app.ts` (TypeScript plus a real `node_modules`
dependency) through a VFS plugin and writes `/project/dist/app.js`:

```
tool        : esbuild-wasm v0.28.2 (13.3 MB wasm)
wasm        : compiled + service started in 37ms
bundle      : 5138 bytes in 116ms
written     : /project/dist/app.js
```

Two runtime features were added to make this work: the `package.json`
**`browser` field** (string and object forms, `false` → empty module) and a
module-level **`require.resolve()`**.

### Bundling with rollup (M5b)

Hit **Bundle** and rollup — its official WASM build — bundles the project's ES
modules straight out of the virtual file system (no plugin needed: our `fs` *is*
the VFS) and writes `/project/dist/app.esm.js`:

```
tool        : rollup v4.63.3 (official WASM build)
bundle      : 339 bytes in 13ms
tree-shaken : yes (dead export dropped)
written     : /project/dist/app.esm.js
```

Vite / webpack themselves were the next step — and Vite now works (M5c):

### Building with Vite (M5c)

Hit **⚡ Vite build** and the *real* Vite (v5) bundles `site/` inside the tab.
Vite is pure ESM and `import`s the native esbuild addon, so the runtime aliases
`esbuild`→`esbuild-wasm` and `rollup`→`@rollup/wasm-node`; the WASM esbuild is
started explicitly, then `vite.build()` runs entirely on the virtual file
system:

```
tool        : vite v5.4.21 (running in the tab)
esbuild     : wasm started in 33ms
built in    : 148ms
written     : /project/site/dist/
  assets/index-DTtKUl1f.js
  index.html
```

Making this work meant rewriting the ESM→CJS transform as a scanner over
top-level statements (multi-line imports, template literals, regex-vs-division,
dynamic `import()`), plus support for `PathLike` arguments,
`createRequire(...).resolve`, Node's `events` module identity, and `crypto`.

Note Vite 8 moved to rolldown (a native Rust binary), so a browser build pins
Vite 5.x.

### Running Vite's dev server (M5d–M5e)

Hit **🛠 Vite dev** and the real Vite dev server boots inside the tab:
`createServer()` binds a virtual port (5173) and transforms modules *on demand*,
exactly as it would in Node. Open the **Preview** tab (`:5173`) and the page
renders — served entirely from the virtual file system.

```
tool        : vite v5.4.21 dev server (in the tab)
esbuild     : wasm started in 38ms
listening   : http://127.0.0.1:5173
```

Two things had to be added: a loopback-only **`dns`** builtin (Vite's
`buildStart` resolves `localhost`) and a real EventEmitter `process.stdin`
(its `close()` removes a SIGTERM listener). The preview bridge also learned to
route a browser's **absolute-path** assets (`/@vite/client`, chained imports)
back to the right virtual port, by remembering `clientId → port` — a Service
Worker sees one client id for a document and all its subresources.

**HMR works, over a non-WebSocket channel.** The HMR socket is a WebSocket, and
a ServiceWorker cannot proxy an upgrade, so the browser can never reach it
through the preview bridge. The preview iframe is same-origin, though, so the
ServiceWorker injects a `WebSocket` shim that diverts Vite's HMR socket to a
`BroadcastChannel` (keyed off the `vite-hmr` subprotocol, since an https page can
send its first attempt to the page origin rather than loopback). The channel is
scoped to the virtual port (`web-node-hmr:<port>`), so two dev servers never see
each other's clients; a `<port>.localhost` preview is a *different origin* and
cannot hear the channel at all, so its shim relays through the top-level page,
which shares the runtime's origin. The runtime hands Vite an HMR server object
that `send()`s over that channel instead of a socket. Vite still computes every
update — we only carry it. A small Vite plugin turns VFS change events into Vite
watcher events (there is no inotify in a tab), so editing a source file triggers
a real update: hit **✏️ HMR JS** (a `js-update`) or **🎨 HMR CSS** (a
`css-update`) and the preview updates in place, no reload.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M1 | Pure-JS runtime layer (realm / bindings / module loader) | ✅ Done |
| M2 | Virtual file system (in-memory tree + OPFS persistence) | ✅ Done |
| M3 | Networking (virtual TCP + ServiceWorker bridge + preview) | ✅ Done (basic) |
| S | Streams foundation (`Readable`/`Writable`/`pipe`/backpressure + chunked) | ✅ Done |
| M4 | npm client (registry + tarball + `node_modules`) | ✅ Done |
| M3.5a | Keep-alive (persistent connections + pipelining + client pool) | ✅ Done |
| M3.5b | Real browser-side streaming (SW relays a `ReadableStream`) | ✅ Done |
| M3.5c | `https` (the `http` surface under a TLS-shaped name) | ✅ Done |
| M3.5d | Subdomain routing (`<port>.localhost`) | ✅ Done (dev server) |
| M5 | Real build tool — esbuild WASM: install, initialize, bundle, write back | ✅ Done |
| M5b | Real bundler — rollup WASM: ESM graph, tree-shaking, write to VFS | ✅ Done |
| M5c | Real build toolchain — Vite in the tab: production bundle to VFS | ✅ Done |
| M5d | Vite dev server in the tab (on-demand transforms + preview) | ✅ Done |
| M5e | Vite HMR in the tab (over BroadcastChannel, not a WebSocket) | ✅ Done |
| M5f | HMR wrap-up — CSS `css-update` + per-port channel isolation | ✅ Done |
| M6 | npm wrap-up — `package-lock.json`, integrity checks, peer auto-install | ✅ Done |
| M7 | `child_process` + a controlled spawn surface (fork/exec/spawn + mini-shell) | ✅ Done |
| M7 | npm `.bin` shims + lifecycle scripts (JS shims, dep and root scripts) | ✅ Done |
| M8 | Stream wrap-up — byte-exact `read(n)`, objectMode split, `autoDestroy` | ✅ Done |
| M9 | Buffer shared memory — `slice`/`subarray`, `from(ArrayBuffer)` views | ✅ Done |
| M10 | Wider vendoring — real `internal/streams/state.js` drives the high-water marks | ✅ Done |
| M11 | Fix stream core bugs (sync push recursion, async-iter error) + real `Readable.from` | ✅ Done |
| M12 | Align the stream state shape (`_readableState`/`_writableState`) + real predicates | ✅ Done |
| M13 | Vendor `internal/streams/destroy.js` (real `destroy`/`_undestroy` + `[kState]` bits) and run `finished()` on the real predicates | ✅ Done |
| M14 | Vendor `internal/streams/end-of-stream.js` — `finished()`/`eos()` are the real source, options + AbortSignal included | ✅ Done |
| M15 | Vendor Node's real `events.js` (replacing the custom EventEmitter) + the real `stream.addAbortSignal` | ✅ Done |
| M16 | The whole `stream` module is Node's real source (`lib/stream.js` + `internal/streams/*`): Writable/Duplex/Transform/PassThrough/pipeline/compose/duplexPair/operators + `stream/promises`; the hand-written stream is gone | ✅ Done |
| M17 | Real `async_hooks` — `lib/async_hooks.js` + `internal/async_hooks.js` + `internal/async_local_storage/*` on a JS `async_wrap` binding; tick/timer are real async resources, so hooks fire and `AsyncLocalStorage` carries a store across async edges | ✅ Done |
| M18 | Real framework — `@vitejs/plugin-vue` compiles a **Vue 3 SFC** in the tab; `vite build` emits a production Vue bundle and the dev server serves a live, interactive app (HMR included) | ✅ Done |
| M19 | More vendored source — real `punycode.js`, `domain.js` and `diagnostics_channel.js` (over the real `async_hooks`, on a small JS binding) | ✅ Done |

## Vendored Node source

Where a module in Node's `lib/` is reusable as-is, we take it verbatim (content
hash + upstream revision recorded in `vendor/node-lib/MANIFEST.json`) instead of
reimplementing it. `npm run vendor` re-generates that tree from a local Node
checkout; every patch we do apply is listed in the manifest's `patches` field.

The tree on disk is pristine; what the *bundle* ships is comment-stripped by a
build-time plugin (`plugins/vendored-source.ts`). Node's `lib/` is heavily
documented (~23% comments) and the sources reach the bundle as raw strings that
the minifier cannot touch. The stripper removes comments while keeping **line
numbers and code columns intact** (so stack traces still point at real lines)
and keeps each file's MIT header; the worker bundle drops from 1259 KB to
1028 KB (**315 → 237 KB gzipped**).

**Current coverage** (revision `7a3437d`, v26.9.1-dev):

- **83 files vendored** — the whole `stream` layer, `events`,
  `internal/event_target` (+ `internal/webidl`, `internal/perf/utils`),
  `internal/abort_controller`, `console` (+ `internal/console/*`,
  `internal/cli_table`, `internal/util/debuglog`, `internal/trace_events`,
  `internal/readline/*`), `os`,
  `timers` (+ `internal/timers`, `timers/promises`, `internal/linkedlist`,
  `internal/priority_queue`),
  `internal/worker/io` (+ `internal/per_context/messageport`,
  `internal/worker/js_transferable`) — a real `MessageChannel` / `MessagePort` /
  `BroadcastChannel`, on a JS reimplementation of the `messaging` binding,
  `readline` (+ `readline/promises`, `internal/readline/*`, `internal/repl/history`)
  — a real line editor, keypress decoder, ANSI cursor writers and history ring,
  on plain streams rather than a TTY,
  `async_hooks`
  (+ `internal/async_local_storage/*`, `internal/promise_hooks`), `path`,
  `querystring`, `punycode`, `domain`, `diagnostics_channel`, `string_decoder`,
  `assert` (+ `internal/assert/*`), `internal/validators`,
  `internal/fs/glob` (+ the bundled `internal/deps/minimatch/index`) — the real
  glob walker and pattern matcher, so `path.matchesGlob`, `fs.glob`, `fs.globSync`
  and `fs.promises.glob` work,
  `internal/util/types`, `internal/util/inspect` (the real `util.inspect`),
  `internal/util/comparisons` (the real `isDeepStrictEqual`),
  `internal/util/colors`, `util` (+ `internal/util.js`, `internal/util/diff`,
  `internal/util/parse_args/*`), `internal/mime`, and the `internal/*` pieces
  they need (`primordials`, `fixed_queue`, `constants`, `encoding/util`,
  `streams/state`, `streams/destroy`, `per_context/*`, …).
- **29 of the 58 top-level `lib/*.js` modules are provided** — either as
  vendored source, or by our own implementation where the real file needs a
  native layer that cannot exist in a tab. `crypto` is the newest of these: the
  WebCrypto API is promise-only, but Node's `createHash` / `createHmac` /
  `pbkdf2Sync` / `scryptSync` are synchronous, so MD5, SHA-1, SHA-2
  (224/256/384/512), HMAC, PBKDF2, HKDF and scrypt are implemented in plain JS
  in `src/node-runtime/crypto/hash.ts` and checked against Node's OpenSSL
  output. Ciphers, signatures and key objects stay explicitly unsupported.

### What can and cannot be moved over

Node's `lib/` has ~420 `.js` files. Moving "all of them" is not a copy job: the
large majority sit directly on native bindings (V8 C++ APIs, libuv handles, raw
sockets, native addons, the module loader) that have no browser equivalent. So
the rule is: **vendor the pure-JS layers verbatim, and reimplement only the
native layer underneath them in JS** — exactly what `async_wrap` does for
`async_hooks` and what the JS `string_decoder` binding does for the real
decoder (`src/string_decoder.cc` ported to `bindings/string_decoder.ts`). A file
is vendorable when its only dependencies are shims we already provide;
everything else is a binding away.

The remaining large gaps are the ones with no browser story at all (`http2`,
`dgram`, `tls`/`_tls_*`, `cluster`, the thread-spawning half of
`worker_threads`, `inspector`, `repl`, `vm`/`wasi`, `sqlite`, `sea`), plus
native-layer reimplementations worth doing (`internal/util/inspect.js`, the
native `string_decoder`, `internal/fs/*`).

## Contributing

1. Run `npm run typecheck && npm test` and keep both green.
2. The browser verification checklist lives at the top of `docs/DEVLOG.md`.
3. Append a change record to `docs/DEVLOG.md` (what changed / why / files touched).
