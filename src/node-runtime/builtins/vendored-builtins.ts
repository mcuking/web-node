import type { BuiltinSpec } from './types';

/**
 * Builtins backed by real Node.js source (see tools/vendor.mjs).
 * Provenance is recorded in vendor/node-lib/MANIFEST.json.
 */

export const vendoredBuiltins: BuiltinSpec[] = [
  {
    id: 'internal/constants',
    vendorPath: 'internal/constants.js',
    origin: 'node-source',
  },
  {
    id: 'internal/encoding/util',
    vendorPath: 'internal/encoding/util.js',
    origin: 'node-source',
  },
  {
    id: 'internal/querystring',
    vendorPath: 'internal/querystring.js',
    origin: 'node-source',
    deps: ['internal/errors'],
  },
  {
    id: 'internal/webidl',
    vendorPath: 'internal/webidl.js',
    origin: 'node-source',
    // Pure JS: only `internal/util` + `internal/util/types` (+ primordials).
    deps: ['internal/util', 'internal/util/types'],
  },
  {
    id: 'internal/perf/utils',
    vendorPath: 'internal/perf/utils.js',
    origin: 'node-source',
    // Reads the `performance` binding (milestones/constants/now) at load time.
    deps: [],
  },
  {
    id: 'internal/perf/performance_entry',
    vendorPath: 'internal/perf/performance_entry.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/util', 'internal/validators'],
  },
  {
    id: 'internal/perf/observe',
    vendorPath: 'internal/perf/observe.js',
    origin: 'node-source',
    // Calls `setupObservers()` on the `performance` binding at load time, then
    // indexes the binding's `observerCounts` vector by entry type.
    deps: [
      'internal/errors',
      'internal/util',
      'internal/validators',
      'internal/perf/utils',
      'internal/perf/performance_entry',
      'timers',
    ],
  },
  {
    id: 'internal/perf/nodetiming',
    vendorPath: 'internal/perf/nodetiming.js',
    origin: 'node-source',
    deps: ['internal/perf/performance_entry', 'internal/perf/utils', 'internal/util'],
  },
  {
    id: 'internal/perf/usertiming',
    vendorPath: 'internal/perf/usertiming.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/util',
      'internal/validators',
      'internal/perf/nodetiming',
      'internal/perf/observe',
      'internal/perf/performance_entry',
      'internal/perf/utils',
      'internal/worker/js_transferable',
    ],
  },
  {
    id: 'internal/perf/resource_timing',
    vendorPath: 'internal/perf/resource_timing.js',
    origin: 'node-source',
    deps: [
      'internal/assert',
      'internal/errors',
      'internal/util',
      'internal/validators',
      'internal/perf/observe',
      'internal/perf/performance_entry',
    ],
  },
  {
    id: 'internal/perf/timerify',
    vendorPath: 'internal/perf/timerify.js',
    origin: 'node-source',
    // Builds its histogram lazily; the module only needs `isHistogram` at load.
    deps: [
      'internal/errors',
      'internal/histogram',
      'internal/util',
      'internal/validators',
      'internal/perf/observe',
      'internal/perf/performance_entry',
      'internal/perf/utils',
    ],
  },
  {
    id: 'internal/perf/event_loop_delay',
    vendorPath: 'internal/perf/event_loop_delay.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/histogram',
      'internal/util',
      'internal/validators',
      'internal/worker/js_transferable',
    ],
  },
  {
    id: 'internal/perf/event_loop_utilization',
    vendorPath: 'internal/perf/event_loop_utilization.js',
    origin: 'node-source',
    deps: [],
  },
  {
    id: 'internal/perf/performance',
    vendorPath: 'internal/perf/performance.js',
    origin: 'node-source',
    // Assembles the `Performance` class from every other perf module; nothing
    // in this group requires it back, so there is no load cycle.
    deps: [
      'internal/errors',
      'internal/event_target',
      'internal/util',
      'internal/validators',
      'internal/webidl',
      'internal/perf/utils',
      'internal/perf/performance_entry',
      'internal/perf/observe',
      'internal/perf/nodetiming',
      'internal/perf/usertiming',
      'internal/perf/resource_timing',
      'internal/perf/timerify',
      'internal/perf/event_loop_utilization',
    ],
  },
  {
    id: 'perf_hooks',
    aliases: ['node:perf_hooks'],
    vendorPath: 'perf_hooks.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/histogram',
      'internal/perf/performance',
      'internal/perf/performance_entry',
      'internal/perf/resource_timing',
      'internal/perf/observe',
      'internal/perf/usertiming',
      'internal/perf/event_loop_delay',
      'internal/perf/event_loop_utilization',
      'internal/perf/timerify',
    ],
  },
  {
    id: 'internal/event_target',
    vendorPath: 'internal/event_target.js',
    origin: 'node-source',
    // Node's own file eagerly `require('events')`s at the top, so `events` is
    // deliberately *not* listed here (the loader materialises it on demand when
    // the module body runs, by which point `events` is no longer loading).
    deps: [
      'internal/errors',
      'internal/validators',
      'internal/util',
      'internal/util/inspect',
      'internal/webidl',
      'internal/perf/utils',
    ],
  },
  {
    id: 'internal/abort_controller',
    vendorPath: 'internal/abort_controller.js',
    origin: 'node-source',
    // Node's file top-level requires `events` (for `kMaxEventTargetListeners`)
    // and `internal/event_target` (which itself top-level requires `events`).
    // Listing `events` first makes sure it is fully materialised before either
    // consumer starts, instead of handing them a half-built `module.exports`.
    // `internal/worker/io` is reached only through the lazy `[kTransferList]`
    // path and is registered as a vendored module in its own right.
    deps: [
      'events',
      'internal/event_target',
      'internal/util',
      'internal/util/inspect',
      'internal/errors',
      'internal/webidl',
      'internal/validators',
      'internal/assert',
      'internal/worker/js_transferable',
      'timers',
    ],
  },
  {
    id: 'internal/util/types',
    vendorPath: 'internal/util/types.js',
    origin: 'node-source',
  },
  {
    id: 'internal/trace_events',
    vendorPath: 'internal/trace_events.js',
    origin: 'node-source',
    // Pure JS over the `trace_events` binding (which we make inert).
    deps: ['internal/constants'],
  },
  {
    id: 'internal/util/debuglog',
    vendorPath: 'internal/util/debuglog.js',
    origin: 'node-source',
    // `internal/util/colors` is only pulled while actually logging.
    deps: ['internal/trace_events', 'internal/util/inspect'],
  },
  {
    id: 'internal/cli_table',
    vendorPath: 'internal/cli_table.js',
    origin: 'node-source',
    deps: ['internal/util/inspect'],
  },
  {
    id: 'internal/readline/utils',
    vendorPath: 'internal/readline/utils.js',
    origin: 'node-source',
  },
  {
    id: 'internal/readline/callbacks',
    vendorPath: 'internal/readline/callbacks.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/readline/utils', 'internal/validators'],
  },
  {
    id: 'internal/console/constructor',
    vendorPath: 'internal/console/constructor.js',
    origin: 'node-source',
    // Node lazily pulls `internal/util/colors` (on first write), `internal/cli_table`
    // (on `table()`), `internal/readline/callbacks` (on `clear()`, TTY-only) and
    // `internal/v8/startup_snapshot` (from `initializeGlobalConsole`, which this
    // runtime never calls). None of those are eager edges.
    deps: [
      'internal/trace_events',
      'internal/errors',
      'internal/validators',
      'buffer',
      'internal/util',
      'internal/util/inspect',
      'internal/util/types',
      'internal/util/debuglog',
      'diagnostics_channel',
    ],
  },
  {
    id: 'internal/console/global',
    vendorPath: 'internal/console/global.js',
    origin: 'node-source',
    deps: ['internal/console/constructor'],
  },
  {
    id: 'internal/util/inspect',
    vendorPath: 'internal/util/inspect.js',
    origin: 'node-source',
    deps: [
      'internal/util',
      'internal/util/types',
      'internal/errors',
      'internal/assert',
      'internal/bootstrap/realm',
      'internal/validators',
      'buffer',
    ],
  },
  {
    id: 'internal/util/colors',
    vendorPath: 'internal/util/colors.js',
    origin: 'node-source',
    // `internal/tty` is only pulled in when FORCE_COLOR is set, which never
    // happens in the browser, so it is deliberately left unregistered.
    deps: [],
  },
  {
    id: 'internal/validators',
    vendorPath: 'internal/validators.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/util', 'internal/util/types'],
  },
  {
    id: 'internal/assert',
    vendorPath: 'internal/assert.js',
    origin: 'node-source',
    deps: ['internal/errors'],
  },
  {
    id: 'internal/assert/myers_diff',
    vendorPath: 'internal/assert/myers_diff.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/util/colors'],
  },
  {
    id: 'internal/assert/assertion_error',
    vendorPath: 'internal/assert/assertion_error.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/util',
      'internal/util/colors',
      'internal/util/inspect',
      'internal/validators',
      'internal/assert/myers_diff',
    ],
  },
  {
    id: 'internal/assert/utils',
    vendorPath: 'internal/assert/utils.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/errors/error_source',
      'internal/util',
      'internal/util/inspect',
      'internal/assert/assertion_error',
    ],
  },
  {
    id: 'internal/util/comparisons',
    vendorPath: 'internal/util/comparisons.js',
    origin: 'node-source',
    // `internal/crypto/keys` is only reached for real KeyObject/CryptoKey
    // values, which this runtime never produces (no OpenSSL).
    deps: ['buffer', 'internal/assert', 'internal/url', 'internal/util', 'internal/util/types'],
  },
  {
    id: 'assert',
    vendorPath: 'assert.js',
    origin: 'node-source',
    deps: [
      'internal/assert',
      'internal/assert/utils',
      'internal/errors',
      'internal/util',
      'internal/util/comparisons',
      'internal/util/inspect',
      'internal/util/types',
      'internal/validators',
    ],
  },
  {
    id: 'internal/streams/state',
    vendorPath: 'internal/streams/state.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/validators'],
  },
  {
    id: 'internal/streams/from',
    vendorPath: 'internal/streams/from.js',
    origin: 'node-source',
    deps: ['buffer', 'internal/errors'],
  },
  {
    id: 'internal/streams/utils',
    vendorPath: 'internal/streams/utils.js',
    origin: 'node-source',
  },
  {
    id: 'internal/streams/destroy',
    vendorPath: 'internal/streams/destroy.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/streams/utils'],
  },
  {
    id: 'internal/streams/end-of-stream',
    vendorPath: 'internal/streams/end-of-stream.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/util',
      'internal/validators',
      'internal/streams/utils',
      'internal/async_hooks',
      'internal/async_context_frame',
      'internal/events/abort_listener',
    ],
  },
  {
    id: 'internal/streams/legacy',
    vendorPath: 'internal/streams/legacy.js',
    origin: 'node-source',
    deps: ['events'],
  },
  {
    id: 'internal/streams/add-abort-signal',
    vendorPath: 'internal/streams/add-abort-signal.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/streams/utils',
      'internal/streams/end-of-stream',
      'internal/events/abort_listener',
    ],
  },
  {
    id: 'internal/fixed_queue',
    vendorPath: 'internal/fixed_queue.js',
    origin: 'node-source',
  },
  {
    id: 'internal/streams/readable',
    vendorPath: 'internal/streams/readable.js',
    origin: 'node-source',
    deps: [
      'events',
      'buffer',
      'string_decoder',
      'internal/errors',
      'internal/validators',
      'internal/options',
      'internal/util/debuglog',
      'internal/streams/legacy',
      'internal/streams/state',
      'internal/streams/utils',
      'internal/streams/destroy',
      'internal/streams/end-of-stream',
      'internal/streams/add-abort-signal',
      'internal/streams/from',
      'internal/fixed_queue',
    ],
  },
  {
    id: 'internal/streams/writable',
    vendorPath: 'internal/streams/writable.js',
    origin: 'node-source',
    deps: [
      'events',
      'buffer',
      'internal/util',
      'internal/errors',
      'internal/streams/legacy',
      'internal/streams/destroy',
      'internal/streams/end-of-stream',
      'internal/streams/add-abort-signal',
      'internal/streams/state',
      'internal/streams/utils',
    ],
  },
  {
    id: 'internal/streams/duplex',
    vendorPath: 'internal/streams/duplex.js',
    origin: 'node-source',
    deps: [
      'internal/streams/legacy',
      'internal/streams/readable',
      'internal/streams/writable',
      'internal/streams/add-abort-signal',
      'internal/streams/destroy',
      'internal/streams/utils',
    ],
  },
  {
    id: 'internal/streams/transform',
    vendorPath: 'internal/streams/transform.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/streams/duplex', 'internal/streams/state'],
  },
  {
    id: 'internal/streams/passthrough',
    vendorPath: 'internal/streams/passthrough.js',
    origin: 'node-source',
    deps: ['internal/streams/transform'],
  },
  {
    id: 'internal/streams/pipeline',
    vendorPath: 'internal/streams/pipeline.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/validators',
      'internal/util',
      'internal/abort_controller',
      'internal/streams/end-of-stream',
      'internal/streams/destroy',
      'internal/streams/duplex',
      'internal/streams/utils',
      'internal/streams/readable',
      'internal/events/abort_listener',
      'internal/streams/passthrough',
    ],
  },
  {
    id: 'internal/streams/compose',
    vendorPath: 'internal/streams/compose.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/streams/pipeline',
      'internal/streams/duplex',
      'internal/streams/destroy',
      'internal/streams/utils',
      'internal/streams/end-of-stream',
    ],
  },
  {
    id: 'internal/streams/operators',
    vendorPath: 'internal/streams/operators.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/validators',
      'internal/event_target',
      'internal/abort_controller',
      'internal/streams/end-of-stream',
    ],
  },
  {
    id: 'internal/streams/duplexpair',
    vendorPath: 'internal/streams/duplexpair.js',
    origin: 'node-source',
    deps: ['internal/assert', 'stream'],
  },
  {
    id: 'internal/streams/duplexify',
    vendorPath: 'internal/streams/duplexify.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/blob',
      'internal/abort_controller',
      'internal/streams/utils',
      'internal/streams/end-of-stream',
      'internal/streams/destroy',
      'internal/streams/duplex',
      'internal/streams/readable',
      'internal/streams/writable',
      'internal/streams/from',
    ],
  },
  {
    id: 'stream',
    aliases: ['node:stream'],
    vendorPath: 'stream.js',
    origin: 'node-source',
    deps: [
      'internal/util',
      'internal/util/types',
      'internal/buffer',
      'internal/errors',
      'internal/streams/operators',
      'internal/streams/compose',
      'internal/streams/state',
      'internal/streams/pipeline',
      'internal/streams/destroy',
      'internal/streams/end-of-stream',
      'internal/streams/utils',
      'internal/streams/legacy',
      'internal/streams/readable',
      'internal/streams/writable',
      'internal/streams/duplex',
      'internal/streams/transform',
      'internal/streams/passthrough',
      'internal/streams/add-abort-signal',
      'stream/promises',
    ],
  },
  {
    id: 'stream/promises',
    aliases: ['node:stream/promises'],
    vendorPath: 'stream/promises.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/streams/utils', 'internal/streams/pipeline', 'internal/streams/end-of-stream'],
  },
  // -- WHATWG streams (milestone 36) ----------------------------------------
  // `internal/webstreams/util` sits at the bottom of the group. It reaches for
  // `internal/webstreams/transfer` only through a lazy accessor, so it has no
  // eager dep on anything in the group and can be built first.
  {
    id: 'internal/webstreams/util',
    vendorPath: 'internal/webstreams/util.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/assert', 'internal/util/types', 'internal/validators'],
  },
  {
    id: 'internal/webstreams/writablestream',
    vendorPath: 'internal/webstreams/writablestream.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/assert',
      'internal/util',
      'internal/validators',
      'internal/abort_controller',
      'internal/streams/utils',
      'internal/worker/io',
      'internal/worker/js_transferable',
      'internal/process/task_queues',
      'internal/webstreams/util',
    ],
  },
  {
    id: 'internal/webstreams/readablestream',
    vendorPath: 'internal/webstreams/readablestream.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/assert',
      'internal/util',
      'internal/util/types',
      'internal/validators',
      'internal/streams/utils',
      'internal/worker/io',
      'internal/worker/js_transferable',
      'internal/process/task_queues',
      'internal/webstreams/util',
      'internal/webstreams/writablestream',
    ],
  },
  {
    id: 'internal/webstreams/transfer',
    vendorPath: 'internal/webstreams/transfer.js',
    origin: 'node-source',
    deps: [
      'internal/assert',
      'internal/webstreams/util',
      'internal/webstreams/readablestream',
      'internal/webstreams/writablestream',
    ],
  },
  {
    id: 'internal/webstreams/transformstream',
    vendorPath: 'internal/webstreams/transformstream.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/assert',
      'internal/util',
      'internal/validators',
      'internal/worker/js_transferable',
      'internal/webstreams/util',
      'internal/webstreams/readablestream',
      'internal/webstreams/writablestream',
    ],
  },
  {
    id: 'internal/webstreams/queuingstrategies',
    vendorPath: 'internal/webstreams/queuingstrategies.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/util', 'internal/validators', 'internal/webstreams/util'],
  },
  {
    id: 'internal/webstreams/encoding',
    vendorPath: 'internal/webstreams/encoding.js',
    origin: 'node-source',
    deps: [
      'internal/encoding',
      'internal/errors',
      'internal/util',
      'internal/webstreams/util',
      'internal/webstreams/transformstream',
    ],
  },
  {
    id: 'internal/webstreams/adapters',
    vendorPath: 'internal/webstreams/adapters.js',
    origin: 'node-source',
    // The classic <-> web bridges. `stream` is a sibling vendored builtin that
    // only reaches back here lazily (Readable.toWeb), so there is no cycle.
    deps: [
      'buffer',
      'internal/encoding',
      'internal/errors',
      'internal/util',
      'internal/util/types',
      'internal/validators',
      'internal/streams/end-of-stream',
      'internal/streams/utils',
      'internal/webstreams/util',
      'internal/webstreams/readablestream',
      'internal/webstreams/writablestream',
      'internal/webstreams/queuingstrategies',
      'stream',
    ],
  },
  {
    id: 'internal/webstreams/compression',
    vendorPath: 'internal/webstreams/compression.js',
    origin: 'node-source',
    // Requires `zlib` lazily. Now that `zlib` is a real module, the whole
    // CompressionStream/DecompressionStream surface works; only the `brotli`
    // format throws (no browser codec).
    deps: [
      'internal/errors',
      'internal/util',
      'internal/util/types',
      'internal/webidl',
      'internal/webstreams/util',
      'internal/webstreams/adapters',
    ],
  },
  {
    id: 'stream/web',
    aliases: ['node:stream/web'],
    vendorPath: 'stream/web.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/validators',
      'internal/webstreams/readablestream',
      'internal/webstreams/writablestream',
      'internal/webstreams/transformstream',
      'internal/webstreams/queuingstrategies',
      'internal/webstreams/encoding',
      'internal/webstreams/compression',
    ],
  },
  {
    id: 'internal/blob',
    vendorPath: 'internal/blob.js',
    origin: 'node-source',
    // The real `Blob` (src/node_blob.cc reduced to a flat list of byte parts by
    // `bindings/blob.ts`). It sits on our `internal/encoding` shim (decoder +
    // encoder), `internal/url`, `internal/util`, `internal/webidl` converters
    // and `internal/worker/js_transferable`; the WHATWG streams and timers it
    // uses are touched lazily from inside the file.
    deps: [
      'internal/encoding',
      'internal/url',
      'internal/util',
      'internal/util/inspect',
      'internal/util/types',
      'internal/validators',
      'internal/webidl',
      'internal/errors',
      'internal/process/task_queues',
      'internal/worker/js_transferable',
    ],
  },
  {
    id: 'internal/file',
    vendorPath: 'internal/file.js',
    origin: 'node-source',
    // `File` is a thin subclass of `Blob`; it only needs the blob module plus
    // validation/inspection helpers. Exposed globally by `bootstrap/web`.
    deps: [
      'internal/blob',
      'internal/errors',
      'internal/util',
      'internal/util/inspect',
      'internal/worker/js_transferable',
    ],
  },
  // -- iterable streams (milestone 38) --------------------------------------
  // `stream/iter` (the new experimental iterable-streams API) is a fully
  // self-contained pure-JS group. The bottom of the stack is `webidl` (protocol
  // validation), then `types`/`ringbuffer` (no deps), then `utils`/`from`. The
  // order below mirrors the eager `require` graph so each module sees its deps
  // fully built.
  {
    id: 'internal/streams/iter/webidl',
    vendorPath: 'internal/streams/iter/webidl.js',
    origin: 'node-source',
    deps: ['internal/abort_controller', 'internal/util/types', 'internal/webidl'],
  },
  {
    id: 'internal/streams/iter/types',
    vendorPath: 'internal/streams/iter/types.js',
    origin: 'node-source',
    deps: [],
  },
  {
    id: 'internal/streams/iter/ringbuffer',
    vendorPath: 'internal/streams/iter/ringbuffer.js',
    origin: 'node-source',
    deps: [],
  },
  {
    id: 'internal/streams/iter/utils',
    vendorPath: 'internal/streams/iter/utils.js',
    origin: 'node-source',
    deps: [
      'internal/encoding',
      'internal/errors',
      'internal/streams/iter/webidl',
      'internal/util',
      'internal/util/types',
      'internal/validators',
    ],
  },
  {
    id: 'internal/streams/iter/from',
    vendorPath: 'internal/streams/iter/from.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/streams/iter/types', 'internal/streams/iter/utils', 'internal/util/types'],
  },
  {
    id: 'internal/streams/iter/consumers',
    vendorPath: 'internal/streams/iter/consumers.js',
    origin: 'node-source',
    deps: [
      'internal/encoding',
      'internal/errors',
      'internal/streams/iter/from',
      'internal/streams/iter/types',
      'internal/streams/iter/utils',
      'internal/streams/iter/webidl',
      'internal/util/types',
      'internal/validators',
    ],
  },
  {
    id: 'internal/streams/iter/pull',
    vendorPath: 'internal/streams/iter/pull.js',
    origin: 'node-source',
    deps: [
      'internal/abort_controller',
      'internal/errors',
      'internal/streams/iter/from',
      'internal/streams/iter/types',
      'internal/streams/iter/utils',
      'internal/streams/iter/webidl',
      'internal/util',
      'internal/util/types',
    ],
  },
  {
    id: 'internal/streams/iter/push',
    vendorPath: 'internal/streams/iter/push.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/streams/iter/pull',
      'internal/streams/iter/ringbuffer',
      'internal/streams/iter/types',
      'internal/streams/iter/utils',
      'internal/streams/iter/webidl',
      'internal/util',
      'internal/validators',
    ],
  },
  {
    id: 'internal/streams/iter/duplex',
    vendorPath: 'internal/streams/iter/duplex.js',
    origin: 'node-source',
    deps: ['internal/streams/iter/push', 'internal/streams/iter/webidl'],
  },
  {
    id: 'internal/streams/iter/broadcast',
    vendorPath: 'internal/streams/iter/broadcast.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/streams/iter/from',
      'internal/streams/iter/pull',
      'internal/streams/iter/ringbuffer',
      'internal/streams/iter/types',
      'internal/streams/iter/utils',
      'internal/streams/iter/webidl',
      'internal/util',
      'internal/validators',
    ],
  },
  {
    id: 'internal/streams/iter/share',
    vendorPath: 'internal/streams/iter/share.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/streams/iter/from',
      'internal/streams/iter/pull',
      'internal/streams/iter/ringbuffer',
      'internal/streams/iter/types',
      'internal/streams/iter/utils',
      'internal/streams/iter/webidl',
      'internal/validators',
    ],
  },
  {
    id: 'internal/streams/iter/classic',
    vendorPath: 'internal/streams/iter/classic.js',
    origin: 'node-source',
    deps: [
      'buffer',
      'internal/errors',
      'internal/process/task_queues',
      'internal/streams/add-abort-signal',
      'internal/streams/destroy',
      'internal/streams/end-of-stream',
      'internal/streams/iter/from',
      'internal/streams/iter/types',
      'internal/streams/iter/utils',
      'internal/streams/readable',
      'internal/streams/writable',
      'internal/util/types',
      'internal/validators',
    ],
  },
  {
    id: 'stream/consumers',
    aliases: ['node:stream/consumers'],
    vendorPath: 'stream/consumers.js',
    origin: 'node-source',
    deps: ['internal/encoding', 'internal/blob', 'buffer'],
  },
  {
    id: 'stream/iter',
    aliases: ['node:stream/iter'],
    vendorPath: 'stream/iter.js',
    origin: 'node-source',
    // Upstream gates this behind `--experimental-stream-iter`. There is no flag
    // surface in a tab, so it is always available; the module still emits the
    // same `ExperimentalWarning` on load.
    deps: [
      'internal/util',
      'internal/streams/iter/types',
      'internal/streams/iter/push',
      'internal/streams/iter/duplex',
      'internal/streams/iter/from',
      'internal/streams/iter/pull',
      'internal/streams/iter/consumers',
      'internal/streams/iter/classic',
      'internal/streams/iter/broadcast',
      'internal/streams/iter/share',
    ],
  },
  {
    id: 'internal/async_hooks',
    vendorPath: 'internal/async_hooks.js',
    origin: 'node-source',
    // No eager deps: Node requires `internal/util/inspect`, `internal/options`
    // and `internal/promise_hooks` lazily from inside this file.
    deps: [],
  },
  {
    id: 'internal/promise_hooks',
    vendorPath: 'internal/promise_hooks.js',
    origin: 'node-source',
    deps: ['internal/util', 'internal/validators'],
  },
  {
    id: 'internal/async_context_frame',
    vendorPath: 'internal/async_context_frame.js',
    origin: 'node-source',
  },
  {
    id: 'internal/async_local_storage/run_scope',
    vendorPath: 'internal/async_local_storage/run_scope.js',
    origin: 'node-source',
  },
  {
    id: 'internal/async_local_storage/async_hooks',
    vendorPath: 'internal/async_local_storage/async_hooks.js',
    origin: 'node-source',
    deps: [
      'internal/validators',
      'internal/async_hooks',
      'async_hooks',
      'internal/async_local_storage/run_scope',
      'internal/util',
    ],
  },
  {
    id: 'async_hooks',
    aliases: ['node:async_hooks'],
    vendorPath: 'async_hooks.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/util',
      'internal/validators',
      'internal/async_hooks',
      'internal/async_context_frame',
    ],
  },
  {
    id: 'events',
    aliases: ['node:events'],
    vendorPath: 'events.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/util',
      'internal/util/inspect',
      'internal/validators',
      'internal/events/abort_listener',
      'internal/fixed_queue',
      'internal/events/symbols',
      // `internal/event_target` is *not* an eager dep: Node's own events.js only
      // pulls it in lazily (inside `on`/`once`/`getMaxListeners`), and making it
      // eager here would deadlock the circular load (event_target eagerly
      // requires events, which would then be `loading` and hand back a partial,
      // empty `module.exports`).
    ],
  },
  {
    id: 'internal/deps/minimatch/index',
    vendorPath: 'internal/deps/minimatch/index.js',
    origin: 'node-source',
    // Node bundles `deps/minimatch` with esbuild into a single self-contained
    // CJS file (no external requires), so the whole matcher rides along.
    deps: [],
  },
  {
    id: 'internal/fs/glob',
    vendorPath: 'internal/fs/glob.js',
    origin: 'node-source',
    // The real glob walker + pattern matcher. It sits on our own `fs` /
    // `fs/promises` (lstat/stat/readdir/realpath) and `path`; `internal/fs/utils`
    // is a shim that only has to supply `DirentFromStats`.
    deps: [
      'fs',
      'fs/promises',
      'path',
      'internal/util',
      'internal/validators',
      'internal/fs/utils',
      'internal/errors',
      'internal/assert',
      'internal/url',
      'internal/deps/minimatch/index',
    ],
  },
  {
    id: 'path',
    aliases: ['node:path'],
    vendorPath: 'path.js',
    origin: 'node-source',
    // NOTE: `path.js` only touches `internal/fs/glob` lazily (inside
    // `matchesGlob`, via `getLazy`), so it is deliberately *not* a declared dep.
    // Declaring it would make `path` pull `glob` in while `path` itself is still
    // `loading`; glob destructures `isAbsolute` from `require('path')` at load
    // time, so it would capture a half-built `path` and `matchesGlob` would
    // silently lose `isAbsolute`. `glob` declares `path` as a dep instead, which
    // orders them correctly however the load starts.
    deps: ['internal/constants', 'internal/validators', 'internal/util'],
  },
  {
    id: 'querystring',
    aliases: ['node:querystring'],
    vendorPath: 'querystring.js',
    origin: 'node-source',
    deps: ['buffer', 'internal/querystring'],
  },
  {
    id: 'punycode',
    aliases: ['node:punycode'],
    vendorPath: 'punycode.js',
    origin: 'node-source',
    deps: [],
  },
  {
    id: 'domain',
    aliases: ['node:domain'],
    vendorPath: 'domain.js',
    origin: 'node-source',
    deps: [
      'events',
      'async_hooks',
      'internal/errors',
      'internal/util',
      'internal/async_hooks',
    ],
  },
  {
    id: 'diagnostics_channel',
    aliases: ['node:diagnostics_channel'],
    vendorPath: 'diagnostics_channel.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/validators',
      'internal/util',
      'internal/util/types',
      'async_hooks',
    ],
  },
  {
    id: 'string_decoder',
    aliases: ['node:string_decoder'],
    vendorPath: 'string_decoder.js',
    origin: 'node-source',
    deps: ['buffer', 'internal/util', 'internal/errors'],
  },
  {
    id: 'internal/util',
    vendorPath: 'internal/util.js',
    origin: 'node-source',
    // `internal/validators` / `path` / `internal/url` / `vm` / the process
    // helpers are only pulled in lazily from inside the functions that need
    // them, so they are deliberately not eager deps (validators depends on this
    // module in turn).
    deps: ['internal/errors', 'internal/options', 'internal/assert'],
  },
  {
    id: 'internal/util/diff',
    vendorPath: 'internal/util/diff.js',
    origin: 'node-source',
    deps: ['internal/validators', 'internal/assert/myers_diff'],
  },
  {
    id: 'internal/util/parse_args/utils',
    vendorPath: 'internal/util/parse_args/utils.js',
    origin: 'node-source',
    deps: ['internal/validators'],
  },
  {
    id: 'internal/util/parse_args/parse_args',
    vendorPath: 'internal/util/parse_args/parse_args.js',
    origin: 'node-source',
    deps: [
      'internal/validators',
      'internal/util/parse_args/utils',
      'internal/errors',
      'internal/util',
      'internal/options',
    ],
  },
  {
    id: 'internal/mime',
    vendorPath: 'internal/mime.js',
    origin: 'node-source',
    deps: ['internal/errors'],
  },
  {
    id: 'util',
    aliases: ['node:util'],
    vendorPath: 'util.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'buffer',
      'internal/util/inspect',
      'internal/util/debuglog',
      'internal/validators',
      'internal/streams/utils',
      'internal/util/types',
      'internal/options',
      'internal/util',
    ],
  },
  {
    id: 'os',
    aliases: ['node:os'],
    vendorPath: 'os.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/util', 'internal/validators'],
  },
  {
    id: 'internal/linkedlist',
    vendorPath: 'internal/linkedlist.js',
    origin: 'node-source',
  },
  {
    id: 'internal/priority_queue',
    vendorPath: 'internal/priority_queue.js',
    origin: 'node-source',
  },
  {
    id: 'internal/timers',
    vendorPath: 'internal/timers.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/validators',
      'internal/util',
      'internal/util/inspect',
      'internal/util/debuglog',
      'internal/async_hooks',
      'internal/async_context_frame',
      'internal/linkedlist',
      'internal/priority_queue',
    ],
  },
  {
    id: 'timers',
    aliases: ['node:timers'],
    vendorPath: 'timers.js',
    origin: 'node-source',
    deps: [
      'internal/linkedlist',
      'internal/timers',
      'internal/util',
      'internal/util/debuglog',
      'internal/validators',
      'internal/async_hooks',
    ],
  },
  {
    id: 'timers/promises',
    aliases: ['node:timers/promises'],
    vendorPath: 'timers/promises.js',
    origin: 'node-source',
    deps: ['internal/timers', 'timers', 'internal/errors', 'internal/validators', 'internal/util'],
  },
  {
    id: 'console',
    aliases: ['node:console'],
    vendorPath: 'console.js',
    origin: 'node-source',
    deps: ['internal/console/global'],
  },
  {
    id: 'internal/per_context/messageport',
    vendorPath: 'internal/per_context/messageport.js',
    origin: 'node-source',
  },
  {
    id: 'internal/repl/history',
    vendorPath: 'internal/repl/history.js',
    origin: 'node-source',
    // Writes the REPL history file through the real `fs`, and asks the
    // (permanently disabled) permission model whether that is allowed.
    deps: ['internal/validators', 'fs', 'os', 'internal/util/debuglog', 'internal/process/permission', 'timers', 'internal/readline/utils'],
  },
  {
    id: 'readline',
    aliases: ['node:readline'],
    vendorPath: 'readline.js',
    origin: 'node-source',
    deps: [
      'events',
      'string_decoder',
      'internal/errors',
      'internal/util',
      'internal/util/inspect',
      'internal/validators',
      'internal/readline/callbacks',
      'internal/readline/emitKeypressEvents',
      'internal/readline/interface',
      'readline/promises',
    ],
  },
  {
    id: 'readline/promises',
    aliases: ['node:readline/promises'],
    vendorPath: 'readline/promises.js',
    origin: 'node-source',
    deps: [
      'internal/errors',
      'internal/util',
      'internal/validators',
      'internal/readline/interface',
      'internal/readline/promises',
    ],
  },
  {
    id: 'internal/readline/emitKeypressEvents',
    vendorPath: 'internal/readline/emitKeypressEvents.js',
    origin: 'node-source',
    deps: ['string_decoder', 'timers', 'internal/readline/interface'],
  },
  {
    id: 'internal/readline/interface',
    vendorPath: 'internal/readline/interface.js',
    origin: 'node-source',
    deps: [
      'events',
      'string_decoder',
      'internal/errors',
      'internal/events/abort_listener',
      'internal/events/symbols',
      'internal/readline/callbacks',
      'internal/readline/emitKeypressEvents',
      'internal/readline/utils',
      'internal/repl/history',
      'internal/util',
      'internal/util/inspect',
      'internal/validators',
    ],
  },
  {
    id: 'internal/readline/promises',
    vendorPath: 'internal/readline/promises.js',
    origin: 'node-source',
    deps: ['internal/errors', 'internal/validators', 'internal/readline/utils', 'internal/streams/utils'],
  },
  {
    id: 'internal/worker/js_transferable',
    vendorPath: 'internal/worker/js_transferable.js',
    origin: 'node-source',
    // `setup()` is only invoked from the worker bootstrap; the messaging binding
    // supplies `setDeserializerCreateObjectFunction`/`structuredClone` regardless.
    deps: ['internal/errors', 'internal/webidl'],
  },
  {
    id: 'internal/worker/io',
    vendorPath: 'internal/worker/io.js',
    origin: 'node-source',
    // Top-level requires `stream`, `internal/event_target` (which pulls `events`),
    // `internal/util`, `internal/util/inspect` and `internal/errors`. The undici
    // `createFastMessageEvent` and `internal/worker/messaging` are lazy.
    deps: [
      'stream',
      'internal/event_target',
      'internal/util',
      'internal/util/inspect',
      'internal/errors',
      'internal/worker/js_transferable',
    ],
  },
  {
    id: 'internal/v8/startup_snapshot',
    vendorPath: 'internal/v8/startup_snapshot.js',
    origin: 'node-source',
    // Reads the inert `mksnapshot` binding at load time; the real work is behind
    // `isBuildingSnapshot()`, which is always false here.
    deps: ['internal/validators', 'internal/errors'],
  },
  {
    id: 'util/types',
    vendorPath: 'util/types.js',
    origin: 'node-source',
    deps: ['internal/util/types'],
  },
  {
    id: 'internal/buffer',
    vendorPath: 'internal/buffer.js',
    origin: 'node-source',
    // Destructures `internal/errors`/`internal/validators`/`util/types` at load
    // time, then the whole `buffer` binding.
    deps: ['internal/errors', 'internal/validators', 'util/types'],
  },
  {
    id: 'buffer',
    vendorPath: 'buffer.js',
    origin: 'node-source',
    // `Buffer` is `FastBuffer` from `internal/buffer`; `constants` comes from the
    // `buffer` binding; `Blob`/`File` are lazy (`internal/blob`/`internal/file`).
    deps: [
      'internal/util',
      'internal/util/types',
      'internal/util/inspect',
      'internal/assert',
      'internal/errors',
      'internal/validators',
      'internal/buffer',
      'internal/v8/startup_snapshot',
    ],
  },
];
