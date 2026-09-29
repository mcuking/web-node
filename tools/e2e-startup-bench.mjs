// Cold-start benchmark for the web-node app (M107).
//
//   node tools/e2e-startup-bench.mjs [url] [runs]
//
// Reads the read-only `globalThis.__wnBoot` breakdown the app fills in
// (`moduleEvalMs` / `workerSpawnMs` / `runtimeReadyMs` / `firstRunMs`) and
// prints a table. Requires a Chromium with CDP on 127.0.0.1:38800.
const URL_ = process.argv[2] || 'https://mcuking.github.io/web-node/';
const RUNS = Number(process.argv[3] || 1);

const version = await (await fetch('http://127.0.0.1:38800/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}, s) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
for (let run = 1; run <= RUNS; run++) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  await sleep(500);
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  // The CDN browser cache would measure a warm bundle, not a cold load.
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Page.navigate', { url: URL_ + '?bench=' + Date.now() }, sessionId);

  const evalIn = async (expr, ms = 20000) =>
    (
      await Promise.race([
        send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT eval ' + expr)), ms)),
      ])
    ).result?.value;

  const t0 = Date.now();
  let boot = null;
  for (;;) {
    boot = await evalIn('globalThis.__wnBoot && globalThis.__wnBoot.runtimeReadyMs ? JSON.stringify(globalThis.__wnBoot) : null');
    if (boot) break;
    if (Date.now() - t0 > 120000) throw new Error('runtime never became ready');
    await sleep(500);
  }
  const parsed = JSON.parse(boot);
  // The deferred codecs (M107) and the lazy vendored-source tier (M126) land
  // *after* ready by design; wait for the worker to report their timestamps so
  // the table can show they were off the critical path.
  const tDefer = Date.now();
  while ((!parsed.deferredMs || !parsed.vendoredDeferredMs) && Date.now() - tDefer < 30000) {
    const b = await evalIn(
      'globalThis.__wnBoot && globalThis.__wnBoot.deferredMs && globalThis.__wnBoot.vendoredDeferredMs ? JSON.stringify(globalThis.__wnBoot) : null',
    );
    if (b) Object.assign(parsed, JSON.parse(b));
    else await sleep(300);
  }
  const wallMs = Date.now() - t0;
  rows.push({ run, wallMs, ...parsed });
  console.log(
    `run ${run}: moduleEval=${parsed.moduleEvalMs}ms  workerSpawn=${parsed.workerSpawnMs}ms  ` +
      `runtimeReady=${parsed.runtimeReadyMs}ms  (wall from navigate ≈ ${wallMs}ms)`,
  );
  console.log(
    `         ↳ worker phases: vendored(core)=${parsed.vendoredMs}ms  wasm=${parsed.wasmMs}ms  ` +
      `realm=${parsed.realmMs}ms  |  lazy sources @${parsed.vendoredDeferredMs}ms  deferred codecs @${parsed.deferredMs}ms`,
  );
  await send('Target.closeTarget', { targetId });
}

const avg = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);
console.log('');
console.log('=== summary ===');
console.log(`runs              : ${rows.length}`);
console.log(`module eval (ms)  : ${avg('moduleEvalMs')}`);
console.log(`worker spawn (ms) : ${avg('workerSpawnMs')}`);
console.log(`runtime ready (ms): ${avg('runtimeReadyMs')}`);
console.log(`  vendored core (ms): ${avg('vendoredMs')}`);
console.log(`  wasm (ms)       : ${avg('wasmMs')}`);
console.log(`  realm (ms)      : ${avg('realmMs')}`);
console.log(`  lazy sources (ms): ${avg('vendoredDeferredMs')}  (fetched in background, not awaited at boot)`);
console.log(`  deferred codecs (ms): ${avg('deferredMs')}  (prefetched in parallel, not awaited at boot)`);
console.log(`wall (ms)         : ${avg('wallMs')}`);
