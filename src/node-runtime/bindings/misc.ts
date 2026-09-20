import type { BindingFactory } from './context';

/** `symbols` binding: internal symbols shared across internal Node modules. */
export const symbolsBinding: BindingFactory = () => {
  const make = (name: string): symbol => Symbol(name);
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
export const performanceBinding: BindingFactory = (ctx) => ({
  now: () => ctx.now(),
  timeOrigin: 0,
  mark: () => undefined,
  clearMark: () => undefined,
  measure: () => undefined,
  clearMeasures: () => undefined,
  getEntries: () => [],
  getEntriesByName: () => [],
  getEntriesByType: () => [],
  setupGarbageCollectionTracking: () => undefined,
});

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

/** `os` binding: static host facts. */
export const osBinding: BindingFactory = () => ({
  getHostname: () => 'web-node',
  getOSRelease: () => 'browser',
  getOSType: () => 'Browser',
  getOSVersion: () => '',
  getMachine: () => 'wasm32',
  getFreeMem: () => 512 * 1024 * 1024,
  getTotalMem: () => 1024 * 1024 * 1024,
  getUptime: () => performance.now() / 1000,
  getCPUs: () => [],
  getInterfaceAddresses: () => ({}),
  getHomeDirectory: () => '/home/web-node',
  getTmpdir: () => '/tmp',
  getUserInfo: () => ({ uid: 0, gid: 0, username: 'web-node', homedir: '/home/web-node', shell: null }),
});

/** `icru`/`icu` binding: Intl availability. */
export const icuBinding: BindingFactory = () => ({
  getDefaultLocale: () => 'en-US',
  getAvailableLocales: () => ['en-US'],
  getBestAvailableLocale: () => 'en-US',
  getStringWidth: (s: string) => s.length,
  hasSmallICU: () => false,
});

/** `messaging` binding: only enough to satisfy internal code paths we ship. */
export const messagingBinding: BindingFactory = () => ({
  setDeserializeMainFunction: () => undefined,
  isBuildingSnapshot: () => false,
});

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
