// Inspect a page (or a subframe) over raw CDP — the browser tool's policy blocks
// `*.localhost`, and cross-origin iframes are unreadable from page JS anyway.
//
// Usage:
//   node tools/cdp-probe.mjs <url> <js-expression>
//   node tools/cdp-probe.mjs --target <url-substring> --frame <url-substring> <js-expression>
//
// `--target` attaches to an existing page target instead of opening a new one;
// `--frame` evaluates inside the first frame whose URL contains the substring.
const args = process.argv.slice(2);
const opts = { target: null, frame: null, allFrames: false, url: null, expression: null };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target') opts.target = args[++i];
  else if (args[i] === '--frame') opts.frame = args[++i];
  else if (args[i] === '--all-frames') opts.allFrames = true;
  else if (!opts.url && !opts.target) opts.url = args[i];
  else opts.expression = args[i];
}

const version = await (await fetch('http://127.0.0.1:38800/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
await new Promise((r) => (ws.onopen = r));

let targetId = null;
let sessionId = null;
if (opts.target) {
  const list = await (await fetch('http://127.0.0.1:38800/json/list')).json();
  const byUrl = list.filter((t) => t.url.includes(opts.target));
  const match = ['page', 'iframe', 'worker'].map((type) => byUrl.find((t) => t.type === type)).find(Boolean) ?? byUrl[0];
  if (!match) throw new Error('no target matching ' + opts.target);
  targetId = match.id;
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
} else {
  ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }));
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: opts.url }, sessionId);
  await new Promise((r) => setTimeout(r, 4500));
}

let contextId;
if (opts.frame) {
  const tree = await send('Page.getFrameTree', {}, sessionId);
  const flat = [];
  (function walk(node) {
    flat.push(node.frame);
    for (const child of node.childFrames || []) walk(child);
  })(tree.frameTree);
  const frame = flat.find((f) => f.url.includes(opts.frame));
  if (!frame) throw new Error('no frame matching ' + opts.frame + '; have: ' + flat.map((f) => f.url).join(', '));
  ({ executionContextId: contextId } = await send(
    'Page.createIsolatedWorld',
    { frameId: frame.id, grantUniveralAccess: true },
    sessionId,
  ));
} else if (opts.allFrames) {
  const tree = await send('Page.getFrameTree', {}, sessionId);
  const flat = [];
  (function walk(node) {
    flat.push(node.frame);
    for (const child of node.childFrames || []) walk(child);
  })(tree.frameTree);
  const out = [];
  for (const frame of flat) {
    const { executionContextId } = await send(
      'Page.createIsolatedWorld',
      { frameId: frame.id, grantUniveralAccess: true },
      sessionId,
    );
    const r = await send(
      'Runtime.evaluate',
      { expression: opts.expression, returnByValue: true, awaitPromise: true, contextId: executionContextId },
      sessionId,
    );
    out.push({ url: frame.url, value: r.result?.value, error: r.exceptionDetails?.text });
  }
  console.log(JSON.stringify(out, null, 2));
  if (!opts.target) await send('Target.closeTarget', { targetId });
  ws.close();
  process.exit(0);
}

const result = await send(
  'Runtime.evaluate',
  { expression: opts.expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) },
  sessionId,
);
console.log(JSON.stringify(result.result?.value ?? result, null, 2));

if (!opts.target) await send('Target.closeTarget', { targetId });
ws.close();
