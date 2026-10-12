/**
 * `node:sqlite` — the synchronous SQLite API over the **real upstream SQLite**,
 * compiled to WebAssembly (M148).
 *
 * Node's `node:sqlite` is a native binding over `deps/sqlite/sqlite3.c`. Here the
 * same amalgamation is built with wasi-sdk (`native/src/wn_sqlite.c` + the
 * unmodified `deps/sqlite/sqlite3.c`) and reached through `internalBinding('sqlite')`,
 * so the SQL semantics — affinity, types, constraints, JSON/date functions,
 * FTS5/RTREE — are the ones real Node ships.
 *
 * The gate is a shared observation program (`tools/sqlite-probe.mjs`) run both on
 * a real Node oracle (which produced `test/fixtures/sqlite.json`) and inside
 * web-node: the two JSON blobs must be **equal**. The focused checks below exist
 * so a failure points at *what* drifted.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const encoder = new TextEncoder();
const expected = JSON.parse(readFileSync('test/fixtures/sqlite.json', 'utf8')) as Record<string, unknown>;

/** Run `body` inside the runtime and collect everything it prints. */
function runBody(body: string, waitMs = 6000): Promise<string[]> {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', encoder.encode(body));
  const lines: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (chunk) => lines.push(chunk),
    onStderr: (chunk) => lines.push(chunk),
  });
  runtime.runMain('/project/index.js');
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs;
    let joined = '';
    let stable = 0;
    const poll = (): void => {
      const now = lines.join('');
      if (now !== joined) {
        joined = now;
        stable = 0;
      } else if (now.length > 0 && ++stable >= 8) {
        resolve(joined.split('\n').filter((line) => line.length > 0));
        return;
      }
      if (Date.now() > deadline) {
        resolve(joined.split('\n').filter((line) => line.length > 0));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

const probe = readFileSync('tools/sqlite-probe.cjs', 'utf8');

describe('node:sqlite (real upstream SQLite via wasm)', () => {
  it('matches the real-Node oracle observation program', async () => {
    const lines = await runBody(probe);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('__OBS__')).toBe(true);
    const actual = JSON.parse(lines[0].slice('__OBS__'.length)) as Record<string, unknown>;
    expect(actual).toEqual(expected);
  }, 20000);

  it('round-trips every value type through parameters and results', async () => {
    const lines = await runBody(`
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (i INTEGER, r REAL, s TEXT, b BLOB, n)');
const stmt = db.prepare('INSERT INTO t VALUES (?, ?, ?, ?, ?)');
stmt.run(7, 2.5, 'hi', Buffer.from([1, 2, 3]), null);
const row = db.prepare('SELECT i, r, s, b, n, typeof(i) ti, typeof(r) tr, typeof(s) ts, typeof(b) tb, typeof(n) tn FROM t').get();
console.log(JSON.stringify({
  i: row.i, r: row.r, s: row.s,
  b: Array.from(row.b),
  n: row.n,
  types: [row.ti, row.tr, row.ts, row.tb, row.tn],
}));
`);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      i: 7,
      r: 2.5,
      s: 'hi',
      b: [1, 2, 3],
      n: null,
      types: ['integer', 'real', 'text', 'blob', 'null'],
    });
  }, 20000);

  it('binds named parameters (with and without the prefix)', async () => {
    const lines = await runBody(`
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (a, b)');
const s = db.prepare('INSERT INTO t VALUES (:a, :b)');
s.run({ a: 1, b: 2 });
s.run({ ':a': 3, ':b': 4 });
db.prepare('INSERT INTO t VALUES (?, ?)').run(5, 6);
console.log(JSON.stringify(db.prepare('SELECT a, b FROM t ORDER BY a').all()));
`);
    expect(JSON.parse(lines[0])).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
      { a: 5, b: 6 },
    ]);
  }, 20000);

  it('reports changes and lastInsertRowid, and returns bigints when asked', async () => {
    const lines = await runBody(`
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
const ins = db.prepare('INSERT INTO t (v) VALUES (?)');
const r1 = ins.run('x');
const r2 = ins.run('y');
const s = db.prepare('SELECT id FROM t ORDER BY id');
s.setReadBigInts(true);
const big = s.all();
console.log(JSON.stringify({
  c1: r1.changes, id1: r1.lastInsertRowid,
  c2: r2.changes, id2: r2.lastInsertRowid,
  big: big.map((row) => typeof row.id),
}));
`);
    expect(JSON.parse(lines[0])).toEqual({
      c1: 1,
      id1: 1,
      c2: 1,
      id2: 2,
      big: ['bigint', 'bigint'],
    });
  }, 20000);

  it('surfaces SQLite errors with code ERR_SQLITE_ERROR', async () => {
    const lines = await runBody(`
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
try {
  db.exec('SELECT * FROM missing_table');
} catch (err) {
  console.log(JSON.stringify({ code: err.code, name: err.name }));
}
`);
    expect(JSON.parse(lines[0])).toEqual({ code: 'ERR_SQLITE_ERROR', name: 'Error' });
  }, 20000);
});
