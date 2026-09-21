/**
 * The controlled spawn surface.
 *
 * This is the *only* place in the runtime where user code can cause another
 * program to run, so it is deliberately narrow and deliberately explicit about
 * what it does not model. There is no OS process here: a "child" is a second
 * module registry executing JavaScript on the same event loop, with its own
 * `process` view (argv/env/cwd/stdout/stderr/stdin/pid) and its own stdout and
 * stderr pipes.
 *
 * ## The lifecycle model (read this before debugging a stuck child)
 *
 * A child is considered finished when either
 *
 *   a. its synchronous entry execution returns **and** it scheduled no work on
 *      the runtime's timer queue (measured as a before/after delta, so a parent
 *      that is itself holding a timer does not keep its children alive), or
 *   b. it calls `process.exit()` / `process.kill()` on itself, or
 *   c. the caller kills it, or its `timeoutMs` expires.
 *
 * The one gap that used to be honest: a child whose remaining work is a pending
 * *host* request (an in-flight `fetch`, say) lives outside the sandbox timer
 * queue and so was invisible to that delta, and could be reported as exited
 * early. The runtime now counts such requests as active work (it wraps the
 * sandbox's `fetch` and includes the in-flight count in `activeCount()`), so
 * that case is covered too. Everything a build script realistically does —
 * reading and writing files, running another script, `await`ing pure JS or a
 * download — is covered. A pending promise that only resolves on the microtask
 * queue still does not hold a child open, matching real Node.
 *
 * `process.exit()` inside a child throws a `ChildExit` to unwind the child's own
 * stack. That works from synchronous code; from inside a callback there is no
 * stack left to unwind, so the child is simply marked exited (and NODE's own
 * behaviour of skipping the rest of the callback is documented as unsupported).
 *
 * ## Why the timers are wrapped
 *
 * A child's `setTimeout`/`setInterval`/`queueMicrotask`/`process.nextTick` are
 * wrapped so that a throwing callback is attributed to *that child* — its stack
 * goes to the child's stderr and the child exits non-zero — instead of escaping
 * as an uncaught error that takes the whole worker down. A `postinstall` script
 * with a buggy `.then()` should fail an install, not the tab.
 */

import type { Vfs } from '../vfs';
import type { Realm } from '../realm';
import type { ModuleLoader } from '../loader';
import * as p from '../vfs/posix';
import { resolveCommand, displayCommand, type ResolveContext, type Resolution } from './command';
import {
  createIpcChannelPair,
  IpcHandleUnsupportedError,
  type IpcChannelPair,
  type IpcEndpoint,
  type Serialization,
} from './ipc';

/** Raised when a command cannot be started at all (Node's `spawn` `'error'`). */
export class SpawnError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SpawnError';
    this.code = code;
  }
}

/** Thrown inside a child by `process.exit()` to unwind its own stack. */
export class ChildExit extends Error {
  code: number;
  constructor(code: number) {
    super(`child exited with code ${code}`);
    this.name = 'ChildExit';
    this.code = code;
  }
}

export interface SpawnRequest {
  command: string;
  args?: string[];
  cwd?: string;
  /** Extra environment for the child, layered over the runtime's own env. */
  env?: Record<string, string>;
  /** Bytes written to the child's stdin; the pipe closes right after. */
  stdin?: Uint8Array | null;
  /** Kill the child after this long. */
  timeoutMs?: number;
  /**
   * Give the child an IPC channel (`fork`). A child with an open, ref'd channel
   * stays alive past its synchronous phase — that is what keeps a forked module
   * waiting for messages instead of exiting immediately.
   */
  ipc?: { serialization?: Serialization };
  /** The child's `process.execArgv`. */
  execArgv?: string[];
  /** Label used in diagnostics (defaults to the command line). */
  label?: string;
}

export interface ExitStatus {
  code: number | null;
  signal: string | null;
}

export interface ChildHandle {
  readonly pid: number;
  readonly command: string;
  readonly exited: boolean;
  /** The parent's end of the child's IPC channel; absent unless forked. */
  readonly ipc?: IpcEndpoint;
  /** Write to the child's stdin. No-op once it has exited. */
  write(data: Uint8Array): void;
  endStdin(): void;
  kill(signal?: string): boolean;
  onStdout(cb: (chunk: Uint8Array) => void): () => void;
  onStderr(cb: (chunk: Uint8Array) => void): () => void;
  onExit(cb: (result: ExitStatus) => void): () => void;
}

export interface RunResult {
  code: number | null;
  signal: string | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export interface ProcessHost {
  spawn(req: SpawnRequest): ChildHandle;
  /** Spawn and resolve once the child has finished, buffering its output. */
  run(req: SpawnRequest): Promise<RunResult>;
  /** Synchronous variant; throws when the program needs the event loop. */
  runSync(req: SpawnRequest): RunResult;
  /** Live child count (the runner uses it to decide the loop is still busy). */
  readonly activeChildren: number;
  /** Kill everything. Called between runs, like tearing a process group down. */
  reset(): void;
}

export interface ProcessHostDeps {
  vfs: Vfs;
  realm(): Realm;
  loader(): ModuleLoader;
  /** The parent's injected sandbox globals (the child's are derived from these). */
  globals(): Record<string, unknown>;
  /** Module aliases (native → WASM shims) that children must inherit. */
  aliases(): Record<string, string>;
  /** Live timer count, used for the "did the child schedule work?" delta. */
  activeCount(): number;
  execPath: string;
  baseEnv: Record<string, string>;
  /** Defer to the next macrotask. Injectable so tests stay deterministic. */
  defer?(fn: () => void): void;
  /** Called when a child starts/finishes — used for diagnostics. */
  onChildEvent?(event: { type: 'spawn' | 'exit'; pid: number; command: string; code?: number | null }): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function toBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

/**
 * Emit an `error` on a child's `process`/`ChildProcess`, but only when someone
 * is listening. Node crashes the process on an unhandled `'error'`; here the
 * crash would take the whole worker down, so a dropped channel with no listener
 * is reported through the send callback instead.
 */
function emitIfListened(emitter: Record<string, unknown>, err: Error): void {
  const count = emitter.listenerCount;
  if (typeof count === 'function' && (count as (name: string) => number).call(emitter, 'error') > 0) {
    (emitter.emit as (name: string, ...a: unknown[]) => boolean).call(emitter, 'error', err);
  }
}

export function createProcessHost(deps: ProcessHostDeps): ProcessHost {
  // Captured before any runtime shadows the globals, so the settle poll runs on
  // the *host* timer queue and never shows up in `activeCount()`.
  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis) as (fn: () => void, ms: number) => unknown;
  const defer = deps.defer ?? ((fn: () => void) => void nativeSetTimeout(fn, 0));

  const children = new Set<Child>();
  let nextPid = 100;

  /**
   * `process.stdin` yields Buffers in Node, and real install scripts do
   * `d.toString()` on them, so the chunk handed to a `data` listener is wrapped
   * to match rather than left as a bare `Uint8Array` (whose `toString` would
   * print a list of byte values).
   */
  let bufferFrom: ((value: Uint8Array) => Uint8Array) | null = null;
  const toBuffer = (chunk: Uint8Array): Uint8Array => {
    if (!bufferFrom) {
      const { Buffer: BufferCtor } = deps.realm().require('buffer') as {
        Buffer: { from(value: Uint8Array): Uint8Array };
      };
      bufferFrom = (value) => BufferCtor.from(value);
    }
    return bufferFrom(chunk);
  };

  class Child implements ChildHandle {
    readonly pid: number;
    readonly command: string;
    readonly cwd: string;
    readonly env: Record<string, string>;
    readonly #label: string;
    readonly #request: SpawnRequest;

    #stdoutChunks: Uint8Array[] = [];
    #stderrChunks: Uint8Array[] = [];
    #stdoutCbs: Array<(chunk: Uint8Array) => void> = [];
    #stderrCbs: Array<(chunk: Uint8Array) => void> = [];
    #exitCbs: Array<(result: ExitStatus) => void> = [];
    #exit: ExitStatus | null = null;
    #exitCode: number | null = null;
    #signal: string | null = null;
    /** Inside the synchronous entry execution: a throw can still unwind. */
    #syncPhase = true;
    #syncReturned = false;
    #timersBefore = 0;
    #timeoutHandle: unknown = null;
    /** stdin queue handed to the child as `process.stdin`. */
    readonly #stdinChunks: Uint8Array[] = [];
    #stdinEnded = false;
    /** `endStdin()` was called: the parent closed the pipe for good. */
    #stdinExplicitEnd = false;
    /** The pump has run to completion: the child can now be settled. */
    #stdinDelivered = false;
    /** A program that reads stdin is waiting on IO, which is never synchronous. */
    #stdinListenerCount = 0;
    #stdinDataListeners: Array<(chunk: Uint8Array) => void> = [];
    #stdinEndListeners: Array<() => void> = [];
    #stdinPumpScheduled = false;
    /** The IPC pair, created on first need so a plain spawn pays nothing. */
    #ipcPair: IpcChannelPair | null = null;
    #settleScheduled = false;

    constructor(request: SpawnRequest) {
      this.pid = nextPid++;
      this.#request = request;
      this.command = request.command;
      this.cwd = p.resolve(request.cwd ?? deps.vfs.cwd);
      this.env = { ...deps.baseEnv, ...(request.env ?? {}) };
      this.#label = request.label ?? displayCommand(request.command, request.args ?? []);
    }

    get exited(): boolean {
      return this.#exit !== null;
    }

    /** The parent's end of this child's IPC channel, if it has one. */
    get ipc(): IpcEndpoint | undefined {
      return this.#ipcPair?.parent;
    }

    /** Create the channel once, on demand (only `fork` asks for one). */
    #ipc(): IpcChannelPair | null {
      if (!this.#request.ipc) return null;
      if (!this.#ipcPair) {
        this.#ipcPair = createIpcChannelPair({ serialization: this.#request.ipc.serialization, defer });
      }
      return this.#ipcPair;
    }

    /**
     * An open, ref'd IPC channel is live work, exactly like a socket: a forked
     * module that has returned from its synchronous phase still waits for
     * messages. `process.channel.unref()` (or a disconnect) lifts that.
     */
    #ipcKeepsAlive(): boolean {
      const pair = this.#ipcPair;
      return pair !== null && pair.child.connected && pair.child.refd;
    }

    get label(): string {
      return this.#label;
    }

    get exitResult(): ExitStatus | null {
      return this.#exit;
    }

    onStdout(cb: (chunk: Uint8Array) => void): () => void {
      this.#stdoutCbs.push(cb);
      // A subscriber usually attaches *after* the child has already run: the
      // child's synchronous phase happens inside `spawn()`. Replaying what it
      // wrote is what stops that output from being silently dropped.
      for (const chunk of this.#stdoutChunks) cb(chunk);
      return () => {
        this.#stdoutCbs = this.#stdoutCbs.filter((c) => c !== cb);
      };
    }

    onStderr(cb: (chunk: Uint8Array) => void): () => void {
      this.#stderrCbs.push(cb);
      for (const chunk of this.#stderrChunks) cb(chunk);
      return () => {
        this.#stderrCbs = this.#stderrCbs.filter((c) => c !== cb);
      };
    }

    onExit(cb: (result: ExitStatus) => void): () => void {
      if (this.#exit) {
        cb(this.#exit);
        return () => undefined;
      }
      this.#exitCbs.push(cb);
      return () => {
        this.#exitCbs = this.#exitCbs.filter((c) => c !== cb);
      };
    }

    writeStdout(text: string): void {
      this.pushStdout(encoder.encode(text));
    }

    writeStderr(text: string): void {
      this.pushStderr(encoder.encode(text));
    }

    pushStdout(chunk: Uint8Array): void {
      if (this.#exit) return;
      this.#stdoutChunks.push(chunk);
      for (const cb of this.#stdoutCbs) cb(chunk);
    }

    pushStderr(chunk: Uint8Array): void {
      if (this.#exit) return;
      this.#stderrChunks.push(chunk);
      for (const cb of this.#stderrCbs) cb(chunk);
    }

    // ---- stdin ------------------------------------------------------------

    write(data: Uint8Array): void {
      if (this.#exit) return;
      if (this.#stdinEnded) {
        if (this.#stdinExplicitEnd) return;
        // stdin auto-closed because the queue drained. There is no live pipe to
        // write to, so re-open it for this chunk rather than dropping it.
        this.#stdinEnded = false;
        this.#stdinDelivered = false;
      }
      this.#stdinChunks.push(data);
      this.#scheduleStdinPump();
    }

    endStdin(): void {
      this.#stdinExplicitEnd = true;
      this.#stdinEnded = true;
      this.#scheduleStdinPump();
    }

    /** Pull whatever is buffered (the child's `process.stdin.read()`). */
    readStdin(): Uint8Array | null {
      if (this.#stdinChunks.length === 0) return null;
      return this.#stdinChunks.shift() as Uint8Array;
    }
    get stdinEnded(): boolean {
      return this.#stdinEnded;
    }

    /**
     * Can this child be considered finished without ever yielding to the event
     * loop? Used by `runSync`, where there is no way to await anything.
     */
    syncSettled(): boolean {
      if (this.#exit) return true;
      if (!this.#syncReturned) return false;
      // A program that reads stdin is blocked on the pump, which is a timer.
      if (this.#stdinListenerCount > 0) return false;
      return deps.activeCount() <= this.#timersBefore;
    }

    get pendingExitCode(): number {
      return this.#exitCode ?? 0;
    }

    // ---- lifecycle --------------------------------------------------------

    kill(signal = 'SIGTERM'): boolean {
      if (this.#exit) return false;
      this.#signal = signal;
      this.finish(null, signal);
      return true;
    }

    /** `process.exit()` from inside the child. */
    requestExit(code: number): never | void {
      this.#exitCode = code;
      if (this.#syncPhase) throw new ChildExit(code);
      this.finish(code, null);
    }

    #armTimeout(): void {
      const ms = this.#request.timeoutMs;
      if (!ms || ms <= 0) return;
      this.#timeoutHandle = nativeSetTimeout(() => {
        if (this.#exit) return;
        this.pushStderr(encoder.encode(`[web-node] ${this.#label} timed out after ${ms}ms and was killed\n`));
        this.kill('SIGTERM');
      }, ms);
    }

    #clearTimeout(): void {
      if (this.#timeoutHandle !== null) {
        (globalThis.clearTimeout as (h: unknown) => void)(this.#timeoutHandle);
        this.#timeoutHandle = null;
      }
    }

    finish(code: number | null, signal: string | null): void {
      if (this.#exit) return;
      this.#exit = { code, signal };
      this.#clearTimeout();
      // A child that dies takes its channel with it, and the parent hears about
      // that *before* `exit` — Node's order is disconnect → exit → close.
      this.#ipcPair?.parent.disconnect();
      children.delete(this);
      deps.onChildEvent?.({ type: 'exit', pid: this.pid, command: this.command, code });
      const cbs = this.#exitCbs;
      this.#exitCbs = [];
      for (const cb of cbs) cb(this.#exit);
    }

    get stdoutBytes(): Uint8Array {
      return concatChunks(this.#stdoutChunks);
    }

    get stderrBytes(): Uint8Array {
      return concatChunks(this.#stderrChunks);
    }

    /** Run the entry synchronously; the caller owns the try/catch boundary. */
    start(): void {
      deps.onChildEvent?.({ type: 'spawn', pid: this.pid, command: this.command });
      children.add(this);
      this.#armTimeout();
      this.#timersBefore = deps.activeCount();
      if (this.#request.stdin) this.write(toBytes(this.#request.stdin));

      const savedCwd = deps.vfs.cwd;
      try {
        // Relative paths inside a child's synchronous phase must resolve against
        // the child's cwd, and the parent is blocked (it is inside spawn()), so
        // borrowing the process-wide cwd here is safe. An async continuation
        // restores the parent's cwd — a documented limitation.
        if (this.cwd !== savedCwd) deps.vfs.chdir(this.cwd);
        this.#execute();
        this.#syncReturned = true;
      } catch (err) {
        this.#syncReturned = true;
        if (err instanceof ChildExit) {
          this.finish(err.code, null);
        } else if (err instanceof SpawnError) {
          // A program that could never start is not a program that ran and
          // failed: the caller (spawn / run / runSync) reports it as such.
          this.finish(1, null);
          throw err;
        } else {
          this.pushStderr(encoder.encode(formatUncaught(err)));
          this.finish(1, null);
        }
      } finally {
        this.#syncPhase = false;
        try {
          if (deps.vfs.cwd !== savedCwd) deps.vfs.chdir(savedCwd);
        } catch {
          /* the VFS is allowed to have moved on */
        }
      }

      if (!this.#exit) this.#scheduleSettle();
    }

    /**
     * Resolve `command` and run it. Split out so the sync/async entry points
     * share exactly one implementation.
     */
    #execute(): void {
      const ctx: ResolveContext = {
        vfs: deps.vfs,
        cwd: this.cwd,
        env: this.env,
        execPath: deps.execPath,
      };
      const args = this.#request.args ?? [];
      const resolved = resolveCommand(ctx, this.command, args);

      switch (resolved.kind) {
        case 'missing':
          throw new SpawnError('ENOENT', `spawn ${displayCommand(this.command, args)} ENOENT`);
        case 'unsupported':
          throw new SpawnError(
            'ENOEXEC',
            `cannot execute ${resolved.path}: ${resolved.reason}`,
          );
        case 'node':
          return this.#executeNode(resolved);
        case 'program':
          return this.#executeProgram(resolved.path, resolved.args);
      }
    }

    #executeNode(resolved: Extract<Resolution, { kind: 'node' }>): void {
      if (resolved.args[0] === '--version') {
        this.writeStdout(`${String((deps.realm().require('process') as { version?: string }).version ?? '')}\n`);
        return;
      }
      const evalIndex = resolved.args[0] === '-e' || resolved.args[0] === '--eval' || resolved.args[0] === '-p' || resolved.args[0] === '--print';
      if (evalIndex) {
        const print = resolved.args[0] === '-p' || resolved.args[0] === '--print';
        const code = resolved.args[1] ?? '';
        const rest = resolved.args.slice(2);
        const source = print
          ? `var __wn_value = (${code});\nif (__wn_value !== undefined) process.stdout.write(require('util').inspect(__wn_value) + '\\n');\n`
          : code;
        this.#evaluate(p.join(this.cwd, '__web_node_eval__.js'), source, [deps.execPath, ...rest]);
        return;
      }
      if (resolved.script === null) {
        // `node` with no script: a REPL in Node; there is no terminal here.
        throw new SpawnError('ENOEXEC', 'running bare "node" (a REPL) is not supported in a browser tab');
      }
      this.#executeProgram(resolved.script, resolved.args, [deps.execPath, resolved.script, ...resolved.args]);
    }

    #executeProgram(script: string, args: string[], argvOverride?: string[]): void {
      const source = decoder.decode(deps.vfs.readFile(script));
      this.#evaluate(script, source, argvOverride ?? [deps.execPath, script, ...args]);
    }

    /** Build an isolated registry + `process` view and run one module. */
    #evaluate(filename: string, source: string, argv: string[]): void {
      const realm = deps.realm();
      const parentGlobals = deps.globals();
      const parentProcess = parentGlobals.process as Record<string, unknown>;
      const childProcess = this.#childProcess(parentProcess, argv);
      const childConsole = this.#childConsole();

      const globals: Record<string, unknown> = {
        ...parentGlobals,
        process: childProcess,
        console: childConsole,
        setTimeout: this.#wrapTimer('setTimeout'),
        setInterval: this.#wrapTimer('setInterval'),
        setImmediate: this.#wrapTimer('setImmediate'),
        queueMicrotask: (fn: () => void) => {
          if (typeof fn !== 'function') throw new TypeError('queueMicrotask requires a function');
          queueMicrotask(() => this.#guard(fn));
        },
      };
      globals.global = globals;
      globals.globalThis = globals;

      const loader = new (deps.loader().constructor as new (
        r: Realm,
        v: Vfs,
        g: Record<string, unknown>,
      ) => ModuleLoader)(realm, deps.vfs, globals);
      loader.setAliases(deps.aliases());
      loader.loadModule(filename, source);
    }

    #wrapTimer(kind: 'setTimeout' | 'setInterval' | 'setImmediate'): (...args: unknown[]) => number {
      const timers = deps.realm().require('timers') as Record<string, (...a: unknown[]) => number>;
      const delegate = timers[kind];
      return (...args: unknown[]) => {
        const fn = args[0] as (...a: unknown[]) => void;
        if (typeof fn !== 'function') throw new TypeError(`${kind} requires a function`);
        const wrapped = (...callArgs: unknown[]) => this.#guard(() => fn(...callArgs));
        return delegate(wrapped, ...args.slice(1));
      };
    }

    /** Attribute a throwing callback to this child instead of the worker. */
    #guard(fn: () => void): void {
      if (this.#exit) return;
      try {
        fn();
      } catch (err) {
        if (err instanceof ChildExit) {
          this.finish(err.code, null);
          return;
        }
        this.pushStderr(encoder.encode(formatUncaught(err)));
        this.finish(1, null);
      }
    }

    #childProcess(parent: Record<string, unknown>, argv: string[]): Record<string, unknown> {
      const ctor = parent.constructor as new () => Record<string, unknown>;
      const proc = new ctor();
      proc.argv = argv;
      proc.argv0 = p.basename(argv[0] ?? 'node');
      proc.env = this.env;
      proc.pid = this.pid;
      proc.ppid = 1;
      proc.execArgv = this.#request.execArgv ?? [];
      proc.title = this.#label;
      proc.exitCode = undefined;
      proc.cwd = (): string => this.cwd;
      proc.chdir = (): void => {
        throw new SpawnError('ENOSYS', 'process.chdir() inside a spawned program is not supported');
      };
      proc.exit = (code?: number): void => this.requestExit(code ?? 0);
      proc.nextTick = (fn: (...a: unknown[]) => void, ...rest: unknown[]): void => {
        queueMicrotask(() => this.#guard(() => fn(...rest)));
      };
      proc.stdout = this.#pipeStream((text) => this.writeStdout(text), false, 1);
      proc.stderr = this.#pipeStream((text) => this.writeStderr(text), false, 2);
      proc.stdin = this.#stdinStream();
      this.#attachIpc(proc);
      return proc;
    }

    /**
     * Give a forked child the four things Node puts on its `process`: `send`,
     * `disconnect`, `channel`, and a live `connected`. A plain spawned child
     * never gets these — `process.send` is `undefined` in Node there too.
     */
    #attachIpc(proc: Record<string, unknown>): void {
      const pair = this.#ipc();
      if (!pair) return;
      const channel = pair.child;

      proc.send = (message: unknown, sendHandleOrCb?: unknown, maybeCb?: unknown): boolean => {
        let callback: ((err: Error | null) => void) | undefined;
        if (typeof sendHandleOrCb === 'function') {
          callback = sendHandleOrCb as (err: Error | null) => void;
        } else if (sendHandleOrCb !== undefined && sendHandleOrCb !== null) {
          throw new IpcHandleUnsupportedError('A send handle');
        } else if (typeof maybeCb === 'function') {
          callback = maybeCb as (err: Error | null) => void;
        }
        return channel.send(message, callback);
      };
      proc.disconnect = (): void => channel.disconnect();
      proc.channel = {
        ref: (): void => channel.ref(),
        unref: (): void => channel.unref(),
      };
      Object.defineProperty(proc, 'connected', {
        get: () => channel.connected,
        enumerable: true,
        configurable: true,
      });

      channel.onMessage((message) => {
        (proc.emit as (name: string, ...a: unknown[]) => boolean).call(proc, 'message', message);
        this.#scheduleSettle();
      });
      channel.onDisconnect(() => {
        (proc.emit as (name: string, ...a: unknown[]) => boolean).call(proc, 'disconnect');
        this.#scheduleSettle();
      });
      channel.onError((err) => emitIfListened(proc, err));
    }

    /** A `process.stdout`-shaped sink over this child's pipe. */
    #pipeStream(write: (text: string) => void, isTTY: boolean, fd: number): Record<string, unknown> {
      const stream: Record<string, unknown> = {
        write(chunk: unknown, _enc?: unknown, cb?: () => void): boolean {
          write(typeof chunk === 'string' ? chunk : decoder.decode(toBytes(chunk as Uint8Array)));
          if (typeof cb === 'function') queueMicrotask(cb);
          return true;
        },
        end(chunk?: unknown, cb?: () => void): void {
          if (chunk !== undefined) (stream.write as (c: unknown) => void)(chunk);
          if (typeof cb === 'function') queueMicrotask(cb);
        },
        isTTY,
        fd,
        columns: 80,
        rows: 24,
        writable: true,
        on: () => stream,
        once: () => stream,
        off: () => stream,
        addListener: () => stream,
        removeListener: () => stream,
        listenerCount: () => 0,
        emit: () => false,
        setDefaultEncoding: () => stream,
      };
      return stream;
    }

    /**
     * Drain whatever has been piped into the child, then close stdin.
     *
     * The close is the important half: the parent hands its input over up front,
     * so a pipe that stayed open would keep a program reading stdin — and so the
     * child — alive forever. A later `write()` re-opens it.
     */
    #pumpStdin(): void {
      if (this.#exit) return;
      let chunk: Uint8Array | null;
      while ((chunk = this.#stdinChunks.shift() ?? null) !== null) {
        const delivered = toBuffer(chunk);
        for (const listener of this.#stdinDataListeners) listener(delivered);
      }
      if (!this.#stdinExplicitEnd && !this.#stdinEnded) this.#stdinEnded = true;
      if (this.#stdinEnded && !this.#stdinDelivered) {
        this.#stdinDelivered = true;
        for (const listener of this.#stdinEndListeners) listener();
      }
    }

    #scheduleStdinPump(): void {
      if (this.#stdinPumpScheduled) return;
      this.#stdinPumpScheduled = true;
      defer(() => {
        this.#stdinPumpScheduled = false;
        this.#pumpStdin();
      });
    }

    /** `process.stdin` for a child: a readable over whatever was piped in. */
    #stdinStream(): Record<string, unknown> {
      const on = (name: string, fn: (...a: unknown[]) => void): Record<string, unknown> => {
        if (name === 'data') {
          this.#stdinDataListeners.push(fn as (chunk: Uint8Array) => void);
          this.#stdinListenerCount += 1;
        }
        if (name === 'end') {
          this.#stdinEndListeners.push(fn as () => void);
          this.#stdinListenerCount += 1;
        }
        // A listener attached late still receives whatever is buffered.
        this.#scheduleStdinPump();
        return stream;
      };
      const stream: Record<string, unknown> = {
        isTTY: false,
        fd: 0,
        readable: true,
        read: (): Uint8Array | null => this.#stdinChunks.shift() ?? null,
        on,
        once: on,
        addListener: on,
        off: () => stream,
        removeListener: () => stream,
        pause: () => stream,
        resume: () => stream,
        setEncoding: () => stream,
        setRawMode: () => stream,
      };
      this.#scheduleStdinPump();
      return stream;
    }

    /** A per-child `console` writing to the child's own pipes. */
    #childConsole(): Record<string, unknown> {
      const util = deps.realm().require('util') as { format: (...a: unknown[]) => string };
      const out = (...args: unknown[]): void => this.writeStdout(util.format(...args) + '\n');
      const err = (...args: unknown[]): void => this.writeStderr(util.format(...args) + '\n');
      return {
        log: out,
        info: out,
        debug: out,
        dir: out,
        trace: err,
        warn: err,
        error: err,
        assert: (value: unknown, ...args: unknown[]): void => {
          if (!value) err('Assertion failed:', ...args);
        },
        group: out,
        groupEnd: () => undefined,
        time: () => undefined,
        timeEnd: () => undefined,
        table: out,
      };
    }

    /**
     * Wait for the child's work to drain.
     *
     * The delta against the pre-spawn timer count is what makes this usable:
     * it asks "did the child leave anything behind?", not "is the queue empty?"
     */
    #scheduleSettle(): void {
      if (this.#exit || this.#settleScheduled) return;
      this.#settleScheduled = true;
      defer(() => {
        this.#settleScheduled = false;
        this.#checkSettle();
      });
    }

    #checkSettle(): void {
      if (this.#exit) return;
      // The stdin pump is itself a macrotask, so a child still waiting for its
      // input has not finished merely because its timers drained.
      if (!this.#stdinDelivered) {
        this.#scheduleSettle();
        return;
      }
      if (deps.activeCount() > this.#timersBefore) {
        this.#scheduleSettle();
        return;
      }
      // An open channel parks the child instead of polling for it: the next
      // message, or the disconnect, schedules the check again.
      if (this.#ipcKeepsAlive()) return;
      this.finish(this.#exitCode ?? 0, null);
    }
  }

  function startChild(request: SpawnRequest): Child {
    const child = new Child(request);
    child.start();
    return child;
  }

  return {
    spawn(request: SpawnRequest): ChildHandle {
      return startChild(request);
    },

    run(request: SpawnRequest): Promise<RunResult> {
      const child = startChild(request);
      return new Promise<RunResult>((resolve) => {
        child.onExit((result) => {
          resolve({
            code: result.code,
            signal: result.signal,
            stdout: child.stdoutBytes,
            stderr: child.stderrBytes,
          });
        });
      });
    },

    runSync(request: SpawnRequest): RunResult {
      const child = startChild(request);
      if (!child.syncSettled()) {
        // Leaving it running would let a "synchronous" call quietly keep going
        // in the background, which is exactly the kind of surprise this surface
        // exists to prevent.
        child.kill('SIGTERM');
        throw new SpawnError(
          'ERR_WEB_NODE_SYNC_SPAWN',
          `${child.label} needs the event loop (asynchronous work, or reading stdin), so it cannot be run synchronously. Use the asynchronous API instead.`,
        );
      }
      if (!child.exited) child.finish(child.pendingExitCode, null);
      const result = child.exitResult as ExitStatus;
      return { code: result.code, signal: result.signal, stdout: child.stdoutBytes, stderr: child.stderrBytes };
    },

    get activeChildren(): number {
      return children.size;
    },

    reset(): void {
      for (const child of [...children]) child.kill('SIGKILL');
      children.clear();
    },
  };
}

    /** Render an exception the way a thrown-and-uncaught error would read. */
function formatUncaught(err: unknown): string {
  if (err instanceof Error) {
    return `${err.stack ?? `${err.name}: ${err.message}`}\n`;
  }
  return `${String(err)}\n`;
}
