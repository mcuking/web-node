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
 *   - `fork()` starts the module like `node <module>` **and gives it an IPC
 *     channel**, so `send()`/`on('message')`/`disconnect()` work in both
 *     directions. The channel is a host macrotask hop, not an OS pipe; a send
 *     handle (a socket) is refused rather than dropped.
 *   - A `spawn()`ed child has no channel, so `send()`/`disconnect()` throw —
 *     Node leaves them `undefined` there, and a silent no-op would be the worst
 *     possible outcome, because the parent would wait forever for a reply.
 *   - The `*Sync` variants only work for programs that complete without the
 *     event loop, and say so precisely when they cannot be used.
 */

import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';
import { runShell, runShellSync, ShellSyntaxError, ShellUnsupportedError } from '../shell/sh';
import { SpawnError } from '../proc/host';
import type { IpcEndpoint, Serialization } from '../proc/ipc';
import * as p from '../vfs/posix';

export const childProcessSpec: BuiltinSpec = {
  id: 'child_process',
  aliases: ['node:child_process'],
  origin: 'web-node',
  arity: { ChildProcess: 0, fork: 1 },
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
      /** `fork`: 'json' (default) or 'advanced' message serialization. */
      serialization?: Serialization;
      /** `fork`: accepted for shape compatibility; the child inherits stdin. */
      silent?: boolean;
      /** `fork`: the child's `process.execArgv`. */
      execArgv?: string[];
      killSignal?: string;
      detached?: boolean;
      windowsHide?: boolean;
    }

    /**
     * Emit an `error` on a ChildProcess, but only when someone is listening.
     * Node crashes on an unhandled `'error'`; that crash would take the whole
     * worker (and every other child) down here, so a dropped channel with no
     * listener is reported through the send callback instead.
     */
    function emitErrorIfListened(child: ChildProcess, err: Error): void {
      const emitter = child as unknown as { listenerCount(name: string): number };
      if (emitter.listenerCount('error') > 0) child.emit('error', err);
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
      [key: string]: unknown;

      #handle: ChildHandleLike | null = null;
      #closed = false;
      #connected = false;
      /** The parent's handle on the IPC channel; `undefined` unless forked. */
      #channel: { ref: () => void; unref: () => void } | null = null;

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

      /**
       * `true` only while a forked child's channel is open. A spawned child has
       * no channel, so this stays `false` — the same value Node reports.
       */
      get connected(): boolean {
        return this.#connected;
      }

      /**
       * The channel object (`ref`/`unref`), Node's `subprocess.channel`. It is
       * `undefined` when there is no channel at all and `null` once one has been
       * disconnected — both measured against Node v26.9.0.
       */
      get channel(): unknown {
        const ipc = this.#handle?.ipc;
        if (!ipc) return undefined;
        return ipc.connected ? this.#channel : null;
      }

      bind(handle: ChildHandleLike): void {
        this.#handle = handle;
        this.pid = handle.pid;
        const ipc = handle.ipc;
        if (ipc) {
          this.#connected = true;
          this.#channel = {
            ref: () => ipc.ref(),
            unref: () => ipc.unref(),
          };
          // Messages and the disconnect travel on their own macrotask, so a
          // listener attached right after `fork()` returns is never too late.
          ipc.onMessage((message) => defer(() => this.emit('message', message)));
          ipc.onDisconnect(() => defer(() => this.#emitDisconnect()));
          ipc.onError((err) => defer(() => emitErrorIfListened(this, err)));
        }
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
        // A dead child takes its channel with it, and Node's order is
        // disconnect → exit → close.
        this.#emitDisconnect();
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

      /**
       * `ChildProcess#spawn(options)` — Node's internal launcher. Our spawning is
       * driven by the host from the constructor, so this entry point has no work
       * to do; it exists for surface fidelity and refuses loudly rather than
       * pretending to launch something.
       */
      spawn(_options?: unknown): never {
        throw notImplemented(
          'api',
          'child_process.ChildProcess.spawn',
          'spawning is driven by the host from spawn()/fork()',
        );
      }

      disconnect(): void {
        const ipc = this.#handle?.ipc;
        if (!ipc) {
          throw notImplemented(
            'api',
            'child_process.ChildProcess.disconnect',
            'this child has no IPC channel; only fork() creates one',
          );
        }
        ipc.disconnect();
      }

      send(message: unknown, sendHandle?: unknown, options?: unknown, callback?: unknown): boolean {
        const ipc = this.#handle?.ipc;
        if (!ipc) {
          throw notImplemented(
            'api',
            'child_process.ChildProcess.send',
            'this child has no IPC channel (only fork() creates one); for a spawned program, use a file or a socket on the virtual network',
          );
        }
        let cb: ((err: Error | null) => void) | undefined;
        if (typeof sendHandle === 'function') {
          cb = sendHandle as (err: Error | null) => void;
        } else if (sendHandle !== undefined && sendHandle !== null) {
          // A handle is a real OS object (a socket, a server, a shared fd) and
          // there is none here, so refuse rather than quietly drop it.
          throw new Error(
            'a send handle cannot cross a web-node IPC channel: there is no OS socket to hand over',
          );
        } else if (typeof options === 'function') {
          cb = options as (err: Error | null) => void;
        } else if (typeof callback === 'function') {
          cb = callback as (err: Error | null) => void;
        }
        return ipc.send(message, cb);
      }

      #emitDisconnect(): void {
        if (!this.#connected) return;
        this.#connected = false;
        this.emit('disconnect');
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
      /** Present only for `fork()`ed children. */
      readonly ipc?: IpcEndpoint;
      write(data: Uint8Array): void;
      endStdin(): void;
      kill(signal?: string): boolean;
      onStdout(cb: (chunk: Uint8Array) => void): () => void;
      onStderr(cb: (chunk: Uint8Array) => void): () => void;
      onExit(cb: (result: { code: number | null; signal: string | null }) => void): () => void;
    }

    function checkSerialization(value: unknown): Serialization {
      if (value === undefined) return 'json';
      if (value === 'json' || value === 'advanced') return value;
      const error = new TypeError(
        `The argument 'options.serialization' must be one of: 'json', 'advanced'. Received '${String(value)}'`,
      ) as TypeError & { code?: string };
      error.code = 'ERR_INVALID_ARG_VALUE';
      throw error;
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

    /**
     * `fork` starts a module the way `node <module>` would, and wires up an IPC
     * channel so the two sides can talk:
     *
     *   parent: `child.send(x)` / `child.on('message')` / `child.disconnect()`
     *   child:  `process.send(x)` / `process.on('message')` / `process.disconnect()`
     *
     * A forked child stays alive while its channel is open and ref'd (Node's rule
     * too), so a module that only registers a `'message'` handler waits instead
     * of exiting. `serialization` defaults to `'json'`, matching Node: Buffers
     * arrive as `{ type: 'Buffer', data: [...] }`, `undefined` properties vanish,
     * and a circular structure throws from `send()`.
     */
    function fork(modulePath: string, args?: unknown, options?: unknown): ChildProcess {
      const parsed = normalizeArgs(args, options);
      const opts = parsed.options;
      const serialization = checkSerialization(opts.serialization);
      const script = p.isAbsolute(modulePath) ? modulePath : p.resolve(binding.vfs.cwd, modulePath);

      const child = new ChildProcess(binding.execPath, [script, ...parsed.args]);
      const cwd = opts.cwd ?? binding.vfs.cwd;
      const env = opts.env ? { ...binding.env, ...opts.env } : { ...binding.env };
      const timeoutMs = typeof opts.timeout === 'number' && opts.timeout > 0 ? opts.timeout : undefined;

      try {
        const handle = binding.spawn.spawn({
          command: binding.execPath,
          args: [script, ...parsed.args],
          cwd,
          env,
          stdin: null,
          timeoutMs,
          ipc: { serialization },
          execArgv: opts.execArgv ?? [],
          label: `fork ${script}`,
        });
        defer(() => child.emit('spawn'));
        // `fork` inherits its child's stdio by default (Node's `silent: false`),
        // so a forked module's console output belongs on the runtime's own
        // stdout. `silent: true` keeps it on the pipe only.
        if (!opts.silent) {
          handle.onStdout((chunk) => binding.writeStdout(decoder.decode(chunk)));
          handle.onStderr((chunk) => binding.writeStderr(decoder.decode(chunk)));
        }
        child.bind(handle);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        defer(() => {
          child.emit('error', error);
          child.stdout.push(null);
          child.stderr.push(null);
          child.emit('close', null, null);
        });
      }
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

    /**
     * `_forkChild(fd, serializationMode)` — Node's forked-child IPC bootstrap.
     * web-node has no OS fd/IPC channel to adopt, so it is present for surface
     * fidelity but refuses loudly.
     */
    const _forkChild = (_fd?: unknown, _serializationMode?: unknown): never => {
      throw notImplemented(
        'api',
        'child_process._forkChild',
        'there is no OS IPC channel to adopt in web-node',
      );
    };

    return {
      spawn,
      exec,
      execFile,
      fork,
      spawnSync,
      execSync,
      execFileSync,
      ChildProcess,
      _forkChild,
    };
  },
};
