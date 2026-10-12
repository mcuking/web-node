// Differential observation program for `node:sqlite`. Runs on real Node AND in
// web-node.
//
// Only the public API is touched (`new DatabaseSync`, `prepare`, `run`/`get`/
// `all`/`iterate`, `exec`, transactions, `sqlite_version()`). Output is a single
// `__OBS__<json>` line so the two runs compare as one blob.
//
// Row objects are copied into plain objects before `JSON.stringify`, so the
// comparison is about *values and types*, not about Node's null-prototype rows.

const { DatabaseSync } = require('node:sqlite');

const out = {};
const plain = (row) => (row === undefined ? undefined : JSON.parse(JSON.stringify(row)));

const db = new DatabaseSync(':memory:');

// --- version ----------------------------------------------------------------

out.version = db.prepare('SELECT sqlite_version() AS v').get().v;
out.foreignKeysDefault = db.prepare('PRAGMA foreign_keys').get().foreign_keys;

// --- DDL + types ------------------------------------------------------------

db.exec(`
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    i INTEGER,
    r REAL,
    s TEXT,
    b BLOB,
    n
  )
`);
const ins = db.prepare('INSERT INTO t (i, r, s, b, n) VALUES (?, ?, ?, ?, ?)');
const insResults = [
  plain(ins.run(7, 2.5, 'hi', Buffer.from([1, 2, 3]), null)),
  plain(ins.run(-3, 0.1, 'uni: 你好 🦀', Buffer.alloc(0), 42)),
];

out.insertResults = insResults;
out.rows = db.prepare('SELECT i, r, s, b, n FROM t ORDER BY id').all().map((row) => ({
  i: row.i,
  r: row.r,
  s: row.s,
  b: row.b === null ? null : Array.from(row.b),
  n: row.n,
}));
out.typeofs = db
  .prepare('SELECT typeof(i) ti, typeof(r) tr, typeof(s) ts, typeof(b) tb, typeof(n) tn FROM t ORDER BY id')
  .all()
  .map(plain);

// --- named parameters -------------------------------------------------------

db.exec('CREATE TABLE named (a, b)');
const named = db.prepare('INSERT INTO named VALUES (:a, :b)');
named.run({ a: 1, b: 2 });
named.run({ ':a': 3, ':b': 4 });
db.prepare('INSERT INTO named VALUES (?, ?)').run(5, 6);
out.named = db.prepare('SELECT a, b FROM named ORDER BY a').all().map(plain);

// --- aggregates + arithmetic ------------------------------------------------

db.exec('CREATE TABLE nums (v INTEGER)');
const nIns = db.prepare('INSERT INTO nums (v) VALUES (?)');
for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) nIns.run(v);
out.agg = plain(
  db.prepare('SELECT count(*) c, sum(v) s, avg(v) a, min(v) mn, max(v) mx FROM nums').get(),
);

// --- JSON + date-ish deterministic functions --------------------------------

out.json = plain(
  db.prepare("SELECT json_extract('{\"a\":{\"b\":[10,20]}}', '$.a.b[1]') AS v").get(),
);
out.jsonArray = db.prepare("SELECT json_array(1, 'x', null) AS v").get().v;
out.abs = plain(db.prepare('SELECT abs(-5) a, round(2.5) r, length(\'hello\') l').get());

// --- string functions -------------------------------------------------------

out.strings = plain(
  db.prepare("SELECT upper('abc') u, lower('ABC') l, substr('hello', 2, 3) s, replace('a.b.c', '.', '/') r").get(),
);

// --- transactions + changes -------------------------------------------------

db.exec('CREATE TABLE tx (x)');
db.exec('BEGIN');
db.prepare('INSERT INTO tx VALUES (1)').run();
db.prepare('INSERT INTO tx VALUES (2)').run();
const inTx = db.isTransaction;
db.exec('COMMIT');
out.transaction = { inTx, after: db.isTransaction, rows: db.prepare('SELECT x FROM tx ORDER BY x').all().map(plain) };

// --- bigints ----------------------------------------------------------------

const bigStmt = db.prepare('SELECT id FROM t ORDER BY id');
bigStmt.setReadBigInts(true);
const big = bigStmt.all();
out.bigints = big.map((row) => typeof row.id + ':' + row.id.toString());

// --- iterate ----------------------------------------------------------------

const iter = [];
for (const row of db.prepare('SELECT v FROM nums WHERE v % 2 = 0 ORDER BY v').iterate()) {
  iter.push(row.v);
}
out.iterated = iter;

// --- errors -----------------------------------------------------------------

const errOf = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return { code: err.code, name: err.name, hasMessage: typeof err.message === 'string' && err.message.length > 0 };
  }
};
out.err = {
  missingTable: errOf(() => db.exec('SELECT * FROM does_not_exist')),
  syntax: errOf(() => db.exec('SELEKT 1')),
  badBindCount: errOf(() => db.prepare('SELECT ?').get()), // wrong arg count
  unknownNamed: errOf(() => db.prepare('SELECT :x').get({ y: 1 })),
};

// --- constraints ------------------------------------------------------------

db.exec('CREATE TABLE uniq (id INTEGER PRIMARY KEY, e TEXT UNIQUE)');
db.prepare('INSERT INTO uniq (e) VALUES (?)').run('a');
out.uniqueViolation = errOf(() => db.prepare('INSERT INTO uniq (e) VALUES (?)').run('a'));

// --- FTS5 -------------------------------------------------------------------

db.exec("CREATE VIRTUAL TABLE ft USING fts5(body)");
const ftIns = db.prepare('INSERT INTO ft (body) VALUES (?)');
ftIns.run('the quick brown fox');
ftIns.run('lazy dog sleeps');
out.fts5 = db.prepare("SELECT body FROM ft WHERE ft MATCH 'quick'").all().map((row) => row.body);

// --- json object round trip through a column --------------------------------

db.exec('CREATE TABLE j (doc TEXT)');
db.prepare('INSERT INTO j VALUES (?)').run(JSON.stringify({ n: 1, list: [1, 2, 3] }));
out.jsonRound = JSON.parse(db.prepare('SELECT doc FROM j').get().doc);

db.close();

console.log('__OBS__' + JSON.stringify(out));
