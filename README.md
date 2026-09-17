# web-node

Run Node.js source code in the browser — a WebContainer-style runtime.

**English** · [简体中文](README_zh.md)

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
(HTML responses get a `<base>` tag injected to fix *relative* paths). HTTP/1.1
handles one request per connection (`Connection: close`) — no keep-alive and no
TLS — though chunked transfer encoding is supported.

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

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M1 | Pure-JS runtime layer (realm / bindings / module loader) | ✅ Done |
| M2 | Virtual file system (in-memory tree + OPFS persistence) | ✅ Done |
| M3 | Networking (virtual TCP + ServiceWorker bridge + preview) | ✅ Done (basic) |
| S | Streams foundation (`Readable`/`Writable`/`pipe`/backpressure + chunked) | ✅ Done |
| M4 | npm client (registry + tarball + `node_modules`) | ✅ Done |
| M3.5 | Network convergence (subdomain routing / keep-alive / HTTPS) | ⬜ Not started |
| M5 | Real build tools (Vite / webpack) | ⬜ Not started |

## Contributing

1. Run `npm run typecheck && npm test` and keep both green.
2. The browser verification checklist lives at the top of `docs/DEVLOG.md`.
3. Append a change record to `docs/DEVLOG.md` (what changed / why / files touched).
