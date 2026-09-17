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
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'virtual server timed out' }), 15000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data);
    };
    client.postMessage(
      {
        type: 'web-node:http',
        port,
        method: request.method,
        path: path + url.search,
        headers,
        body,
      },
      [channel.port2],
    );
  });

  if (result.error) {
    return new Response('web-node: ' + result.error, {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    });
  }

  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(result.headers || {})) {
    if (name.toLowerCase() === 'connection' || name.toLowerCase() === 'content-length') continue;
    if (Array.isArray(value)) for (const v of value) responseHeaders.append(name, v);
    else responseHeaders.set(name, value);
  }

  // The app shell is served with COOP/COEP: require-corp (so SharedArrayBuffer is
  // available). Under that policy an embedded document must opt in explicitly,
  // otherwise Chrome silently renders the iframe blank.
  responseHeaders.set('cross-origin-resource-policy', 'cross-origin');
  responseHeaders.set('cross-origin-embedder-policy', 'require-corp');
  responseHeaders.set('cross-origin-opener-policy', 'same-origin');

  let responseBody = result.body;
  const contentType = String(responseHeaders.get('content-type') || '');

  // Relative asset URLs inside a previewed page need to stay under the prefix.
  if (contentType.includes('text/html') && responseBody) {
    const html = new TextDecoder().decode(responseBody);
    const base = `<base href="${PREVIEW_PREFIX}${port}/">`;
    const patched = html.includes('<head>') ? html.replace('<head>', '<head>' + base) : base + html;
    responseBody = new TextEncoder().encode(patched);
  }

  return new Response(responseBody, {
    status: result.status,
    statusText: result.statusMessage || '',
    headers: responseHeaders,
  });
}
