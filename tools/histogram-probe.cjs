// Shared observation program for `perf_hooks` histograms (milestone 117).
//
// It runs both on a real Node oracle (tools/histogram-oracle.mjs ->
// test/fixtures/histogram.json) and inside web-node (test/histogram.test.ts).
// The two JSON blobs must be **equal**: the wasm module is Node's own
// deps/histogram and native/src/wn_histogram.cc is a line-by-line port of
// src/histogram.cc, so every number and every CBOR byte has to match.
//
// Output is one line: `__OBS__<json>`.
'use strict';

const {
  createHistogram,
  importHistogram,
  Histogram,
} = require('perf_hooks');

const out = {};

function hex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function mapToObject(map) {
  const o = {};
  for (const [k, v] of map) o[String(k)] = typeof v === 'bigint' ? v.toString() : v;
  return o;
}

function err(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return `${e.name}:${e.code || ''}:${e.message}`;
  }
}

// Transcendentals (`erfc`/`lgamma`/`exp`/`log`) come from the host libm on the
// oracle but from wasi-libc inside wasm, so they can differ by an ULP. Round the
// *statistical* floats to 10 significant digits: the gate still catches any real
// drift, without tripping on the last bit of the libm.
const f = (x) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toPrecision(10)) : x);
const obj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

// 1) Default histogram over a known ramp: every scalar statistic.
{
  const h = createHistogram();
  for (let i = 1; i <= 1000; i++) h.record(i);
  out.ramp = {
    count: h.count,
    countBigInt: h.countBigInt.toString(),
    min: h.min,
    minBigInt: h.minBigInt.toString(),
    max: h.max,
    maxBigInt: h.maxBigInt.toString(),
    mean: f(h.mean),
    stddev: f(h.stddev),
    exceeds: h.exceeds,
    exceedsBigInt: h.exceedsBigInt.toString(),
    skewness: f(h.skewness),
    kurtosis: f(h.kurtosis),
    percentile50: h.percentile(50),
    percentile99: h.percentile(99),
    percentile99BigInt: h.percentileBigInt(99).toString(),
    countAt500: h.countAt(500),
    cdf500: f(h.cdf(500)),
    ccdf500: f(h.ccdf(500)),
    toJSON: {
      count: h.toJSON().count,
      min: h.toJSON().min,
      max: h.toJSON().max,
      mean: f(h.toJSON().mean),
      percentiles: h.toJSON().percentiles,
    },
  };
}

// 2) `export()` / `importHistogram()` CBOR round trip.
{
  const h = createHistogram();
  for (let i = 1; i <= 500; i++) h.record(i * 3);
  const bytes = h.export();
  out.exportHex = hex(bytes);
  out.exportLength = bytes.length;
  const back = importHistogram(bytes);
  out.imported = {
    count: back.count,
    min: back.min,
    max: back.max,
    mean: f(back.mean),
    exportHex: hex(back.export()),
  };
}

// 3) Encoded parameters: lowest / highest / figures each change the bucket map.
{
  const cases = [
    { lowest: 1, highest: 1000, figures: 3 },
    { lowest: 10, highest: 100000, figures: 2 },
    { lowest: 1, highest: 1 << 30, figures: 5 },
    { lowest: 5n, highest: 5000n, figures: 4 },
  ];
  out.options = cases.map((opts) => {
    const h = createHistogram(opts);
    for (let i = 1; i <= 300; i++) h.record(i * 7);
    return {
      opts: { lowest: String(opts.lowest), highest: String(opts.highest), figures: opts.figures },
      count: h.count,
      min: h.min,
      max: h.max,
      mean: f(h.mean),
      stddev: f(h.stddev),
      exportHex: hex(h.export()),
    };
  });
}

// 4) recordCorrected (backfills the gap at the expected interval).
{
  const h = createHistogram({ lowest: 1, highest: 1000000, figures: 3 });
  h.recordCorrected(1000, 100);
  h.recordCorrected(5000, 100);
  out.corrected = {
    count: h.count,
    min: h.min,
    max: h.max,
    mean: f(h.mean),
    exceeds: h.exceeds,
  };
}

// 5) reset() clears everything.
{
  const h = createHistogram();
  for (let i = 1; i <= 100; i++) h.record(i);
  h.reset();
  out.reset = { count: h.count, min: h.min, max: h.max, mean: f(h.mean), exceeds: h.exceeds };
}

// 6) Two-sample tests: ksTest / welchTest / mannWhitneyTest / cohensD / cliffsD.
{
  const a = createHistogram({ lowest: 1, highest: 100000, figures: 3 });
  const b = createHistogram({ lowest: 1, highest: 100000, figures: 3 });
  for (let i = 1; i <= 200; i++) a.record(i * 5);
  for (let i = 1; i <= 200; i++) b.record(i * 6 + 40);
  out.twoSample = {
    ksTest: f(a.ksTest(b)),
    welch: obj(a.welchTest(b, { confidence: 0.95 })),
    mannWhitney: obj(a.mannWhitneyTest(b)),
    cohensD: f(a.cohensD(b)),
    cliffsD: f(a.cliffsD(b)),
  };
}

// 7) Confidence intervals.
{
  const h = createHistogram();
  for (let i = 1; i <= 400; i++) h.record(i);
  out.ci = {
    meanCI: obj(h.meanCI({ confidence: 0.95 })),
    percentileCI: h.percentileCI(50, { confidence: 0.95 }),
    percentileCI90: h.percentileCI(90, { confidence: 0.9 }),
  };
}

// 8) Bucketing views.
{
  const h = createHistogram({ lowest: 1, highest: 100000, figures: 3 });
  for (let i = 1; i <= 500; i++) h.record(i * 10);
  const linear = new Map();
  h.linearBuckets(5000, linear);
  const log = new Map();
  h.logBuckets(10, 2, log);
  const at = h.percentilesAt([10, 50, 90, 99]);
  const pct = h.percentiles;
  const pctBig = h.percentilesBigInt;
  out.buckets = {
    linear: mapToObject(linear),
    log: mapToObject(log),
    at: mapToObject(at),
    percentiles: mapToObject(pct),
    percentilesBigInt: mapToObject(pctBig),
  };
}

// 9) add / subtract between two compatible histograms.
{
  const a = createHistogram();
  const b = createHistogram();
  for (let i = 1; i <= 50; i++) a.record(i);
  for (let i = 1; i <= 120; i++) b.record(i * 2);
  out.add = {
    added: a.add(b),
    count: a.count,
    min: a.min,
    max: a.max,
    exceeds: a.exceeds,
  };
  const c = createHistogram();
  for (let i = 1; i <= 200; i++) c.record(i);
  const d = createHistogram();
  for (let i = 1; i <= 60; i++) d.record(i);
  out.subtract = {
    dropped: c.subtract(d),
    count: c.count,
    min: c.min,
    max: c.max,
  };
}

// 10) EWMA (halfLife) and the SLO error-rate EWMA (threshold).
{
  const h = createHistogram({ lowest: 1, highest: 100000, figures: 3, halfLife: 4, threshold: 500 });
  for (let i = 1; i <= 200; i++) h.record(i * 10);
  out.ewma = {
    ewmaMean: f(h.ewmaMean),
    ewmaStddev: f(h.ewmaStddev),
    ewmaErrorRate: f(h.ewmaErrorRate),
    // The exported CBOR encodes `ewmaAlpha`/`ewmaVariance` as float64. `alpha`
    // matches bit-for-bit, but `variance` accumulates `v + alpha*d*d`, which the
    // **host** compiler fuses into an FMA on arm64 and wasm cannot (no FMA
    // instruction) — a legitimate 1-ULP difference in the last byte. So the
    // EWMA map itself is compared through `ewmaStddev`/`ewmaErrorRate` (above,
    // rounded to 10 significant digits) and the *framing* is compared exactly.
    exportLength: h.export().length,
    exportHexBeforeEwma: hex(h.export()).slice(0, hex(h.export()).lastIndexOf('0ba5')),
  };
  const imported = importHistogram(h.export());
  out.ewmaImport = {
    ewmaMean: f(imported.ewmaMean),
    ewmaStddev: f(imported.ewmaStddev),
    ewmaErrorRate: f(imported.ewmaErrorRate),
    count: imported.count,
  };
}

// 11) Error shapes.
{
  const h = createHistogram();
  out.errors = {
    recordZero: err(() => h.record(0)),
    recordNegative: err(() => h.record(-1)),
    recordNonInteger: err(() => h.record(1.5)),
    figuresZero: err(() => createHistogram({ figures: 0 })),
    figuresSix: err(() => createHistogram({ figures: 6 })),
    highestBelowLowest: err(() => createHistogram({ lowest: 100, highest: 10 })),
    halfLifeNegative: err(() => createHistogram({ halfLife: -1 })),
    illegalConstructor: err(() => new Histogram()),
    importNotBytes: err(() => importHistogram('nope')),
    importGarbage: err(() => importHistogram(Uint8Array.from([0xff, 0x00, 0x01]))),
    percentileZero: err(() => h.percentile(0)),
    percentile101: err(() => h.percentile(101)),
  };
}

// 12) monitorEventLoopDelay is timing-dependent, so only its *shape* is observed.
{
  const { monitorEventLoopDelay } = require('perf_hooks');
  const h = monitorEventLoopDelay({ resolution: 5 });
  out.eld = {
    isHistogram: typeof h.enable === 'function' && typeof h.disable === 'function',
    initiallyEnabled: typeof h.count === 'number',
    enable: h.enable(),
    disable: h.disable(),
    enableAgain: h.enable(),
    disableAgain: h.disable(),
  };
}

process.stdout.write('__OBS__' + JSON.stringify(out) + '\n');
