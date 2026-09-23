/**
 * `perf_hooks` histograms — the **real `deps/histogram`**, compiled to
 * WebAssembly (M117).
 *
 * Node's `Histogram` is a native binding over the HdrHistogram C source in
 * `deps/histogram`. Here the same upstream C is built with wasi-sdk (`native/src/
 * wn_histogram.cc` is a line-by-line port of `src/histogram.cc`'s algorithms and
 * CBOR codec) and reached through `internalBinding('performance')`, so
 * `createHistogram()`, `importHistogram()`, every statistic, every bucket view and
 * the exported CBOR bytes must match Node v26.9.0.
 *
 * The gate is a shared observation program (`tools/histogram-probe.cjs`) run both
 * on a real Node oracle (which produced `test/fixtures/histogram.json`) and inside
 * web-node: the two JSON blobs must be **equal**. The focused checks below exist so
 * a failure points at *what* drifted.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const encoder = new TextEncoder();
const expected = JSON.parse(readFileSync('test/fixtures/histogram.json', 'utf8')) as Record<string, unknown>;

/**
 * Run a script inside the runtime and collect everything it prints, waiting
 * until the output stops growing (or a deadline passes).
 */
function runBody(body: string, waitMs = 4000): Promise<string[]> {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', encoder.encode(body));
  const lines: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (chunk) => lines.push(chunk),
    onStderr: (chunk) => lines.push(chunk),
  });
  runtime.runMain('/project/index.js');
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs;
    let joined = '';
    let stable = 0;
    const poll = (): void => {
      const now = lines.join('');
      if (now !== joined) {
        joined = now;
        stable = 0;
      } else if (now.length > 0 && ++stable >= 8) {
        resolve(joined.split('\n').filter((line) => line.length > 0));
        return;
      }
      if (Date.now() > deadline) {
        resolve(joined.split('\n').filter((line) => line.length > 0));
        return;
      }
      setTimeout(poll, 20);
    };
    setTimeout(poll, 20);
  });
}

/** Evaluate a snippet that reports one value through `__report`; return it. */
async function evaluate(snippet: string, waitMs = 4000): Promise<unknown> {
  const body =
    `const { createHistogram, importHistogram } = require('perf_hooks');\n` +
    `const __report = (v) => console.log('RESULT ' + JSON.stringify(v));\n` +
    `const f = (x) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toPrecision(10)) : x);\n` +
    `const obj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));\n` +
    `${snippet}\n`;
  const lines = await runBody(body, waitMs);
  const line = lines.find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('no RESULT line; output was:\n' + lines.join('\n'));
  return JSON.parse(line.slice('RESULT '.length));
}

describe('perf_hooks histograms', () => {
  it('matches the real-Node oracle on the shared observation corpus', async () => {
    const probe = readFileSync('tools/histogram-probe.cjs', 'utf8');
    const lines = await runBody(probe, 8000);
    const line = lines.find((l) => l.startsWith('__OBS__'));
    expect(line, 'the probe produced no __OBS__ line').toBeTruthy();
    const observed = JSON.parse((line as string).slice('__OBS__'.length)) as Record<string, unknown>;
    // Compare key-by-key so a mismatch names the field instead of dumping two blobs.
    expect(Object.keys(observed).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      expect(observed[key], `field "${key}"`).toEqual(expected[key]);
    }
  }, 30000);

  it('computes every scalar statistic like Node', async () => {
    const result = await evaluate(`
      const h = createHistogram();
      for (let i = 1; i <= 1000; i++) h.record(i);
      __report({
        count: h.count,
        min: h.min,
        max: h.max,
        mean: f(h.mean),
        stddev: f(h.stddev),
        skewness: f(h.skewness),
        kurtosis: f(h.kurtosis),
        exceeds: h.exceeds,
        cdf500: f(h.cdf(500)),
        ccdf500: f(h.ccdf(500)),
        countAt500: h.countAt(500),
        percentile50: h.percentile(50),
        percentile99BigInt: h.percentileBigInt(99).toString(),
      });`);
    const ramp = expected.ramp as Record<string, unknown>;
    expect(result).toEqual({
      count: ramp.count,
      min: ramp.min,
      max: ramp.max,
      mean: ramp.mean,
      stddev: ramp.stddev,
      skewness: ramp.skewness,
      kurtosis: ramp.kurtosis,
      exceeds: ramp.exceeds,
      cdf500: ramp.cdf500,
      ccdf500: ramp.ccdf500,
      countAt500: ramp.countAt500,
      percentile50: ramp.percentile50,
      percentile99BigInt: ramp.percentile99BigInt,
    });
  });

  it('exports CBOR bytes byte-for-byte like Node, and re-imports them', async () => {
    const result = await evaluate(`
      const h = createHistogram();
      for (let i = 1; i <= 500; i++) h.record(i * 3);
      const bytes = h.export();
      let hex = '';
      for (const b of bytes) hex += b.toString(16).padStart(2, '0');
      const back = importHistogram(bytes);
      let rehex = '';
      for (const b of back.export()) rehex += b.toString(16).padStart(2, '0');
      __report({ hex, length: bytes.length, backCount: back.count, backMean: f(back.mean), rehex });`);
    const imported = expected.imported as Record<string, unknown>;
    expect(result).toEqual({
      hex: expected.exportHex,
      length: expected.exportLength,
      backCount: imported.count,
      backMean: imported.mean,
      rehex: imported.exportHex,
    });
  });

  it('honors lowest/highest/figures instead of ignoring them', async () => {
    const result = await evaluate(`
      const cfgs = [
        { lowest: 1, highest: 1000, figures: 3 },
        { lowest: 10, highest: 100000, figures: 2 },
        { lowest: 1, highest: 1 << 30, figures: 5 },
        { lowest: 5n, highest: 5000n, figures: 4 },
      ];
      __report(cfgs.map((c) => {
        const h = createHistogram(c);
        for (let i = 1; i <= 300; i++) h.record(i * 7);
        return { count: h.count, min: h.min, max: h.max, mean: f(h.mean), stddev: f(h.stddev) };
      }));`);
    const options = expected.options as Array<Record<string, unknown>>;
    expect(result).toEqual(
      options.map((o) => ({
        count: o.count,
        min: o.min,
        max: o.max,
        mean: o.mean,
        stddev: o.stddev,
      })),
    );
  });

  it('runs the two-sample tests and confidence intervals like Node', async () => {
    const result = await evaluate(`
      const a = createHistogram({ lowest: 1, highest: 100000, figures: 3 });
      const b = createHistogram({ lowest: 1, highest: 100000, figures: 3 });
      for (let i = 1; i <= 200; i++) a.record(i * 5);
      for (let i = 1; i <= 200; i++) b.record(i * 6 + 40);
      const c = createHistogram();
      for (let i = 1; i <= 400; i++) c.record(i);
      __report({
        ksTest: f(a.ksTest(b)),
        welch: obj(a.welchTest(b, { confidence: 0.95 })),
        mannWhitney: obj(a.mannWhitneyTest(b)),
        cohensD: f(a.cohensD(b)),
        cliffsD: f(a.cliffsD(b)),
        meanCI: obj(c.meanCI({ confidence: 0.95 })),
        percentileCI: c.percentileCI(50, { confidence: 0.95 }),
      });`);
    const twoSample = expected.twoSample as Record<string, unknown>;
    const ci = expected.ci as Record<string, unknown>;
    expect(result).toEqual({
      ksTest: twoSample.ksTest,
      welch: twoSample.welch,
      mannWhitney: twoSample.mannWhitney,
      cohensD: twoSample.cohensD,
      cliffsD: twoSample.cliffsD,
      meanCI: ci.meanCI,
      percentileCI: ci.percentileCI,
    });
  });

  it('tracks EWMA and the SLO error rate like Node, through export/import', async () => {
    const result = await evaluate(`
      const h = createHistogram({ lowest: 1, highest: 100000, figures: 3, halfLife: 4, threshold: 500 });
      for (let i = 1; i <= 200; i++) h.record(i * 10);
      const back = importHistogram(h.export());
      __report({
        ewmaMean: f(h.ewmaMean),
        ewmaStddev: f(h.ewmaStddev),
        ewmaErrorRate: f(h.ewmaErrorRate),
        importMean: f(back.ewmaMean),
        importStddev: f(back.ewmaStddev),
        importErrorRate: f(back.ewmaErrorRate),
        importCount: back.count,
      });`);
    const ewma = expected.ewma as Record<string, unknown>;
    const ewmaImport = expected.ewmaImport as Record<string, unknown>;
    expect(result).toEqual({
      ewmaMean: ewma.ewmaMean,
      ewmaStddev: ewma.ewmaStddev,
      ewmaErrorRate: ewma.ewmaErrorRate,
      importMean: ewmaImport.ewmaMean,
      importStddev: ewmaImport.ewmaStddev,
      importErrorRate: ewmaImport.ewmaErrorRate,
      importCount: ewmaImport.count,
    });
  });

  it('reports validation and import failures exactly like Node', async () => {
    const result = await evaluate(`
      const err = (fn) => { try { fn(); return null; } catch (e) { return e.name + ':' + (e.code || '') + ':' + e.message; } };
      const h = createHistogram();
      __report({
        recordZero: err(() => h.record(0)),
        recordNonInteger: err(() => h.record(1.5)),
        figuresZero: err(() => createHistogram({ figures: 0 })),
        highestBelowLowest: err(() => createHistogram({ lowest: 100, highest: 10 })),
        halfLifeNegative: err(() => createHistogram({ halfLife: -1 })),
        importNotBytes: err(() => importHistogram('nope')),
        importGarbage: err(() => importHistogram(Uint8Array.from([0xff, 0x00, 0x01]))),
        percentileZero: err(() => h.percentile(0)),
        percentile101: err(() => h.percentile(101)),
      });`);
    const errors = expected.errors as Record<string, string>;
    expect(result).toEqual({
      recordZero: errors.recordZero,
      recordNonInteger: errors.recordNonInteger,
      figuresZero: errors.figuresZero,
      highestBelowLowest: errors.highestBelowLowest,
      halfLifeNegative: errors.halfLifeNegative,
      importNotBytes: errors.importNotBytes,
      importGarbage: errors.importGarbage,
      percentileZero: errors.percentileZero,
      percentile101: errors.percentile101,
    });
  });

  it('monitorEventLoopDelay samples the loop and stays unref\'d', async () => {
    // The absolute delays are timing-dependent, so only the *contract* is checked:
    // enable/disable return booleans, samples carry nanosecond magnitudes, and the
    // (unref'd) histogram does not keep the runtime alive after `disable()`.
    const result = await evaluate(
      `
      const { monitorEventLoopDelay } = require('perf_hooks');
      const h = monitorEventLoopDelay({ resolution: 5 });
      const first = h.enable();
      setTimeout(() => {
        const second = h.disable();
        __report({
          first,
          second,
          reEnable: h.enable(),
          reDisable: h.disable(),
          count: h.count,
          enoughSamples: h.count >= 4 && h.count <= 15,
          minAtLeastResolution: h.min >= 5_000_000,
          hasMean: typeof h.mean === 'number',
          huge: h.max >= h.min,
        });
      }, 40);`,
      6000,
    );
    expect(result).toEqual({
      first: true,
      second: true,
      reEnable: true,
      reDisable: true,
      // 40ms / 5ms => around 8 samples (jitter allowed); exact values are timing.
      count: expect.any(Number),
      enoughSamples: true,
      minAtLeastResolution: true,
      hasMean: true,
      huge: true,
    });
  }, 20000);
});
