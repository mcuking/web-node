# web-node

Run Node.js source code in the browser — a WebContainer-style runtime.

[![live demo](https://img.shields.io/badge/live%20demo-mcuking.github.io%2Fweb--node-5ef1a5)](https://mcuking.github.io/web-node/)

**English** · [简体中文](README_zh.md)

- **Live demo**: <https://mcuking.github.io/web-node/> (install deps, run the
  demo project, hit **⚡ Vite build** — all inside the tab)
- **Dev log / progress / next steps**: [`docs/DEVLOG.md`](docs/DEVLOG.md) ← **append an entry after every change**
- Design doc: [`docs/superpowers/specs/2026-09-17-web-node-design.md`](docs/superpowers/specs/2026-09-17-web-node-design.md)
- Upstream sources: local checkout of Node.js (v26.9.1), vendored via `tools/`

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
  hoisting, so `require('pkg')` works with no server.
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

## Development

> ⚠️ Use an independent Node v22.19.0 from fnm — not the host app's bundled
> Electron Node. The Electron Node makes rollup's native module fail `dlopen`
> with a code-signing error.

```bash
export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v22.19.0/installation/bin:$PATH"

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

Known MVP limits: the preview uses a `/preview/<port>/` path prefix rather than
`<port>.localhost`, so absolute-path assets (`/app.js`) land outside the prefix
(HTML responses get a `<base>` tag injected to fix *relative* paths). Subdomain
routing is deferred because `<port>.localhost` is a *different origin* while the
runtime, VFS and OPFS (origin-scoped) live on the main origin — making it work
needs a cross-origin relay layer, which is a larger change.

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

## npm

Hit **Install deps** and the client resolves your `package.json` dependencies
against the npm registry, downloads each tarball, gunzips + untars it into the
virtual `node_modules` (hoisting to the top level, nesting only on a version
conflict), after which a normal `require` picks it up:

```js
const ms = require('ms');
ms(60000); // '1m'
```

Not yet: lifecycle scripts, `.bin` shims, peer-dependency auto-install, lockfile
read/write and integrity verification.

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
Vite 5.x. The dev server (HMR) is the next milestone (M5d).

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
| M3.5d | Subdomain routing (`<port>.localhost`) | ⏸ Deferred (cross-origin runtime/OPFS) |
| M5 | Real build tool — esbuild WASM: install, initialize, bundle, write back | ✅ Done |
| M5b | Real bundler — rollup WASM: ESM graph, tree-shaking, write to VFS | ✅ Done |
| M5c | Real build toolchain — Vite in the tab: production bundle to VFS | ✅ Done |
| M5d | Vite dev server (dev-server orchestration / HMR) | ⬜ Next |

## Contributing

1. Run `npm run typecheck && npm test` and keep both green.
2. The browser verification checklist lives at the top of `docs/DEVLOG.md`.
3. Append a change record to `docs/DEVLOG.md` (what changed / why / files touched).
