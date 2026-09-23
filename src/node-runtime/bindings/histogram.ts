/**
 * `histogram` binding —— `perf_hooks` 直方图的 native 层（native → WASM，M117）。
 *
 * 背后是**真 `deps/histogram`**（HdrHistogram 的 C 实现）编出的 wasm 模块 +
 * `native/src/wn_histogram.cc`（逐行移植 Node `src/histogram.cc` 的算法）。
 * 这一层是薄封装：把 wasm 的 C ABI 包成一个与 Node `internalBinding('performance')`
 * 的 `Histogram` **可观测等价**的 JS 类，供 vendored 的 `lib/internal/histogram.js`
 * 与 `lib/internal/perf/event_loop_delay.js` 直接使用。
 *
 * 关于内存：变长结果（分位表、桶表、CBOR 字节、定长结构体）写在 wasm 侧自己的
 * scratch 缓冲里，再通过 `*_ptr()` 读地址；每次都从 `memory.buffer` 重新取视图
 * （wasm 内存增长会 detach 旧视图）。JS 从不把自己的 TypedArray 指针传进 wasm。
 */
import type { BindingContext } from './context';
import { wasmModule } from '../wasm/registry';

interface HistogramExports {
  memory: WebAssembly.Memory;
  wn_histo_new(lowest: bigint, highest: bigint, figures: number, halfLife: number, threshold: bigint): number;
  wn_histo_free(handle: number): void;
  wn_histo_reset(handle: number): void;
  wn_histo_record(handle: number, value: bigint): number;
  wn_histo_record_corrected(handle: number, value: bigint, expectedInterval: bigint): number;
  wn_histo_record_delta(handle: number, now: bigint): number;
  wn_histo_add(dst: number, src: number): number;
  wn_histo_subtract(dst: number, src: number): number;
  wn_histo_count(handle: number): bigint;
  wn_histo_exceeds(handle: number): bigint;
  wn_histo_min(handle: number): bigint;
  wn_histo_max(handle: number): bigint;
  wn_histo_mean(handle: number): number;
  wn_histo_stddev(handle: number): number;
  wn_histo_skewness(handle: number): number;
  wn_histo_kurtosis(handle: number): number;
  wn_histo_ewma_mean(handle: number): number;
  wn_histo_ewma_stddev(handle: number): number;
  wn_histo_ewma_error_rate(handle: number): number;
  wn_histo_percentile(handle: number, percentile: number): bigint;
  wn_histo_count_at(handle: number, value: bigint): bigint;
  wn_histo_cdf(handle: number, value: bigint): number;
  wn_histo_ks_test(a: number, b: number): number;
  wn_histo_cohens_d(a: number, b: number): number;
  wn_histo_cliffs_d(a: number, b: number): number;
  wn_histo_mean_ci(handle: number, confidence: number): void;
  wn_histo_welch_test(a: number, b: number, confidence: number): void;
  wn_histo_mann_whitney(a: number, b: number): void;
  wn_histo_percentile_ci(handle: number, percentile: number, confidence: number): void;
  wn_histo_percentiles(handle: number): number;
  wn_histo_percentiles_at(handle: number, inputPtr: number, count: number): number;
  wn_histo_linear_buckets(handle: number, stepSize: bigint): number;
  wn_histo_log_buckets(handle: number, firstBucket: bigint, logBase: number): number;
  wn_histo_keys_ptr(): number;
  wn_histo_vals_ptr(): number;
  wn_histo_out_ptr(): number;
  wn_histo_iout_ptr(): number;
  wn_histo_export(handle: number): number;
  wn_histo_bytes_ptr(): number;
  wn_histo_import_begin(length: number): number;
  wn_histo_import_commit(): number;
  wn_alloc(size: number): number;
  wn_dealloc(ptr: number): void;
}

function ex(): HistogramExports {
  return wasmModule('wn_histogram') as unknown as HistogramExports;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** 读 wasm 线性内存（每次新建视图：内存增长会 detach 旧视图）。 */
function view(): DataView {
  return new DataView(ex().memory.buffer);
}

/** `Number.MAX_SAFE_INTEGER` 之上无损的整数（Node 的 `highest` 默认值）。 */
function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
}

export interface HistogramApi {
  Histogram: new (
    lowest: number | bigint,
    highest: number | bigint,
    figures: number,
    halfLife?: number,
    threshold?: number,
  ) => unknown;
  createELDHistogram(resolution: number, samplePerIteration: boolean): unknown;
}

/**
 * 造出 `internalBinding('performance')` 里的直方图那一半。
 *
 * `ctx` 只用于 ELD 直方图的时钟与定时器（`recordDelta` 需要一个单调纳秒时钟，
 * `monitorEventLoopDelay` 需要一个定时器）。
 */
export function createHistogramApi(ctx: BindingContext): HistogramApi {
  // 句柄 → native 指针。用 WeakMap 而不是 `#` 私有字段：`import()` 要用
  // `Object.create` 造实例（不走构造器），而私有字段的 brand 只能由构造器装上。
  const PTR = new WeakMap<object, number>();
  const ptrOf = (value: unknown): number => {
    const ptr = typeof value === 'object' && value !== null ? PTR.get(value) : undefined;
    if (ptr === undefined) throw new TypeError('not a Histogram handle');
    return ptr;
  };

  const nowNanos = (): bigint => {
    const [seconds, nanos] = ctx.hrtime();
    return BigInt(seconds) * 1_000_000_000n + BigInt(nanos);
  };

  /** Node 的 `Histogram`（`internalBinding('performance').Histogram`）。 */
  class HistogramHandle {
    constructor(
      lowest: number | bigint,
      highest: number | bigint,
      figures: number,
      halfLife = 0,
      threshold = 0,
    ) {
      const ptr = ex().wn_histo_new(
        toBigInt(lowest),
        toBigInt(highest),
        figures | 0,
        halfLife,
        BigInt(Math.trunc(threshold)),
      );
      if (ptr === 0) throw new Error('Invalid histogram options');
      PTR.set(this, ptr);
    }

    static import(data: Uint8Array): HistogramHandle {
      const ptr = ex().wn_histo_import_begin(data.length);
      new Uint8Array(ex().memory.buffer).set(data, ptr);
      const handle = ex().wn_histo_import_commit();
      if (handle === 0) {
        const err = new TypeError('Invalid histogram export data');
        (err as { code?: string }).code = 'ERR_INVALID_ARG_VALUE';
        throw err;
      }
      const histogram = Object.create(HistogramHandle.prototype) as HistogramHandle;
      PTR.set(histogram, handle);
      return histogram;
    }

    count(): number {
      return Number(ex().wn_histo_count(ptrOf(this)));
    }
    countBigInt(): bigint {
      return ex().wn_histo_count(ptrOf(this));
    }
    exceeds(): number {
      return Number(ex().wn_histo_exceeds(ptrOf(this)));
    }
    exceedsBigInt(): bigint {
      return ex().wn_histo_exceeds(ptrOf(this));
    }
    min(): number {
      return Number(ex().wn_histo_min(ptrOf(this)));
    }
    minBigInt(): bigint {
      return ex().wn_histo_min(ptrOf(this));
    }
    max(): number {
      return Number(ex().wn_histo_max(ptrOf(this)));
    }
    maxBigInt(): bigint {
      return ex().wn_histo_max(ptrOf(this));
    }
    mean(): number {
      return ex().wn_histo_mean(ptrOf(this));
    }
    stddev(): number {
      return ex().wn_histo_stddev(ptrOf(this));
    }
    skewness(): number {
      return ex().wn_histo_skewness(ptrOf(this));
    }
    kurtosis(): number {
      return ex().wn_histo_kurtosis(ptrOf(this));
    }
    ewmaMean(): number {
      return ex().wn_histo_ewma_mean(ptrOf(this));
    }
    ewmaStddev(): number {
      return ex().wn_histo_ewma_stddev(ptrOf(this));
    }
    ewmaErrorRate(): number {
      return ex().wn_histo_ewma_error_rate(ptrOf(this));
    }
    percentile(percentile: number): number {
      return Number(ex().wn_histo_percentile(ptrOf(this), percentile));
    }
    percentileBigInt(percentile: number): bigint {
      return ex().wn_histo_percentile(ptrOf(this), percentile);
    }
    countAt(value: number): number {
      return Number(ex().wn_histo_count_at(ptrOf(this), toBigInt(value)));
    }
    cdf(value: number): number {
      return ex().wn_histo_cdf(ptrOf(this), toBigInt(value));
    }
    reset(): void {
      ex().wn_histo_reset(ptrOf(this));
    }
    record(value: number | bigint): void {
      ex().wn_histo_record(ptrOf(this), toBigInt(value));
    }
    recordCorrected(value: number | bigint, expectedInterval: number | bigint): void {
      ex().wn_histo_record_corrected(ptrOf(this), toBigInt(value), toBigInt(expectedInterval));
    }
    recordDelta(): number {
      return ex().wn_histo_record_delta(ptrOf(this), nowNanos());
    }
    add(other: unknown): number {
      return ex().wn_histo_add(ptrOf(this), ptrOf(other));
    }
    subtract(other: unknown): number {
      return ex().wn_histo_subtract(ptrOf(this), ptrOf(other));
    }
    ksTest(other: unknown): number {
      return ex().wn_histo_ks_test(ptrOf(this), ptrOf(other));
    }
    cohensD(other: unknown): number {
      return ex().wn_histo_cohens_d(ptrOf(this), ptrOf(other));
    }
    cliffsD(other: unknown): number {
      return ex().wn_histo_cliffs_d(ptrOf(this), ptrOf(other));
    }
    meanCI(confidence: number): number[] {
      ex().wn_histo_mean_ci(ptrOf(this), confidence);
      return readDoubles(ex().wn_histo_out_ptr(), 3);
    }
    welchTest(other: unknown, confidence: number): number[] {
      ex().wn_histo_welch_test(ptrOf(this), ptrOf(other), confidence);
      return readDoubles(ex().wn_histo_out_ptr(), 5);
    }
    mannWhitneyTest(other: unknown): number[] {
      ex().wn_histo_mann_whitney(ptrOf(this), ptrOf(other));
      return readDoubles(ex().wn_histo_out_ptr(), 3);
    }
    percentileCI(percentile: number, confidence: number): number[] {
      ex().wn_histo_percentile_ci(ptrOf(this), percentile, confidence);
      return readBigInt64s(ex().wn_histo_iout_ptr(), 3).map(Number);
    }

    /** 分位数表 → 填进 JS `Map`（key = 百分位，value = 该分位的值）。 */
    percentiles(target: Map<number, unknown>, bigintValues = false): void {
      const n = ex().wn_histo_percentiles(ptrOf(this));
      const keys = readDoubles(ex().wn_histo_keys_ptr(), n);
      const vals = readBigInt64s(ex().wn_histo_vals_ptr(), n);
      for (let i = 0; i < n; i++) target.set(keys[i], bigintValues ? vals[i] : Number(vals[i]));
    }

    percentilesBigInt(target: Map<number, unknown>): void {
      this.percentiles(target, true);
    }

    percentilesAt(target: Map<number, unknown>, input: Float64Array): void {
      const n = input.length;
      const ptr = ex().wn_alloc(n * 8);
      try {
        new Float64Array(ex().memory.buffer, ptr, n).set(input);
        ex().wn_histo_percentiles_at(ptrOf(this), ptr, n);
      } finally {
        ex().wn_dealloc(ptr);
      }
      const vals = readBigInt64s(ex().wn_histo_vals_ptr(), n);
      for (let i = 0; i < n; i++) target.set(input[i], Number(vals[i]));
    }

    linearBuckets(stepSize: number, target: Map<number, unknown>): void {
      const n = ex().wn_histo_linear_buckets(ptrOf(this), toBigInt(stepSize));
      const keys = readDoubles(ex().wn_histo_keys_ptr(), n);
      const vals = readBigInt64s(ex().wn_histo_vals_ptr(), n);
      for (let i = 0; i < n; i++) target.set(keys[i], Number(vals[i]));
    }

    logBuckets(firstBucket: number, logBase: number, target: Map<number, unknown>): void {
      const n = ex().wn_histo_log_buckets(ptrOf(this), toBigInt(firstBucket), logBase);
      const keys = readDoubles(ex().wn_histo_keys_ptr(), n);
      const vals = readBigInt64s(ex().wn_histo_vals_ptr(), n);
      for (let i = 0; i < n; i++) target.set(keys[i], Number(vals[i]));
    }

    export(): Uint8Array {
      const n = ex().wn_histo_export(ptrOf(this));
      const ptr = ex().wn_histo_bytes_ptr();
      return new Uint8Array(ex().memory.buffer, ptr, n).slice();
    }
  }

  function readDoubles(ptr: number, count: number): number[] {
    const dv = view();
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(dv.getFloat64(ptr + i * 8, true));
    return out;
  }

  function readBigInt64s(ptr: number, count: number): bigint[] {
    const dv = view();
    const out: bigint[] = [];
    for (let i = 0; i < count; i++) out.push(dv.getBigInt64(ptr + i * 8, true));
    return out;
  }

  /**
   * `monitorEventLoopDelay` 的 ELD 直方图。Node 用 libuv 的定时器（`IntervalHistogram`）
   * 或 prepare/check 钩子（`IterationHistogram`）采样事件循环延迟；这里用 **unref 过的**
   * 定时器 / `setImmediate` 驱动，记录相邻两次的间隔（纳秒）——语义等价，且和 Node 一样
   * **不吊住事件循环**（unref）。
   */
  class ELDHistogramHandle extends HistogramHandle {
    #timer: { unref?(): void } | null = null;
    #last: bigint | null = null;

    constructor(private readonly resolution: number, private readonly perIteration: boolean) {
      // IntervalHistogram 用 `Histogram::Options{1000}`；IterationHistogram 用 `{1}`。
      super(perIteration ? 1 : 1000, MAX_SAFE, 3, 0, 0);
    }

    start(): void {
      if (this.#timer !== null) return;
      const timers = ctx.requireBuiltin?.('timers') as
        | {
            setInterval(fn: () => void, ms: number): { unref?(): void };
            setImmediate(fn: () => void): { unref?(): void };
            clearInterval(t: unknown): void;
            clearImmediate(t: unknown): void;
          }
        | undefined;
      if (!timers) throw new Error('timers unavailable for ELD histogram');
      this.#last = null;
      const tick = (): void => {
        const now = nowNanos();
        if (this.#last !== null && now - this.#last >= 1n) {
          ex().wn_histo_record(ptrOf(this), now - this.#last);
        }
        this.#last = now;
        if (this.perIteration) this.#timer = timers.setImmediate(tick);
      };
      if (this.perIteration) {
        this.#timer = timers.setImmediate(tick);
      } else {
        this.#timer = timers.setInterval(tick, this.resolution);
      }
      this.#timer.unref?.();
    }

    stop(): void {
      if (this.#timer === null) return;
      const timers = ctx.requireBuiltin?.('timers') as
        | { clearInterval(t: unknown): void; clearImmediate(t: unknown): void }
        | undefined;
      if (this.perIteration) timers?.clearImmediate(this.#timer);
      else timers?.clearInterval(this.#timer);
      this.#timer = null;
      this.#last = null;
    }
  }

  return {
    Histogram: HistogramHandle as unknown as HistogramApi['Histogram'],
    createELDHistogram(resolution: number, samplePerIteration: boolean): unknown {
      return new ELDHistogramHandle(resolution, samplePerIteration);
    },
  };
}
