/**
 * web-node ServiceWorker — the virtual TCP front door.
 *
 * Node's `http.createServer().listen(port)` binds a port *inside* the runtime
 * worker, which the browser knows nothing about. This worker bridges the gap:
 *
 *   browser fetch  →  [this SW]  →  postMessage → page → runtime worker
 *                                     ↓
 *                          user's http.createServer
 *
 * Preview URLs are same-origin paths: `<base>/preview/<port>/<path>`. We use a
 * path prefix (not `<port>.localhost`) because it needs no DNS or dev-server
 * host configuration; the trade-off is that absolute-path assets (`/app.js`)
 * resolve outside the prefix, so HTML responses get a `<base>` tag injected to
 * fix the far more common *relative* asset case.
 *
 * The app may be served from a sub-path (GitHub Pages uses `/web-node/`), so the
 * prefix is derived from where this worker actually lives instead of assuming
 * the origin root. In dev that is `/`, on Pages `/web-node/`.
 *
 * Responses are streamed: the runtime posts the head and then each body chunk
 * as `res.write()` produces it, and we hand the browser a `ReadableStream` — so
 * SSE and large downloads arrive incrementally. HTML is the one exception: it is
 * buffered so the `<base>` tag can be injected before the first byte is sent.
 */

const BASE = new URL('./', self.location).pathname;
const PREVIEW_PREFIX = BASE + 'preview/';

/**
 * Injected into every preview document, ahead of the app's own scripts.
 *
 * A ServiceWorker cannot proxy a WebSocket — `fetch` never sees the upgrade — so
 * a dev server running inside the runtime is unreachable over the wire. It *is*
 * reachable over a same-origin `BroadcastChannel`, though (the browser ignores
 * it, but worker and page are one origin), so we swap `WebSocket` for a shim
 * that speaks a tiny JSON protocol on that channel instead.
 *
 * Only loopback URLs are diverted: the preview's Vite HMR socket (
 * `ws://127.0.0.1:5173/`). Every other WebSocket is left untouched for the real
 * browser implementation.
 */
const WS_SHIM = `<script>(function () {
  var CH = 'web-node-hmr';
  var Native = window.WebSocket;
  function isLoopback(host) {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  }
  // Vite's HMR client always opens its socket with the subprotocol 'vite-hmr'
  // (and, on https, may fall back to the page origin rather than loopback), so
  // the subprotocol is the reliable signal; loopback is a belt-and-braces check.
  function isHmr(url, protocols) {
    var list = Array.isArray(protocols) ? protocols.join(',') : String(protocols == null ? '' : protocols);
    if (list.indexOf('vite-hmr') !== -1) return true;
    try { return isLoopback(new URL(url, location.href).hostname); } catch (e) { return false; }
  }
  function fire(ws, type, extra) {
    var ev;
    if (type === 'message') {
      try { ev = new MessageEvent('message', { data: extra.data }); } catch (e) { ev = { type: type }; ev.data = extra.data; }
    } else {
      try { ev = new Event(type); } catch (e) { ev = { type: type }; }
      for (var k in extra) ev[k] = extra[k];
    }
    var h = ws['on' + type];
    if (typeof h === 'function') h.call(ws, ev);
    (ws._ls[type] || []).forEach(function (fn) { fn.call(ws, ev); });
  }
  function Bridged(url) {
    this.url = String(url);
    this.readyState = 0;
    this.protocol = 'vite-hmr';
    this.binaryType = 'blob';
    this.bufferedAmount = 0;
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    this._ls = {};
    var self = this;
    this._id = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    this._ch = new BroadcastChannel(CH);
    this._ch.onmessage = function (e) {
      var m = e.data;
      if (!m || m.id !== self._id) return;
      if (m.t === 'open') { self.readyState = 1; fire(self, 'open', {}); }
      else if (m.t === 'message') { fire(self, 'message', { data: m.data }); }
      else if (m.t === 'close') { self.readyState = 3; fire(self, 'close', { code: 1000, wasClean: true }); }
    };
    setTimeout(function () { self._ch.postMessage({ t: 'open', id: self._id, url: self.url }); }, 0);
  }
  Bridged.prototype.addEventListener = function (t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); };
  Bridged.prototype.removeEventListener = function (t, fn) {
    var a = this._ls[t];
    if (a) this._ls[t] = a.filter(function (f) { return f !== fn; });
  };
  Bridged.prototype.send = function (d) {
    if (this.readyState !== 1) return;
    this._ch.postMessage({ t: 'send', id: this._id, data: String(d) });
  };
  Bridged.prototype.close = function () {
    this.readyState = 2;
    try { this._ch.postMessage({ t: 'close', id: this._id }); } catch (e) {}
    this._ch.close();
  };
  function Shim(url, protocols) {
    if (isHmr(url, protocols)) return new Bridged(url);
    return new Native(url, protocols);
  }
  Shim.CONNECTING = 0; Shim.OPEN = 1; Shim.CLOSING = 2; Shim.CLOSED = 3;
  Shim.prototype = Native.prototype;
  window.WebSocket = Shim;
})();</script>`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  previewPortByClient.clear();
});

/**
 * Which preview port each client (page/iframe) belongs to.
 *
 * A preview document and every subresource it loads share one client id, so
 * remembering `clientId → port` when the preview is navigated lets us route that
 * client's *absolute-path* assets (Vite emits `/@vite/client`, and chained
 * imports carry the importing module as referrer — not the preview document)
 * back to the right virtual port.
 */
const previewPortByClient = new Map();

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only our own origin.
  if (url.origin !== self.location.origin) return;

  const previewPort = portFromPreviewPath(url.pathname);
  if (previewPort !== null) {
    // A preview navigation or one of its in-namespace requests: bind the owning
    // client so its later absolute-path assets can be routed too.
    const owner = event.resultingClientId || event.clientId;
    if (owner) previewPortByClient.set(owner, previewPort);
    event.respondWith(handle(event, previewPort, url));
    return;
  }

  // Not a preview path: an absolute-path asset (e.g. Vite's `/@vite/client`),
  // which resolves to the origin root. Route it back to the preview that asked
  // for it — by client id first, then by referrer as a fallback.
  const port = previewPortByClient.get(event.clientId) ?? portFromReferrer(event.request.referrer);
  if (port == null) return;
  event.respondWith(handle(event, port, url));
});

/** Port encoded in `/<base>preview/<port>/…`, or null if the path is not a preview path. */
function portFromPreviewPath(pathname) {
  if (!pathname.startsWith(PREVIEW_PREFIX)) return null;
  const rest = pathname.slice(PREVIEW_PREFIX.length);
  const slash = rest.indexOf('/');
  const portText = slash === -1 ? rest : rest.slice(0, slash);
  const port = Number(portText);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/** Port of the preview document that referred this request, or null. */
function portFromReferrer(referrer) {
  if (!referrer) return null;
  try {
    return portFromPreviewPath(new URL(referrer).pathname);
  } catch {
    return null;
  }
}

function parsePortAndPath(pathname) {
  if (!pathname.startsWith(PREVIEW_PREFIX)) return { port: null, path: pathname };
  const rest = pathname.slice(PREVIEW_PREFIX.length);
  const slash = rest.indexOf('/');
  const portText = slash === -1 ? rest : rest.slice(0, slash);
  return { port: Number(portText), path: rest.slice(portText.length) || '/' };
}

/**
 * Find the page that owns the runtime.
 *
 * `event.clientId` is empty for *navigation* requests (which is exactly what an
 * iframe preview load is), so falling back to a window client is required —
 * otherwise every preview navigation 503s.
 *
 * Crucially, a preview page itself must *never* be chosen: it is the virtual
 * server's document, not the app shell, and has no runtime listener — posting to
 * it would silently time out. That applies to the direct `clientId` branch too:
 * a subresource requested by a preview iframe (e.g. Vite's absolute
 * `/@vite/client`) reports the iframe as its client, so it must be skipped in
 * favour of the controlling app shell.
 */
async function resolveClient(event) {
  const isRuntimeHost = (client) => client && !new URL(client.url).pathname.startsWith(PREVIEW_PREFIX);
  if (event.clientId) {
    const direct = await self.clients.get(event.clientId);
    if (isRuntimeHost(direct)) return direct;
  }
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
  return windows.find(isRuntimeHost) || null;
}

const HOP_BY_HOP = ['connection', 'content-length', 'transfer-encoding', 'keep-alive', 'te', 'trailer', 'upgrade'];

function buildHeaders(raw) {
  const headers = new Headers();
  // The runtime already decoded its own `chunked` framing and the browser frames
  // the Response itself, so passing hop-by-hop headers on would corrupt the body.
  for (const [name, value] of Object.entries(raw || {})) {
    if (HOP_BY_HOP.includes(name.toLowerCase())) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  // The app shell is served with COOP/COEP: require-corp (so SharedArrayBuffer is
  // available). Under that policy an embedded document must opt in explicitly,
  // otherwise Chrome silently renders the iframe blank.
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('cross-origin-embedder-policy', 'require-corp');
  headers.set('cross-origin-opener-policy', 'same-origin');
  return headers;
}

/**
 * A tiny async queue over the reply MessagePort: `next()` resolves with the next
 * message from the page (head / chunk / end / error), optionally with a timeout.
 */
function makeInbox(port) {
  const queue = [];
  let notify = null;
  let closed = false;
  port.onmessage = (event) => {
    const msg = event.data;
    if (msg && msg.type === 'end') closed = true;
    queue.push(msg);
    if (notify) {
      const n = notify;
      notify = null;
      n();
    }
  };

  return {
    get closed() {
      return closed;
    },
    next(timeoutMs) {
      return new Promise((resolve, reject) => {
        const deliver = () => {
          if (timer) clearTimeout(timer);
          resolve(queue.shift());
        };
        let timer = null;
        if (queue.length) return deliver();
        if (timeoutMs) {
          timer = setTimeout(() => {
            notify = null;
            reject(new Error('virtual server timed out'));
          }, timeoutMs);
        }
        notify = deliver;
      });
    },
  };
}

function bridgeError(message) {
  return new Response('web-node: ' + message, {
    status: 502,
    headers: { 'content-type': 'text/plain' },
  });
}

async function handle(event, port, url) {
  const { path } = parsePortAndPath(url.pathname);
  const request = event.request;

  const client = await resolveClient(event);
  if (!client) {
    return new Response('web-node: no controlling page for this request', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }

  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
  }

  const channel = new MessageChannel();
  const inbox = makeInbox(channel.port1);
  client.postMessage(
    {
      type: 'web-node:http',
      port,
      method: request.method,
      path: path + url.search,
      headers,
      body,
      stream: true,
    },
    [channel.port2],
  );

  // Wait (bounded) for the response head. A connect failure surfaces here.
  let head;
  try {
    head = await inbox.next(15000);
  } catch (err) {
    return bridgeError(err.message);
  }
  if (head.error) return bridgeError(head.error);
  if (head.type === 'error') return bridgeError(head.message || 'virtual request failed');

  const responseHeaders = buildHeaders(head.headers);
  const contentType = String(responseHeaders.get('content-type') || '');

  // HTML needs its `<base>` tag injected, which means buffering it first.
  if (contentType.includes('text/html')) {
    const parts = [];
    for (;;) {
      let msg;
      try {
        msg = await inbox.next(0);
      } catch {
        break;
      }
      if (!msg || msg.type === 'end') break;
      if (msg.type === 'error') break;
      if (msg.type === 'chunk') parts.push(toBytes(msg.data));
    }
    const total = parts.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of parts) {
      merged.set(c, offset);
      offset += c.length;
    }
    const html = new TextDecoder().decode(merged);
    const base = `<base href="${PREVIEW_PREFIX}${port}/">`;
    const patched = html.includes('<head>') ? html.replace('<head>', '<head>' + base + WS_SHIM) : base + WS_SHIM + html;
    return new Response(new TextEncoder().encode(patched), {
      status: head.status,
      statusText: head.statusMessage || '',
      headers: responseHeaders,
    });
  }

  // Everything else streams straight through.
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const msg = await inbox.next(0);
        if (!msg || msg.type === 'end') {
          controller.close();
          return;
        }
        if (msg.type === 'error') {
          controller.error(new Error(msg.message || 'virtual request failed'));
          return;
        }
        if (msg.type === 'chunk') controller.enqueue(toBytes(msg.data));
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: head.status,
    statusText: head.statusMessage || '',
    headers: responseHeaders,
  });
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(0);
}

