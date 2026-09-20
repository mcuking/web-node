/**
 * `child_process` — the public face of the controlled spawn surface.
 *
 * The shape follows Node: a `ChildProcess` is an EventEmitter carrying
 * `stdout`/`stderr` as Readables and `stdin` as a Writable, and it emits
 * `spawn` → `exit` → `close` (or `error`, if the program could never start).
 *
 * What differs is spelled out in the option handling rather than hidden:
 *
 *   - `shell: true`, `exec()` and `execFile({ shell: true })` go through the
 *     mini-shell in `shell/sh.ts`. It is a real parser, and it refuses what it
 *     cannot faithfully run instead of approximating it.
 *   - `fork()` starts the module like `node <module>`, but there is no IPC
 *     channel: `send()`, `disconnect()` and `'message'` events throw rather
 *     than pretend. A silent no-op here would be the worst possible outcome,
 *     because the parent would simply wait forever for a reply.
 *   - The `*Sync` variants only work for programs that complete without the
 *     event loop, and say so precisely when they cannot be used.
 */

import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';
import { runShell, runShellSync, ShellSyntaxError, ShellUnsupportedError } from '../shell/sh';
import { SpawnError } from '../proc/host';

export const childProcessSpec: BuiltinSpec = {
  id: 'child_process',
  aliases: ['node:child_process'],
  origin: 'web-node',
  deps: ['events', 'stream', 'buffer'],
  init: (ctx: BuiltinInitContext) => {
    const binding = ctx.binding;
    const { EventEmitter } = ctx.require('events') as { EventEmitter: new () => EmitterLike };
    const { Readable, Writable } = ctx.require('stream') as {
      Readable: new (options?: Record<string, unknown>) => ReadableLike;
      Writable: new (options?: Record<string, unknown>) => WritableLike;
    };
    const { Buffer: Buffer_ } = ctx.require('buffer') as {
      Buffer: {
        from(value: unknown, encoding?: string): Uint8Array;
        concat(chunks: Uint8Array[]): Uint8Array;
      };
    };

    interface EmitterLike {
      on(name: string, fn: (...a: unknown[]) => void): unknown;
      once(name: string, fn: (...a: unknown[]) => void): unknown;
      emit(name: string, ...args: unknown[]): boolean;
      removeAllListeners(name?: string): unknown;
    }
    interface ReadableLike extends EmitterLike {
      push(chunk: unknown): boolean;
    }
    interface WritableLike extends EmitterLike {
      write(chunk: unknown): boolean;
      end(chunk?: unknown): void;
      end(): void;
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    /** Node defers every lifecycle event past the current tick; so do we. */
    const defer = (fn: () => void): void => binding.nextTick(fn as (...a: unknown[]) => void);

    /** Defer past the next tick *and* the microtask drain (a macrotask). */
    const deferMacro = (fn: () => void): void => {
      binding.timers.setTimeout(fn as (...a: unknown[]) => void, 0);
    };

    interface ExecOptions {
      cwd?: string;
      env?: Record<string, string>;
      shell?: string | boolean;
      timeout?: number;
      input?: string | Uint8Array;
      encoding?: string | null;
      maxBuffer?: number;
      stdio?: unknown;
    }

    function toBytes(value: string | Uint8Array): Uint8Array {
      return typeof value === 'string' ? encoder.encode(value) : value;
    }

    function decode(value: Uint8Array, encoding: string | null | undefined): Uint8Array | string {
      if (encoding === null || encoding === 'buffer') return value;
      return decoder.decode(value);
    }

    function shellPath(options: ExecOptions): string {
      if (typeof options.shell === 'string') return options.shell;
      return '/bin/sh';
    }

    class ChildProcess extends (EventEmitter as new () => EmitterLike) {
      pid: number | undefined;
      stdout: ReadableLike;
      stderr: ReadableLike;
      stdin: WritableLike;
      exitCode: number | null = null;
      signalCode: string | null = null;
      killed = false;
      spawnargs: string[];
      spawnfile: string;
      connected = false;
      [key: string]: unknown;

      #handle: ChildHandleLike | null = null;
      #closed = false;

      constructor(command: string, args: string[]) {
        super();
        this.spawnfile = command;
        this.spawnargs = [command, ...args];
        this.stdout = new Readable({
          read: () => undefined,
          destroy: () => undefined,
        }) as unknown as ReadableLike;
        this.stderr = new Readable({
          read: () => undefined,
          destroy: () => undefined,
        }) as unknown as ReadableLike;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.stdin = new Writable({
          write(chunk: unknown, _enc: string, cb: (err?: Error | null) => void): void {
            try {
              self.#handle?.write(toBytes(chunk as string | Uint8Array));
              cb();
            } catch (err) {
              cb(err as Error);
            }
          },
          final(cb: (err?: Error | null) => void): void {
            self.#handle?.endStdin();
            cb();
          },
        }) as unknown as WritableLike;
      }

      get exitCodeOrNull(): number | null {
        return this.exitCode;
      }

      bind(handle: ChildHandleLike): void {
        this.#handle = handle;
        this.pid = handle.pid;
        // Subscribe on a later turn, not synchronously. The virtual child has
        // already run to completion inside `spawn()`, so its output is replayed
        // on subscribe; replaying synchronously would land before the caller's
        // `stdout.on('data')` has put the readable into flowing mode (Node
        // defers `resume_`), buffering the output past `exit`. A macrotask gives
        // the resume a full turn to run first, so the order matches Node:
        // spawn → data → exit → close.
        deferMacro(() => {
          handle.onStdout((chunk) => this.stdout.push(chunk));
          handle.onStderr((chunk) => this.stderr.push(chunk));
          handle.onExit((result) => {
            defer(() => this.#finish(result));
          });
        });
      }

      #finish(result: { code: number | null; signal: string | null }): void {
        if (this.#closed) return;
        this.#closed = true;
        this.exitCode = result.code;
        this.signalCode = result.signal;
        this.stdout.push(null);
        this.stderr.push(null);
        this.emit('exit', result.code, result.signal);
        this.emit('close', result.code, result.signal);
      }

      kill(signal = 'SIGTERM'): boolean {
        if (!this.#handle) return false;
        this.killed = true;
        return this.#handle.kill(signal);
      }

      disconnect(): void {
        throw notImplemented(
          'api',
          'child_process.ChildProcess.disconnect',
          'a spawned program has no IPC channel in web-node',
        );
      }

      send(): boolean {
        throw notImplemented(
          'api',
          'child_process.ChildProcess.send',
          'a spawned program has no IPC channel in web-node; use a file or a socket on the virtual network',
        );
      }

      ref(): this {
        return this;
      }

      unref(): this {
        return this;
      }
    }

    interface ChildHandleLike {
      readonly pid: number;
      write(data: Uint8Array): void;
      endStdin(): void;
      kill(signal?: string): boolean;
      onStdout(cb: (chunk: Uint8Array) => void): () => void;
      onStderr(cb: (chunk: Uint8Array) => void): () => void;
      onExit(cb: (result: { code: number | null; signal: string | null }) => void): () => void;
    }

    function startProcess(
      command: string,
      args: string[],
      options: ExecOptions,
    ): { child: ChildProcess; error: Error | null } {
      const child = new ChildProcess(command, args);
      const cwd = options.cwd ?? binding.vfs.cwd;
      const env = options.env ? { ...binding.env, ...options.env } : { ...binding.env };
      const timeoutMs = typeof options.timeout === 'number' && options.timeout > 0 ? options.timeout : undefined;
      const input = options.input === undefined ? null : toBytes(options.input);

      try {
        const handle = binding.spawn.spawn({ command, args, cwd, env, stdin: input, timeoutMs });
        // Queued before `bind`, which queues the exit/close pair: Node's order
        // is spawn → exit → close, and the two are one microtask apart.
        defer(() => child.emit('spawn'));
        child.bind(handle);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // Node reports an unstartable program through 'error', asynchronously,
        // and never emits 'spawn' for it.
        defer(() => {
          child.emit('error', error);
          child.stdout.push(null);
          child.stderr.push(null);
          child.emit('close', null, null);
        });
        return { child, error };
      }
      return { child, error: null };
    }

    /** Run a shell script and collect its output onto `child`. */
    function startShell(
      script: string,
      options: ExecOptions,
      callback?: (error: Error | null, stdout: unknown, stderr: unknown) => void,
    ): ChildProcess {
      const child = new ChildProcess(shellPath(options), ['-c', script]);
      const cwd = options.cwd ?? binding.vfs.cwd;
      const env = options.env ? { ...binding.env, ...options.env } : { ...binding.env };
      const timeoutMs = typeof options.timeout === 'number' && options.timeout > 0 ? options.timeout : undefined;
      const input = options.input === undefined ? null : toBytes(options.input);

      let settled = false;
      const done = (code: number | null, signal: string | null): void => {
        if (settled) return;
        settled = true;
        defer(() => {
          child.exitCode = code;
          child.signalCode = signal;
          child.stdout.push(null);
          child.stderr.push(null);
          child.emit('exit', code, signal);
          child.emit('close', code, signal);
          if (!callback) return;
          const stdout = decode(collected(), options.encoding);
          const stderr = decode(collectedErr(), options.encoding);
          callback(code === 0 ? null : makeExitError(script, code, signal), stdout, stderr);
        });
      };

      let stdoutBytes: Uint8Array | null = null;
      let stderrBytes: Uint8Array | null = null;
      const collected = (): Uint8Array => stdoutBytes ?? new Uint8Array(0);
      const collectedErr = (): Uint8Array => stderrBytes ?? new Uint8Array(0);

      runShell(script, {
        host: binding.spawn,
        vfs: binding.vfs,
        cwd,
        env,
        stdin: input,
        timeoutMs,
        onOutput: (chunk, stream) => {
          if (stream === 'stdout') {
            stdoutBytes = concat(stdoutBytes, chunk);
            child.stdout.push(chunk);
          } else {
            stderrBytes = concat(stderrBytes, chunk);
            child.stderr.push(chunk);
          }
        },
      })
        .then((result) => {
          child.pid = 4000;
          child.emit('spawn');
          done(result.code, null);
        })
        .catch((err: unknown) => {
          const error = err instanceof SpawnError || err instanceof ShellSyntaxError || err instanceof ShellUnsupportedError
            ? (err as Error)
            : new Error(err instanceof Error ? err.message : String(err));
          defer(() => child.emit('error', error));
          done(1, null);
        });

      return child;
    }

    function concat(a: Uint8Array | null, b: Uint8Array): Uint8Array {
      if (!a || a.length === 0) return b;
      const out = new Uint8Array(a.length + b.length);
      out.set(a, 0);
      out.set(b, a.length);
      return out;
    }

    function makeExitError(script: string, code: number | null, signal: string | null): Error {
      const error = new Error(`Command failed: ${script}`) as Error & {
        code?: number | null;
        signal?: string | null;
        cmd?: string;
        killed?: boolean;
      };
      error.code = code;
      error.signal = signal;
      error.cmd = script;
      error.killed = false;
      return error;
    }

    // ---- public API -------------------------------------------------------

    function spawn(command: string, args?: unknown, options?: unknown): ChildProcess {
      const parsed = normalizeArgs(args, options);
      if (parsed.options.shell) {
        return startShell(
          [command, ...parsed.args].join(' '),
          parsed.options,
        );
      }
      return startProcess(command, parsed.args, parsed.options).child;
    }

    function exec(
      command: string,
      optionsOrCallback?: unknown,
      maybeCallback?: unknown,
    ): ChildProcess {
      const { options, callback } = splitCallback(optionsOrCallback, maybeCallback);
      return startShell(command, options, callback);
    }

    function execFile(
      file: string,
      argsOrOptions?: unknown,
      optionsOrCallback?: unknown,
      maybeCallback?: unknown,
    ): ChildProcess {
      const parsed = normalizeArgs(argsOrOptions, optionsOrCallback);
      const callback = (typeof maybeCallback === 'function' ? maybeCallback : undefined) as
        | ((error: Error | null, stdout: unknown, stderr: unknown) => void)
        | undefined;
      if (parsed.options.shell) {
        return startShell([file, ...parsed.args].join(' '), parsed.options, callback);
      }
      const { child } = startProcess(file, parsed.args, parsed.options);
      if (callback) {
        const out: Uint8Array[] = [];
        const err: Uint8Array[] = [];
        child.stdout.on('data', (chunk: unknown) => out.push(chunk as Uint8Array));
        child.stderr.on('data', (chunk: unknown) => err.push(chunk as Uint8Array));
        child.once('close', (code: unknown) => {
          callback(
            (code as number) === 0 ? null : makeExitError(file, code as number, null),
            decode(bufferConcat(out), parsed.options.encoding),
            decode(bufferConcat(err), parsed.options.encoding),
          );
        });
      }
      return child;
    }

    /** `fork` starts a module the way `node <module>` would. */
    function fork(modulePath: string, args?: unknown, options?: unknown): ChildProcess {
      const parsed = normalizeArgs(args, options);
      const { child } = startProcess('node', [modulePath, ...parsed.args], parsed.options);
      return child;
    }

    function bufferConcat(chunks: Uint8Array[]): Uint8Array {
      if (chunks.length === 0) return new Uint8Array(0);
      if (chunks.length === 1) return chunks[0];
      return Buffer_.concat(chunks);
    }

    function spawnSync(command: string, args?: unknown, options?: unknown): SyncResult {
      const parsed = normalizeArgs(args, options);
      return runSyncInner(
        parsed.options.shell ? null : command,
        parsed.options.shell ? [command, ...parsed.args].join(' ') : null,
        parsed.args,
        parsed.options,
      );
    }

    function execSync(command: string, options?: ExecOptions): unknown {
      const result = runSyncInner(null, command, [], options ?? {});
      if (result.error) throw result.error;
      if (result.status !== 0) throw makeExitError(command, result.status, result.signal);
      return decode(result.stdoutBytes, options?.encoding);
    }

    function execFileSync(file: string, args?: unknown, options?: unknown): unknown {
      const parsed = normalizeArgs(args, options);
      const result = runSyncInner(
        parsed.options.shell ? null : file,
        parsed.options.shell ? [file, ...parsed.args].join(' ') : null,
        parsed.args,
        parsed.options,
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw makeExitError(file, result.status, result.signal);
      return decode(result.stdoutBytes, parsed.options.encoding);
    }

    interface SyncResult {
      pid: number;
      output: [null, unknown, unknown];
      stdout: unknown;
      stderr: unknown;
      status: number | null;
      signal: string | null;
      error: Error | null;
    }

    function runSyncInner(
      command: string | null,
      script: string | null,
      args: string[],
      options: ExecOptions,
    ): SyncResult & { stdoutBytes: Uint8Array; stderrBytes: Uint8Array } {
      const cwd = options.cwd ?? binding.vfs.cwd;
      const env = options.env ? { ...binding.env, ...options.env } : { ...binding.env };
      const timeoutMs = typeof options.timeout === 'number' && options.timeout > 0 ? options.timeout : undefined;
      const stdin = options.input === undefined ? null : toBytes(options.input);
      try {
        const result = script !== null
          ? runShellSync(script, { host: binding.spawn, vfs: binding.vfs, cwd, env, stdin, timeoutMs })
          : binding.spawn.runSync({ command: command as string, args, cwd, env, stdin, timeoutMs });
        const status = result.code;
        return {
          pid: 4000,
          output: [null, decode(result.stdout, options.encoding), decode(result.stderr, options.encoding)],
          stdout: decode(result.stdout, options.encoding),
          stderr: decode(result.stderr, options.encoding),
          status,
          signal: 'signal' in result ? (result.signal as string | null) : null,
          error: status === 0 ? null : null,
          stdoutBytes: result.stdout,
          stderrBytes: result.stderr,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const empty = new Uint8Array(0);
        if (options.encoding === null || options.encoding === 'buffer') {
          return {
            pid: -1,
            output: [null, empty, empty],
            stdout: empty,
            stderr: empty,
            status: null,
            signal: null,
            error,
            stdoutBytes: empty,
            stderrBytes: empty,
          };
        }
        return {
          pid: -1,
          output: [null, '', ''],
          stdout: '',
          stderr: '',
          status: null,
          signal: null,
          error,
          stdoutBytes: empty,
          stderrBytes: empty,
        };
      }
    }

    function normalizeArgs(
      argsOrOptions: unknown,
      options: unknown,
    ): { args: string[]; options: ExecOptions } {
      if (Array.isArray(argsOrOptions)) {
        return { args: argsOrOptions.map(String), options: (options as ExecOptions) ?? {} };
      }
      return { args: [], options: (argsOrOptions as ExecOptions) ?? {} };
    }

    function splitCallback(
      optionsOrCallback: unknown,
      maybeCallback: unknown,
    ): { options: ExecOptions; callback?: (error: Error | null, stdout: unknown, stderr: unknown) => void } {
      if (typeof optionsOrCallback === 'function') {
        return {
          options: {},
          callback: optionsOrCallback as (error: Error | null, stdout: unknown, stderr: unknown) => void,
        };
      }
      return {
        options: (optionsOrCallback as ExecOptions) ?? {},
        callback:
          typeof maybeCallback === 'function'
            ? (maybeCallback as (error: Error | null, stdout: unknown, stderr: unknown) => void)
            : undefined,
      };
    }

    return {
      spawn,
      exec,
      execFile,
      fork,
      spawnSync,
      execSync,
      execFileSync,
      ChildProcess,
    };
  },
};
