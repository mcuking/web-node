import type { BuiltinSpec, BuiltinInitContext } from './types';

/** `console` builtin. Writes go straight to the binding's stdout/stderr sinks. */
export const consoleSpec: BuiltinSpec = {
  id: 'console',
  aliases: ['node:console'],
  origin: 'web-node',
  deps: ['util'],
  init: (ctx: BuiltinInitContext) => {
    const util = ctx.require('util') as { format: (f: unknown, ...a: unknown[]) => string; inspect: (v: unknown) => string };
    const binding = ctx.binding;

    function stringify(value: unknown): string {
      return typeof value === 'string' ? value : util.inspect(value);
    }

    class Console {
      #stdout: (s: string) => void;
      #stderr: (s: string) => void;
      #groupIndent = '';

      constructor(opts?: { stdout?: (s: string) => void; stderr?: (s: string) => void }) {
        this.#stdout = opts?.stdout ?? binding.writeStdout;
        this.#stderr = opts?.stderr ?? binding.writeStderr;
      }

      log(...args: unknown[]): void {
        this.#stdout(this.#groupIndent + args.map(stringify).join(' ') + '\n');
      }
      info(...args: unknown[]): void {
        this.log(...args);
      }
      debug(...args: unknown[]): void {
        this.log(...args);
      }
      warn(...args: unknown[]): void {
        this.#stderr(this.#groupIndent + args.map(stringify).join(' ') + '\n');
      }
      error(...args: unknown[]): void {
        this.warn(...args);
      }
      trace(...args: unknown[]): void {
        const err = new Error();
        this.#stderr(this.#groupIndent + 'Trace: ' + args.map(stringify).join(' ') + '\n' + (err.stack ?? '') + '\n');
      }
      dir(obj: unknown): void {
        this.log(util.inspect(obj));
      }
      assert(condition: unknown, ...args: unknown[]): void {
        if (!condition) this.#stderr('Assertion failed' + (args.length ? ': ' + args.map(stringify).join(' ') : '') + '\n');
      }
      count(label = 'default'): void {
        this.log(`${label}: 1`);
      }
      countReset(label = 'default'): void {
        this.log(`${label}: 0`);
      }
      group(...args: unknown[]): void {
        this.log(...args);
        this.#groupIndent += '  ';
      }
      groupCollapsed(...args: unknown[]): void {
        this.group(...args);
      }
      groupEnd(): void {
        this.#groupIndent = this.#groupIndent.slice(2);
      }
      table(data: unknown): void {
        this.log(util.inspect(data));
      }
      time(label = 'default'): void {
        this.log(`${label}: 0ms`);
      }
      timeEnd(label = 'default'): void {
        this.log(`${label}: 0ms`);
      }
      timeLog(label = 'default'): void {
        this.log(`${label}: 0ms`);
      }
      clear(): void {
        /* no-op: no terminal to clear in-browser */
      }
      profile(): void {
        /* no-op */
      }
      profileEnd(): void {
        /* no-op */
      }
    }

    const globalConsole = new Console();
    const api: Record<string, unknown> = { Console, default: globalConsole };
    const methods = [
      'log', 'info', 'debug', 'warn', 'error', 'trace', 'dir', 'assert', 'count', 'countReset',
      'group', 'groupCollapsed', 'groupEnd', 'table', 'time', 'timeEnd', 'timeLog', 'clear', 'profile', 'profileEnd',
    ] as const;
    for (const m of methods) {
      api[m] = (globalConsole[m] as (...a: unknown[]) => unknown).bind(globalConsole);
    }
    return api;
  },
};
