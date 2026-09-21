// Vendors a curated subset of the real Node.js source tree into vendor/node-lib/.
//
// Only files that are genuinely reusable as-is (no `internalBinding`, or only bindings
// we already provide) are vendored. Everything else lives in src/node-runtime/builtins
// as our own implementation. A manifest records upstream revision + content hash so we
// can prove provenance and detect drift on upgrade.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const NODE_SRC = process.env.NODE_SRC || '/Users/tangjianghong/Downloads/node';
const OUT = path.resolve('vendor/node-lib');

// Curated allow-list. Every entry must be dependency-free, or depend only on
// shims we already provide (see src/node-runtime/builtins/internal/*).
const FILES = [
  'internal/per_context/primordials.js',
  'internal/per_context/domexception.js',
  'internal/per_context/messageport.js',
  'internal/constants.js',
  'internal/encoding/util.js',
  'internal/querystring.js',
  'internal/webidl.js',
  'internal/perf/utils.js',
  'internal/perf/performance_entry.js',
  'internal/perf/observe.js',
  'internal/perf/usertiming.js',
  'internal/perf/nodetiming.js',
  'internal/perf/resource_timing.js',
  'internal/perf/timerify.js',
  'internal/perf/event_loop_utilization.js',
  'internal/perf/event_loop_delay.js',
  'internal/perf/performance.js',
  'perf_hooks.js',
  'internal/event_target.js',
  'internal/abort_controller.js',
  'internal/trace_events.js',
  'internal/util/debuglog.js',
  'internal/cli_table.js',
  'internal/readline/utils.js',
  'internal/readline/callbacks.js',
  'internal/readline/emitKeypressEvents.js',
  'internal/readline/interface.js',
  'internal/readline/promises.js',
  'internal/repl/history.js',
  'readline.js',
  'readline/promises.js',
  'internal/console/constructor.js',
  'internal/console/global.js',
  'console.js',
  'internal/util/types.js',
  'internal/util/inspect.js',
  'internal/util/colors.js',
  'internal/tty.js',
  'internal/util/comparisons.js',
  'internal/util.js',
  'internal/util/diff.js',
  'internal/util/parse_args/parse_args.js',
  'internal/util/parse_args/utils.js',
  'internal/mime.js',
  'internal/validators.js',
  'internal/assert.js',
  'internal/assert/assertion_error.js',
  'internal/assert/myers_diff.js',
  'internal/assert/utils.js',
  'internal/streams/state.js',
  'internal/streams/from.js',
  'internal/streams/utils.js',
  'internal/streams/destroy.js',
  'internal/streams/end-of-stream.js',
  'internal/streams/legacy.js',
  'internal/streams/add-abort-signal.js',
  'internal/streams/readable.js',
  'internal/streams/writable.js',
  'internal/streams/duplex.js',
  'internal/streams/transform.js',
  'internal/streams/passthrough.js',
  'internal/streams/pipeline.js',
  'internal/streams/compose.js',
  'internal/streams/operators.js',
  'internal/streams/duplexpair.js',
  'internal/streams/duplexify.js',
  'stream.js',
  'stream/promises.js',
  'internal/fixed_queue.js',
  'internal/linkedlist.js',
  'internal/priority_queue.js',
  'internal/timers.js',
  'timers.js',
  'timers/promises.js',
  'internal/async_hooks.js',
  'internal/promise_hooks.js',
  'internal/async_context_frame.js',
  'internal/async_local_storage/async_hooks.js',
  'internal/async_local_storage/run_scope.js',
  'async_hooks.js',
  'events.js',
  'path.js',
  'querystring.js',
  'punycode.js',
  'domain.js',
  'diagnostics_channel.js',
  'string_decoder.js',
  'assert.js',
  'util.js',
  'os.js',
  'internal/worker/js_transferable.js',
  'internal/worker/io.js',
  // milestone 48: the real Buffer implementation + its unsafe-allocation helpers
  'util/types.js',
  'internal/buffer.js',
  'buffer.js',
  'internal/v8/startup_snapshot.js',
  'internal/fs/glob.js',
  'internal/deps/minimatch/index.js',
  'internal/webstreams/util.js',
  'internal/webstreams/transfer.js',
  'internal/webstreams/readablestream.js',
  'internal/webstreams/writablestream.js',
  'internal/webstreams/transformstream.js',
  'internal/webstreams/queuingstrategies.js',
  'internal/webstreams/encoding.js',
  'internal/webstreams/adapters.js',
  'internal/webstreams/compression.js',
  'stream/web.js',
  'internal/blob.js',
  'internal/file.js',
  // milestone 38: the iterable streams API (`stream/iter`) + `stream/consumers`
  'stream/consumers.js',
  'stream/iter.js',
  'internal/streams/iter/types.js',
  'internal/streams/iter/utils.js',
  'internal/streams/iter/webidl.js',
  'internal/streams/iter/ringbuffer.js',
  'internal/streams/iter/from.js',
  'internal/streams/iter/consumers.js',
  'internal/streams/iter/pull.js',
  'internal/streams/iter/push.js',
  'internal/streams/iter/duplex.js',
  'internal/streams/iter/broadcast.js',
  'internal/streams/iter/share.js',
  'internal/streams/iter/classic.js',
  // milestone 49: the real VFS subsystem (MemoryProvider-backed) + the fs base
  'internal/fs/utils.js',
  'internal/vfs/errors.js',
  'internal/vfs/router.js',
  'internal/vfs/fd.js',
  'internal/vfs/stats.js',
  'internal/vfs/provider.js',
  'internal/vfs/dir.js',
  'internal/vfs/file_handle.js',
  'internal/vfs/streams.js',
  'internal/vfs/watcher.js',
  'internal/vfs/file_system.js',
  'internal/vfs/providers/memory.js',
  // milestone 50: real fs/promises on top of the VFS
  'fs/promises.js',
  'internal/fs/dir.js',
  'internal/fs/watchers.js',
  'internal/fs/recursive_watch.js',
  'internal/fs/cp/cp.js',
  'internal/fs/cp/cp-sync.js',
  'internal/fs/read/context.js',
  'internal/streams/fast-utf8-stream.js',
  'internal/fs/streams.js',
  'fs.js',
  'internal/fs/promises.js',
  'internal/vfs/setup.js',
  // milestone 53: the real `url` module (legacy parse/format/resolve built on
  // the WHATWG API that `internal/url` bridges to the host's own classes)
  'url.js',
  // milestone 54: the real `v8` module. The serialization half runs on the
  // `serdes` binding (the V8 wire format reimplemented in JS); the heap and
  // profiler halves are native-only and throw from the binding.
  // (`internal/v8/startup_snapshot.js` is already vendored above, for the
  // console bootstrap.)
  'v8.js',
  'internal/v8/heap_profile.js',
  'internal/v8/cpu_profiler.js',
  // milestone 55: the real `tty`. Its streams need a native TTY handle (none in
  // a tab) so they throw; `isatty` and `WriteStream.prototype.getColorDepth`
  // are real. `internal/tty.js` (above) is the pure-JS colour-depth logic.
  'tty.js',
  // milestone 56: the real `vm`. `contextify` is a JS stand-in for V8 contexts:
  // a context is the sandbox tagged with the contextify symbol, and a script
  // runs inside `with (context)`. `internal/vm.js` holds `isContext` and the
  // `importModuleDynamically` plumbing.
  'vm.js',
  'internal/vm.js',
];

/**
 * A few builtins are generated at build time from a tree outside `lib/`. Node
 * bundles `deps/minimatch` with esbuild into `deps/minimatch/index.js` and maps
 * that file to the builtin id `internal/deps/minimatch/index`; the source
 * checkout has no `lib/internal/deps/minimatch/`. Map those ids to their real
 * on-disk location here.
 */
const SOURCE_OVERRIDES = {
  'internal/deps/minimatch/index.js': 'deps/minimatch/index.js',
};
/**
 * Documented, minimal patches applied to vendored source.
 * Every patch is recorded in the manifest so provenance stays auditable.
 */
const PATCHES = {
  'internal/per_context/primordials.js': [
    {
      note: 'Skip intrinsics missing on this engine (Float16Array / Iterator) instead of throwing.',
      find: '  copyPropsRenamed(globalThis[name], primordials, name);',
      replace:
        '  // [web-node patch] skip intrinsics absent from the host engine\n' +
        '  if (globalThis[name] === undefined) return;\n' +
        '  copyPropsRenamed(globalThis[name], primordials, name);',
    },
    {
      note: 'Guard intrinsic-object copies against missing globals.',
      find:
        '  const original = globalThis[name];\n' +
        '  primordials[name] = original;\n' +
        '  copyPropsRenamed(original, primordials, name);\n' +
        '  copyPrototype(original.prototype, primordials, `${name}Prototype`);',
      replace:
        '  // [web-node patch] skip intrinsics absent from the host engine\n' +
        '  const original = globalThis[name];\n' +
        '  if (original === undefined) return;\n' +
        '  primordials[name] = original;\n' +
        '  copyPropsRenamed(original, primordials, name);\n' +
        '  copyPrototype(original.prototype, primordials, `${name}Prototype`);',
    },
    {
      note: 'Guard bound-intrinsic copies against missing globals.',
      find:
        '  const original = globalThis[name];\n' +
        '  primordials[name] = original;\n' +
        '  copyPropsRenamedBound(original, primordials, name);\n' +
        '  copyPrototype(original.prototype, primordials, `${name}Prototype`);',
      replace:
        '  // [web-node patch] skip intrinsics absent from the host engine\n' +
        '  const original = globalThis[name];\n' +
        '  if (original === undefined) return;\n' +
        '  primordials[name] = original;\n' +
        '  copyPropsRenamedBound(original, primordials, name);\n' +
        '  copyPrototype(original.prototype, primordials, `${name}Prototype`);',
    },
  ],
};

function upstreamRev() {
  try {
    return execFileSync('git', ['-C', NODE_SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const manifest = {
  generatedAt: new Date().toISOString(),
  nodeSource: NODE_SRC,
  nodeRevision: upstreamRev(),
  files: [],
};

for (const rel of FILES) {
  const src = path.join(NODE_SRC, SOURCE_OVERRIDES[rel] ?? path.join('lib', rel));
  if (!fs.existsSync(src)) {
    console.error(`skip (missing): ${rel}`);
    continue;
  }
  const originalBuf = fs.readFileSync(src);
  let text = originalBuf.toString('utf8');
  const appliedPatches = [];
  for (const patch of PATCHES[rel] ?? []) {
    if (!text.includes(patch.find)) {
      console.error(`  !! patch did not apply (pattern missing): ${patch.note}`);
      process.exitCode = 1;
      continue;
    }
    text = text.replace(patch.find, patch.replace);
    appliedPatches.push(patch.note);
  }
  const buf = Buffer.from(text, 'utf8');
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, buf);
  manifest.files.push({
    path: rel,
    sha256: sha256(buf),
    upstreamSha256: sha256(originalBuf),
    bytes: buf.length,
    patches: appliedPatches,
  });
  console.log(`vendored ${rel} (${buf.length} bytes, ${appliedPatches.length} patch(es))`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nmanifest written: ${manifest.files.length} files @ ${manifest.nodeRevision}`);
