# web-node

Run Node.js source code in the browser — a WebContainer-style runtime.

[![live demo](https://img.shields.io/badge/live%20demo-mcuking.github.io%2Fweb--node-5ef1a5)](https://mcuking.github.io/web-node/)

**English** · [简体中文](README_zh.md)

- **Live demo**: <https://mcuking.github.io/web-node/> — pick a project (**Vite** / **Webpack** / **Rspack** / **Node.js**), then **⬇ Install deps** → **▶ Run dev** and/or **⚙ Run build**, all inside the tab
- **Dev log / progress / next steps**: [`docs/DEVLOG.md`](docs/DEVLOG.md) ← **append an entry after every change**
- Design docs: [`docs/superpowers/specs/2026-09-17-web-node-design.md`](docs/superpowers/specs/2026-09-17-web-node-design.md) and [`docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`](docs/superpowers/specs/2026-09-23-native-to-wasm-design.md)
- Upstream sources: local checkout of Node.js (v26.9.1-dev, `v26.9.0-1-g7a3437d`), vendored via `tools/`

## How it works

WebContainer is **not** Node.js compiled to WASM. The real trick is to run user
code on the browser's own JS engine (no V8 port) and swap only the native /
syscall layer for a virtual one. `internalBinding()` is the single seam, and on
top of it sit a handful of virtual subsystems:

```
┌──────────────────────────────── browser page ────────────────────────────────┐
│                                                                              │
│  UI (project stepper / file tree / editor / terminal / preview)              │
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
- **Virtual network (inbound)** — a plain-TS port table and duplex byte pipes,
  exposed to the page through a ServiceWorker so `http.createServer().listen(3000)`
  is reachable at a real browser URL.
- **Outbound network (egress)** — a `fetch`-backed `Egress`: a non-loopback
  `http(s)` request is serialised and executed with the host's `fetch` (an
  optional proxy catches a blocked direct call), then re-framed through the same
  HTTP parser, so `https.get('https://…')` works. `net.connect` to a non-loopback
  host without a TCP bridge fails honestly with `ECONNREFUSED` rather than hanging
  or faking it (M122).
- **Streams** — `Readable` / `Writable` / `Duplex` / `Transform` / `PassThrough`
  with real backpressure, wired into `fs` and `http`.
- **npm client** — resolves `package.json` ranges against the registry, downloads
  and unpacks tarballs (gzip + tar) into the virtual `node_modules` with npm-style
  hoisting, so `require('pkg')` works with no server. Installs write a
  `package-lock.json` (lockfileVersion 3) that a repeat install reuses without
  re-resolving, verify every tarball against the registry's sha512/sha1 before
  writing it, install missing peer dependencies at the root, and skip
  optional dependencies built for another platform. A root `overrides` (or yarn
  `resolutions`) table pins a transitive dependency's version, `file:`/`link:`
  specifiers install a package straight out of the virtual file system, tarballs
  download with bounded concurrency, and you can also **add a package to an
  existing project on demand** — `npm install <spec>` from the UI (M142).
- **Build tools** — esbuild (the official WASM build, the same transformer Vite
  uses) runs inside the tab: it compiles TypeScript, bundles a real `node_modules`
  dependency and writes `/project/dist/app.js`.
- **Real bundlers** — rollup (its official WASM build) tree-shakes an ES module
  graph read straight out of the virtual file system; **webpack 5** and
  **rspack 2.2.7** run real production builds in the tab (see *Build tools*).
- **Vite itself** — the real Vite (v5) runs inside the tab. Vite is pure ESM and
  reaches for the *native* esbuild addon; the runtime aliases
  `esbuild`→`esbuild-wasm` and `rollup`→`@rollup/wasm-node`, so Vite boots on the
  virtual file system and produces a real production bundle.
- **Vite's dev server** — `createServer()` + `listen()` also boot in the tab,
  binding a virtual port and transforming modules on demand. **HMR** rides a
  `BroadcastChannel` (a ServiceWorker cannot proxy the WebSocket), so edits
  hot-update in place.
- **Processes and cluster** — `fork()` starts a module as a real second module
  registry with an IPC channel; `cluster` forks one runtime worker per child and
  round-robins a shared port on the virtual network (M123).
- **Native layer → WASM** — a tab has no native addons and no `dlopen`, so where
  a core module's real implementation sits on a C/C++ library, that **upstream
  library is compiled to WASM** (see below) instead of being reimplemented.
  Those modules are *real*, not stubs: `zlib` (+ brotli/zstd), `perf_hooks`
  histograms, and the whole `crypto` surface (OpenSSL).

## Native layer → WASM

A browser tab has no native addons and no `dlopen`, and the previous milestones
proved that hand-written JS stand-ins for compression / crypto eventually hit a
correctness wall. So the rule for the native layer changed: **compile the real
upstream C/C++ to WASM** with `wasi-sdk`, don't rewrite it. The artefacts are
committed under `src/node-runtime/wasm/artifacts/` and registered in
`src/node-runtime/wasm/index.ts` (imported with `?url`, so Vite emits them as
content-hashed `assets/`). Loading is layered, per M107: the small codec modules
(`wn_stub`, `wn_zlib`) are awaited at startup before the Realm is built (the
binding table is synchronous, so anything a binding needs at build time must be
ready), the heavier codecs (`wn_histogram`, `wn_brotli`, `wn_zstd`) are fetched
in the background at boot but awaited before any user code runs, and the ~2.4 MB
OpenSSL subset is loaded lazily on first use (`wasm/lazy.ts`, gated by
`opensslReady()`), falling back to the JS path if it never arrives.

`native/build.mjs` drives the build (`npm run build:native`): each module lists
its sources, the toolchain targets **`wasm32-wasip1`** with the **reactor** model
(`-mexec-model=reactor -Wl,--no-entry`, calling `_initialize` once after
instantiation), and exports exactly the symbols declared with
`__attribute__((export_name(…), used))` — never `--export-all` (it leaks libc
symbols). A minimal WASI host (`src/node-runtime/wasm/wasi.ts`) backs the
`wasi_snapshot_preview1` imports (clock → `performance.now()`, random →
`crypto.getRandomValues`, writes to fd default to a sink).

| module | upstream | serves | size | milestone |
| --- | --- | --- | --- | --- |
| `wn_stub` | hand-written C stub (smoke test) | the toolchain→binding seam | 46.5 KB | M115 |
| `wn_zlib` | `deps/zlib` 1.3.2.1-motley (11 `.c`) | `zlib` binding | 108.8 KB | M116 |
| `wn_histogram` | `deps/histogram` (hdr_histogram) + ported `src/histogram.cc` | `performance` binding | 257.7 KB | M117 |
| `wn_brotli` | `deps/brotli` 1.2.0 (36 `.c`) | `zlib` binding (brotli half) | 847.4 KB | M118 |
| `wn_zstd` | `deps/zstd` 1.5.7 (27 `.c`, single-threaded) | `zlib` binding (zstd half) | 484.0 KB | M118 |
| `wn_openssl` | `deps/openssl` 3.5.8 subset (self-contained WASI target) | `crypto` module (TS drives it directly, not a binding) | 2483.2 KB | M119 |

> The design note for this phase (native → WASM) lives at
> [`docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`](docs/superpowers/specs/2026-09-23-native-to-wasm-design.md).

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
npm run build:native  # rebuild the WASM artefacts (needs wasi-sdk)
npm run vendor     # re-vendor files from the Node.js sources
```

### Deploying (GitHub Pages)

Pages serves a project site from a sub-path, so the build takes a base path and
the script publishes it to a `gh-pages` branch (no Actions needed):

```bash
npm run deploy     # = BASE_PATH=/web-node/ tools/deploy-pages.sh
```

The site is then live at <https://mcuking.github.io/web-node/>.

## The demo

The demo is a small IDE. Its top row switches between **four self-contained
projects**, and the second row runs the current project's steps:

| project | stack | steps | port |
| --- | --- | --- | --- |
| **Vite** | Vue 3 SFC, real Vite v5 | **▶ Run dev** (HMR) · **⚙ Run build** | 5173 |
| **Webpack** | React, real webpack 5 + JSX loader | **▶ Run dev** (watch + full-reload) · **⚙ Run build** | 5174 |
| **Rspack** | React, real rspack 2.2.7 + swc loader | **▶ Run dev** · **⚙ Run build** | 5175 |
| **Node.js** | plain `node index.js` (HTTP server) | **▶ Run** | 3000 |

Every project installs its own `node_modules`, runs in the tab, and shows its
output in the terminal / preview. A **+ New project** chip scaffolds a fresh
project from any template onto its own port (M134); the file tree is editable —
create / rename / delete files and folders, inline (M135–M136). Switching
projects clears the terminal and preview and releases the previous project's
file bodies from memory while keeping its bytes on disk (M133).

## Layout

```
src/
  node-runtime/   Runtime core: realm (binding dispatch) / loader / runtime
    bindings/     TS implementations of internalBinding
    builtins/     node:* module implementations (real sources + TS shims)
    crypto/       Crypto engine, driven from TS on the wn_openssl WASM build
    loader/       CJS resolver + ESM→CJS transform
    net/          Virtual TCP (inbound) + egress (outbound)
    npm/          npm client (semver / registry / tarball / installer)
    proc/         Child-process host for fork / cluster
    vfs/          Virtual file system (in-memory tree + OPFS persistence)
    wasm/         WASM artefacts + registry + minimal WASI host
  sync/           SharedArrayBuffer + Atomics synchronous RPC
  worker/         Dedicated Worker entries (runtime + file system)
  client/         Main-thread Runtime Client API (incl. ServiceWorker bridge)
  ui/             Demo UI (project stepper / file tree / editor / terminal / preview)
  demo/           The four demo projects (node / vite / webpack / rspack)
native/           C/C++ sources + build.mjs (wasi-sdk → src/node-runtime/wasm/artifacts)
examples/rspack/  Custom rspack binding entry (real browser Workers for emnapi threads)
public/sw.js      ServiceWorker: /preview/<port>/ → virtual network, + COOP/COEP
public/wasi-thread-child.js  Prebuilt thread-child bundle for the rspack WASM binding
vendor/node-lib/  Real files copied from the Node.js sources (with MANIFEST.json)
tools/            Dependency scan / vendoring / build tools
docs/             Design docs + dev log
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
Pages fall back to a `/preview/<port>/` path prefix (HTML responses get a `<base>`
tag injected to fix relative paths), unless a wildcard preview domain is
configured (M113).

Connections are persistent (HTTP/1.1 keep-alive) with pipelining on the server
side and a per-port client connection pool. Responses stream all the way: the
ServiceWorker hands the browser a `ReadableStream`, so `res.write()` / SSE /
large downloads arrive incrementally instead of as one blob (HTML is buffered
so the `<base>` tag can be injected). `https` is provided as the `http` surface
under a TLS-shaped name — the virtual network has no TLS.

### Outbound network (egress) (M122)

Only the **loopback** is virtual; everything else goes out through the host. A
non-loopback `http`/`https` request is turned into an `EgressConnection` and run
with the host's `fetch` (`src/node-runtime/net/egress.ts`); the reply is
re-framed through the same HTTP reader, so status line, headers and body match an
inbound response. `fetch` already decompresses and de-chunks, so
`content-encoding`/`transfer-encoding` are dropped and a `content-length` is
added. A direct call that is blocked (CORS) can be rescued by a proxy configured
through `VITE_WEB_NODE_EGRESS_PROXY` / `__WEB_NODE_EGRESS_PROXY__` — **no third
party is hard-coded**. A raw (non-loopback) `net.connect` has no bridge by
default and fails honestly with `ECONNREFUSED` (the optional
`VITE_WEB_NODE_TCP_PROXY` WebSocket bridge can supply one). Errors carry
`code='ERR_WEB_NODE_EGRESS'` plus the target.

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

`url` is Node's own `lib/url.js` as well — the legacy `Url`/`parse`/`format`/
`resolve`/`resolveObject` API next to the WHATWG re-exports
(`URL`/`URLSearchParams`/`URLPattern`). Its WHATWG half lives in `internal/url`,
which here is a bridge to the tab's own spec-compliant URL parser (Node's is
native Ada); `pathToFileURL`/`fileURLToPath` are reimplemented to Node's own
algorithms (the `src/node_url.cc` encode table, the POSIX path rules).

`v8` is the real `lib/v8.js` too, and `v8.serialize`/`v8.deserialize` speak V8's
own structured-clone wire format (version 15) — reimplemented tag for tag in the
`serdes` binding, because page JavaScript cannot reach a `ValueSerializer`. The
same bytes a real Node produces for plain objects, arrays, maps, sets, dates,
regexps, errors, bigints, array buffers and typed arrays; the heap-snapshot and
profiler half of the module has no equivalent in a tab and throws instead of
inventing numbers.

`tty` is the real `lib/tty.js` too. There are no file descriptors in a tab, so
`isatty` answers `false` and the `ReadStream`/`WriteStream` classes throw rather
than pretend to be a console — but the colour-depth logic (`lib/internal/tty.js`)
is real, which is what makes `FORCE_COLOR` paint `util.styleText` output.

`vm` is the real `lib/vm.js` as well. A page cannot build a second V8 realm, so
the `contextify` binding stands in: a context *is* the sandbox object (tagged with
Node's contextify symbol) and scripts run inside `with (context) { … }`, with
`this` bound to it. `createContext`/`isContext`/`Script`/`compileFunction` and the
`runIn*Context` helpers are real, sandbox reads and writes behave as in Node, and
a fresh context exposes the standard intrinsics (plus `console`) while keeping
`process`, `require`, `Buffer` and `setTimeout` undefined.

`Worker` is this runtime's own. A browser tab cannot start a thread, so a worker
is a second module registry on the same event loop, with its own
`process`/`worker_threads` views and a real `MessageChannel` to the parent.
`workerData`, message round trips, the `online`/`message`/`error`/`exit`
lifecycle, `terminate()` and the constructor validation behave as in Node, and so
do `worker.stdin`/`stdout`/`stderr` — real streams carried over a second
`MessageChannel`, with the worker's `console` bound to its own stdout/stderr.
What is missing is parallelism, which the docs state plainly, and anything
needing a native isolate (`eval`, `resourceLimits`, profiling, nested workers)
throws.

## npm

The file panel's **⬇ Install deps** resolves your `package.json` dependencies
against the npm registry, downloads each tarball, gunzips + untars it into the
virtual `node_modules` (hoisting to the top level, nesting only on a version
conflict), after which a normal `require` picks it up:

```js
const ms = require('ms');
ms(60000); // '1m'
```

- **Lockfile** — installs write a `package-lock.json` (lockfileVersion 3); a
  repeat install reuses the locked versions instead of re-resolving.
- **Integrity** — every tarball is checked against the registry's sha512/sha1
  *before* it is written to the VFS.
- **Peers / platform** — missing peer dependencies are installed at the root
  (npm 7+ behaviour); optional dependencies for another platform
  (`linux`/`wasm32`) are skipped.
- **`overrides` / `resolutions`** — a root `overrides` (or yarn `resolutions`)
  table pins a transitive dependency's version without editing the package that
  declares it.
- **`file:` / `link:`** — install straight from the virtual file system: `file:`
  points at a directory (read its `package.json`, copy recursively, skipping
  `node_modules`) or a local `.tgz`; `link:` is materialised as a copy, since the
  VFS has no symbolic links.
- **Bounded concurrency** — tarballs download at most `concurrency` (default 8)
  at a time, and the tree is written only after every download verifies.
- **On demand** — the **Add dependency** button runs `npm install <spec>` against
  an existing project (M142): the spec is parsed (`name`, `name@range`,
  `name@tag`, scoped `@scope/pkg`), added to the resolution, and the resolved
  version is written back to both `package.json` and `package-lock.json` (a bare
  name / tag / exact version is saved as `^<resolved>`, an explicit range is kept
  as-is; `save: false` installs without writing).

Not yet: `git+` / `git:` specifiers; `link:` is a copy, not a symlink, so an edit
to the linked package is not seen by the consumer. Lifecycle scripts and `.bin`
shims run against the runtime's own `child_process` surface (milestone 7).

## Processes, cluster and IPC (M7 / M40 / M123)

`spawn`/`exec`/`execFile` run a program to completion inside a controlled child
(the virtual file system, the virtual network, and the mini-shell). `fork()`
goes one step further: it starts the module the way `node <module>` would **and
wires a channel between the two sides**, so the ordinary parent↔child protocol
just works:

```js
const { fork } = require('child_process');
const child = fork('/project/worker.js');
child.on('message', (m) => console.log('child said', m));
child.send({ job: 21 });
```

```js
// /project/worker.js
process.on('message', (m) => process.send({ doubled: m.job * 2 }));
```

Details that are faithful on purpose:

- **JSON is the default serialization**, like Node: a Buffer arrives as
  `{ type: 'Buffer', data: [...] }`, a `Date` as an ISO string, an `undefined`
  property disappears, and a circular structure throws from `send()`.
  `serialization: 'advanced'` switches to structured clone.
- **An open channel keeps the child alive.** A forked module that returns from
  its last statement still waits for messages; `process.channel.unref()` or a
  `disconnect()` releases it. Messages that arrive before a listener is attached
  are buffered, not dropped.
- The parent sees `disconnect` → `exit` → `close` when the child dies, and
  `child.connected` / `child.channel` track the channel's life.

**`cluster` (M123)** — each fork is already its own runtime worker (its own
registry, `process` view, pid and IPC), so `cluster` is real too: the primary
view matches Node (`isPrimary`/`isWorker`, `fork()`, `workers`, `setupPrimary`,
the `Worker` class, and the `fork`/`online`/`listening`/`exit`/`message`
events), workers get a `cluster.isWorker=true` view, and a **shared port** is
round-robined across them on the virtual network (`net.Server` gains `exclusive`;
a worker's `net`/`http`/`https` servers default to `exclusive: false`). The
internal frames ride `{cmd:'NODE_CLUSTER'}` and are not surfaced as user
`'message'` events. A two-worker program produces the same line-by-line output as
real Node v26.9.0.

Not yet: a **send handle** (a `net.Socket`, a server) is refused rather than
silently dropped — there is no OS handle here to hand over. `'advanced'` keeps
`Map`/`Set`/`Date` but not the `Buffer` subclass (V8's serializer does;
`structuredClone` does not). `cwd` is not isolated: parent and child share one
virtual file system.

## Build tools (M5)

The runtime ships with a module-level **`require.resolve()`** and honours the
`package.json` **`browser` field** (the string form; the object form is a
bundler-substitution table that real Node — and this runtime, which provides
`fs`/`os`/`path` — ignores). On top of that, real build tools run in the tab.

### Bundling with esbuild (M5)

The real esbuild — its official WASM build, the same transformer Vite uses
internally — `require`s `esbuild-wasm`, initializes from the `esbuild.wasm` in
the virtual file system, then bundles TypeScript plus a real `node_modules`
dependency through a VFS plugin and writes `/project/dist/app.js`:

```
tool        : esbuild-wasm v0.28.2 (13.3 MB wasm)
wasm        : compiled + service started in 37ms
bundle      : 5138 bytes in 116ms
written     : /project/dist/app.js
```

### Bundling with rollup (M5b)

rollup — its official WASM build — bundles the project's ES modules straight out
of the virtual file system (no plugin needed: our `fs` *is* the VFS) and writes
`/project/dist/app.esm.js`:

```
tool        : rollup v4.63.3 (official WASM build)
bundle      : 339 bytes in 13ms
tree-shaken : yes (dead export dropped)
written     : /project/dist/app.esm.js
```

### Building with Vite (M5c)

The *real* Vite (v5) bundles a Vue 3 project inside the tab. Vite is pure ESM and
`import`s the native esbuild addon, so the runtime aliases `esbuild`→`esbuild-wasm`
and `rollup`→`@rollup/wasm-node`; the WASM esbuild is started explicitly, then
`vite.build()` runs entirely on the virtual file system:

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

The real Vite dev server boots inside the tab: `createServer()` binds a virtual
port (5173) and transforms modules *on demand*, exactly as it would in Node.
Open the **Preview** tab (`:5173`) and the page renders — served entirely from
the virtual file system.

```
tool        : vite v5.4.21 dev server (in the tab)
esbuild     : wasm started in 38ms
listening   : http://127.0.0.1:5173
```

Two things had to be added: a loopback-only **`dns`** builtin (Vite's
`buildStart` resolves `localhost`) and a real EventEmitter `process.stdin`
(its `close()` removes a SIGTERM listener). The preview bridge also learned to
route a browser's **absolute-path** assets (`/@vite/client`, chained imports)
back to the right virtual port, by remembering `clientId → port`.

**HMR works, over a non-WebSocket channel.** The HMR socket is a WebSocket, and a
ServiceWorker cannot proxy an upgrade, so the preview iframe is same-origin and
the ServiceWorker injects a `WebSocket` shim that diverts Vite's HMR socket to a
`BroadcastChannel` (keyed off the `vite-hmr` subprotocol). The channel is scoped
to the virtual port (`web-node-hmr:<port>`); the runtime hands Vite an HMR server
object that `send()`s over that channel instead of a socket, and a small Vite
plugin turns VFS change events into Vite watcher events. Hit **▶ Run dev** after
editing a source file and the preview updates in place, no reload.

### Building with webpack (M109–M110)

The real **webpack 5** runs in the tab. A **production build** compiles a project
through the loader / plugin ecosystem — `ts-loader`, `babel-loader`
(`preset-env`, `targets: ie11`), `css-loader`, `mini-css-extract-plugin` and
`html-webpack-plugin` — with `hasErrors=false`, emitting `bundle.js`,
`index.html` and `styles.css`:

```
Webpack 5.111.1 compiled successfully in 14.3s  (mode=production)
assets : bundle.js + index.html + styles.css
babel  : optional chaining / classes compiled away (ie11 target)
css    : extracted by MiniCssExtractPlugin
```

`webpack-dev-server` needs express + ws + chokidar, none of which a tab has, so
the demo ships a **hand-written dev server**: a virtual
`http.createServer().listen(5174)` serves `/` and `/bundle.js`, and each
recompile is pushed to the preview as `{type:'full-reload'}` over the **same
`BroadcastChannel` bridge Vite uses**. Because webpack's `watchpack` ultimately
lands on `fs.watch`, and our `fs_event_wrap.FSEvent` is a VFS projection, saving
a file triggers a real rebuild with no polling.

### Building with rspack (M125)

The real **rspack 2.2.7** runs a production build — including terser minification
— inside the tab:

```
Rspack 2.2.7 compiled successfully in 47.76 s   (minimize:true)
OUT_BYTES=51  OUT_HEAD=(()=>{"use strict";console.log("hello rspack")})();
```

This is the hardest of the bundlers, because rspack's Rust core spawns **real OS
threads** at init (wasm32-wasi `wasi_threads` → `@emnapi/wasi-threads`), which the
same-realm cooperative `worker_threads` cannot provide. The fix is a **custom
binding entry** (`examples/rspack/webnode-binding.cjs`, a drop-in for
`rspack.wasi.cjs`) that uses `@napi-rs/wasm-runtime` with a custom
`onCreateWorker` returning **real browser `Worker`s**, loading a prebuilt
self-contained thread-child (`public/wasi-thread-child.js`, 519 KB / 141 KB
gzipped). The child needs no VFS — emnapi's `createFsProxy` routes `fs` over a
message port back to the parent (the VFS). Two prerequisites make it possible: a
real **`node:wasi`** host (46 `wasi_snapshot_preview1` syscalls backed by the
VFS), and a **cross-origin-isolated** page (`SharedArrayBuffer` + COOP/COEP,
which `public/sw.js` injects even on a static host that cannot set headers, M134).

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

- **163 files vendored** — the whole `stream` layer, `events`,
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
  `perf_hooks` (+ the whole `internal/perf/*` group) — a real `Performance`,
  `PerformanceMark`/`PerformanceMeasure`, `PerformanceObserver`,
  `PerformanceNodeTiming` and `timerify`, on a JS `performance` binding;
  histograms (`createHistogram`, `monitorEventLoopDelay`) are real, on the
  `wn_histogram` WASM build of `deps/histogram` (the `performance` binding),
  `stream/web` (+ the whole `internal/webstreams/*` group) — the real WHATWG
  `ReadableStream` / `WritableStream` / `TransformStream`, the queuing
  strategies and the text codecs, plus the classic↔web adapters so
  `Readable.toWeb` / `Writable.toWeb` / `Duplex.toWeb` work;
  `CompressionStream`/`DecompressionStream` are real, on the `wn_zlib` WASM
  build of `deps/zlib` (plus `wn_brotli`/`wn_zstd` for the brotli/zstd codecs),
  `stream/iter` (+ the whole `internal/streams/iter/*` group) — the new
  experimental iterable-streams API (`push`/`pull`/`from`/`merge`/`broadcast`/
  `share`/`tap`, sync and async consumers, and classic↔iter interop), plus
  `stream/consumers` (`text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob`),
  `internal/blob` (+ `internal/file`) — the real `Blob` and `File`, on a JS
  `blob` binding that keeps the `DataQueue` contract (a reader hands back one
  entry per `pull`, so `blob.stream()` chunks on the original source
  boundaries); `Blob`/`File` are globals and agree on identity with
  `require('buffer').Blob`, and `fs.openAsBlob` plus the
  `URL.createObjectURL` object store ride along,
  `internal/util/comparisons` (the real `isDeepStrictEqual`),
  `internal/util/colors`, `util` (+ `internal/util.js`, `internal/util/diff`,
  `internal/util/parse_args/*`), `internal/mime`, and the `internal/*` pieces
  they need (`primordials`, `fixed_queue`, `constants`, `encoding/util`,
  `streams/state`, `streams/destroy`, `per_context/*`, …).
- **Of the 58 top-level `lib/*.js` modules, 32 are available** — 31 as real
  implementations (vendored source, or our own JS where the real file sits on a
  native layer a tab cannot have, or running on a WASM build) and **`tls`** as
  the only module left as a load-only stub that keeps `import` side-effect-free
  and throws a typed `NotImplementedError` on use (`tty`, `v8` and `zlib` are
  real). The newest real ones are `zlib` (`wn_zlib`/`wn_brotli`/`wn_zstd`) and
  `perf_hooks` histograms (`wn_histogram`) on WASM, `stream/web` (the whole
  `internal/webstreams/*` group), the `Blob`/`File` globals behind
  `internal/blob` + `internal/file`, and `stream/iter` (+ `internal/streams/iter/*`)
  with `stream/consumers`. `crypto` is the deepest one: the WebCrypto API is
  promise-only, but Node's `createHash` / `createHmac` / `pbkdf2Sync` /
  `scryptSync` / cipher and key APIs are synchronous, so a whole crypto engine
  was needed. It runs on the `wn_openssl` WASM build of an OpenSSL 3.5.8 subset,
  driven from TS in `src/node-runtime/crypto/` — digests (MD5, SHA-1, SHA-2,
  SHA-3/Keccak, BLAKE2, RIPEMD-160, SM3), MACs (HMAC, Poly1305, SipHash), KDFs
  (PBKDF2, HKDF, scrypt, Argon2), symmetric ciphers (AES incl.
  GCM/CCM/OCB/SIV/XTS/CBC-CTS/CFB, ChaCha20-Poly1305, DES/3DES, Camellia, ARIA,
  SM4), asymmetric (RSA/DSA/DH/ECDH/Ed25519/Ed448/X25519/X448/ML-KEM), plus
  X.509/SPKAC certificates and DER. Output is checked against Node's own OpenSSL
  byte for byte.

### What can and cannot be moved over

Node's `lib/` has ~420 `.js` files. Moving "all of them" is not a copy job: the
large majority sit directly on native bindings (V8 C++ APIs, libuv handles, raw
sockets, native addons, the module loader) that have no browser equivalent. So
the rule is: **vendor the pure-JS layers verbatim, and cover the native layer
underneath them** — either with a JS reimplementation built on the browser's own
APIs (exactly what `async_wrap` does for `async_hooks` and what the JS
`string_decoder` binding does for the real decoder, `src/string_decoder.cc`
ported to `bindings/string_decoder.ts`) or, where the real implementation sits
on a C/C++ library, by **compiling that library to WASM** (see *Native layer →
WASM*). A file is vendorable when its only dependencies are shims we already
provide; everything else is a binding away.

Where the real implementation sits on a C/C++ library, the library is now
**compiled to WASM** rather than reimplemented (see *Native layer → WASM*):
`zlib` (+ brotli/zstd), `perf_hooks` histograms and the whole `crypto` engine.
`wasi` and `cluster` are real too — a full `wasi_snapshot_preview1` host on the
VFS (which is what lets rspack's WASM binding run), and one worker per forked
child with shared ports on the virtual network.

The remaining large gaps are the ones with no browser story at all (`http2`,
`dgram`, `tls`/`_tls_*`, `inspector`, `repl`, `sqlite`, `sea`, and the *real
threads* behind `worker_threads`), plus native-layer reimplementations worth
doing (`internal/util/inspect.js`, the native `string_decoder`, `internal/fs/*`).
`vm` is the real `lib/vm.js` on a JS stand-in for V8 contexts, and
`worker_threads.Worker` runs as a cooperative worker (real messages, lifecycle
and stdio, no parallelism). `internal/errors` defines every code the vendored
modules actually reach for (and every word of their messages), with regression
tests keeping it that way. Of Node's core modules, only `tls` remains a pure
throwing stub.

## Contributing

1. Run `npm run typecheck && npm test` and keep both green.
2. The browser verification checklist lives at the top of `docs/DEVLOG.md`.
3. Append a change record to `docs/DEVLOG.md` (what changed / why / files touched).
