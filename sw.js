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
 * A preview can be addressed two ways, and this worker serves both:
 *
 *   1. Path prefix — `<base>preview/<port>/<path>` on the main origin.
 *      Needs no DNS or dev-server host config, so it works on a static host
 *      (GitHub Pages). The trade-off is that absolute-path assets (`/app.js`)
 *      resolve outside the prefix; HTML responses get a `<base>` tag injected to
 *      fix the far more common *relative* asset case.
 *
 *   2. Subdomain — `<port>.localhost:<devport>/<path>` (dev only).
 *      `*.localhost` resolves to loopback in every modern browser, so this gives
 *      each preview a *real origin*: absolute paths, cookies and storage all
 *      behave exactly as they would on a real host. Requires the dev-server
 *      middleware in `plugins/dev-subdomains.ts` (a static host has no DNS
 *      wildcard) and a relay, because the runtime — and the VFS and OPFS it
 *      owns — lives on the main origin, not on the subdomain.
 *
 * The app itself may be served from a sub-path (GitHub Pages uses `/web-node/`),
 * so the prefix is derived from where this worker actually lives instead of
 * assuming the origin root. In dev that is `/`, on Pages `/web-node/`.
 *
 * Responses are streamed: the runtime posts the head and then each body chunk
 * as `res.write()` produces it, and we hand the browser a `ReadableStream` — so
 * SSE and large downloads arrive incrementally. HTML is the one exception: it is
 * buffered so the `<base>` / WebSocket shim can be injected before the first
 * byte is sent.
 */

const BASE = new URL('./', self.location).pathname;
const PREVIEW_PREFIX = BASE + 'preview/';

/**
 * The port this worker serves when it lives on a `<port>.localhost` subdomain,
 * or null on the main origin. Set by the dev-server bootstrap page, which is the
 * only thing that ever registers this file cross-origin.
 */
const HOST_PORT = portFromHost(self.location.hostname);
const SUBDOMAIN_MODE = HOST_PORT !== null;

/**
 * The bootstrap shell's path on a preview subdomain.
 *
 * It must be a *distinct* URL from the app: the worker wraps every request on
 * this origin, so if the shell lived at `/` the worker would intercept its own
 * bootstrap document — and fail, because the relay client it needs is that very
 * document. Both this file and `src/ui/preview-url.ts` know the path.
 */
const SUBDOMAIN_SHELL_PATH = '/__webnode__/';

/**
 * Requests that belong to the page, not the virtual server: the shell itself and
 * the worker script. Everything else on a preview subdomain is the app's.
 */
function isShellRequest(pathname) {
  return pathname === SUBDOMAIN_SHELL_PATH || pathname === '/sw.js';
}

/**
 * Injected into every preview document, ahead of the app's own scripts.
 *
 * A ServiceWorker cannot proxy a WebSocket — `fetch` never sees the upgrade — so
 * a dev server running inside the runtime is unreachable over the wire. It *is*
 * reachable over a channel the browser ignores: a same-origin
 * `BroadcastChannel` (worker and page share an origin), or, for a preview on its
 * own subdomain, a `postMessage` hop through the top-level page, which does
 * share that origin. So we swap `WebSocket` for a shim that speaks a tiny JSON
 * protocol on that channel instead.
 *
 * Only Vite's HMR socket is diverted (it is recognisable by its `vite-hmr`
 * subprotocol); every other WebSocket is left to the real implementation.
 *
 * The channel is scoped to the virtual port (`web-node-hmr:<port>`) so several
 * dev servers can run side by side without seeing each other's clients. The
 * port is baked in from the preview URL the worker is answering.
 */
function wsShim(port) {
  return `<script>(function () {
  var PORT = ${JSON.stringify(port)};
  var CH = 'web-node-hmr:' + PORT;
  var Native = window.WebSocket;
  // A <port>.localhost preview is a different origin from the runtime, so the
  // BroadcastChannel below is unreachable; relay through the top page instead.
  var SUB = /^\\d+\\.localhost$/.test(location.hostname);
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
  function makeTransport(onFrame) {
    if (SUB) {
      // The top page relays on the channel for our port; frames carry it so a
      // page showing several previews can route to the right one.
      window.addEventListener('message', function (e) {
        if (e.data && e.data.__wnHmr && e.data.port === PORT) onFrame(e.data.__wnHmr);
      });
      return function (frame) { try { window.top.postMessage({ __wnHmr: frame, port: PORT }, '*'); } catch (e) {} };
    }
    var ch = new BroadcastChannel(CH);
    ch.onmessage = function (e) { onFrame(e.data); };
    return function (frame) { try { ch.postMessage(frame); } catch (e) {} };
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
    this._send = makeTransport(function (frame) {
      if (!frame || frame.id !== self._id) return;
      if (frame.t === 'open') { self.readyState = 1; fire(self, 'open', {}); }
      else if (frame.t === 'message') { fire(self, 'message', { data: frame.data }); }
      else if (frame.t === 'close') { self.readyState = 3; fire(self, 'close', { code: 1000, wasClean: true }); }
    });
    setTimeout(function () { self._send({ t: 'open', id: self._id, url: self.url }); }, 0);
  }
  Bridged.prototype.addEventListener = function (t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); };
  Bridged.prototype.removeEventListener = function (t, fn) {
    var a = this._ls[t];
    if (a) this._ls[t] = a.filter(function (f) { return f !== fn; });
  };
  Bridged.prototype.send = function (d) {
    if (this.readyState !== 1) return;
    this._send({ t: 'send', id: this._id, data: String(d) });
  };
  Bridged.prototype.close = function () {
    this.readyState = 2;
    try { this._send({ t: 'close', id: this._id }); } catch (e) {}
  };
  function Shim(url, protocols) {
    if (isHmr(url, protocols)) return new Bridged(url);
    return new Native(url, protocols);
  }
  Shim.CONNECTING = 0; Shim.OPEN = 1; Shim.CLOSING = 2; Shim.CLOSED = 3;
  Shim.prototype = Native.prototype;
  window.WebSocket = Shim;
})();</script>`;
}

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

  // Subdomain mode: this whole origin *is* one virtual server. No prefix to
  // strip — every path is the app's own, except the shell that bootstraps us.
  if (SUBDOMAIN_MODE) {
    if (isShellRequest(url.pathname)) return;
    event.respondWith(handle(event, HOST_PORT, url, 'subdomain'));
    return;
  }

  const previewPort = portFromPreviewPath(url.pathname);
  if (previewPort !== null) {
    // A preview navigation or one of its in-namespace requests: bind the owning
    // client so its later absolute-path assets can be routed too.
    const owner = event.resultingClientId || event.clientId;
    if (owner) previewPortByClient.set(owner, previewPort);
    event.respondWith(handle(event, previewPort, url, 'prefix'));
    return;
  }

  // Not a preview path: an absolute-path asset (e.g. Vite's `/@vite/client`),
  // which resolves to the origin root. Route it back to the preview that asked
  // for it — by client id first, then by referrer as a fallback.
  //
  // Navigations are excluded on purpose: the app shell owns its own document,
  // and a stale client→port entry must never hijack it into a preview.
  if (event.request.mode === 'navigate') return;
  const port = previewPortByClient.get(event.clientId) ?? portFromReferrer(event.request.referrer);
  if (port == null) return;
  event.respondWith(handle(event, port, url, 'prefix'));
});

/** Port encoded in `/<port>.localhost`, or null if this is not a preview subdomain. */
function portFromHost(hostname) {
  const m = /^(\d+)\.localhost$/.exec(hostname);
  if (!m) return null;
  const port = Number(m[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

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

/**
 * Find the bridge page on this subdomain origin.
 *
 * The bootstrap shell relays every request on to the top-level page, which
 * shares an origin with the runtime. It must be the *shell* that gets the
 * message — the app frame has no relay listener, so picking it would deadlock —
 * which is why the shell keeps its own path.
 */
async function resolveSubdomainClient() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.find((c) => new URL(c.url).pathname === SUBDOMAIN_SHELL_PATH) || windows[0] || null;
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
    headers: {
      'content-type': 'text/plain',
      // An error inside a COEP: require-corp page must still opt in, or the
      // browser replaces our diagnostic with a blank "blocked" page.
      'cross-origin-resource-policy': 'cross-origin',
    },
  });
}

async function handle(event, port, url, mode) {
  const request = event.request;
  const path = mode === 'subdomain' ? url.pathname + url.search : parsePortAndPath(url.pathname).path + url.search;

  const client = mode === 'subdomain' ? await resolveSubdomainClient() : await resolveClient(event);
  if (!client) {
    return new Response('web-node: no controlling page for this request', {
      status: 503,
      headers: { 'content-type': 'text/plain', 'cross-origin-resource-policy': 'cross-origin' },
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
      path,
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

  // HTML needs the WebSocket shim injected (and, in prefix mode, a `<base>` tag),
  // which means buffering it first.
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
    // In subdomain mode the document already sits at the origin root, so its
    // absolute paths are correct and no `<base>` is needed — only the shim.
    const inject = mode === 'subdomain' ? wsShim(port) : `<base href="${PREVIEW_PREFIX}${port}/">` + wsShim(port);
    const patched = html.includes('<head>') ? html.replace('<head>', '<head>' + inject) : inject + html;
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
