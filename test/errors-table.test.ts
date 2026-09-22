import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { VENDORED } from '../src/node-runtime/vendored';

/**
 * Structural guard for the `internal/errors` code table.
 *
 * A vendored module that pulls a code off `internal/errors` gets `undefined` if
 * the shim does not define it, and the `new ERR_X(...)` at the call site then
 * throws "is not a constructor" — a latent bug that only surfaces on the rare
 * path that reaches it (that is how ERR_NO_TEMPORAL, ERR_USE_AFTER_CLOSE and
 * friends were hiding). This walks the whole vendored tree, collects the codes
 * it references, and fails if any is missing from the table.
 */

/** Codes a source file pulls off `internal/errors`, destructured or inline. */
function referencedCodes(source: string): string[] {
  const found = new Set<string>();
  // `const { … } = require('internal/errors')` — one or more codes in the braces.
  for (const m of source.matchAll(/const\s*\{([\s\S]*?)\}\s*=\s*require\('internal\/errors'\)/g)) {
    for (const c of m[1].matchAll(/\b(ERR_[A-Z0-9_]+)\b/g)) found.add(c[1]);
  }
  // `require('internal/errors').codes.ERR_X`
  for (const m of source.matchAll(/require\('internal\/errors'\)\.codes\.(ERR_[A-Z0-9_]+)/g)) {
    found.add(m[1]);
  }
  return [...found];
}

describe('internal/errors table covers every referenced code', () => {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  const { codes } = runtime.realm.require('internal/errors') as { codes: Record<string, unknown> };

  const missing: string[] = [];
  const seen = new Set<string>();
  for (const [file, source] of Object.entries(VENDORED)) {
    for (const code of referencedCodes(source)) {
      seen.add(code);
      if (typeof codes[code] !== 'function') missing.push(`${code} (${file})`);
    }
  }

  it('scans a non-trivial number of codes', () => {
    expect(seen.size).toBeGreaterThan(50);
  });

  it('defines every referenced code as a constructor', () => {
    expect(missing).toEqual([]);
  });
});
