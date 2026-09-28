import type { BuiltinSpec, BuiltinInitContext } from './types';

/**
 * `cluster` builtin — multi-"process" fan-out over the worker-per-child model.
 *
 * Real Node's cluster forks OS processes and shares the listening socket through
 * the primary. web-node has no OS process, so a cluster worker is a **forked
 * child** (M7's controlled spawn surface: its own module registry, its own
 * `process` view, its own pid) and a shared port is modelled in the virtual
 * network: each worker listens on the same port with `exclusive: false`, and the
 * network round-robins incoming connections across them. That is observationally
 * the same as Node's handle sharing — connections are spread across the workers
 * — without a separate handle-passing protocol.
 *
 * The primary view here mirrors Node's public surface: `isPrimary`/`isWorker`,
 * `fork()`, `workers`, `settings`, `setupPrimary`, `disconnect`, the `Worker`
 * class, and the `fork`/`online`/`listening`/`exit`/`message` events. A worker
 * gets its own view (see `buildClusterWorkerOverrides`) that reports
 * `isWorker: true` and exposes `cluster.worker`.
 *
 * Internal messages — the `{ cmd: 'NODE_CLUSTER', ... }` envelope Node also uses
 * — are consumed by cluster and never surfaced as a user `'message'`.
 */

/** Command tag for cluster's own primary↔worker control messages. */
export const NODE_CLUSTER_CMD = 'NODE_CLUSTER';

interface Emitter {
  on(name: string, fn: (...a: never[]) => void): unknown;
  once(name: string, fn: (...a: never[]) => void): unknown;
  emit(name: string, ...args: unknown[]): boolean;
  removeListener(name: string, fn: (...a: never[]) => void): unknown;
  listenerCount(name: string): number;
}

/** The slice of `child_process.ChildProcess` cluster drives. */
interface ChildLike extends Emitter {
  pid?: number;
  connected?: boolean;
  exitCode?: number | null;
  signalCode?: string | null;
  send(message: unknown, cb?: (err: Error | null) => void): boolean;
  disconnect(): void;
  kill(signal?: string): boolean;
}

export interface ClusterSettings {
  exec: string | undefined;
  args: string[];
  execArgv: string[];
  silent: boolean;
  serialization: 'json' | 'advanced';
  cwd: string | undefined;
  windowsHide: boolean;
}

/** The primary's `Worker` handle (Node's `cluster.Worker`). */
interface WorkerHandle extends Emitter {
  id: number;
  process: ChildLike;
  state: 'none' | 'online' | 'listening' | 'disconnected' | 'dead';
  exitedAfterDisconnect: boolean;
  send(message: unknown, cb?: (err: Error | null) => void): boolean;
  kill(signal?: string): void;
  destroy(signal?: string): void;
  isConnected(): boolean;
  isDead(): boolean;
  disconnect(): WorkerHandle;
}

function makeWorkerClass(Emitter: new () => Emitter): {
  Worker: new (id: number, child: ChildLike) => WorkerHandle;
} {
  class Worker extends (Emitter as unknown as new () => Emitter) {
    id: number;
    process: ChildLike;
    state: 'none' | 'online' | 'listening' | 'disconnected' | 'dead' = 'none';
    exitedAfterDisconnect = false;

    constructor(id: number, child: ChildLike) {
      super();
      this.id = id;
      this.process = child;
    }

    /** `worker.send(message[, sendHandle][, callback])`. */
    send(message: unknown, cb?: (err: Error | null) => void): boolean {
      return this.process.send(message, cb);
    }

    /** `worker.kill([signal])` — SIGTERM by default, like Node. */
    kill(signal = 'SIGTERM'): void {
      this.process.kill(signal);
    }

    /** `worker.destroy()` — the abrupt teardown `cluster.disconnect` avoids. */
    destroy(signal = 'SIGTERM'): void {
      this.exitedAfterDisconnect = true;
      this.process.kill(signal);
    }

    /** `worker.isConnected()` — is the IPC channel still open? */
    isConnected(): boolean {
      return this.process.connected === true;
    }

    /** `worker.isDead()` — has the worker exited? */
    isDead(): boolean {
      return this.state === 'dead' || this.process.exitCode !== null && this.process.exitCode !== undefined;
    }

    /** `worker.disconnect()` — close the channel so the worker drains and exits. */
    disconnect(): WorkerHandle {
      this.exitedAfterDisconnect = true;
      this.process.disconnect();
      return this;
    }
  }
  return { Worker };
}

/**
 * Build the loader-level builtin overrides a **cluster worker's** registry must
 * see: the worker-side `cluster`, and `net`/`http`/`https` whose servers listen
 * with `exclusive: false` so siblings (and the primary) can share the port.
 *
 * `realmRequire` is `realm.require`; passing it in keeps this file free of a
 * runtime import of the realm (and of a builtins ↔ realm cycle).
 */
export function buildClusterWorkerOverrides(
  realmRequire: (id: string) => unknown,
  id: number,
  proc: Record<string, unknown>,
): Record<string, unknown> {
  const events = realmRequire('events') as { EventEmitter: new () => Emitter };
  const cluster = new events.EventEmitter() as Emitter & Record<string, unknown>;

  const worker = new events.EventEmitter() as Emitter & Record<string, unknown>;
  worker.id = id;
  worker.process = proc;
  worker.state = 'online';
  worker.exitedAfterDisconnect = false;
  const procSend = proc.send as (m: unknown, cb?: (e: Error | null) => void) => boolean;
  const procKill = proc.kill as (s?: string) => boolean;
  const procDisconnect = proc.disconnect as () => void;
  worker.send = (message: unknown, cb?: (e: Error | null) => void): boolean => procSend(message, cb);
  worker.kill = (signal = 'SIGTERM'): void => {
    procKill(signal);
  };
  worker.destroy = (signal = 'SIGTERM'): void => {
    worker.exitedAfterDisconnect = true;
    procKill(signal);
  };
  worker.isConnected = (): boolean => proc.connected === true;
  worker.isDead = (): boolean => worker.state === 'dead';
  worker.disconnect = (): unknown => {
    worker.exitedAfterDisconnect = true;
    procDisconnect();
    return worker;
  };
  (proc.on as (n: string, f: (...a: unknown[]) => void) => void)('message', (m: unknown) => {
    // The primary never sends cluster control frames back down as user messages,
    // but guard just in case the protocol grows one.
    if (m && typeof m === 'object' && (m as { cmd?: string }).cmd === NODE_CLUSTER_CMD) return;
    worker.emit('message', m);
  });
  (proc.on as (n: string, f: (...a: unknown[]) => void) => void)('disconnect', () => {
    worker.state = 'disconnected';
    worker.emit('disconnect');
    cluster.emit('disconnect', worker);
  });

  const env = (proc.env ?? {}) as Record<string, string>;
  const pArgv = (proc.argv as string[]) ?? [];
  cluster.isPrimary = false;
  cluster.isMaster = false;
  cluster.isWorker = true;
  cluster.worker = worker;
  // Node: only the primary owns `cluster.workers`.
  cluster.workers = undefined;
  cluster.SCHED_NONE = 1;
  cluster.SCHED_RR = 2;
  cluster.schedulingPolicy = 2;
  cluster.settings = {
    exec: pArgv[1],
    args: pArgv.slice(2),
    execArgv: (proc.execArgv as string[]) ?? [],
    silent: false,
    serialization: 'json',
    cwd: undefined,
    windowsHide: false,
  } as ClusterSettings;
  cluster.setupPrimary = (): void => {};
  cluster.setupMaster = (): void => {};
  cluster.fork = (): never => {
    throw Object.assign(new Error('cluster.fork() is only available to the primary'), {
      code: 'ERR_CLUSTER_NOT_SUPPORTED',
    });
  };
  cluster.disconnect = (cb?: () => void): void => {
    (worker.disconnect as () => void)();
    if (typeof cb === 'function') cb();
  };

  const views = buildSharedServerViews(realmRequire, id, proc);
  return {
    cluster,
    'node:cluster': cluster,
    net: views.net,
    'node:net': views.net,
    http: views.http,
    'node:http': views.http,
    https: views.https,
    'node:https': views.https,
  };
}

/**
 * Wrap `net`/`http`/`https` so their servers default to `exclusive: false` and
 * report their bind up to the primary (`cluster.on('listening')`).
 */
function buildSharedServerViews(
  realmRequire: (id: string) => unknown,
  id: number,
  proc: Record<string, unknown>,
): {
  net: Record<string, unknown>;
  http: Record<string, unknown>;
  https: Record<string, unknown>;
} {
  const send = proc.send as ((m: unknown, cb?: (e: Error | null) => void) => boolean) | undefined;

  const wrap = (mod: Record<string, unknown>): Record<string, unknown> => {
    type ServerLike = {
      exclusive?: boolean;
      listen(...a: unknown[]): unknown;
      address?: () => { address?: string; port?: number } | null;
      once(n: string, f: (...a: unknown[]) => void): void;
    };
    const Base = mod.Server as new (...a: unknown[]) => ServerLike;
    class SharedServer extends Base {
      constructor(...args: unknown[]) {
        super(...args);
        this.exclusive = false;
      }
      listen(...args: unknown[]): unknown {
        // An explicit `exclusive: true` still wins; otherwise a cluster worker's
        // server shares the port with its siblings.
        const opts = args.find((a) => a && typeof a === 'object' && 'exclusive' in (a as object)) as
          | { exclusive?: boolean }
          | undefined;
        if (opts?.exclusive !== undefined) this.exclusive = opts.exclusive;
        else if (this.exclusive === undefined) this.exclusive = false;
        // Report the bind up to the primary so `cluster.on('listening')` fires
        // there, exactly as a shared handle would in Node.
        if (this.exclusive === false) {
          this.once('listening', () => {
            const addr = typeof this.address === 'function' ? this.address() : null;
            send?.({ cmd: NODE_CLUSTER_CMD, act: 'listening', id, address: addr?.address, port: addr?.port });
          });
        }
        return super.listen(...args);
      }
    }
    // `createServer()` in the module does `new Server(...)` with the *original*
    // class, so wrapping the export alone would leave the returned server
    // unwrapped. Build a SharedServer directly instead.
    const createServer = (...args: unknown[]): unknown => new SharedServer(...args);
    const dflt = mod.default as Record<string, unknown> | undefined;
    return {
      ...mod,
      Server: SharedServer,
      createServer,
      default: dflt ? { ...dflt, Server: SharedServer, createServer } : dflt,
    };
  };

  return {
    net: wrap(realmRequire('net') as Record<string, unknown>),
    http: wrap(realmRequire('http') as Record<string, unknown>),
    https: wrap(realmRequire('https') as Record<string, unknown>),
  };
}

export const clusterSpec: BuiltinSpec = {
  id: 'cluster',
  aliases: ['node:cluster'],
  origin: 'web-node',
  deps: ['events', 'child_process', 'net', 'http', 'https'],
  arity: { fork: 0, disconnect: 0, setupPrimary: 1, setupMaster: 1, Worker: 2 },
  init: (ctx: BuiltinInitContext) => {
    const { EventEmitter } = ctx.require('events') as { EventEmitter: new () => Emitter };
    const childProcess = ctx.require('child_process') as {
      fork(modulePath: string, args?: unknown, options?: unknown): ChildLike;
    };
    const proc = ctx.require('process') as { argv: string[]; env: Record<string, string>; execArgv?: string[] };

    const cluster = new EventEmitter() as Emitter & Record<string, unknown>;
    const { Worker } = makeWorkerClass(EventEmitter);

    const settings: ClusterSettings = {
      exec: proc.argv[1],
      args: proc.argv.slice(2),
      execArgv: proc.execArgv ?? [],
      silent: false,
      serialization: 'json',
      cwd: undefined,
      windowsHide: false,
    };

    const workers: Record<number, WorkerHandle> = {};
    let nextWorkerId = 1; // Node's round-robin starts at 1 (primary is 0).
    let disconnecting = false;

    /** Cluster's own control frames must not reach a user `'message'` listener. */
    function onWorkerMessage(worker: WorkerHandle, message: unknown): void {
      if (message && typeof message === 'object' && (message as { cmd?: string }).cmd === NODE_CLUSTER_CMD) {
        const frame = message as { act?: string; address?: string; port?: number };
        if (frame.act === 'listening') {
          worker.state = 'listening';
          worker.emit('listening', { address: frame.address, port: frame.port });
          cluster.emit('listening', worker, { address: frame.address, port: frame.port });
        }
        return;
      }
      worker.emit('message', message);
      cluster.emit('message', worker, message);
    }

    function maybeFinishDisconnect(): void {
      if (!disconnecting) return;
      if (Object.keys(workers).length > 0) return;
      disconnecting = false;
      cluster.emit('disconnect');
    }

    const fork = (env?: Record<string, string>): WorkerHandle => {
      const workerEnv = { ...(env ?? {}), NODE_UNIQUE_ID: String(nextWorkerId) };
      const child = childProcess.fork(settings.exec as string, settings.args, {
        env: workerEnv,
        execArgv: settings.execArgv,
        silent: settings.silent,
        serialization: settings.serialization,
      });
      const worker = new Worker(nextWorkerId, child);
      nextWorkerId += 1;
      workers[worker.id] = worker;
      cluster.emit('fork', worker);

      child.on('spawn', () => {
        worker.state = 'online';
        worker.emit('online');
        cluster.emit('online', worker);
      });
      child.on('message', (msg: unknown) => onWorkerMessage(worker, msg));
      child.on('disconnect', () => {
        worker.emit('disconnect');
      });
      child.on('exit', (code: number | null, signal: string | null) => {
        worker.state = 'dead';
        delete workers[worker.id];
        worker.emit('exit', code, signal);
        cluster.emit('exit', worker, code, signal);
        maybeFinishDisconnect();
      });
      child.on('error', (err: Error) => worker.emit('error', err));
      return worker;
    };

    const setupPrimary = (opts?: Partial<ClusterSettings>): void => {
      if (!opts) return;
      if (opts.exec !== undefined) settings.exec = opts.exec;
      if (opts.args !== undefined) settings.args = opts.args;
      if (opts.execArgv !== undefined) settings.execArgv = opts.execArgv;
      if (opts.silent !== undefined) settings.silent = opts.silent;
      if (opts.serialization !== undefined) settings.serialization = opts.serialization;
      if (opts.cwd !== undefined) settings.cwd = opts.cwd;
      if (opts.windowsHide !== undefined) settings.windowsHide = opts.windowsHide;
    };

    cluster.isPrimary = true;
    cluster.isMaster = true;
    cluster.isWorker = false;
    cluster.worker = undefined;
    cluster.workers = workers;
    cluster.settings = settings;
    cluster.SCHED_NONE = 1;
    cluster.SCHED_RR = 2;
    cluster.schedulingPolicy = 2;
    cluster.fork = fork;
    cluster.setupPrimary = setupPrimary;
    cluster.setupMaster = setupPrimary;
    cluster.Worker = Worker;
    cluster.disconnect = (cb?: () => void): void => {
      const ids = Object.keys(workers);
      if (ids.length === 0) {
        if (typeof cb === 'function') cb();
        return;
      }
      disconnecting = true;
      if (typeof cb === 'function') cluster.once('disconnect', cb as never);
      for (const id of ids) workers[Number(id)].disconnect();
    };

    // host.ts reaches this to build a forked child's worker-side view without
    // going through the builtin registry (the child is a *different* registry).
    Object.defineProperty(cluster, '_workerOverrides', {
      value: (id: number, childProc: Record<string, unknown>) =>
        buildClusterWorkerOverrides((name: string) => ctx.require(name), id, childProc),
      enumerable: false,
    });

    return cluster;
  },
};
