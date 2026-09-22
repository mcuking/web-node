import type { BindingFactory } from './context';
import { notImplemented } from '../errors';

/**
 * The `v8`, `heap_utils` and `profiler` bindings.
 *
 * `lib/v8.js` reaches for four native bindings. What a tab can genuinely answer
 * is the serialization half (`serdes`) and a few string/flag questions; the
 * rest is V8 heap introspection that only the embedder can see. Those throw a
 * typed `NotImplementedError` rather than inventing numbers.
 */

const UNSUPPORTED = (subject: string) => () => {
  throw notImplemented('api', subject);
};

/**
 * `ScriptCompiler::CachedDataVersionTag()` — `hash_combine(Version::Hash(),
 * FlagList::Hash())`. Only the contract matters to callers (the tag changes
 * when the engine or its flags change), so derive a stable tag from the
 * engine's own version string.
 */
function cachedDataVersionTag(): number {
  const version = (() => {
    try {
      const process = (globalThis as { process?: { versions?: Record<string, string> } }).process;
      return process?.versions?.v8 ?? 'unknown';
    } catch {
      return 'unknown';
    }
  })();
  let hash = 0x811c9dc5;
  for (let i = 0; i < version.length; i++) {
    hash ^= version.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The heap space names this engine reports, as `node_v8.cc` reads them once. */
const HEAP_SPACES = [
  'read_only_space',
  'new_space',
  'old_space',
  'code_space',
  'shared_space',
  'trusted_space',
  'shared_trusted_space',
  'new_large_object_space',
  'large_object_space',
  'code_large_object_space',
  'shared_large_object_space',
  'shared_trusted_large_object_space',
  'trusted_large_object_space',
];

export const v8Binding: BindingFactory = () => ({
  cachedDataVersionTag,
  // A tab has no `--v8-flags` surface to rewrite.
  setFlagsFromString: (): void => {},

  // Index constants `lib/v8.js` uses to read the statistics buffers. They are
  // the real ones; the buffers below simply never get filled.
  kTotalHeapSizeIndex: 0,
  kTotalHeapSizeExecutableIndex: 1,
  kTotalPhysicalSizeIndex: 2,
  kTotalAvailableSize: 3,
  kUsedHeapSizeIndex: 4,
  kHeapSizeLimitIndex: 5,
  kMallocedMemoryIndex: 6,
  kPeakMallocedMemoryIndex: 7,
  kDoesZapGarbageIndex: 8,
  kNumberOfNativeContextsIndex: 9,
  kNumberOfDetachedContextsIndex: 10,
  kTotalGlobalHandlesSizeIndex: 11,
  kUsedGlobalHandlesSizeIndex: 12,
  kExternalMemoryIndex: 13,
  kTotalAllocatedBytes: 14,

  kSpaceSizeIndex: 0,
  kSpaceUsedSizeIndex: 1,
  kSpaceAvailableSizeIndex: 2,
  kPhysicalSpaceSizeIndex: 3,

  kCodeAndMetadataSizeIndex: 0,
  kBytecodeAndMetadataSizeIndex: 1,
  kExternalScriptSourceSizeIndex: 2,
  kCPUProfilerMetaDataSizeIndex: 3,

  // `HeapProfiler::SamplingFlags` (`deps/v8/include/v8-profiler.h`): the bits
  // `internal/v8/heap_profile.js` ORs together when it starts a sampling heap
  // profile. The profiler itself is unreachable here, but the module builds the
  // flag mask on its (reachable) construction path, so the constants must be
  // real numbers rather than `undefined`.
  kSamplingNoFlags: 0,
  kSamplingForceGC: 1,
  kSamplingIncludeObjectsCollectedByMajorGC: 2,
  kSamplingIncludeObjectsCollectedByMinorGC: 4,

  kHeapSpaces: HEAP_SPACES,

  // `AliasedFloat64Array`s in Node; the shape is what `lib/v8.js` indexes.
  heapStatisticsBuffer: new Float64Array(15),
  heapCodeStatisticsBuffer: new Float64Array(4),
  heapSpaceStatisticsBuffer: new Float64Array(HEAP_SPACES.length * 4),

  // V8's heap internals are not reachable from a page, so filling these would
  // mean fabricating numbers. The updater throws instead, which makes
  // `v8.getHeapStatistics()` (and the space/code variants) fail loudly.
  updateHeapStatisticsBuffer: UNSUPPORTED('v8.getHeapStatistics'),
  updateHeapSpaceStatisticsBuffer: UNSUPPORTED('v8.getHeapSpaceStatistics'),
  updateHeapCodeStatisticsBuffer: UNSUPPORTED('v8.getHeapCodeStatistics'),
  getCppHeapStatistics: UNSUPPORTED('v8.getCppHeapStatistics'),
  detailLevel: { DETAILED: 1, BRIEF: 0 },

  setHeapSnapshotNearHeapLimit: UNSUPPORTED('v8.setHeapSnapshotNearHeapLimit'),
  setHeapProfileNearHeapLimit: UNSUPPORTED('v8.setHeapProfileNearHeapLimit'),

  // Profiling needs the inspector; there is none here.
  startCpuProfile: UNSUPPORTED('v8.startCpuProfile'),
  stopCpuProfile: UNSUPPORTED('v8.stopCpuProfile'),
  startHeapProfile: UNSUPPORTED('v8.startHeapProfile'),
  stopHeapProfile: UNSUPPORTED('v8.stopHeapProfile'),

  /** Real: is the string stored as one byte per code unit (Latin-1)? */
  isStringOneByteRepresentation: (content: unknown): boolean => {
    const text = `${content}`;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) > 0xff) return false;
    }
    return true;
  },

  GCProfiler: class GCProfiler {
    start(): void {
      throw notImplemented('api', 'v8.GCProfiler.start');
    }
    stop(): never {
      throw notImplemented('api', 'v8.GCProfiler.stop');
    }
    // `Symbol.dispose` is spelled out because the TS lib target predates it.
    [Symbol.for('nodejs.dispose')](): void {}
  },
});

/** `internalBinding('heap_utils')`: heap snapshots need V8's heap walker. */
export const heapUtilsBinding: BindingFactory = () => ({
  createHeapSnapshotStream: UNSUPPORTED('v8.getHeapSnapshot'),
  triggerHeapSnapshot: UNSUPPORTED('v8.writeHeapSnapshot'),
});

/** `internalBinding('profiler')`: only read when `config.hasInspector`. */
export const profilerBinding: BindingFactory = () => ({
  // `internal/util.js` only calls the first two when `process.features.inspector`
  // is on (it is not here), but the shape should still be honest.
  setCoverageDirectory: UNSUPPORTED('profiler.setCoverageDirectory'),
  setSourceMapCacheGetter: UNSUPPORTED('profiler.setSourceMapCacheGetter'),
  takeCoverage: UNSUPPORTED('v8.takeCoverage'),
  stopCoverage: UNSUPPORTED('v8.stopCoverage'),
  endCoverage: UNSUPPORTED('v8.endCoverage'),
});
