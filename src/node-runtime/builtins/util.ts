import type { BuiltinSpec } from './types';

/** `util` builtin — formatting, inspection, promisify, type helpers. */
export const utilSpec: BuiltinSpec = {
  id: 'util',
  aliases: ['node:util'],
  origin: 'web-node',
  init: (ctx) => {
    // The real `internal/util/inspect.js` is vendored now; `util.inspect`,
    // `util.format` and `util.formatWithOptions` come straight from it, so
    // formatting matches Node exactly (depth, colours, circular refs, custom
    // inspect symbols, promise/collection/tag handling, …).
    const {
      inspect,
      format,
      formatWithOptions,
    } = ctx.require('internal/util/inspect') as {
      inspect: ((value: unknown, opts?: unknown) => string) & {
        custom: symbol;
        defaultOptions: Record<string, unknown>;
        colors: Record<string, [number, number]>;
      };
      format: (f: unknown, ...args: unknown[]) => string;
      formatWithOptions: (opts: unknown, f: unknown, ...args: unknown[]) => string;
    };

    // `util.types` is `require('internal/util/types')` in Node; that module is
    // now the real vendored source, so use it directly.
    const types = ctx.require('internal/util/types') as Record<string, (v: unknown) => boolean>;

    // `util.isDeepStrictEqual` is Node's real structural comparison (handles
    // Map/Set/typed arrays/cycles/prototypes); the hand-rolled version that
    // used to live here was a shallow approximation.
    const { isDeepStrictEqual } = ctx.require('internal/util/comparisons') as {
      isDeepStrictEqual: (a: unknown, b: unknown) => boolean;
    };

    function promisify(original: (...args: unknown[]) => unknown): (...args: unknown[]) => Promise<unknown> {
      if (typeof original !== 'function') throw new TypeError('The "original" argument must be of type function');
      return function promisified(this: unknown, ...args: unknown[]) {
        return new Promise((resolve, reject) => {
          original.call(this, ...args, (err: unknown, value: unknown) => {
            if (err) reject(err);
            else resolve(value);
          });
        });
      };
    }

    function callbackify(fn: (...args: unknown[]) => Promise<unknown>) {
      return function callbackified(this: unknown, ...args: unknown[]) {
        const cb = args.pop();
        if (typeof cb !== 'function') throw new TypeError('The last argument must be of type function');
        fn.apply(this, args).then(
          (v) => queueMicrotask(() => (cb as (e: null, v: unknown) => void)(null, v)),
          (e) => queueMicrotask(() => (cb as (e: unknown) => void)(e)),
        );
      };
    }

    function inherits(ctor: { prototype: object }, superCtor: { prototype: object }): void {
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
    }

    function deprecate<T extends (...args: never[]) => unknown>(fn: T, _msg: string, _code?: string): T {
      return fn;
    }

    function stripVTControlCharacters(str: string): string {
      // eslint-disable-next-line no-control-regex
      return str.replace(/\u001b\[[0-9;]*m/g, '');
    }

    function styleText(_format: unknown, text: string, _opts?: unknown): string {
      return text;
    }

    return {
      format,
      formatWithOptions,
      inspect,
      types,
      isDeepStrictEqual,
      promisify,
      callbackify,
      inherits,
      deprecate,
      stripVTControlCharacters,
      styleText,
      toUSVString: (s: string) => s,
      getSystemErrorName: (code: number) => String(code),
      getSystemErrorMap: () => new Map(),
      TextEncoder,
      TextDecoder,
      debuglog: () => () => undefined,
      debug: () => undefined,
      parseArgs: () => {
        throw new Error('util.parseArgs is not supported in web-node yet');
      },
      transferableAbortController: () => new AbortController(),
      transferableAbortSignal: (s: AbortSignal) => s,
      aborted: () => new Promise(() => undefined),
      emitWarning: () => undefined,
      setTraceSigInt: () => undefined,
      getCallSites: () => [],
      isCollected: () => false,
      MIMEType: undefined,
      MIMEParams: undefined,
      _errnoException: (err: unknown) => err,
    };
  },
};
