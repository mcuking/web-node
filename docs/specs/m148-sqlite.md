# M148 — `node:sqlite` over the real upstream SQLite (WASM)

## Goal

Ship the **synchronous** `node:sqlite` API with real SQL semantics by compiling the
**unmodified upstream SQLite amalgamation** (`deps/sqlite/sqlite3.c`) to
WebAssembly — the same native→wasm play as the rest of stage H, rather than a JS
re-implementation of SQL.

## Why it works

Node's `node:sqlite` is a thin C++ binding (`src/node_sqlite.cc`) over
`deps/sqlite/sqlite3.c`. Compile that exact amalgamation with wasi-sdk and expose a
small ABI (`native/src/wn_sqlite.c`); the SQL engine — affinity, types,
constraints, `STRICT` tables, JSON/date functions, FTS5/RTREE — is then literally
the code Node ships, so behaviour matches without re-deriving any of it.

## Shape

```
builtins/sqlite.ts   DatabaseSync / StatementSync (public API, JS)
bindings/sqlite.ts   wn_sqlite ABI wrapper (scratch buffers, ptr marshalling)
native/src/wn_sqlite.c   C ABI shim over the amalgamation
native/build.mjs     registers `wn_sqlite` (defines mirror sqlite.gyp)
wasm/artifacts/wn_sqlite.wasm   ~1842 KB (gzip ~677 KB), lazy content-hashed chunk
```

## Key decisions

- **In-memory VFS** (`SQLITE_OS_OTHER=1`, VFS name `wn-mem`): the browser tab has no
  POSIX filesystem. A named database's bytes are mirrored to/from the runtime VFS on
  open/close, so `new DatabaseSync('/project/app.db')` is a real visible file and
  survives a reload.
- **Defines mirror `deps/sqlite/sqlite.gyp`**: `SQLITE_THREADSAFE=0`,
  `SQLITE_OMIT_LOAD_EXTENSION`, FTS3/FTS5/RTREE/GEOPOLY/MATH/PERCENTILE/DBSTAT,
  `SQLITE_ENABLE_COLUMN_METADATA`, etc.
- **Exports declared explicitly** with `__attribute__((export_name(...), used))` —
  never `--export-all` (leaks libc symbols).
- **Errors are plain `Error`** with `code: 'ERR_SQLITE_ERROR'`; Node exports no
  `SqliteError` class. Unknown named parameter ⇒ `ERR_INVALID_STATE`.
- **`sqlite3_close_v2`** so closing with outstanding statements succeeds.
- Out of scope, thrown loudly: sessions/changesets, `backup`, user-defined
  functions/aggregates, `enableLoadExtension`/`loadExtension`.

## Verification

`tools/sqlite-probe.cjs` runs on real Node v26.9.0 (→ `test/fixtures/sqlite.json`)
and inside web-node; the two JSON blobs must be equal. `test/sqlite.test.ts` also
pins value-type round-trips, named parameters, `changes`/`lastInsertRowid`/bigints,
and the error shape.
