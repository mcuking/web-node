import type { BuiltinSpec, BuiltinInitContext } from './types';

/** `assert` builtin. */
export const assertSpec: BuiltinSpec = {
  id: 'assert',
  aliases: ['node:assert'],
  origin: 'web-node',
  deps: ['util'],
  init: (ctx: BuiltinInitContext) => {
    const util = ctx.require('util') as { isDeepStrictEqual: (a: unknown, b: unknown) => boolean; inspect: (v: unknown) => string };

    class AssertionError extends Error {
      code = 'ERR_ASSERTION';
      actual: unknown;
      expected: unknown;
      operator: string;
      generatedMessage = true;
      constructor(opts: { message?: string; actual?: unknown; expected?: unknown; operator?: string }) {
        super(opts.message ?? 'Assertion failed');
        this.name = 'AssertionError';
        this.actual = opts.actual;
        this.expected = opts.expected;
        this.operator = opts.operator ?? '==';
      }
    }

    function ok(value: unknown, message?: string | Error): void {
      if (!value) {
        throw message instanceof Error
          ? message
          : new AssertionError({ message: message ?? `The expression evaluated to a falsy value: ${util.inspect(value)}`, actual: value, expected: true, operator: '==' });
      }
    }

    function strictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
      if (!Object.is(actual, expected)) {
        throw message instanceof Error
          ? message
          : new AssertionError({ message: message ?? `${util.inspect(actual)} !== ${util.inspect(expected)}`, actual, expected, operator: 'strictEqual' });
      }
    }

    function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
      if (!util.isDeepStrictEqual(actual, expected)) {
        throw message instanceof Error
          ? message
          : new AssertionError({ message: message ?? 'Values are not deeply equal', actual, expected, operator: 'deepStrictEqual' });
      }
    }

    function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
      if (Object.is(actual, expected)) {
        throw message instanceof Error ? message : new AssertionError({ message: message ?? 'Values are strictly equal', actual, expected, operator: 'notStrictEqual' });
      }
    }

    function throws(fn: () => unknown, message?: string | Error): void {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      if (!threw) throw message instanceof Error ? message : new AssertionError({ message: message ?? 'Missing expected exception', operator: 'throws' });
    }

    async function rejects(fn: () => Promise<unknown>, message?: string | Error): Promise<void> {
      let threw = false;
      try {
        await fn();
      } catch {
        threw = true;
      }
      if (!threw) throw message instanceof Error ? message : new AssertionError({ message: message ?? 'Missing expected rejection', operator: 'rejects' });
    }

    function fail(message?: string | Error): never {
      throw message instanceof Error ? message : new AssertionError({ message: message ?? 'Failed', operator: 'fail' });
    }

    const assert = Object.assign(ok, {
      ok,
      equal: (a: unknown, b: unknown, m?: string | Error) => {
        // eslint-disable-next-line eqeqeq
        if (a != b) throw new AssertionError({ message: typeof m === 'string' ? m : 'Values are not equal', actual: a, expected: b, operator: '==' });
      },
      notEqual: (a: unknown, b: unknown, m?: string | Error) => {
        // eslint-disable-next-line eqeqeq
        if (a == b) throw new AssertionError({ message: typeof m === 'string' ? m : 'Values are equal', actual: a, expected: b, operator: '!=' });
      },
      strictEqual,
      notStrictEqual,
      deepStrictEqual,
      deepEqual: deepStrictEqual,
      notDeepStrictEqual: (a: unknown, b: unknown, m?: string | Error) => {
        if (util.isDeepStrictEqual(a, b)) throw new AssertionError({ message: typeof m === 'string' ? m : 'Values are deeply equal', actual: a, expected: b, operator: 'notDeepStrictEqual' });
      },
      throws,
      rejects,
      doesNotThrow: (fn: () => unknown) => fn(),
      doesNotReject: async (fn: () => Promise<unknown>) => await fn(),
      ifError: (v: unknown) => {
        if (v) throw v;
      },
      fail,
      AssertionError,
      CallTracker: class {},
    });

    return { ...assert, default: assert };
  },
};
