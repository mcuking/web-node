// End-to-end check: subdomain preview + Vite HMR.
//
//   node tools/e2e-subdomain-hmr.mjs [port]
//
// Drives the real dev-server page over CDP. Every step is bounded so a wedged
// renderer shows up as a timeout at the exact step that wedged.
const PORT = process.argv[2] || '5173';
const DEV = 'http://localhost:5199';

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
const listTargets = async () => (await (await fetch('http://127.0.0.1:38800/json/list')).json());

let pageSession;
async function attachPage() {
  const t = (await listTargets()).find((x) => x.type === 'page' && x.url.includes('localhost:5199'));
  if (!t) throw new Error('no dev-server page target');
  ({ sessionId: pageSession } = await send('Target.attachToTarget', { targetId: t.id, flatten: true }));
}
await attachPage();
// Start from a clean document: a wedged renderer from an earlier run would
// otherwise stall every later step. The runtime re-boots from OPFS.
await send('Page.reload', { ignoreCache: true }, pageSession);
await sleep(1500);

function bounded(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${label} (${ms}ms)`)), ms)),
  ]);
}
const evalIn = (sid, expr, ms = 8000) =>
  bounded(send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid), ms, 'eval').then(
    (r) => r.result?.value ?? JSON.stringify(r),
  );
const req = (expr, ms = 8000) => evalIn(pageSession, expr, ms);

async function waitFor(expr, label, timeoutMs = 90000, every = 1500) {
  const t0 = Date.now();
  for (;;) {
    const v = await req(expr, 8000);
    if (v && v !== 'false' && String(v) !== 'null') return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor ${label} timed out`);
    await sleep(every);
  }
}

console.log('1. boot');
await waitFor("document.getElementById('boot') && /runtime ready/.test(document.getElementById('boot').textContent) && 'ready'", 'boot');
console.log('   ', await req("document.getElementById('boot').textContent"));

console.log('2. vite dev (install first if needed)');
console.log('   ', await req("document.getElementById('install').click(), 'install-clicked'"));
await waitFor("document.getElementById('status').textContent.includes('installed') && 'installed'", 'install', 120000);
console.log('   ', await req("document.getElementById('status').textContent"));
console.log('   ', await req("document.getElementById('vitedev').click(), 'vitedev-clicked'"));

console.log('3. preview shell reachable on the subdomain');
const subShell = `http://${PORT}.localhost:5199/__webnode__/`;
await waitFor(`document.getElementById('terminal').textContent.includes('listening') && 'listening'`, 'vite listening', 90000);
const ok = await bounded(fetch(subShell).then((r) => r.status), 15000, 'fetch shell');
console.log('   shell status', ok);

console.log('4. point the preview at the subdomain shell');
await req(`document.getElementById('preview-frame').src='about:blank', document.getElementById('preview-frame').src=${JSON.stringify(subShell)}, 'set'`);
await sleep(4000);
console.log('   ', await waitFor("document.getElementById('terminal').textContent.includes('preview connected') && 'connected'", 'hmr client', 45000));
await sleep(2000);

console.log('5. instrument the app frame');
const iframeSession = await (async () => {
  const t = (await listTargets()).find((x) => x.type === 'iframe' && x.url.includes(`${PORT}.localhost`));
  if (!t) throw new Error('no subdomain iframe target');
  const { sessionId } = await send('Target.attachToTarget', { targetId: t.id, flatten: true });
  return sessionId;
})();
const { frameTree } = await send('Page.getFrameTree', {}, iframeSession);
const flat = [];
(function walk(n) { flat.push(n.frame); for (const c of n.childFrames || []) walk(c); })(frameTree);
console.log('   frames:', flat.map((f) => f.url || '(about:blank)').join('  |  '));
const appFrame = flat.find((f) => f.url.includes(`${PORT}.localhost`) && !f.url.includes('__webnode__'));
if (!appFrame) throw new Error('no app frame on the subdomain');

async function inApp(expr, ms = 8000) {
  const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: appFrame.id, grantUniveralAccess: true }, iframeSession);
  return bounded(
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: executionContextId }, iframeSession).then(
      (r) => r.result?.value ?? JSON.stringify(r),
    ),
    ms,
    'inApp',
  );
}
// A script element appended from an isolated world runs in the frame's MAIN
// world, so counters/listeners set there are invisible from the isolated world.
// Publish them on the DOM (shared by both worlds) and read the DOM back.
const inject = (js) => inApp(`(function(){var s=document.createElement('script');s.textContent=${JSON.stringify(js)};document.head.appendChild(s);return 'ok';})()`);
await inject(
  "document.documentElement.dataset.mark='stay';document.documentElement.dataset.hmr='0';" +
    "window.addEventListener('message',function(e){try{if(e.data&&e.data.__wnHmr)document.documentElement.dataset.hmr=String(Number(document.documentElement.dataset.hmr)+1);}catch(_){}});",
);
await sleep(1200);
console.log('   app before:', await inApp("document.getElementById('app') && document.getElementById('app').textContent"));

console.log('6. edit a watched file (triggers HMR)');
console.log('   ', await req("document.getElementById('hmred').click(), 'edited'"));
await sleep(7000);

console.log('7. result');
console.log('   app after :', await inApp("document.getElementById('app') && document.getElementById('app').textContent"));
console.log('   hmr frames received by app:', await inApp("document.documentElement.dataset.hmr"));
console.log('   marker survived (no reload):', await inApp("document.documentElement.dataset.mark"));
process.exit(0);
