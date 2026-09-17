// Probe the subdomain HMR relay: count frames received in the shell and in the
// app frame, in each frame's MAIN world (script elements run there, but an
// isolated world has a separate `window`, so the counter must be read there).
const PORT = process.argv[2] || '5173';

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

const t = (await (await fetch('http://127.0.0.1:38800/json/list')).json()).find(
  (x) => x.type === 'iframe' && x.url.includes(`${PORT}.localhost`),
);
if (!t) throw new Error('no subdomain iframe target');
const { sessionId } = await send('Target.attachToTarget', { targetId: t.id, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
const { frameTree } = await send('Page.getFrameTree', {}, sessionId);
const flat = [];
(function walk(n) { flat.push(n.frame); for (const c of n.childFrames || []) walk(c); })(frameTree);
console.log('frames:', flat.map((f) => `${f.id.slice(0, 8)} ${f.url || '(blank)'}`).join('\n          '));

await sleep(500);
const ctxFor = (frameId) =>
  events
    .filter((e) => e.method === 'Runtime.executionContextCreated')
    .map((e) => e.params.context)
    .find((c) => c.auxData && c.auxData.frameId === frameId && c.auxData.isDefault);
const evalInFrame = async (frameId, expr) => {
  const ctx = ctxFor(frameId);
  if (!ctx) return `(no main-world ctx for ${frameId.slice(0, 8)})`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: ctx.id }, sessionId);
  return r.result?.value ?? JSON.stringify(r);
};

for (const f of flat) {
  const label = f.url.includes('__webnode__') ? 'SHELL' : 'APP  ';
  const val = await evalInFrame(
    f.id,
    `JSON.stringify({ ctx: (function(){try{return window.__wnProbe}catch(e){return 'x'}})() })`,
  );
  console.log(`${label} ${f.id.slice(0, 8)} probe=${val}`);
}

// Install counters in each frame's main world.
const inject = `(function(){
  window.__wnProbe = window.__wnProbe || { count: 0, last: '' };
  if (!window.__wnProbeHooked) {
    window.__wnProbeHooked = true;
    window.addEventListener('message', function (e) {
      try {
        if (e.data && e.data.__wnHmr) {
          window.__wnProbe.count = (window.__wnProbe.count || 0) + 1;
          window.__wnProbe.last = JSON.stringify(e.data.__wnHmr).slice(0, 120);
        }
      } catch (_) {}
    });
  }
  return 'installed';
})()`;
for (const f of flat) {
  const label = f.url.includes('__webnode__') ? 'SHELL' : 'APP  ';
  console.log(label, 'inject ->', await evalInFrame(f.id, inject));
}

console.log('triggering an HMR edit...');
const main = (await (await fetch('http://127.0.0.1:38800/json/list')).json()).find((x) => x.type === 'page' && x.url.includes('localhost:5199'));
const { sessionId: mainSid } = await send('Target.attachToTarget', { targetId: main.id, flatten: true });
await send('Runtime.evaluate', { expression: "document.getElementById('hmred').click()" }, mainSid);
console.log('waiting 10s for HMR traffic...');
await sleep(10000);
for (const f of flat) {
  const label = f.url.includes('__webnode__') ? 'SHELL' : 'APP  ';
  console.log(label, 'after ->', await evalInFrame(f.id, 'JSON.stringify(window.__wnProbe)'));
}
for (const f of flat) {
  const label = f.url.includes('__webnode__') ? 'SHELL' : 'APP  ';
  console.log(label, 'dom ->', await evalInFrame(f.id, "JSON.stringify({title: document.title, app: (document.getElementById('app')||{}).textContent})"));
}
process.exit(0);
