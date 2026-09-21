import type { BindingFactory } from './context';
import { notImplemented } from '../errors';
import { triggerUncaughtException } from './uncaught';

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
export const errorsBinding: BindingFactory = (ctx) => ({
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
  // `promise_hooks` and `diagnostics_channel` dispatch into here when a
  // rejection goes unhandled or a channel subscriber throws. It must reach the
  // user's handlers — a silent no-op would swallow unhandled rejections.
  triggerUncaughtException: (err: unknown, fromPromise?: boolean) =>
    triggerUncaughtException(ctx, err, fromPromise),
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

  // `enum PerformanceEntryType` in source order (GC, HTTP, HTTP2, NET, DNS,
  // QUIC); `internal/perf/observe.js` indexes `observerCounts` with these.
  NODE_PERFORMANCE_ENTRY_TYPE_GC: 0,
  NODE_PERFORMANCE_ENTRY_TYPE_HTTP: 1,
  NODE_PERFORMANCE_ENTRY_TYPE_HTTP2: 2,
  NODE_PERFORMANCE_ENTRY_TYPE_NET: 3,
  NODE_PERFORMANCE_ENTRY_TYPE_DNS: 4,
  NODE_PERFORMANCE_ENTRY_TYPE_QUIC: 5,
  NODE_PERFORMANCE_ENTRY_TYPE_INVALID: 6,

  // `enum PerformanceGCKind` / `PerformanceGCFlags` (values are the V8 GCType
  // and GC flags bit values — see `src/node_perf.h`).
  NODE_PERFORMANCE_GC_MAJOR: 4,
  NODE_PERFORMANCE_GC_MINOR: 1,
  NODE_PERFORMANCE_GC_MINOR_MARK_SWEEP: 2,
  NODE_PERFORMANCE_GC_INCREMENTAL: 8,
  NODE_PERFORMANCE_GC_WEAKCB: 16,
  NODE_PERFORMANCE_GC_FLAGS_NO: 0,
  NODE_PERFORMANCE_GC_FLAGS_CONSTRUCT_RETAINED: 2,
  NODE_PERFORMANCE_GC_FLAGS_FORCED: 4,
  NODE_PERFORMANCE_GC_FLAGS_SYNCHRONOUS_PHANTOM_PROCESSING: 8,
  NODE_PERFORMANCE_GC_FLAGS_ALL_AVAILABLE_GARBAGE: 16,
  NODE_PERFORMANCE_GC_FLAGS_ALL_EXTERNAL_MEMORY: 32,
  NODE_PERFORMANCE_GC_FLAGS_SCHEDULE_IDLE: 64,
};

/** Number of entry types the `observerCounts` vector is indexed by. */
const ENTRY_TYPE_COUNT = PERF_CONSTANTS.NODE_PERFORMANCE_ENTRY_TYPE_INVALID;

export const performanceBinding: BindingFactory = (ctx) => {
  const host = (globalThis as { performance?: { timeOrigin?: number } }).performance;
  const timeOriginMs = host?.timeOrigin ?? Date.now() - ctx.now();
  const milestones = new Array<number>(8).fill(-1);
  milestones[MILESTONES.TIME_ORIGIN_TIMESTAMP] = timeOriginMs * 1e3; // microseconds
  milestones[MILESTONES.TIME_ORIGIN] = timeOriginMs * 1e6; // nanoseconds
  // Node marks these during bootstrap; here the runtime *is* the origin, so
  // they land at 0 relative to it. LOOP_START/LOOP_EXIT stay -1 until the loop
  // actually runs, exactly like Node before the first tick (real Node reports
  // `loopStart === -1` at top level too, and `eventLoopUtilization()` then
  // returns all zeros).
  for (const index of [
    MILESTONES.ENVIRONMENT,
    MILESTONES.NODE_START,
    MILESTONES.V8_START,
    MILESTONES.BOOTSTRAP_COMPLETE,
  ]) {
    milestones[index] = milestones[MILESTONES.TIME_ORIGIN];
  }

  // `setupObservers()` hands the binding a JS callback to invoke on GC/native
  // events. We never see those events, so remember it and never call it.
  const observerCounts = new Array<number>(ENTRY_TYPE_COUNT).fill(0);

  return {
    now: () => ctx.now(),
    timeOrigin: timeOriginMs,
    constants: PERF_CONSTANTS,
    milestones,
    // GC observation / event-loop metrics have no libuv (or V8 GC hook) to sit
    // on, so these report the same inert values Node uses when the data is
    // unavailable rather than fabricating numbers.
    observerCounts,
    setupObservers: (_callback: unknown) => undefined,
    installGarbageCollectionTracking: () => undefined,
    removeGarbageCollectionTracking: () => undefined,
    loopIdleTime: () => 0,
    uvMetricsInfo: () => [0, 0, 0],
    setupGarbageCollectionTracking: () => undefined,
    // `monitorEventLoopDelay` builds its histogram from this handle; the
    // histogram itself is not implemented (see `internal/histogram`).
    createELDHistogram: () => {
      throw notImplemented('api', 'perf_hooks.monitorEventLoopDelay');
    },
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
export const mksnapshotBinding: BindingFactory = () => ({
  // `internal/v8/startup_snapshot.js` reads `[0]` of this array to answer
  // `isBuildingSnapshot()`; we are never building one.
  isBuildingSnapshotBuffer: [false],
  setSerializeCallback: (): void => {},
  setDeserializeCallback: (): void => {},
  setDeserializeMainFunction: (): void => {},
});

export const icuBinding: BindingFactory = (ctx) => ({
  getDefaultLocale: () => 'en-US',
  getAvailableLocales: () => ['en-US'],
  getBestAvailableLocale: () => 'en-US',
  getStringWidth,
  hasSmallICU: () => false,
  // `buffer.transcode` (lib/buffer.js) decodes with a source converter and
  // re-encodes with a target one. ICU returns a numeric status for a bad
  // request; `icuErrName` turns it into the `code` the thrown error carries.
  transcode: (source: Uint8Array, fromEnc: unknown, toEnc: unknown) => {
    const result = transcode(source, fromEnc, toEnc);
    // The native `_transcode` hands back a `Buffer` (`node::Buffer::New`), not a
    // bare `Uint8Array`; `lib/buffer.js` returns it verbatim, so wrap it here.
    return typeof result === 'number' ? result : toBuffer(ctx, result);
  },
  icuErrName: (code: number): string => ICU_ERR_NAMES[code] ?? 'U_UNKNOWN_ERROR',
});

/** Wrap fresh bytes as a non-pooled `Buffer`, like `node::Buffer::New`. */
function toBuffer(
  ctx: Parameters<BindingFactory>[0],
  bytes: Uint8Array,
): Uint8Array {
  const Buffer = (ctx.requireBuiltin?.('buffer') as
    | { Buffer?: { from(b: ArrayBufferLike, o: number, l: number): Uint8Array } }
    | undefined)?.Buffer;
  if (Buffer && bytes.length > 0) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  return bytes;
}

const ICU_ERR_NAMES: Record<number, string> = {
  0: 'U_ZERO_ERROR',
  1: 'U_ILLEGAL_ARGUMENT_ERROR',
  2: 'U_MISSING_RESOURCE_ERROR',
  4: 'U_FILE_ACCESS_ERROR',
  5: 'U_INTERNAL_PROGRAM_ERROR',
  7: 'U_INVALID_FORMAT_ERROR',
  9: 'U_BUFFER_OVERFLOW_ERROR',
  10: 'U_UNSUPPORTED_ERROR',
  12: 'U_INVALID_CHAR_FOUND',
  15: 'U_MEMORY_ALLOCATION_ERROR',
};

/** Canonical name for the encodings ICU accepts in `transcode`. */
function canonicalTranscodeEncoding(encoding: unknown): 'utf8' | 'ucs2' | 'latin1' | 'ascii' | null {
  if (typeof encoding !== 'string') return null;
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return 'utf8';
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return 'ucs2';
    case 'latin1':
    case 'binary':
      return 'latin1';
    case 'ascii':
      return 'ascii';
    default:
      return null;
  }
}

/**
 * `Buffer.transcode(source, fromEnc, toEnc)` (src/node_i18n.cc). Returns the
 * transcoded bytes, or the numeric ICU status (1, U_ILLEGAL_ARGUMENT_ERROR)
 * when either encoding is not one ICU can convert.
 */
function transcode(source: Uint8Array, fromEnc: unknown, toEnc: unknown): Uint8Array | number {
  const from = canonicalTranscodeEncoding(fromEnc);
  const to = canonicalTranscodeEncoding(toEnc);
  if (from === null || to === null) return 1;

  // Decode the source into UTF-16 code units.
  let units: number[];
  if (from === 'utf8') {
    const decoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(source);
    units = [];
    for (let i = 0; i < decoded.length; i++) units.push(decoded.charCodeAt(i));
  } else if (from === 'ucs2') {
    units = [];
    for (let i = 0; i + 1 < source.length; i += 2) units.push(source[i] | (source[i + 1] << 8));
  } else if (from === 'latin1') {
    units = Array.from(source);
  } else {
    units = [];
    for (let i = 0; i < source.length; i++) units.push(source[i] < 0x80 ? source[i] : 0xfffd);
  }

  // Encode them into the target encoding, substituting unrepresentable chars.
  if (to === 'utf8') {
    let text = '';
    for (const u of units) text += String.fromCharCode(u);
    return new TextEncoder().encode(text);
  }
  if (to === 'ucs2') {
    const out = new Uint8Array(units.length * 2);
    for (let i = 0; i < units.length; i++) {
      out[2 * i] = units[i] & 0xff;
      out[2 * i + 1] = (units[i] >> 8) & 0xff;
    }
    return out;
  }
  const limit = to === 'latin1' ? 0x100 : 0x80;
  const out = new Uint8Array(units.length);
  for (let i = 0; i < units.length; i++) out[i] = units[i] < limit ? units[i] : 0x3f;
  return out;
}

// --- Unicode column width -------------------------------------------------
// `getStringWidth` is the measure `util.inspect`, `console.table` and readline
// use to lay text out, so `'中文'` must be four columns wide, not two. Node
// computes this in ICU (`src/node_i18n.cc`): a wide/fullwidth code point is 2,
// an emoji-presentation code point is 2, control/format/combining marks and
// emoji modifiers are 0, and everything else is 1.

/**
 * The wide/fullwidth (East_Asian_Width = W or F) set. V8 exposes no
 * East_Asian_Width property, so these are the same ranges Node's own no-ICU
 * fallback uses (`lib/internal/util/inspect.js`), derived from
 * EastAsianWidth.txt. Emoji live in the 0x1f300-0x1f64f span below.
 */
function isFullWidthCodePoint(code: number): boolean {
  return (
    code >= 0x1100 &&
    (code <= 0x115f || // Hangul Jamo
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0x3247 && code !== 0x303f) ||
      (code >= 0x3250 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0xa4c6) ||
      (code >= 0xa960 && code <= 0xa97c) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6b) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1b000 && code <= 0x1b001) ||
      (code >= 0x1f200 && code <= 0x1f251) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x20000 && code <= 0x3fffd))
  );
}

const emojiPresentation = /\p{Emoji_Presentation}/u;
const emojiModifier = /\p{Emoji_Modifier}/u;
const zeroWidthCategory = /[\p{Cc}\p{Cf}\p{Me}\p{Mn}]/u;

function columnWidth(codePoint: number): number {
  const char = String.fromCodePoint(codePoint);
  if (isFullWidthCodePoint(codePoint)) return 2;
  if (emojiPresentation.test(char)) return 2;
  // U+00AD SOFT HYPHEN is a format character but displays as a column.
  if (codePoint !== 0x00ad && (zeroWidthCategory.test(char) || emojiModifier.test(char))) {
    return 0;
  }
  return 1;
}

/**
 * Columns needed to display `str` (no control-character stripping or NFC
 * normalisation here — that belongs to the caller, e.g.
 * `internal/util/inspect.js`). `expandEmojiSequence` mirrors ICU's option:
 * when false, a code point that follows a ZWJ inside an emoji sequence is not
 * counted separately.
 *
 * `ambiguousAsFullWidth` cannot be honoured without the East_Asian_Width
 * Ambiguous set, which JS cannot see; rather than silently ignoring it we throw
 * (no caller in the runtime passes it).
 */
export function getStringWidth(
  str: string,
  ambiguousAsFullWidth = false,
  expandEmojiSequence = true,
): number {
  if (ambiguousAsFullWidth) {
    throw notImplemented(
      'api',
      'icu.getStringWidth(…, ambiguousAsFullWidth = true)',
      'The East_Asian_Width Ambiguous set is not available to JS.',
    );
  }
  let width = 0;
  let previous = 0;
  for (const char of str) {
    const codePoint = char.codePointAt(0)!;
    if (
      !expandEmojiSequence &&
      previous === 0x200d &&
      (emojiPresentation.test(char) || emojiModifier.test(char))
    ) {
      previous = codePoint;
      continue;
    }
    width += columnWidth(codePoint);
    previous = codePoint;
  }
  return width;
}

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
  // `uv.h`: `UV_EOF = -4095`. `internal/webstreams/adapters` compares a raw
  // read result against it when it turns a `stream_base` socket into a web
  // stream.
  UV_EOF: -4095,
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

/**
 * `stream_wrap` binding: the C++ `StreamBase` handle base plus the shared
 * `streamBaseState` vector.
 *
 * `internal/webstreams/adapters` reads this at load time, and only *uses* it in
 * `newWritableStreamFromStreamBase` / `newReadableStreamFromStreamBase`, which
 * turn a raw `stream_base` (a real libuv socket handle) into a web stream. The
 * runtime's networking is emulated and never hands out a `stream_base`, so the
 * shapes below exist to let the module load and to keep the code paths honest
 * if they are ever reached. The field order and offsets match
 * `StreamBase::StreamBaseStateFields` in `src/stream_base.h`.
 */
export const streamWrapBinding: BindingFactory = () => {
  // `Environment::stream_base_state()` is an `Int32Array` of
  // `kNumStreamBaseStateFields` (4) slots.
  const streamBaseState = new Int32Array(4);

  /** `WriteWrap` (src/stream_wrap.cc): an `AsyncWrap` carrying one write. */
  class WriteWrap {
    async = false;
    handle: unknown = null;
    oncomplete: ((status: number) => void) | null = null;
  }

  /** `ShutdownWrap` (src/stream_wrap.cc): an `AsyncWrap` carrying a shutdown. */
  class ShutdownWrap {
    handle: unknown = null;
    oncomplete: ((status: number) => void) | null = null;
  }

  return {
    WriteWrap,
    ShutdownWrap,
    kReadBytesOrError: 0,
    kArrayBufferOffset: 1,
    kBytesWritten: 2,
    kLastWriteWasAsync: 3,
    streamBaseState,
  };
};
