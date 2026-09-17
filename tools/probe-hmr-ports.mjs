// Prove HMR frames are scoped to the virtual port: a listener on another
// port's channel must see nothing when the live preview's port updates.
const PORT = Number(process.argv[2] || 5173);
const OTHER = Number(process.argv[3] || PORT + 1);

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

const page = (await (await fetch('http://127.0.0.1:38800/json/list')).json()).find(
  (t) => t.type === 'page' && t.url.includes('localhost:5199'),
);
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const req = (expr) =>
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId).then(
    (r) => r.result?.value ?? JSON.stringify(r),
  );

console.log('install channel counters');
console.log(
  await req(`(function () {
    window.__wnPorts = {};
    [${PORT}, ${OTHER}].forEach(function (p) {
      var ch = new BroadcastChannel('web-node-hmr:' + p);
      window.__wnPorts[p] = 0;
      ch.onmessage = function () { window.__wnPorts[p]++; };
    });
    return 'ok';
  })()`),
);

console.log('trigger an HMR edit');
console.log(await req("document.getElementById('hmred').click(), 'edited'"));
await sleep(6000);
console.log('counters:', await req('JSON.stringify(window.__wnPorts)'));
console.log('runtime bridge clients:', await req("document.getElementById('terminal').textContent.slice(-90)"));
process.exit(0);
