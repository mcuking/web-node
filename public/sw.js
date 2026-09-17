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
 * Preview URLs are same-origin paths: `/preview/<port>/<path>`.
 * We use a path prefix (not `<port>.localhost`) because it needs no DNS or
 * dev-server host configuration; the trade-off is that absolute-path assets
 * (`/app.js`) resolve outside the prefix, so HTML responses get a `<base>` tag
 * injected to fix the far more common *relative* asset case.
 *
 * Responses are streamed: the runtime posts the head and then each body chunk
 * as `res.write()` produces it, and we hand the browser a `ReadableStream` — so
 * SSE and large downloads arrive incrementally. HTML is the one exception: it is
 * buffered so the `<base>` tag can be injected before the first byte is sent.
 */

const PREVIEW_PREFIX = '/preview/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only our own origin, only the preview namespace. Everything else (Vite's
  // own modules, the app shell) must fall through to the network untouched.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(PREVIEW_PREFIX)) return;

  const rest = url.pathname.slice(PREVIEW_PREFIX.length);
  const slash = rest.indexOf('/');
  const portText = slash === -1 ? rest : rest.slice(0, slash);
  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return;

  event.respondWith(handle(event, port, url, rest));
});

function parsePortAndPath(pathname) {
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
 */
async function resolveClient(event) {
  if (event.clientId) {
    const direct = await self.clients.get(event.clientId);
    if (direct) return direct;
  }
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
  // Never pick a preview page as the runtime host — only the app shell can
  // serve virtual requests.
  return windows.find((c) => !new URL(c.url).pathname.startsWith(PREVIEW_PREFIX)) || null;
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
    const patched = html.includes('<head>') ? html.replace('<head>', '<head>' + base) : base + html;
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

