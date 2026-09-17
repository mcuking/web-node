import type { BindingFactory } from './context';

/** `symbols` binding: internal symbols shared across internal Node modules. */
export const symbolsBinding: BindingFactory = () => {
  const make = (name: string): symbol => Symbol(name);
  return {
    async_id_symbol: make('async_id_symbol'),
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

/** `errors` binding: source-map + uncaught-exception plumbing. */
export const errorsBinding: BindingFactory = () => ({
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

/** `string_decoder` binding: hex/base64 helpers used by the decoder builtin. */
export const stringDecoderBinding: BindingFactory = () => ({
  decode: () => '',
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

/** `uv` binding: the event loop. We expose an explicit "no pending work" view. */
export const uvBinding: BindingFactory = () => ({
  hrtime: () => [0, 0],
  getLibuvNow: () => Date.now(),
  updateTime: () => undefined,
  guessHandleType: () => 'FILE',
});
