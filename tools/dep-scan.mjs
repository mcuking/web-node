// Walk `require('internal/...')` / `require('node:...')` deps from a set of entry files.
import fs from 'node:fs';
import path from 'node:path';

const NODE = '/Users/tangjianghong/Downloads/node';
const LIB = path.join(NODE, 'lib');

function resolveId(id, fromFile) {
  // returns absolute file path within lib, or null
  let base;
  if (id.startsWith('internal/') || id.startsWith('node:') || !id.startsWith('.') && !id.startsWith('/')) {
    base = path.join(LIB, id.replace(/^node:/, ''));
  } else {
    base = path.resolve(path.dirname(fromFile), id);
  }
  const cands = [
    base,
    base + '.js',
    path.join(base, 'index.js'),
  ];
  for (const c of cands) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const seen = new Set();
const externals = new Map();

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return; }
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(src))) {
    const id = m[1];
    const r = resolveId(id, file);
    if (r && r.startsWith(LIB)) {
      walk(r);
    } else {
      const n = externals.get(id) || 0;
      externals.set(id, n + 1);
    }
  }
}

const entries = process.argv.slice(2);
for (const e of entries) {
  const abs = path.join(LIB, e);
  walk(abs);
}

const rel = (f) => path.relative(LIB, f);
const files = [...seen].map(rel).sort();
console.log(`=== resolved internal files (${files.length}) ===`);
for (const f of files) console.log('  ' + f);
console.log(`\n=== external/builtin ids (${externals.size}) ===`);
console.log([...externals.keys()].sort().join(', '));
