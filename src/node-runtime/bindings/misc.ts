import type { BindingFactory } from './context';
import { notImplemented } from '../errors';

/** `trace_events` binding: this runtime does not emit V8 trace events. */
export const traceEventsBinding: BindingFactory = () => ({
  // `usePerfetto` picks the category/marker encoding; both are valid, and the
  // no-Perfetto branch is what a plain `trace()` call expects.
  usePerfetto: false,
  // `internal/trace_events` keeps one of these per category and only consults
  // byte 0 to decide whether an event is enabled. One zeroed byte per call means
  // "always disabled", so `trace()` stays a no-op without lying about it.
  getCategoryEnabledBuffer: () => new Uint8Array(1),
  trace: () => undefined,
  getCategoryEnabledBufferSize: () => 1,
});

/** `inspector` binding: reached only from `initializeGlobalConsole` (unused). */
export const inspectorBinding: BindingFactory = () => ({
  console: {},
});

/** `symbols` binding: internal symbols shared across internal Node modules. */
export const symbolsBinding: BindingFactory = () => {
  // Memoised so repeated reads of the same symbol name stay identical
  // (`internal/per_context/domexception.js` and `internal/worker/io.js` each
  // read these, and the two must agree on identity).
  const cache = new Map<string, symbol>();
  const make = (name: string): symbol => {
    let sym = cache.get(name);
    if (sym === undefined) {
      sym = Symbol(name);
      cache.set(name, sym);
    }
    return sym;
  };
  return {
    async_id_symbol: make('async_id_symbol'),
    trigger_async_id_symbol: make('trigger_async_id_symbol'),
    resource_symbol: make('resource_symbol'),
    handle_onclose: make('handle_onclose'),
    owner_symbol: make('owner_symbol'),
    onread_optimise: make('onread_optimise'),
    onwrite_optimise: make('onwrite_optimise'),
    kResource: make('kResource'),
    kHandle: make('kHandle'),
    kIncomingMessage: make('kIncomingMessage'),
    kOnMessageBegin: make('kOnMessageBegin'),
    kRequest: make('kRequest'),
    kResponse: make('kResponse'),
    kServerResponse: make('kServerResponse'),
    kSocket: make('kSocket'),
    kStreamBaseField: make('kStreamBaseField'),
    kReinitializeHandle: make('kReinitializeHandle'),
    kFsStatsFieldsNumber: make('kFsStatsFieldsNumber'),
    kUpdateTimer: make('kUpdateTimer'),
    kStatsFieldName: make('kStatsFieldName'),
    kStatsFieldNames: make('kStatsFieldNames'),
    kJavaStreamBaseField: make('kJavaStreamBaseField'),
    kTestingOnlyJsStream: make('kTestingOnlyJsStream'),
    kPendingHandle: make('kPendingHandle'),
    // Read by `internal/worker/io.js` when it installs the port's init/close
    // hooks and re-exports the transfer/clone hooks `internal/worker/js_transferable.js`
    // hands to objects that opt into `postMessage`. `no_message_symbol` is the
    // sentinel `MessagePort::ReceiveMessage` returns for "the queue is empty" so
    // our `messaging` binding and `internal/worker/io.js` can compare identity.
    oninit: make('oninit'),
    no_message_symbol: make('no_message_symbol'),
    messaging_clone_symbol: make('messaging_clone_symbol'),
    messaging_transfer_symbol: make('messaging_transfer_symbol'),
    messaging_deserialize_symbol: make('messaging_deserialize_symbol'),
    messaging_transfer_list_symbol: make('messaging_transfer_list_symbol'),
  };
};

/** `task_queue` binding: the microtask sink (`AsyncHooks` destroy queue etc.). */
export const taskQueueBinding: BindingFactory = (ctx) => ({
  enqueueMicrotask: (fn: () => void) => ctx.nextTick(fn),
  runMicrotasks: () => undefined,
});

/**
 * `async_context_frame` binding: the continuation-preserved embedder data used
 * by `AsyncContextFrame`. We ship the non-`--async-context-frame` path, but the
 * binding still has to exist because vendored `internal/async_context_frame.js`
 * reads it at module load.
 */
export const asyncContextFrameBinding: BindingFactory = () => {
  let continuationPreservedEmbedderData: unknown;
  return {
    getContinuationPreservedEmbedderData: () => continuationPreservedEmbedderData,
    setContinuationPreservedEmbedderData: (value: unknown) => {
      continuationPreservedEmbedderData = value;
    },
  };
};

/** `errors` binding: source-map + uncaught-exception plumbing. */
export const errorsBinding: BindingFactory = () => ({
  // `Environment::ExitCode` (read off a real Node). `internal/async_hooks` uses
  // kGenericUserError when a hook callback throws.
  exitCodes: {
    kNoFailure: 0,
    kGenericUserError: 1,
    kInternalJSParseError: 3,
    kInternalJSEvaluationFailure: 4,
    kV8FatalError: 5,
    kInvalidFatalExceptionMonkeyPatching: 6,
    kExceptionInFatalExceptionHandler: 7,
    kInvalidCommandLineArgument: 9,
    kBootstrapFailure: 10,
    kInvalidCommandLineArgument2: 12,
    kUnsettledTopLevelAwait: 13,
    kStartupSnapshotFailure: 14,
    kAbort: 134,
  },
  setSourceMapsEnabled: () => undefined,
  setPrepareStackTraceCallback: () => undefined,
  triggerUncaughtException: () => undefined,
  updateExceptionDetails: () => undefined,
  fatalException: () => undefined,
  getErrorSource: () => undefined,
  setErrorSource: () => undefined,
  hasPrepareStackTraceCallback: () => false,
});

/** `performance` binding: high-resolution timing. */
/**
 * `performance` binding.
 *
 * Mirrors `src/node_perf.cc` / `src/node_perf_common.h`: the milestone enum
 * (index-aligned with `NODE_PERFORMANCE_MILESTONES`), the milestone array, and
 * `now`. The browser `performance` global already provides the clock, so
 * `now()` is milliseconds since the origin and the two origin milestones are
 * derived from `performance.timeOrigin` (Node stores them in nanoseconds /
 * microseconds respectively — see `PerformanceState::Initialize`).
 */
const MILESTONES = {
  TIME_ORIGIN_TIMESTAMP: 0,
  TIME_ORIGIN: 1,
  ENVIRONMENT: 2,
  NODE_START: 3,
  V8_START: 4,
  LOOP_START: 5,
  LOOP_EXIT: 6,
  BOOTSTRAP_COMPLETE: 7,
};

const PERF_CONSTANTS = {
  NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP: MILESTONES.TIME_ORIGIN_TIMESTAMP,
  NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN: MILESTONES.TIME_ORIGIN,
  NODE_PERFORMANCE_MILESTONE_ENVIRONMENT: MILESTONES.ENVIRONMENT,
  NODE_PERFORMANCE_MILESTONE_NODE_START: MILESTONES.NODE_START,
  NODE_PERFORMANCE_MILESTONE_V8_START: MILESTONES.V8_START,
  NODE_PERFORMANCE_MILESTONE_LOOP_START: MILESTONES.LOOP_START,
  NODE_PERFORMANCE_MILESTONE_LOOP_EXIT: MILESTONES.LOOP_EXIT,
  NODE_PERFORMANCE_MILESTONE_BOOTSTRAP_COMPLETE: MILESTONES.BOOTSTRAP_COMPLETE,
  NODE_PERFORMANCE_MILESTONE_INVALID: 8,
};

export const performanceBinding: BindingFactory = (ctx) => {
  const host = (globalThis as { performance?: { timeOrigin?: number } }).performance;
  const timeOriginMs = host?.timeOrigin ?? Date.now() - ctx.now();
  const milestones = new Array<number>(8).fill(-1);
  milestones[MILESTONES.TIME_ORIGIN_TIMESTAMP] = timeOriginMs * 1e3; // microseconds
  milestones[MILESTONES.TIME_ORIGIN] = timeOriginMs * 1e6; // nanoseconds

  return {
    now: () => ctx.now(),
    timeOrigin: timeOriginMs,
    constants: PERF_CONSTANTS,
    milestones,
    mark: () => undefined,
    clearMark: () => undefined,
    measure: () => undefined,
    clearMeasures: () => undefined,
    getEntries: () => [],
    getEntriesByName: () => [],
    getEntriesByType: () => [],
    setupGarbageCollectionTracking: () => undefined,
  };
};

/** `process_methods` binding: process primitives. */
export const processMethodsBinding: BindingFactory = (ctx) => ({
  getStdout: () => 1,
  getStderr: () => 2,
  getStdin: () => 0,
  getCwd: () => ctx.vfs.cwd,
  chdir: (dir: string) => ctx.vfs.chdir(dir),
  setStdout: () => undefined,
  setStderr: () => undefined,
  setStdin: () => undefined,
  umask: () => 0o022,
  exit: (code: number) => ctx.exit(code),
  kill: () => {
    throw new Error('process.kill is not supported in web-node');
  },
  availableMemory: () => 512 * 1024 * 1024,
  constrainedMemory: () => 512 * 1024 * 1024,
});

/**
 * `os` binding: static host facts for the browser sandbox.
 *
 * The surface (and each function's `(…, ctx)` shape) matches `src/node_os.cc`,
 * which the vendored `lib/os.js` drives directly.
 */
export const osBinding: BindingFactory = () => ({
  getHostname: () => 'web-node',
  // `lib/os.js` destructures a single `[type, version, release, machine]` tuple.
  getOSInformation: () => ['Browser', 'web-node', 'browser', 'wasm32'],
  getFreeMem: () => 512 * 1024 * 1024,
  getTotalMem: () => 1024 * 1024 * 1024,
  getUptime: () => performance.now() / 1000,
  getCPUs: () => [],
  // A flat array of 7-tuples in real Node; empty is the "no interfaces" answer.
  getInterfaceAddresses: () => [],
  getHomeDirectory: () => '/home/web-node',
  getUserInfo: () => ({ uid: 0, gid: 0, username: 'web-node', homedir: '/home/web-node', shell: null }),
  getAvailableParallelism: () => navigator.hardwareConcurrency ?? 1,
  // `lib/os.js` hands this a preallocated Float64Array and expects it filled.
  getLoadAvg: (out: Float64Array) => {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  },
  // A value, not a function: `lib/os.js` reads it at module top level.
  isBigEndian: false,
  getPriority: () => 0,
  // Non-zero signals failure; 0 is the "success" answer.
  setPriority: () => 0,
});

/** `credentials` binding: the sandbox has one fixed temp dir. */
export const credentialsBinding: BindingFactory = () => ({
  getTempDir: () => '/tmp',
  cacheDir: '/tmp',
});

/** `icru`/`icu` binding: Intl availability. */
export const icuBinding: BindingFactory = () => ({
  getDefaultLocale: () => 'en-US',
  getAvailableLocales: () => ['en-US'],
  getBestAvailableLocale: () => 'en-US',
  getStringWidth: (s: string) => s.length,
  hasSmallICU: () => false,
});

/** `messaging` binding: see `bindings/messaging.ts`. */

/** `diagnostics_channel` binding: the native subscriber table. */
export const diagnosticsChannelBinding: BindingFactory = () => {
  // The JS side re-reads this through the binding on every subscribe (the
  // buffer is "replaced when native storage grows"), and increments/decrements
  // slots by index. A plain array keeps that contract.
  const subscribers: number[] = [];
  const active = new Set<number>();
  void active;
  return {
    subscribers,
    notifyChannelActive: (index: number) => {
      active.add(index);
    },
    notifyChannelInactive: (index: number) => {
      active.delete(index);
    },
    // No native addons exist in this tab, so there are no channels to link.
    // The callback is still accepted (the module calls it at load).
    linkNativeChannel: (_cb: (name: string, index: number) => unknown) => {},
  };
};

/** `uv` binding: the event loop. We expose an explicit "no pending work" view. */
export const uvBinding: BindingFactory = () => ({
  hrtime: () => [0, 0],
  getLibuvNow: () => Date.now(),
  updateTime: () => undefined,
  guessHandleType: () => 'FILE',
  // There is no libuv error table here, so the errno map is empty and every
  // name/message lookup falls back to Node's `Unknown system error <n>` shape.
  getErrorMap: () => new Map(),
  getErrorMessage: (errno: number) => `Unknown system error ${errno}`,
  errname: () => undefined,
});
