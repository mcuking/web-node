// End-to-end HMR check on the deployed GitHub Pages build (path-prefix mode).
//
//   node tools/e2e-pages-hmr.mjs [url] [port]
//
// Different shape from the dev-server run: there is no `<port>.localhost`
// wildcard on a static host, so the preview is a *same-origin* iframe under
// `<base>preview/<port>/`, and its HMR shim talks to the runtime's channel
// directly. The app frame is therefore a plain (non-OOPIF) frame of the page.
const URL_ = process.argv[2] || 'https://mcuking.github.io/web-node/';
const PORT = process.argv[3] || '5173';
const BASE = new URL(URL_).pathname; // '/web-node/'

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
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    return;
  }
  events.push(m);
};
await new Promise((r) => (ws.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await (await fetch('http://127.0.0.1:38800/json/list')).json());

console.log('1. open a fresh tab on the Pages build');
const { targetId } = await send('Target.createTarget', { url: URL_ });
await sleep(4000);
const page = (await targets()).find((t) => t.id === targetId) ?? (await targets()).find((t) => t.url.includes('mcuking.github.io'));
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

const bounded = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${label}`)), ms))]);
const req = (expr, ms = 8000) =>
  bounded(send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId), ms, 'eval').then(
    (r) => r.result?.value ?? JSON.stringify(r),
  );
async function waitFor(expr, label, timeoutMs = 120000, every = 1500) {
  const t0 = Date.now();
  for (;;) {
    const v = await req(expr, 8000);
    if (v && v !== 'false' && String(v) !== 'null') return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor ${label} timed out`);
    await sleep(every);
  }
}

console.log('   ', await waitFor("document.getElementById('boot') && /runtime ready/.test(document.getElementById('boot').textContent) && document.getElementById('boot').textContent", 'boot'));

console.log('2. reset project, install deps, run vite dev');
await req("document.getElementById('reset').click(), 'reset'");
await sleep(2500);
await req("document.getElementById('install').click(), 'install'");
await waitFor("document.getElementById('status').textContent.includes('installed') && 'installed'", 'install', 180000);
console.log('   ', await req("document.getElementById('status').textContent"));
await req("document.getElementById('vitedev').click(), 'vitedev'");

console.log('3. preview appears under the path prefix');
await waitFor("document.getElementById('terminal').textContent.includes('listening') && 'listening'", 'vite listening', 120000);
const discovered = await waitFor(
  "(function(){var s=document.getElementById('port-select');return s && s.options.length && s.value ? s.value : '';})()",
  'port discovery',
  60000,
);
const previewSrc = await req("document.getElementById('preview-frame').getAttribute('src')");
console.log('   port:', discovered, '| src:', previewSrc);
if (!String(previewSrc).includes(`${BASE}preview/${PORT}/`)) throw new Error(`preview not in prefix mode: ${previewSrc}`);
await waitFor("document.getElementById('terminal').textContent.includes('preview connected') && 'connected'", 'hmr client', 60000);

console.log('4. instrument the preview frame (same origin)');
const appFrame = await (async () => {
  for (let i = 0; i < 20; i++) {
    const { frameTree } = await send('Page.getFrameTree', {}, sessionId);
    const flat = [];
    (function walk(n) { flat.push(n.frame); for (const c of n.childFrames || []) walk(c); })(frameTree);
    const f = flat.find((x) => x.url.includes(`${BASE}preview/${PORT}/`));
    if (f) return f;
    await sleep(1000);
  }
  throw new Error('no preview frame found');
})();
console.log('   frame:', appFrame.url);
const ctxFor = (frameId) =>
  events
    .map((e) => e.method === 'Runtime.executionContextCreated' && e.params.context)
    .filter(Boolean)
    .reverse()
    .find((c) => c.auxData && c.auxData.frameId === frameId && c.auxData.isDefault);
const inApp = async (expr, ms = 8000) => {
  const ctx = ctxFor(appFrame.id);
  if (!ctx) throw new Error('no main-world context for the preview frame yet');
  return bounded(
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: ctx.id }, sessionId).then(
      (r) => r.result?.value ?? JSON.stringify(r),
    ),
    ms,
    'inApp',
  );
};
await inApp(
  "document.documentElement.dataset.mark='stay';document.documentElement.dataset.hmr='0';" +
    "window.addEventListener('message',function(e){try{if(e.data&&e.data.__wnHmr)document.documentElement.dataset.hmr=String(Number(document.documentElement.dataset.hmr)+1);}catch(_){}});",
);
await sleep(1000);
console.log('   app before:', await inApp("document.getElementById('app') && document.getElementById('app').textContent"));

console.log('5. js hmr');
await req("document.getElementById('hmred').click(), 'edited'");
await sleep(6000);
console.log('   app after :', await inApp("document.getElementById('app') && document.getElementById('app').textContent"));
console.log('   marker    :', await inApp("document.documentElement.dataset.mark"));

console.log('6. css hmr');
console.log('   color before:', await inApp("getComputedStyle(document.getElementById('app')).color"));
await req("document.getElementById('hmrcss').click(), 'edited'");
await sleep(6000);
console.log('   color after :', await inApp("getComputedStyle(document.getElementById('app')).color"));
console.log('   marker      :', await inApp("document.documentElement.dataset.mark"));
process.exit(0);
