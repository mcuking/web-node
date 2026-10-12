import type { BuiltinInitContext, BuiltinSpec } from './types';
import { notImplemented } from '../errors';

/**
 * `node:sqlite` — the synchronous SQLite API, backed by the **real upstream
 * SQLite** (M148).
 *
 * Node's `node:sqlite` is a native binding over `deps/sqlite/sqlite3.c`. Here the
 * same amalgamation is compiled to WebAssembly with wasi-sdk (see
 * `native/src/wn_sqlite.c`) and reached through `internalBinding('sqlite')`, so
 * SQL semantics — types, affinity, constraints, `STRICT` tables, the JSON/date
 * functions, FTS5/RTREE — are the ones real Node ships.
 *
 * Scope: the **synchronous** surface (`DatabaseSync` + `StatementSync`) is live:
 * `exec`/`prepare`/`run`/`get`/`all`/`iterate`, named & anonymous parameters,
 * `setReadBigInts`, `setAllowBareNamedParameters`. The session/changeset and
 * `backup` APIs are not implemented and throw loudly. The browser tab has no
 * POSIX filesystem, so databases live in the module's in-memory VFS; the runtime
 * can persist a named database's bytes to the VFS (see the worker), which is what
 * makes `new DatabaseSync('/project/app.db')` survive a reload.
 */

interface SqliteBinding {
  sqliteReady(): boolean;
  sqliteVersion(): string;
  SqliteDb: new (path: string, flags: number) => SqliteDbLike;
  SqliteStmt: new (ptr: number) => unknown;
  readDatabaseImage(path: string): Uint8Array | undefined;
  writeDatabaseImage(path: string, data: Uint8Array): void;
  OPEN_READONLY: number;
  OPEN_READWRITE: number;
  OPEN_CREATE: number;
  SQLITE_ROW: number;
  SQLITE_DONE: number;
}

interface SqliteStmtLike {
  finalize(): void;
  step(): number;
  reset(): void;
  clearBindings(): void;
  columnCount(): number;
  columnName(i: number): string;
  bindParameterCount(): number;
  bindParameterIndex(name: string): number;
  bindParameterName(i: number): string | null;
  columnType(i: number): number;
  columnValue(i: number, bigInts: boolean): null | number | bigint | string | Uint8Array;
  bindValue(index: number, value: unknown): void;
}

interface SqliteDbLike {
  readonly path: string;
  close(): void;
  exec(sql: string): void;
  changes(): number;
  lastInsertRowid(): number;
  prepare(sql: string): SqliteStmtLike;
  errmsg(): string;
}

/** Node's `DatabaseSync` options. */
interface DatabaseSyncOptions {
  open?: boolean;
  readOnly?: boolean;
  enableForeignKeyConstraints?: boolean;
  enableDoubleQuotedStringLiterals?: boolean;
  allowExtension?: boolean;
  timeout?: number;
  readBigInts?: boolean;
  returnArrays?: boolean;
  allowBareNamedParameters?: boolean;
}

/** Parameters accepted by `run`/`get`/`all`/`iterate`. */
type BindParameters = unknown[];

export const sqliteSpec: BuiltinSpec = {
  id: 'sqlite',
  aliases: ['node:sqlite'],
  origin: 'web-node',
  init(ctx: BuiltinInitContext): Record<string, unknown> {
    const binding = ctx.internalBinding('sqlite') as unknown as SqliteBinding;

    const { OPEN_READONLY, OPEN_READWRITE, OPEN_CREATE, SQLITE_ROW, SQLITE_DONE } = binding;

    /** Repeat Node's type guard for option booleans. */
    function booleanOption(options: Record<string, unknown>, key: string, dflt: boolean): boolean {
      const v = options[key];
      if (v === undefined) return dflt;
      if (typeof v !== 'boolean') {
        throw errInvalidArgType(`The "options.${key}" argument must be a boolean.`);
      }
      return v;
    }

    function errInvalidArgType(message: string): TypeError {
      const err = new TypeError(message);
      (err as Error & { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
      return err;
    }

    function errInvalidState(message: string): Error {
      const err = new Error(message);
      (err as Error & { code?: string }).code = 'ERR_INVALID_STATE';
      return err;
    }

    /** Raise the current database error, shaped like Node's `ERR_SQLITE_ERROR`. */
    function raiseDb(db: { errmsg(): string }): never {
      const err = new Error(db.errmsg() || 'sqlite error');
      (err as Error & { code?: string }).code = 'ERR_SQLITE_ERROR';
      throw err;
    }

    class StatementSync {
      #stmt: SqliteStmtLike;
      #db: DatabaseSync;
      #readBigInts: boolean;
      #allowBareNamedParameters: boolean;
      #source: string;
      #finalized = false;

      constructor(db: DatabaseSync, sql: string, stmt: SqliteStmtLike, readBigInts: boolean, allowBare: boolean) {
        this.#db = db;
        this.#stmt = stmt;
        this.#readBigInts = readBigInts;
        this.#allowBareNamedParameters = allowBare;
        this.#source = sql;
      }

      /** Statement text as passed to `prepare`. */
      get sourceSQL(): string {
        return this.#source;
      }

      /** Not expanded (no `sqlite3_expanded_sql` in the wasm build); equals source. */
      get expandedSQL(): string {
        return this.#source;
      }

      setReadBigInts(enabled: boolean): void {
        if (typeof enabled !== 'boolean') {
          throw errInvalidArgType('The "enabled" argument must be a boolean.');
        }
        this.#readBigInts = enabled;
      }

      setAllowBareNamedParameters(enabled: boolean): void {
        if (typeof enabled !== 'boolean') {
          throw errInvalidArgType('The "enabled" argument must be a boolean.');
        }
        this.#allowBareNamedParameters = enabled;
      }

      #bindParams(args: BindParameters): void {
        this.#stmt.clearBindings();
        let anonIdx = 1;
        let anonStart = 0;

        const first = args[0];
        const isObjectFirst =
          first !== null &&
          typeof first === 'object' &&
          !ArrayBuffer.isView(first) &&
          !(first instanceof ArrayBuffer) &&
          !(typeof SharedArrayBuffer !== 'undefined' && first instanceof SharedArrayBuffer);

        if (isObjectFirst) {
          anonStart = 1;
          const obj = first as Record<string, unknown>;
          for (const key of Object.keys(obj)) {
            let idx = this.#stmt.bindParameterIndex(key);
            if (idx === 0 && this.#allowBareNamedParameters) {
              idx = this.#lookupBare(key);
            }
            if (idx === 0) {
              throw errInvalidState(`Unknown named parameter '${key}'`);
            }
            this.#stmt.bindValue(idx, obj[key]);
          }
        }

        for (let i = anonStart; i < args.length; i++) {
          while (this.#isNamedAt(anonIdx)) anonIdx++;
          this.#stmt.bindValue(anonIdx, args[i]);
          anonIdx++;
        }
      }

      /** Bare-name map: `name` → one of `:name`/`@name`/`$name` present in the SQL. */
      #lookupBare(bare: string): number {
        for (const prefix of [':', '@', '$']) {
          const idx = this.#stmt.bindParameterIndex(prefix + bare);
          if (idx !== 0) return idx;
        }
        return 0;
      }

      /**
       * Walk to the next anonymous slot, skipping `:name`/`@name`/`$name`/`?NNN`
       * parameters — exactly Node's `BindParams` loop (`param[0] === '?'` ⇒ not
       * named; a `?123` name is skipped by the `'?'` check further in).
       */
      #isNamedAt(index: number): boolean {
        const name = this.#stmt.bindParameterName(index);
        return name !== null && name[0] !== '?';
      }

      #ensureOpen(): void {
        if (this.#finalized) throw errInvalidState('The statement has been finalized');
      }

      run(...params: BindParameters): { changes: number; lastInsertRowid: number } {
        this.#ensureOpen();
        this.#bindParams(params);
        const rc = this.#stmt.step();
        if (rc !== SQLITE_DONE && rc !== SQLITE_ROW) raiseDb(this.#db);
        this.#stmt.reset();
        return { changes: this.#db.changes(), lastInsertRowid: this.#db.lastInsertRowid() };
      }

      get(...params: BindParameters): Record<string, unknown> | undefined {
        const rows = this.#execute(params, true);
        return rows[0];
      }

      all(...params: BindParameters): Record<string, unknown>[] {
        return this.#execute(params, false);
      }

      *iterate(...params: BindParameters): IterableIterator<Record<string, unknown>> {
        this.#ensureOpen();
        this.#bindParams(params);
        for (;;) {
          const rc = this.#stmt.step();
          if (rc === SQLITE_DONE) break;
          if (rc !== SQLITE_ROW) raiseDb(this.#db);
          yield this.#row();
        }
        this.#stmt.reset();
      }

      #execute(params: BindParameters, firstOnly: boolean): Record<string, unknown>[] {
        this.#ensureOpen();
        this.#bindParams(params);
        const rows: Record<string, unknown>[] = [];
        for (;;) {
          const rc = this.#stmt.step();
          if (rc === SQLITE_DONE) break;
          if (rc !== SQLITE_ROW) raiseDb(this.#db);
          rows.push(this.#row());
          if (firstOnly) break;
        }
        this.#stmt.reset();
        return rows;
      }

      #row(): Record<string, unknown> {
        const n = this.#stmt.columnCount();
        // Node's `node:sqlite` returns null-prototype row objects.
        const row = Object.create(null) as Record<string, unknown>;
        for (let i = 0; i < n; i++) {
          row[this.#stmt.columnName(i)] = this.#stmt.columnValue(i, this.#readBigInts);
        }
        return row;
      }
    }

    class DatabaseSync {
      #db: SqliteDbLike | null = null;
      #path: string;
      #readBigInts: boolean;
      #allowBareNamedParameters: boolean;
      #isTransaction = false;

      constructor(location: string, options: DatabaseSyncOptions = {}) {
        if (typeof location !== 'string') {
          throw errInvalidArgType('The "location" argument must be a string.');
        }
        const readOnly = booleanOption(options as Record<string, unknown>, 'readOnly', false);
        const open = booleanOption(options as Record<string, unknown>, 'open', true);
        const fk = booleanOption(options as Record<string, unknown>, 'enableForeignKeyConstraints', true);
        const doubleQuoted = booleanOption(options as Record<string, unknown>, 'enableDoubleQuotedStringLiterals', false);
        booleanOption(options as Record<string, unknown>, 'allowExtension', false);
        void options.timeout;
        this.#readBigInts = booleanOption(options as Record<string, unknown>, 'readBigInts', false);
        booleanOption(options as Record<string, unknown>, 'returnArrays', false);
        this.#allowBareNamedParameters = booleanOption(
          options as Record<string, unknown>,
          'allowBareNamedParameters',
          true,
        );
        this.#path = location;
        if (open) this.#open(readOnly, fk, doubleQuoted);
      }

      #open(readOnly: boolean, fk: boolean, doubleQuoted: boolean): void {
        if (!binding.sqliteReady()) {
          throw errInvalidState(
            'node:sqlite is not ready: the SQLite WebAssembly module is still loading.',
          );
        }
        // Seed the in-memory VFS from the runtime file, if the database exists
        // (`/project/app.db` is a real visible file, matching Node on disk).
        if (this.#path !== ':memory:') {
          const existing = this.#readFile(this.#path);
          if (existing) binding.writeDatabaseImage(this.#path, existing);
          else if (readOnly) {
            const err = new Error(`unable to open database file: ${this.#path}`);
            (err as Error & { code?: string }).code = 'ERR_SQLITE_ERROR';
            throw err;
          }
        }
        const flags = readOnly ? OPEN_READONLY : OPEN_READWRITE | OPEN_CREATE;
        this.#db = new binding.SqliteDb(this.#path, flags);
        // Node enables FK constraints by default.
        this.exec(`PRAGMA foreign_keys = ${fk ? 'ON' : 'OFF'};`);
        void doubleQuoted;
      }

      get isOpen(): boolean {
        return this.#db !== null;
      }

      get open(): boolean {
        return this.#db !== null;
      }

      set open(value: boolean) {
        if (value && this.#db === null) this.#open(false, true, false);
        else if (!value && this.#db !== null) this.close();
      }

      get isTransaction(): boolean {
        return this.#isTransaction;
      }

      location(): string {
        return this.#path;
      }

      /** The most recent error message from the underlying connection. */
      errmsg(): string {
        return this.#db?.errmsg() ?? 'database is not open';
      }

      close(): void {
        if (this.#db === null) return;
        // Persist the bytes back to the runtime VFS, so the database appears as a
        // real file and survives a reload (there is no POSIX filesystem here).
        if (this.#path !== ':memory:' && binding.sqliteReady()) {
          const image = binding.readDatabaseImage(this.#path);
          if (image) this.#writeFile(this.#path, image);
        }
        this.#db.close();
        this.#db = null;
      }

      /** Read a file from the runtime VFS, or `undefined` if it does not exist. */
      #readFile(path: string): Uint8Array | undefined {
        const fs = this.#fs();
        if (!fs) return undefined;
        try {
          const data = fs.readFileSync(path);
          return data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
        } catch {
          return undefined;
        }
      }

      /** Write a file into the runtime VFS (best effort). */
      #writeFile(path: string, data: Uint8Array): void {
        const fs = this.#fs();
        if (!fs) return;
        try {
          fs.writeFileSync(path, data);
        } catch {
          /* read-only mount or unsupported path — nothing to persist */
        }
      }

      #fsModule: Record<string, (...args: unknown[]) => unknown> | null | undefined;
      #fs(): Record<string, (...args: unknown[]) => unknown> | null {
        if (this.#fsModule === undefined) {
          try {
            this.#fsModule = ctx.require('fs') as Record<string, (...args: unknown[]) => unknown>;
          } catch {
            this.#fsModule = null;
          }
        }
        return this.#fsModule;
      }

      exec(sql: string): void {
        this.#assertOpen().exec(sql);
        this.#trackTransaction(sql);
      }

      prepare(sql: string): StatementSync {
        if (typeof sql !== 'string') {
          throw errInvalidArgType('The "sql" argument must be a string.');
        }
        const stmt = this.#assertOpen().prepare(sql);
        return new StatementSync(this, sql, stmt, this.#readBigInts, this.#allowBareNamedParameters);
      }

      #assertOpen(): SqliteDbLike {
        if (this.#db === null) throw errInvalidState('database is not open');
        return this.#db;
      }

      changes(): number {
        return this.#assertOpen().changes();
      }

      lastInsertRowid(): number {
        return this.#assertOpen().lastInsertRowid();
      }

      #trackTransaction(sql: string): void {
        const trimmed = sql.trimStart().toUpperCase();
        if (trimmed.startsWith('BEGIN')) this.#isTransaction = true;
        else if (trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) this.#isTransaction = false;
      }

      createSession(): never {
        throw notImplemented('api', 'DatabaseSync.prototype.createSession', 'SQLite sessions/changesets are not implemented.');
      }

      applyChangeset(): never {
        throw notImplemented('api', 'DatabaseSync.prototype.applyChangeset', 'SQLite sessions/changesets are not implemented.');
      }

      enableLoadExtension(): never {
        throw notImplemented('api', 'DatabaseSync.prototype.enableLoadExtension', 'Loading SQLite extensions is not supported.');
      }

      loadExtension(): never {
        throw notImplemented('api', 'DatabaseSync.prototype.loadExtension', 'Loading SQLite extensions is not supported.');
      }

      function(): never {
        throw notImplemented('api', 'DatabaseSync.prototype.function', 'User-defined SQL functions are not implemented.');
      }

      aggregate(): never {
        throw notImplemented('api', 'DatabaseSync.prototype.aggregate', 'User-defined SQL aggregates are not implemented.');
      }
    }

    /** A small, honest subset of `node:sqlite`'s `constants`. */
    const constants = {
      SQLITE_CHANGESET_OMIT: 0,
      SQLITE_CHANGESET_REPLACE: 1,
      SQLITE_CHANGESET_ABORT: 2,
      SQLITE_CHANGESET_DATA: 1,
      SQLITE_CHANGESET_NOTFOUND: 2,
      SQLITE_CHANGESET_CONFLICT: 3,
      SQLITE_CHANGESET_CONSTRAINT: 4,
      SQLITE_CHANGESET_FOREIGN_KEY: 5,
      SQLITE_CHANGESET_APPLIED: 0,
    };

    return {
      DatabaseSync,
      StatementSync,
      constants,
      backup(): never {
        throw notImplemented('api', 'sqlite.backup', 'SQLite online backup is not implemented.');
      },
      Session: class Session {
        constructor() {
          throw notImplemented('api', 'sqlite.Session', 'SQLite sessions are not implemented.');
        }
      },
      __version: binding.sqliteVersion(),
    };
  },
};
