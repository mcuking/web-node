// Dump the `internalBinding(...)` ids Node's own `lib/` asks for.
//
// The list feeds `test/fixtures/node-bindings.json`, which is what pins the
// runtime's binding census: every registered binding, and every binding it
// deliberately does not ship, has to be one of these names. Node's source
// checkout is needed, so point `NODE_SRC` at it if it is not the default.
//
//   node tools/binding-names-oracle.mjs > test/fixtures/node-bindings.json
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NODE_SRC = process.env.NODE_SRC ?? '/Users/tangjianghong/Downloads/node';
const LIB = join(NODE_SRC, 'lib');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

if (!statSync(LIB, { throwIfNoEntry: false })) {
  console.error(`no Node lib/ at ${LIB}; set NODE_SRC to a Node checkout`);
  process.exit(1);
}

const names = new Set();
for (const file of walk(LIB)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/internalBinding\(\s*['"]([a-z0-9_]+)['"]\s*\)/g)) {
    if (!match[1].startsWith('internal/')) names.add(match[1]);
  }
}

console.log(JSON.stringify({ source: `Node ${NODE_SRC}`, names: [...names].sort() }, null, 2));
