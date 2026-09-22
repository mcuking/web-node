import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';
import type { WorkerHandle } from '../proc/worker';

/**
 * `worker_threads` — the message-passing half of Node's worker API, plus a real
 * `Worker`.
 *
 * The message-passing classes (`MessageChannel`, `MessagePort`,
 * `BroadcastChannel`, `receiveMessageOnPort`, `markAsUncloneable`) are the
 * vendored `internal/worker/io.js` unchanged, on top of the `messaging` binding.
 *
 * `Worker` is this runtime's own: a browser tab cannot start a thread, so a
 * worker here is a **second module registry on the same event loop** with its own
 * injected globals, its own `process`/`worker_threads` views, and a real
 * `MessageChannel` to the parent (see `proc/worker.ts`). Messages, `workerData`,
 * the `online`/`message`/`error`/`exit` lifecycle and `terminate()` all behave as
 * in Node; what is missing is the parallelism a real thread would give, which the
 * documentation states plainly. `stdin`/`stdout`/`stderr` are real streams (a
 * second port pair carries their bytes, since a tab has no per-thread pipe);
 * the option shapes that need the native isolate — `eval`, `resourceLimits` —
 * throw instead of being approximated.
 *
 * The constants (`isMainThread`, `threadId`, `parentPort: null`) are the truth
 * for the main thread, and `markAsUntransferable`/`isMarkedAsUntransferable`
 * come from `internal/buffer` exactly as Node's own `lib/worker_threads.js`.
 */

interface EmitterLike {
  on(name: string, fn: (...a: unknown[]) => void): unknown;
  emit(name: string, ...args: unknown[]): boolean;
}

const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

/** The parts of `internal/validators` this module uses (real, so exact messages). */
interface Validators {
  validateArray(value: unknown, name: string): void;
  validateString(value: unknown, name: string): void;
}

export const workerThreadsSpec: BuiltinSpec = {
  id: 'worker_threads',
  aliases: ['node:worker_threads'],
  origin: 'web-node',
  arity: { moveMessagePortToContext: 0, postMessageToThread: 4 },
  deps: ['events', 'internal/worker/io', 'internal/buffer'],
  init: (ctx: BuiltinInitContext) => {
    const binding = ctx.binding;
    const io = ctx.require('internal/worker/io') as {
      MessageChannel: unknown;
      MessagePort: unknown;
      BroadcastChannel: unknown;
      receiveMessageOnPort: unknown;
      markAsUncloneable: unknown;
      moveMessagePortToContext: unknown;
    };
    const buffer = ctx.require('internal/buffer') as {
      markAsUntransferable: unknown;
      isMarkedAsUntransferable: unknown;
    };
    const { EventEmitter } = ctx.require('events') as {
      EventEmitter: new () => EmitterLike & {
        once(name: string, fn: (...a: unknown[]) => void): unknown;
        off(name: string, fn: (...a: unknown[]) => void): unknown;
        removeAllListeners(name?: string): unknown;
      };
    };
    const validators = ctx.require('internal/validators') as unknown as Validators;
    const errors = ctx.require('internal/errors') as {
      codes: Record<string, new (...args: unknown[]) => Error>;
    };
    const process = ctx.require('process') as Record<string, unknown>;
    // The process-wide store `setEnvironmentData` writes and every worker reads,
    // shared through the worker host (Node keeps one map per agent).
    const environmentData = binding.workers.environmentData;

    /** Structured-clone a value the way a worker's `workerData` crosses over. */
    const clone = (value: unknown): unknown => {
      const messaging = ctx.internalBinding('messaging') as {
        structuredClone: (value: unknown, options?: { transfer?: unknown }) => unknown;
      };
      return messaging.structuredClone(value);
    };

    /**
     * A `Worker`: Node's `lib/internal/worker.js` public surface, backed by the
     * cooperative worker host. Options that need the native thread throw.
     */
    class Worker extends EventEmitter {
      #handle: WorkerHandle;
      /** `worker.performance.eventLoopUtilization()`, as Node exposes it. */
      performance: { eventLoopUtilization: () => unknown };

      constructor(filename?: unknown, options: Record<string, unknown> = {}) {
        super();
        if (options === null || typeof options !== 'object') {
          throw new errors.codes.ERR_INVALID_ARG_TYPE('options', 'Object', options);
        }
        if (options.execArgv !== undefined) validators.validateArray(options.execArgv, 'options.execArgv');

        let argv: string[] | undefined;
        if (options.argv !== undefined) {
          validators.validateArray(options.argv, 'options.argv');
          argv = (options.argv as unknown[]).map((v) => String(v));
        }

        let resolved: string;
        if (options.eval) {
          if (typeof filename !== 'string') {
            throw new errors.codes.ERR_INVALID_ARG_VALUE(
              'options.eval',
              options.eval,
              "must be false when 'filename' is not a string",
            );
          }
          throw notImplemented(
            'api',
            'worker_threads.Worker({ eval: true })',
            'Evaluating a string worker needs a script context this single-realm runtime does not create.',
          );
        } else if (isDataURL(filename)) {
          throw notImplemented(
            'api',
            'worker_threads.Worker(data: URL)',
            'data: URL workers are not supported.',
          );
        } else if (filename instanceof URL) {
          resolved = fileURLToPath(filename);
        } else if (typeof filename !== 'string') {
          throw new errors.codes.ERR_INVALID_ARG_TYPE('filename', ['string', 'URL'], filename);
        } else if (/^(?:\/|[A-Za-z]:[\\/])/.test(filename) || /^\.\.?[\\/]/.test(filename)) {
          resolved = binding.vfs.resolve(filename);
        } else {
          throw new errors.codes.ERR_WORKER_PATH(filename);
        }

        let env: Record<string, string>;
        if (typeof options.env === 'object' && options.env !== null) {
          env = Object.create(null) as Record<string, string>;
          for (const [key, value] of Object.entries(options.env as Record<string, unknown>)) {
            env[key] = `${value}`;
          }
        } else if (options.env === undefined || options.env === null) {
          env = { ...(process.env as Record<string, string>) };
        } else if (options.env === SHARE_ENV) {
          env = process.env as Record<string, string>;
        } else {
          throw new errors.codes.ERR_INVALID_ARG_TYPE(
            'options.env',
            ['object', 'undefined', 'null', 'worker_threads.SHARE_ENV'],
            options.env,
          );
        }

        let name = 'WorkerThread';
        if (options.name) {
          validators.validateString(options.name, 'options.name');
          name = (options.name as string).trim();
        }

        for (const key of ['resourceLimits'] as const) {
          if (options[key] !== undefined && options[key] !== null && options[key] !== false) {
            throw notImplemented(
              'api',
              `worker_threads.Worker({ ${key} })`,
              'A browser tab has no per-thread OS pipe or V8 isolate, so this option cannot be honoured.',
            );
          }
        }

        const execPath = String(process.execPath ?? '/bin/node');
        this.#handle = binding.workers.create({
          filename: resolved,
          workerData: clone(options.workerData),
          argv: [execPath, resolved, ...(argv ?? [])],
          name,
          env,
          execArgv: (options.execArgv as string[] | undefined) ?? [],
          stdin: Boolean(options.stdin),
          stdout: Boolean(options.stdout),
          stderr: Boolean(options.stderr),
        });

        const handle = this.#handle;
        handle.onOnline(() => this.emit('online'));
        handle.onMessage((value) => this.emit('message', value));
        handle.onMessageError((err) => this.emit('messageerror', err));
        handle.onError((err) => this.emit('error', err));
        handle.onExit((code) => this.emit('exit', code));

        this.performance = {
          eventLoopUtilization: () => handle.eventLoopUtilization(),
        };
      }

      get threadId(): number {
        // Node reports -1 once the worker's handle is gone (it has exited).
        return this.#handle.exited ? -1 : this.#handle.threadId;
      }

      get threadName(): string | null {
        return this.#handle.exited ? null : this.#handle.threadName;
      }

      get resourceLimits(): Record<string, number> {
        // Node reports the per-worker V8 limits; a worker here is not a real
        // isolate, so there are none to report.
        return {};
      }

      postMessage(value?: unknown, transferList?: unknown): void {
        this.#handle.postMessage(value, transferList);
      }

      terminate(): Promise<number> | undefined {
        return this.#handle.terminate();
      }

      ref(): void {
        this.#handle.ref();
      }

      unref(): void {
        this.#handle.unref();
      }

      // Per-thread heap/cpu profiling needs the worker's own V8 isolate.
      getHeapSnapshot(): Promise<never> {
        return Promise.reject(profilingUnsupported('getHeapSnapshot'));
      }

      getHeapStatistics(): Promise<never> {
        return Promise.reject(profilingUnsupported('getHeapStatistics'));
      }

      cpuUsage(): Promise<never> {
        return Promise.reject(profilingUnsupported('cpuUsage'));
      }

      startCpuProfile(): Promise<never> {
        return Promise.reject(profilingUnsupported('startCpuProfile'));
      }

      startHeapProfile(): Promise<never> {
        return Promise.reject(profilingUnsupported('startHeapProfile'));
      }

      get stdin(): unknown {
        return this.#handle.stdin;
      }

      get stdout(): unknown {
        return this.#handle.stdout;
      }

      get stderr(): unknown {
        return this.#handle.stderr;
      }
    }

    function profilingUnsupported(api: string): Error {
      return notImplemented(
        'api',
        `worker_threads.Worker#${api}`,
        'The worker shares this isolate, so there is no second heap or CPU profile to take.',
      );
    }

    function isDataURL(value: unknown): boolean {
      if (!(value instanceof URL)) return false;
      return value.protocol === 'data:';
    }

    /** `url.fileURLToPath` for the file:// URLs Node accepts as a worker entry. */
    function fileURLToPath(url: URL): string {
      const urlModule = ctx.require('internal/url') as { fileURLToPath: (u: URL) => string };
      return urlModule.fileURLToPath(url);
    }

    return {
      isInternalThread: false,
      isMainThread: true,
      threadId: 0,
      threadName: 'main',
      parentPort: null,
      workerData: null,
      resourceLimits: {},
      SHARE_ENV,
      MessageChannel: io.MessageChannel,
      MessagePort: io.MessagePort,
      BroadcastChannel: io.BroadcastChannel,
      receiveMessageOnPort: io.receiveMessageOnPort,
      markAsUncloneable: io.markAsUncloneable,
      moveMessagePortToContext: io.moveMessagePortToContext,
      markAsUntransferable: buffer.markAsUntransferable,
      isMarkedAsUntransferable: buffer.isMarkedAsUntransferable,
      getEnvironmentData: (key: unknown): unknown => environmentData.get(key),
      setEnvironmentData: (key: unknown, value: unknown): void => {
        if (value === undefined) environmentData.delete(key);
        else environmentData.set(key, value);
      },
      Worker,
      postMessageToThread: (): never => {
        throw notImplemented(
          'api',
          'worker_threads.postMessageToThread',
          'There are no other threads to message in this runtime.',
        );
      },
    };
  },
};
