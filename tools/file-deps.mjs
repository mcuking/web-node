import fs from 'node:fs';
import path from 'node:path';
const LIB = '/Users/tangjianghong/Downloads/node/lib';
const files = process.argv.slice(2);
const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const ib = /internalBinding\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const f of files) {
  const p = path.join(LIB, f);
  let src = '';
  try { src = fs.readFileSync(p, 'utf8'); } catch { console.log(`${f}: MISSING`); continue; }
  const reqs = new Set(); let m;
  re.lastIndex = 0; while ((m = re.exec(src))) reqs.add(m[1]);
  const binds = new Set();
  ib.lastIndex = 0; while ((m = ib.exec(src))) binds.add(m[1]);
  console.log(`\n### ${f}  (${src.split('\n').length} lines)`);
  console.log('  requires:', [...reqs].sort().join(', ') || '(none)');
  console.log('  bindings:', [...binds].sort().join(', ') || '(none)');
}
