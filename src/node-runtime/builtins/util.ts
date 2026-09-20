import type { BuiltinSpec } from './types';

/** `util` builtin — formatting, inspection, promisify, type helpers. */
export const utilSpec: BuiltinSpec = {
  id: 'util',
  aliases: ['node:util'],
  origin: 'web-node',
  init: (ctx) => {
    function format(f: unknown, ...args: unknown[]): string {
      if (typeof f !== 'string') {
        return [f, ...args].map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ');
      }
      let i = 0;
      const out = f.replace(/%[sdifjoOc%]/g, (m) => {
        if (m === '%%') return '%';
        if (i >= args.length) return m;
        const a = args[i++];
        switch (m) {
          case '%s':
            return typeof a === 'string' ? a : inspect(a);
          case '%d':
            return String(Number(a));
          case '%i':
            return String(parseInt(String(a), 10));
          case '%f':
            return String(parseFloat(String(a)));
          case '%j':
            try {
              return JSON.stringify(a);
            } catch {
              return '[Circular]';
            }
          case '%o':
          case '%O':
            return inspect(a);
          case '%c':
            return '';
          default:
            return m;
        }
      });
      for (; i < args.length; i++) {
        out.concat(' ', typeof args[i] === 'string' ? (args[i] as string) : inspect(args[i]));
      }
      let result = out;
      for (; i < args.length; i++) {
        result += ' ' + (typeof args[i] === 'string' ? (args[i] as string) : inspect(args[i]));
      }
      return result;
    }

    function formatWithOptions(_opts: unknown, f: unknown, ...args: unknown[]): string {
      return format(f, ...args);
    }

    function inspect(value: unknown, opts?: unknown): string {
      const options = (typeof opts === 'object' && opts !== null ? opts : {}) as {
        depth?: number;
        colors?: boolean;
        showHidden?: boolean;
      };
      const depth = options.depth ?? 2;
      return inspectValue(value, depth, new Set());
    }

    function inspectValue(value: unknown, depth: number, seen: Set<unknown>): string {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      const t = typeof value;
      if (t === 'string') return `'${value as string}'`;
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
      if (t === 'symbol') return (value as symbol).toString();
      if (t === 'function') return `[Function: ${(value as { name?: string }).name || 'anonymous'}]`;
      if (seen.has(value)) return '[Circular]';
      if (depth < 0) return Array.isArray(value) ? '[Array]' : '[Object]';
      seen.add(value);
      let out: string;
      if (Array.isArray(value)) {
        out = '[ ' + value.map((v) => inspectValue(v, depth - 1, seen)).join(', ') + ' ]';
      } else if (value instanceof Date) {
        out = value.toISOString();
      } else if (value instanceof RegExp) {
        out = value.toString();
      } else if (value instanceof Error) {
        out = value.stack ?? `${value.name}: ${value.message}`;
      } else if (ArrayBuffer.isView(value)) {
        const name = (value as { constructor: { name: string } }).constructor.name;
        out = `${name}(${(value as Uint8Array).length}) [ ${Array.from(value as Uint8Array).join(', ')} ]`;
      } else {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj);
        const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
        const prefix = ctor && ctor !== 'Object' ? `${ctor} ` : '';
        out = prefix + '{ ' + keys.map((k) => `${k}: ${inspectValue(obj[k], depth - 1, seen)}`).join(', ') + ' }';
      }
      seen.delete(value);
      return out;
    }

    // `util.types` is `require('internal/util/types')` in Node; that module is
    // now the real vendored source, so use it directly.
    const types = ctx.require('internal/util/types') as Record<string, (v: unknown) => boolean>;

    function isDeepStrictEqual(a: unknown, b: unknown): boolean {
      if (a === b) return true;
      if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
      if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
      if (a instanceof RegExp && b instanceof RegExp) return a.toString() === b.toString();
      const ak = Object.keys(a as object);
      const bk = Object.keys(b as object);
      if (ak.length !== bk.length) return false;
      for (const k of ak) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!isDeepStrictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
      }
      return true;
    }

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
