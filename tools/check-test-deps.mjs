// Which internal modules does the vendored `node:test` need, and does web-node
// provide them? Scoped to the test-runner files only.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'vendor/node-lib';
const SHIMS = 'src/node-runtime/builtins';

const FILES = [
  'test.js',
  'test/reporters.js',
  ...fs
    .readdirSync(path.join(ROOT, 'internal/test_runner'), { recursive: true })
    .filter((p) => typeof p === 'string' && p.endsWith('.js'))
    .map((p) => 'internal/test_runner/' + p.replace(/\\/g, '/')),
];

// A line-oriented state machine: `const {` opens a destructuring block, and the
// names belong to whoever it is bound to (`require('internal/x')` or
// `primordials`). A regex cannot do this — a non-greedy body still runs past the
// closing brace into the next statement.
function scanFile(src) {
  const out = []; // { dest: 'require:internal/x' | 'primordials', names: [] }
  const lines = src.split('\n');
  let open = null;
  for (const line of lines) {
    if (open === null) {
      const m = /^\s*(?:const|let|var)\s*\{/.exec(line);
      if (!m) continue;
      open = { names: [], tail: line.slice(m[0].length) };
      // Single-line: `const { a, b } = require('...');`
      collect(open, line.slice(line.indexOf('{') + 1).split('}')[0] || '');
      if (line.includes('}')) {
        finish(open, line.slice(line.indexOf('}') + 1));
        open = null;
      }
      continue;
    }
    const close = line.indexOf('}');
    if (close === -1) {
      collect(open, line);
      continue;
    }
    collect(open, line.slice(0, close));
    finish(open, line.slice(close + 1));
    open = null;
  }
  return out;

  function collect(state, body) {
    for (const part of body.split(',')) {
      const name = part.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) state.names.push(name);
    }
  }
  function finish(state, rest) {
    const m = /=\s*require\(\s*'(internal\/[^']+)'\s*\)/.exec(rest);
    if (m) out.push({ dest: 'require:' + m[1], names: state.names });
    else if (/=\s*primordials\b/.test(rest)) out.push({ dest: 'primordials', names: state.names });
  }
}

const needed = new Map(); // id -> Map(name -> Set(files))
for (const rel of FILES) {
  for (const { dest, names } of scanFile(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) {
    if (!dest.startsWith('require:')) continue; // primordials are supplied by the realm
    const id = dest.slice('require:'.length);
    if (!needed.has(id)) needed.set(id, new Map());
    for (const n of names) {
      if (!needed.get(id).has(n)) needed.get(id).set(n, new Set());
      needed.get(id).get(n).add(rel);
    }
  }
}

// --- what web-node provides -------------------------------------------------
const isVendored = (id) => fs.existsSync(path.join(ROOT, id + '.js'));
const shimFiles = fs.readdirSync(SHIMS).filter((f) => f.endsWith('.ts'));
const shimSrcOf = (id) => shimFiles.filter((f) => fs.readFileSync(path.join(SHIMS, f), 'utf8').includes(`id: '${id}'`));

/** Keys the shim's `init` returns — heuristic: `  name,` / `  name:` lines. */
function shimKeys(id) {
  const keys = new Set();
  for (const f of shimSrcOf(id)) {
    const src = fs.readFileSync(path.join(SHIMS, f), 'utf8');
    const at = src.indexOf(`id: '${id}'`);
    const block = src.slice(at, at + 8000);
    for (const k of block.matchAll(/^\s{4}([A-Za-z_$][\w$]*)\s*[,:]/gm)) keys.add(k[1]);
  }
  return keys;
}

let problems = 0;
console.log('module'.padEnd(40), 'status');
console.log('-'.repeat(72));
for (const [id, names] of [...needed].sort()) {
  if (isVendored(id)) {
    console.log(id.padEnd(40), `vendored (${names.size} names)`);
    continue;
  }
  if (shimSrcOf(id).length === 0) {
    console.log(id.padEnd(40), `** NO SHIM ** needs ${names.size}: ${[...names.keys()].slice(0, 5).join(', ')}`);
    problems++;
    continue;
  }
  const keys = shimKeys(id);
  const missing = [...names.keys()].filter((n) => !keys.has(n));
  if (missing.length) {
    console.log(id.padEnd(40), `** MISSING ** ${missing.join(', ')}`);
    problems++;
  } else {
    console.log(id.padEnd(40), 'shim ok');
  }
}
console.log('-'.repeat(72));
console.log(problems === 0 ? 'OK' : `${problems} module(s) need work`);
