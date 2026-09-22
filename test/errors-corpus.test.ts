import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import corpus from './fixtures/errors-corpus.json';

/**
 * Differential test for the `internal/errors` code table.
 *
 * `tools/errors-corpus-oracle.mjs` runs under a real Node
 * (`node --expose-internals`) and records, for each case, the class `name`, the
 * `code`, the formatted `message`, which built-in bases the instance matches,
 * the extra own properties, and the extra `E(code, msg, Base, …Extra)` statics.
 * Here we run the identical calls through web-node's `internal/errors` and
 * compare. Regenerate the fixture with:
 *
 *   node --expose-internals tools/errors-corpus-oracle.mjs
 */

type Case = (typeof corpus)[number];

function boot() {
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
  return runtime.realm.require('internal/errors') as { codes: Record<string, any> };
}

const describeHere = (codes: Record<string, any>, c: Case) => {
  const C = codes[c.code];
  if (typeof C !== 'function') return { code: c.code, built: false };
  let err: any;
  try {
    err = new C(...(c.args as unknown[]));
  } catch (e) {
    return { code: c.code, args: c.args, threw: `${(e as Error).name}: ${(e as Error).message}` };
  }
  return {
    code: c.code,
    args: c.args,
    name: err.name,
    errorCode: err.code,
    message: err.message,
    isError: err instanceof Error,
    isTypeError: err instanceof TypeError,
    isRangeError: err instanceof RangeError,
    isSyntaxError: err instanceof SyntaxError,
    props: Object.fromEntries(
      Object.keys(err)
        .filter((k) => k !== 'code')
        .map((k) => [k, err[k]]),
    ),
    extra: ['TypeError', 'RangeError'].reduce<Record<string, unknown>>((acc, k) => {
      if (typeof C[k] === 'function') {
        const e = new C[k](...(c.args as unknown[]));
        acc[k] = { name: e.name, code: e.code, message: e.message };
      }
      return acc;
    }, {}),
  };
};

describe('internal/errors code table (differential vs Node v26.9.0)', () => {
  const { codes } = boot();

  for (const c of corpus as Case[]) {
    const label = `${c.code}(${JSON.stringify(c.args)})`;
    it(`builds ${label}`, () => {
      // Every code the oracle knows must exist as a constructor here.
      expect(typeof codes[c.code]).toBe('function');
      const here = describeHere(codes, c);
      expect(here).toEqual({
        code: c.code,
        args: c.args,
        name: c.name,
        errorCode: c.errorCode,
        message: c.message,
        isError: c.isError,
        isTypeError: c.isTypeError,
        isRangeError: c.isRangeError,
        isSyntaxError: c.isSyntaxError,
        props: c.props,
        extra: c.extra,
      });
    });
  }
});
