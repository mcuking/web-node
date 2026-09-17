import type { BuiltinSpec } from './types';

/**
 * `perf_hooks` — Node's high-resolution timing module.
 *
 * The browser already has a `performance` global with the same `now()` /
 * `timeOrigin` shape, so we expose it directly. `PerformanceObserver` is part
 * of the browser Performance API too; the Node-only entry types are stubbed so
 * that importing the module never throws, while actually collecting a profile
 * is honestly reported as unsupported.
 */
export const perfHooksSpec: BuiltinSpec = {
  id: 'perf_hooks',
  aliases: ['node:perf_hooks'],
  origin: 'web-node',
  init: () => {
    const perf = (globalThis as { performance?: Performance }).performance;
    if (!perf) {
      throw new Error('web-node: this host has no Performance global');
    }
    return {
      performance: perf,
      PerformanceObserver: (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver,
      PerformanceObserverEntryList: undefined,
      PerformanceEntry: undefined,
      PerformanceMark: undefined,
      PerformanceMeasure: undefined,
      constants: {
        NODE_PERFORMANCE_GC_MAJOR: 4,
        NODE_PERFORMANCE_GC_MINOR: 1,
        NODE_PERFORMANCE_GC_INCREMENTAL: 8,
        NODE_PERFORMANCE_GC_WEAKCB: 16,
      },
      // Event-loop / GC monitoring has no equivalent here.
      monitorEventLoopDelay: () => {
        throw new Error('web-node: perf_hooks.monitorEventLoopDelay is not supported');
      },
      createHistogram: () => {
        throw new Error('web-node: perf_hooks.createHistogram is not supported');
      },
    };
  },
};
