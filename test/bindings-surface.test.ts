import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { VENDORED } from '../src/node-runtime/vendored';
import { ERRNO } from '../src/node-runtime/vfs/types';
import real from './fixtures/bind-real.json';

/**
 * Structural + value guard for the `internalBinding(...)` surface.
 *
 * Node's internal code reaches the host only through `internalBinding(id)`, then
 * destructures or reads named properties off it. If the runtime's binding does
 * not define a name, that read is `undefined` and the call site throws
 * "is not a function" the first time that (often rare) path runs — the same
 * class of latent bug the `internal/errors` table had. This walks the whole
 * vendored tree, collects every property path the code reads off a binding, and
 * fails if any is missing.
 *
 * It also pins the *values* of the binding constants that have a canonical
 * definition (libuv errnos, V8 enum ordinals, `constants.internal`), so a typo
 * cannot slip in.
 */

function boot(): NodeRuntime {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  return new NodeRuntime({ vfs, argv: ['/project/index.js'], installGlobals: false, onStdout: () => {}, onStderr: () => {} });
}

/** `const { a, b: c } = internalBinding('id').suffix` → [path[], id, file]. */
function bindingDestructures(file: string, source: string): Array<[string[], string, string]> {
  const out: Array<[string[], string, string]> = [];
  const re = /(?:const|let|var)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*=\s*internalBinding\(\s*['"]([^'"]+)['"]\s*\)((?:\.[A-Za-z_$][\w$]*)*)/g;
  let m;
  while ((m = re.exec(source))) {
    const prefix = m[3] ? m[3].slice(1).split('.') : [];
    const entries: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of m[1]) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (ch === ',' && depth === 0) { entries.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) entries.push(cur);
    for (const e of entries) {
      const t = e.trim();
      if (!t || t.startsWith('...')) continue;
      const colon = t.indexOf(':');
      if (colon === -1) {
        if (/^[A-Za-z_$][\w$]*$/.test(t)) out.push([[...prefix, t], m[2], file]);
      } else {
        const prop = t.slice(0, colon).trim();
        const rest = t.slice(colon + 1).trim();
        if (rest.startsWith('{')) {
          const inner = rest.slice(1, rest.lastIndexOf('}'));
          for (const part0 of inner.split(',')) {
            const p = part0.trim().split(':')[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(p)) out.push([[...prefix, prop, p], m[2], file]);
          }
        } else if (/^[A-Za-z_$][\w$]*$/.test(prop)) {
          out.push([[...prefix, prop], m[2], file]);
        }
      }
    }
  }
  return out;
}

/** `internalBinding('id').a.b` (inline reads) → [path[], id, file]. */
function bindingInlineReads(file: string, source: string): Array<[string[], string, string]> {
  const out: Array<[string[], string, string]> = [];
  const re = /internalBinding\(\s*['"]([^'"]+)['"]\s*\)((?:\.[A-Za-z_$][\w$]*)+)/g;
  let m;
  while ((m = re.exec(source))) {
    out.push([m[2].slice(1).split('.'), m[1], file]);
  }
  return out;
}

describe('internalBinding surface', () => {
  const rt = boot();
  const resolve = (path: string[], id: string): unknown => {
    let mod: unknown;
    try { mod = rt.realm.internalBinding(id); } catch { return Symbol('no-binding'); }
    let cur: any = mod;
    for (const key of path) {
      if (cur == null || typeof cur !== 'object' || !(key in cur)) return undefined;
      cur = cur[key];
    }
    return cur;
  };

  it('defines every binding property the vendored tree reads', () => {
    const missing: string[] = [];
    let scanned = 0;
    for (const [file, source] of Object.entries(VENDORED)) {
      for (const [path, id] of [
        ...bindingDestructures(file, source),
        ...bindingInlineReads(file, source),
      ]) {
        if (id.startsWith('internal/')) continue; // handled by another test
        scanned++;
        if (resolve(path, id) === undefined) missing.push(`${file}  [${id} -> ${path.join('.')}]`);
      }
    }
    expect(scanned).toBeGreaterThan(200);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('publishes the full libuv errno constant set with Node\'s values', () => {
    const expected = Object.fromEntries(
      Object.entries(real.uv)
        .filter(([k, v]) => k.startsWith('UV_') && typeof v === 'number'),
    );
    const actual = Object.fromEntries(
      Object.keys(expected).map((k) => [k, resolve([k], 'uv')]),
    );
    expect(actual).toEqual(expected);
    // Every constant traces back to the shared `ERRNO` table, so `getErrorMap`
    // and the named constants can never disagree.
    for (const [name, errno] of Object.entries(ERRNO)) {
      expect(resolve([`UV_${name}`], 'uv'), name).toBe(errno);
    }
  });

  it('publishes the V8 sampling flags the heap profiler builds its mask from', () => {
    for (const [name, value] of [
      ['kSamplingNoFlags', 0],
      ['kSamplingForceGC', 1],
      ['kSamplingIncludeObjectsCollectedByMajorGC', 2],
      ['kSamplingIncludeObjectsCollectedByMinorGC', 4],
    ] as const) {
      expect(resolve([name], 'v8'), name).toBe(value);
    }
  });

  it('publishes constants.internal (extensionless module formats)', () => {
    expect(resolve(['internal'], 'constants')).toEqual({
      EXTENSIONLESS_FORMAT_JAVASCRIPT: 0,
      EXTENSIONLESS_FORMAT_WASM: 1,
    });
  });

  it('reads the util binding the vendored stream/iter code expects', async () => {
    // `internal/streams/iter/*` calls this on promises it abandons. Without the
    // binding function the call site throws "is not a function"; with it, the
    // rejected promise must not surface as an unhandled rejection.
    const util = rt.realm.internalBinding('util') as { markPromiseAsHandled?: (p: Promise<unknown>) => void };
    expect(typeof util.markPromiseAsHandled).toBe('function');
    const rejected = Promise.reject(new Error('suppressed by markPromiseAsHandled'));
    util.markPromiseAsHandled!(rejected);
    await new Promise((r) => setTimeout(r, 0));
  });

  it('refuses dlopen loudly rather than faking a handle', () => {
    const pm = rt.realm.internalBinding('process_methods') as { dlopenBinary: () => unknown };
    expect(() => pm.dlopenBinary()).toThrow(/not implemented|NotImplemented/i);
  });
});
