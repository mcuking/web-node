/**
 * `wn_sqlite` — thin binding over the wasi-built SQLite amalgamation (M148).
 *
 * The module is **lazy** (1.8 MB raw / 677 KB gzip): it is fetched in the
 * background after boot rather than awaited as part of the startup set, exactly
 * like `wn_openssl`. `node:sqlite`'s API is synchronous (`new DatabaseSync()`),
 * so a caller that arrives before the module lands gets a clear, typed
 * {@link SqliteUnavailableError} instead of a half-initialised database — see
 * `builtins/sqlite.ts`. By the time user code runs (after boot + install) the
 * background fetch has long since completed.
 *
 * Layout mirrors the other bindings: JS never hands a typed-array pointer to
 * wasm. Strings/blobs are written into the module's own scratch buffer
 * (`wn_sqlite_scratch`) and only the address crosses; results are read back out
 * of `memory.buffer`, re-taking the view each time (memory can grow).
 *
 * `sqlite3_int64` maps to a JS `BigInt` across the wasm boundary, so the
 * int64-typed exports take/return `bigint`.
 */
import { wasmLoaded, wasmModule } from '../wasm/registry';
import type { WasmExports } from '../wasm/loader';
import type { BindingContext } from './context';

export const SQLITE_MODULE = 'wn_sqlite';

/** Whether the SQLite module has been instantiated yet. */
export function sqliteReady(): boolean {
  return wasmLoaded(SQLITE_MODULE);
}

// --- sqlite constants (subset we use) ---------------------------------------
export const SQLITE_OK = 0;
export const SQLITE_ROW = 100;
export const SQLITE_DONE = 101;

export const OPEN_READONLY = 0x00000001;
export const OPEN_READWRITE = 0x00000002;
export const OPEN_CREATE = 0x00000004;

export const TYPE_INTEGER = 1;
export const TYPE_FLOAT = 2;
export const TYPE_TEXT = 3;
export const TYPE_BLOB = 4;
export const TYPE_NULL = 5;

/** Maximum integer that survives a round trip through a JS `Number`. */
const MAX_SAFE = 9007199254740991n;
const MIN_SAFE = -9007199254740991n;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** `node:sqlite` was used before the wasm module finished loading. */
export class SqliteUnavailableError extends Error {
  code = 'ERR_SQLITE_UNAVAILABLE';
  constructor() {
    super(
      'node:sqlite is not ready: the SQLite WebAssembly module is still loading. ' +
        'Retry once the runtime has finished booting.',
    );
    this.name = 'SqliteUnavailableError';
  }
}

/** A SQLite error surfaced from the C layer (`ERR_SQLITE_ERROR`, like Node). */
export class SqliteError extends Error {
  code = 'ERR_SQLITE_ERROR';
  errcode: number;
  errstr: string;
  constructor(message: string, errcode: number, errstr: string) {
    super(message);
    // `node:sqlite` reports every failure as a plain `Error` carrying
    // `code: 'ERR_SQLITE_ERROR'` + `errcode`/`errstr` (there is no exported
    // `SqliteError` class upstream), so the `name` must stay `Error`.
    this.name = 'Error';
    this.errcode = errcode;
    this.errstr = errstr;
  }
}

function ex(): WasmExports {
  if (!wasmLoaded(SQLITE_MODULE)) throw new SqliteUnavailableError();
  return wasmModule(SQLITE_MODULE);
}

function fn(name: string): (...args: unknown[]) => unknown {
  const f = ex()[name];
  if (typeof f !== 'function') throw new Error(`wn_sqlite: missing export "${name}"`);
  return f as (...args: unknown[]) => unknown;
}

function num(name: string, ...args: unknown[]): number {
  return fn(name)(...args) as number;
}

function mem(): Uint8Array {
  return new Uint8Array((ex().memory as WebAssembly.Memory).buffer);
}

function cstr(ptr: number): string {
  if (!ptr) return '';
  const m = mem();
  let end = ptr;
  while (end < m.length && m[end] !== 0) end++;
  return decoder.decode(m.subarray(ptr, end));
}

/** Copy `len` bytes starting at `ptr` out of wasm memory. */
function bytesAt(ptr: number, len: number): Uint8Array {
  if (!ptr || len <= 0) return new Uint8Array(0);
  return mem().slice(ptr, ptr + len);
}

/** Write a NUL-terminated UTF-8 string into the scratch buffer; return its address. */
function cstring(s: string): number {
  const b = encoder.encode(s);
  const ptr = num('wn_sqlite_scratch', b.length + 1);
  const m = mem();
  m.set(b, ptr);
  m[ptr + b.length] = 0;
  return ptr;
}

/** Write raw bytes into the scratch buffer; return `{ ptr, len }`. */
function rawBytes(data: Uint8Array): { ptr: number; len: number } {
  if (data.length === 0) return { ptr: num('wn_sqlite_scratch', 1), len: 0 };
  const ptr = num('wn_sqlite_scratch', data.length);
  mem().set(data, ptr);
  return { ptr, len: data.length };
}

/** SQLite library version string (e.g. `3.53.4`). */
export function sqliteVersion(): string {
  return cstr(num('wn_sqlite_version'));
}

/** One open connection. Owns a raw `sqlite3*`. */
export class SqliteDb {
  #ptr = 0;
  #path: string;

  constructor(path: string, flags: number) {
    this.#path = path;
    const ptr = num('wn_sqlite_open', cstring(path), flags);
    if (!ptr) throw new SqliteError('node:sqlite: failed to open database', 0, '');
    this.#ptr = ptr;
  }

  get path(): string {
    return this.#path;
  }

  private assertOpen(): number {
    if (this.#ptr === 0) {
      const err = new Error('database is not open');
      (err as Error & { code?: string }).code = 'ERR_INVALID_STATE';
      throw err;
    }
    return this.#ptr;
  }

  close(): void {
    const ptr = this.assertOpen();
    const rc = num('wn_sqlite_close', ptr);
    this.#ptr = 0;
    if (rc !== SQLITE_OK) throw new SqliteError('failed to close database', rc, '');
  }

  errmsg(): string {
    return this.#ptr ? cstr(num('wn_sqlite_errmsg', this.#ptr)) : '';
  }

  extendedErrcode(): number {
    return this.#ptr ? num('wn_sqlite_extended_errcode', this.#ptr) : 0;
  }

  private check(rc: number, fallback: string): number {
    if (rc !== SQLITE_OK && rc !== SQLITE_ROW && rc !== SQLITE_DONE) {
      throw new SqliteError(this.errmsg() || fallback, this.extendedErrcode(), this.errmsg());
    }
    return rc;
  }

  exec(sql: string): void {
    const ptr = this.assertOpen();
    this.check(num('wn_sqlite_exec', ptr, cstring(sql)), 'exec failed');
  }

  changes(): number {
    return Number(fn('wn_sqlite_changes')(this.assertOpen()) as bigint);
  }

  lastInsertRowid(): number {
    return Number(fn('wn_sqlite_last_insert_rowid')(this.assertOpen()) as bigint);
  }

  prepare(sql: string): SqliteStmt {
    const ptr = this.assertOpen();
    const stmt = num('wn_sqlite_prepare', ptr, cstring(sql), -1);
    if (!stmt) throw new SqliteError(this.errmsg() || 'prepare failed', this.extendedErrcode(), this.errmsg());
    return new SqliteStmt(stmt);
  }
}

/** One prepared statement. */
export class SqliteStmt {
  #ptr = 0;

  constructor(ptr: number) {
    this.#ptr = ptr;
  }

  finalize(): void {
    if (this.#ptr) {
      num('wn_sqlite_finalize', this.#ptr);
      this.#ptr = 0;
    }
  }

  step(): number {
    return num('wn_sqlite_step', this.#ptr);
  }

  reset(): void {
    num('wn_sqlite_reset', this.#ptr);
  }

  clearBindings(): void {
    num('wn_sqlite_clear_bindings', this.#ptr);
  }

  columnCount(): number {
    return num('wn_sqlite_column_count', this.#ptr);
  }

  columnName(i: number): string {
    return cstr(num('wn_sqlite_column_name', this.#ptr, i));
  }

  bindParameterCount(): number {
    return num('wn_sqlite_bind_parameter_count', this.#ptr);
  }

  bindParameterIndex(name: string): number {
    return num('wn_sqlite_bind_parameter_index', this.#ptr, cstring(name));
  }

  bindParameterName(i: number): string | null {
    const ptr = num('wn_sqlite_bind_parameter_name', this.#ptr, i);
    return ptr ? cstr(ptr) : null;
  }

  columnType(i: number): number {
    return num('wn_sqlite_column_type', this.#ptr, i);
  }

  /** Read a column as a JS value, matching Node's `SQLITE_VALUE_TO_JS` + `IntegerToValue`. */
  columnValue(i: number, bigInts: boolean): null | number | bigint | string | Uint8Array {
    switch (this.columnType(i)) {
      case TYPE_INTEGER: {
        const v = fn('wn_sqlite_column_int64')(this.#ptr, i) as bigint;
        if (bigInts) return v;
        if (v < MIN_SAFE || v > MAX_SAFE) {
          const err = new RangeError(`Value is too large to be represented as a JavaScript number: ${v}`);
          (err as Error & { code?: string }).code = 'ERR_OUT_OF_RANGE';
          throw err;
        }
        return Number(v);
      }
      case TYPE_FLOAT:
        return num('wn_sqlite_column_double', this.#ptr, i);
      case TYPE_TEXT: {
        const len = num('wn_sqlite_column_bytes', this.#ptr, i);
        const ptr = num('wn_sqlite_column_text', this.#ptr, i);
        return decoder.decode(bytesAt(ptr, len));
      }
      case TYPE_BLOB: {
        const len = num('wn_sqlite_column_bytes', this.#ptr, i);
        const ptr = num('wn_sqlite_column_blob', this.#ptr, i);
        return bytesAt(ptr, len);
      }
      case TYPE_NULL:
      default:
        return null;
    }
  }

  /** Bind a JS value at 1-based `index`, matching Node's `StatementSync::BindValue`. */
  bindValue(index: number, value: unknown): void {
    const rc = this.#bind(index, value);
    if (rc !== SQLITE_OK) {
      const db = this.#dbPointer();
      throw new SqliteError(
        db ? cstr(num('wn_sqlite_errmsg', db)) : 'bind failed',
        db ? num('wn_sqlite_extended_errcode', db) : rc,
        db ? cstr(num('wn_sqlite_errmsg', db)) : '',
      );
    }
  }

  #bind(index: number, value: unknown): number {
    if (typeof value === 'number') {
      // Node binds every JS `Number` with `sqlite3_bind_double` (verified
      // against src/node_sqlite.cc::BindValue).
      return num('wn_sqlite_bind_double', this.#ptr, index, value);
    }
    if (typeof value === 'bigint') {
      if (value < -9223372036854775808n || value > 9223372036854775807n) {
        const err = new TypeError('BigInt value is too large to bind.');
        (err as Error & { code?: string }).code = 'ERR_INVALID_ARG_VALUE';
        throw err;
      }
      return num('wn_sqlite_bind_int64', this.#ptr, index, value);
    }
    if (typeof value === 'string') {
      const { ptr, len } = rawBytes(encoder.encode(value));
      return num('wn_sqlite_bind_text', this.#ptr, index, ptr, len);
    }
    if (value === null || value === undefined) {
      return num('wn_sqlite_bind_null', this.#ptr, index);
    }
    if (typeof value === 'boolean') {
      return num('wn_sqlite_bind_int64', this.#ptr, index, value ? 1n : 0n);
    }
    if (value instanceof Uint8Array) {
      const { ptr, len } = rawBytes(value);
      return num('wn_sqlite_bind_blob', this.#ptr, index, ptr, len);
    }
    if (value instanceof ArrayBuffer) {
      const { ptr, len } = rawBytes(new Uint8Array(value));
      return num('wn_sqlite_bind_blob', this.#ptr, index, ptr, len);
    }
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      const { ptr, len } = rawBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return num('wn_sqlite_bind_blob', this.#ptr, index, ptr, len);
    }
    const err = new TypeError(`Provided value cannot be bound to SQLite parameter ${index}.`);
    (err as Error & { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }

  /** The owning connection's pointer, reached through the statement (`sqlite3_db_handle`). */
  #dbPointer(): number {
    return 0; // statement-level errmsg falls back to a generic message
  }
}

// --- database image access (persistence) ------------------------------------

/** Read a named in-memory database's bytes, or `undefined` if it does not exist. */
export function readDatabaseImage(path: string): Uint8Array | undefined {
  const pb = encoder.encode(path);
  // Lay out `[path\0][i32 len]` in one scratch allocation so neither address can
  // be invalidated by a second allocation growing the buffer.
  const base = num('wn_sqlite_scratch', pb.length + 1 + 4);
  const view = mem();
  view.set(pb, base);
  view[base + pb.length] = 0;
  const lenPtr = base + pb.length + 1;
  const dataPtr = num('wn_sqlite_getfile', base, lenPtr);
  const len = new Int32Array((ex().memory as WebAssembly.Memory).buffer, lenPtr, 1)[0];
  if (len < 0) return undefined;
  return bytesAt(dataPtr, len);
}

/** Seed a named in-memory database from a byte image (call before opening it). */
export function writeDatabaseImage(path: string, data: Uint8Array): void {
  const pb = encoder.encode(path);
  // Path and data must be resident in scratch *at the same time*; reserve the
  // whole region first so writing the data cannot move the path.
  const base = num('wn_sqlite_scratch', pb.length + 1 + data.length || 1);
  const view = mem();
  view.set(pb, base);
  view[base + pb.length] = 0;
  if (data.length > 0) mem().set(data, base + pb.length + 1);
  num('wn_sqlite_putfile', base, base + pb.length + 1, data.length);
}

/** Register the wasm-backed SQLite surface as an internal binding. */
export function sqliteBinding(_ctx: BindingContext): Record<string, unknown> {
  return {
    sqliteReady,
    sqliteVersion,
    SqliteDb,
    SqliteStmt,
    readDatabaseImage,
    writeDatabaseImage,
    OPEN_READONLY,
    OPEN_READWRITE,
    OPEN_CREATE,
    SQLITE_ROW,
    SQLITE_DONE,
    SQLITE_OK,
    TYPE_INTEGER,
    TYPE_FLOAT,
    TYPE_TEXT,
    TYPE_BLOB,
    TYPE_NULL,
  };
}
