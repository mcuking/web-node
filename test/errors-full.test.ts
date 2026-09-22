import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import full from './fixtures/errors-full.json';

/**
 * Breadth differential for the *whole* `internal/errors` table.
 *
 * `tools/errors-full-oracle.mjs` (run under `node --expose-internals`) walks
 * every code Node defines, discovers each constructor's arity (string messages
 * assert an exact count; function messages are probed until one builds), and
 * records the constructed error's observable fields for a fixed placeholder
 * argument vector. This replays those vectors through web-node's shim for every
 * code we carry and compares name / code / message / error-ness / own props /
 * variant bases.
 *
 * `test/errors-corpus.test.ts` covers the same codes with realistic arguments
 * (the ones call sites actually pass); this one adds breadth so a template or
 * base drift in any single code is caught without a hand-written case.
 *
 * Regenerate the fixture with:
 *
 *   node --expose-internals tools/errors-full-oracle.mjs > test/fixtures/errors-full.json
 */

type Entry = {
  code: string;
  args: unknown[];
  built?: boolean;
  name?: string;
  errorCode?: string;
  message?: string;
  isError?: boolean;
  isTypeError?: boolean;
  isRangeError?: boolean;
  isSyntaxError?: boolean;
  props?: Record<string, unknown>;
  extra?: Record<string, { name: string; code: string; message: string }>;
};
const oracle = full as Record<string, Entry>;

function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('internal/errors') as { codes: Record<string, any> };
}

function describeHere(C: any, args: unknown[]) {
  let err: any;
  try {
    err = new C(...args);
  } catch (e: any) {
    return { threw: `${e.name}: ${e.message}` };
  }
  const props: Record<string, unknown> = {};
  for (const k of Object.keys(err)) if (k !== 'code') props[k] = err[k];
  const extra: Record<string, { name: string; code: string; message: string }> = {};
  for (const k of ['TypeError', 'RangeError', 'SyntaxError', 'Error']) {
    if (typeof C[k] === 'function') {
      const e = new C[k](...args);
      extra[k] = { name: e.name, code: e.code, message: e.message };
    }
  }
  return {
    name: err.name,
    errorCode: err.code,
    message: err.message,
    isError: err instanceof Error,
    isTypeError: err instanceof TypeError,
    isRangeError: err instanceof RangeError,
    isSyntaxError: err instanceof SyntaxError,
    props,
    extra,
  };
}

describe('internal/errors full differential (vs Node v26.9.0)', () => {
  const { codes } = boot();

  const shared = Object.values(oracle).filter(
    (e) => e.built && typeof codes[e.code] === 'function',
  );

  it('carries a meaningful slice of the table (guards against silent shrinkage)', () => {
    expect(shared.length).toBeGreaterThanOrEqual(80);
  });

  it('every shared code matches Node field-for-field', () => {
    const drift: string[] = [];
    for (const entry of shared) {
      const got = describeHere(codes[entry.code], entry.args) as any;
      const want = entry as any;
      if (got.threw) {
        drift.push(`${entry.code}: shim threw ${got.threw}`);
        continue;
      }
      for (const k of [
        'name',
        'errorCode',
        'message',
        'isError',
        'isTypeError',
        'isRangeError',
        'isSyntaxError',
      ]) {
        if (JSON.stringify(want[k]) !== JSON.stringify(got[k])) {
          drift.push(`${entry.code} ${k}: node=${JSON.stringify(want[k])} shim=${JSON.stringify(got[k])}`);
        }
      }
      for (const k of ['props', 'extra']) {
        if (JSON.stringify(want[k]) !== JSON.stringify(got[k])) {
          drift.push(`${entry.code} ${k}: node=${JSON.stringify(want[k])} shim=${JSON.stringify(got[k])}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });
});
