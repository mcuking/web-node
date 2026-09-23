import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `perf_hooks` used to be a hand-written stub: it re-exported the *host*
 * `performance` global and left `PerformanceMark` / `PerformanceMeasure` /
 * `PerformanceEntry` undefined, so `new PerformanceMark(...)` threw a
 * `TypeError` and `PerformanceObserver` was the browser's class rather than
 * Node's.
 *
 * It is now the real `lib/perf_hooks.js` plus the whole `internal/perf/*` group,
 * running on a JS `performance` binding (the browser's clock stands in for
 * `uv_hrtime`, and there is no V8 GC hook to observe). The histogram-backed
 * trio — `createHistogram`, `monitorEventLoopDelay`, `timerify`'s histogram
 * option — rides on the **real `deps/histogram`** compiled to WebAssembly
 * (milestone 117); see `test/histogram.test.ts` for the byte-level gate.
 *
 * Expected values were read off Node v26.9.0 (probe `/tmp/perf-oracle.mjs`).
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require.bind(runtime.realm) as (id: string) => any;
}

describe('perf_hooks: exports and constants', () => {
  it('exports the real Performance classes and a working performance singleton', () => {
    const perf = boot()('perf_hooks');
    for (const name of [
      'Performance',
      'PerformanceEntry',
      'PerformanceMark',
      'PerformanceMeasure',
      'PerformanceObserver',
      'PerformanceObserverEntryList',
      'PerformanceResourceTiming',
      'monitorEventLoopDelay',
      'eventLoopUtilization',
      'timerify',
      'createHistogram',
      'importHistogram',
    ]) {
      expect(typeof perf[name], name).toBe('function');
    }
    expect(typeof perf.performance.now()).toBe('number');
    expect(typeof perf.performance.timeOrigin).toBe('number');
    expect(perf.performance).toBeInstanceOf(perf.Performance);
  });

  it('matches the constant values Node exposes', () => {
    const { constants } = boot()('perf_hooks');
    // Read off Node v26.9.0.
    expect(constants.NODE_PERFORMANCE_GC_MAJOR).toBe(4);
    expect(constants.NODE_PERFORMANCE_GC_MINOR).toBe(1);
    expect(constants.NODE_PERFORMANCE_GC_MINOR_MARK_SWEEP).toBe(2);
    expect(constants.NODE_PERFORMANCE_GC_INCREMENTAL).toBe(8);
    expect(constants.NODE_PERFORMANCE_GC_WEAKCB).toBe(16);
    expect(constants.NODE_PERFORMANCE_GC_FLAGS_NO).toBe(0);
    expect(constants.NODE_PERFORMANCE_GC_FLAGS_CONSTRUCT_RETAINED).toBe(2);
    expect(constants.NODE_PERFORMANCE_GC_FLAGS_FORCED).toBe(4);
    expect(constants.NODE_PERFORMANCE_GC_FLAGS_SYNCHRONOUS_PHANTOM_PROCESSING).toBe(8);
    expect(constants.NODE_PERFORMANCE_GC_FLAGS_ALL_AVAILABLE_GARBAGE).toBe(16);
    expect(constants.NODE_PERFORMANCE_GC_FLAGS_ALL_EXTERNAL_MEMORY).toBe(32);
    expect(constants.NODE_PERFORMANCE_GC_FLAGS_SCHEDULE_IDLE).toBe(64);
    expect(constants.NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN).toBe(1);
    expect(constants.NODE_PERFORMANCE_MILESTONE_INVALID).toBe(8);
  });
});

describe('perf_hooks: user timing', () => {
  it('records marks and measures as real PerformanceEntry instances', () => {
    const perf = boot()('perf_hooks');
    const { performance, PerformanceMark, PerformanceEntry } = perf;

    performance.mark('a');
    performance.mark('b');
    const measure = performance.measure('m', 'a', 'b');

    expect(measure.name).toBe('m');
    expect(measure.entryType).toBe('measure');
    expect(measure.startTime).toBeGreaterThanOrEqual(0);
    expect(measure.duration).toBeGreaterThanOrEqual(0);

    const mark = performance.getEntriesByName('a')[0];
    expect(mark.entryType).toBe('mark');
    expect(mark).toBeInstanceOf(PerformanceMark);
    expect(mark).toBeInstanceOf(PerformanceEntry);
    expect(measure).toBeInstanceOf(PerformanceEntry);

    expect(performance.getEntriesByType('mark').length).toBe(2);
    expect(performance.getEntriesByType('measure').length).toBe(1);

    performance.clearMarks();
    performance.clearMeasures();
    expect(performance.getEntriesByType('mark').length).toBe(0);
  });

  it('constructs PerformanceMark directly but keeps PerformanceMeasure internal', () => {
    const perf = boot()('perf_hooks');
    const mark = new perf.PerformanceMark('direct', { startTime: 42 });
    expect(mark.name).toBe('direct');
    expect(mark.startTime).toBe(42);
    // Node only constructs a PerformanceMeasure from its own `measure()` path;
    // calling the constructor directly is an illegal-constructor error.
    expect(() => new perf.PerformanceMeasure('span', { duration: 5 })).toThrowError(/Illegal constructor/);
  });

  it('supports measure() with options and detail', () => {
    const perf = boot()('perf_hooks');
    const { performance } = perf;
    performance.mark('x');
    const m = performance.measure('opts', { start: 'x', detail: { tag: 1 } });
    expect(m.name).toBe('opts');
    expect(m.detail).toEqual({ tag: 1 });
  });

  it('toJSON() produces the entry shape Node does', () => {
    const perf = boot()('perf_hooks');
    perf.performance.mark('j');
    const json = perf.performance.getEntriesByName('j')[0].toJSON();
    expect(Object.keys(json).sort()).toEqual(
      ['detail', 'duration', 'entryType', 'name', 'startTime'].sort(),
    );
    expect(json.name).toBe('j');
    expect(json.entryType).toBe('mark');
  });
});

describe('perf_hooks: PerformanceObserver', () => {
  it('delivers buffered marks to an observer', async () => {
    const perf = boot()('perf_hooks');
    const seen: string[] = [];
    const observer = new perf.PerformanceObserver((list: { getEntries(): Array<{ name: string }> }) => {
      for (const entry of list.getEntries()) seen.push(entry.name);
    });
    observer.observe({ entryTypes: ['mark'] });
    perf.performance.mark('observed');
    await new Promise((resolve) => setTimeout(resolve, 20));
    observer.disconnect();
    expect(seen).toContain('observed');
  });
});

describe('perf_hooks: nodeTiming', () => {
  it('reports the node timing entry with origin-relative milestones', () => {
    const perf = boot()('perf_hooks');
    const nodeTiming = perf.performance.nodeTiming;
    expect(nodeTiming.name).toBe('node');
    expect(nodeTiming.entryType).toBe('node');
    expect(nodeTiming.startTime).toBe(0);
    // The runtime *is* the origin, so nodeStart/v8Start/environment land at 0;
    // the loop has not started, so loopStart stays -1 exactly like Node.
    expect(nodeTiming.nodeStart).toBe(0);
    expect(nodeTiming.v8Start).toBe(0);
    expect(nodeTiming.environment).toBe(0);
    expect(nodeTiming.loopStart).toBe(-1);
    expect(nodeTiming.loopExit).toBe(-1);
    expect(nodeTiming.bootstrapComplete).toBe(0);
    expect(nodeTiming.uvMetricsInfo).toEqual({ loopCount: 0, events: 0, eventsWaiting: 0 });
    expect(nodeTiming.idleTime).toBe(0);
  });
});

describe('perf_hooks: eventLoopUtilization and histograms', () => {
  it('eventLoopUtilization() reports zeros, like Node before the loop starts', () => {
    const perf = boot()('perf_hooks');
    expect(perf.eventLoopUtilization()).toEqual({ idle: 0, active: 0, utilization: 0 });
  });

  it('backs the histogram API with the real deps/histogram', () => {
    const perf = boot()('perf_hooks');
    const h = perf.createHistogram();
    h.record(5);
    h.record(10);
    h.record(15);
    expect(h.count).toBe(3);
    expect(h.min).toBe(5);
    expect(h.max).toBe(15);
    expect(h.percentile(50)).toBe(10);
    // export/import round-trips through CBOR without losing anything.
    const back = perf.importHistogram(h.export());
    expect(back.count).toBe(3);
    expect(back.max).toBe(15);
  });

  it('monitorEventLoopDelay() returns a working, disable-able histogram', () => {
    const perf = boot()('perf_hooks');
    const eld = perf.monitorEventLoopDelay({ resolution: 20 });
    expect(eld.enable()).toBe(true);
    expect(eld.disable()).toBe(true);
  });

  it('timerify() works without a histogram and accepts a real one', () => {
    const perf = boot()('perf_hooks');
    // Without `options.histogram` timerify never touches the histogram binding.
    const timed = perf.timerify((a: number, b: number) => a + b);
    expect(timed(2, 3)).toBe(5);
    expect(timed.name).toBe('timerified ');
    // A real RecordableHistogram is accepted and collects each call's duration.
    const h = perf.createHistogram();
    const timed2 = perf.timerify((a: number, b: number) => a + b, { histogram: h });
    expect(timed2(4, 5)).toBe(9);
    expect(h.count).toBe(1);
    // A fake histogram is still rejected by Node's own argument validation.
    try {
      perf.timerify(() => 1, { histogram: { record: () => {} } });
      throw new Error('expected timerify to reject the fake histogram');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_INVALID_ARG_TYPE');
    }
  });
});
