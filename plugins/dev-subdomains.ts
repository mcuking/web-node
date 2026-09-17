import type { Plugin } from 'vite';

/**
 * Dev-only middleware that gives every preview its own origin.
 *
 * `<port>.localhost` resolves to loopback in every modern browser, so a preview
 * can be served from a *real origin* instead of a path prefix — which is what
 * WebContainer-style tools do in production with a DNS wildcard. A static host
 * (GitHub Pages) has no such wildcard, so this is a dev-server feature only:
 * `vite preview` and builds fall back to the path-prefix bridge automatically
 * (the client gates on `import.meta.env.DEV`).
 *
 * The runtime — and the VFS and OPFS it owns — lives on the main origin, so the
 * subdomain cannot reach it directly. This middleware serves a tiny bootstrap
 * shell that registers the subdomain ServiceWorker and relays its requests to
 * the top-level page; see `public/sw.js` (`SUBDOMAIN_MODE`).
 */
export function devSubdomains(): Plugin {
  return {
    name: 'web-node:dev-subdomains',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // `types: []` in tsconfig.json means there is no `@types/node`, so the
        // connect callback's request is untyped here. Only two fields are used.
        const request = req as unknown as { url?: string; headers: Record<string, string | string[] | undefined> };
        const port = portFromHost(request.headers.host);
        if (port === null) return next();

        // Only the shell is served here. Every other path on the subdomain is
        // the app's, and is answered by the worker from the virtual filesystem;
        // the shell deliberately lives at its own URL so the worker can let it
        // through (see SUBDOMAIN_SHELL_PATH).
        const path = (request.url || '/').split('?')[0];
        if (path !== '/__webnode__/') return next();

        // The embedding app shell sets COEP: require-corp. For an iframe — unlike
        // a subresource — the embedded *document* must itself opt in with a COEP
        // header (CORP alone is not enough: Chrome fails the load with
        // `coep-frame-resource-needs-coep-header`).
        res.setHeader('cross-origin-embedder-policy', 'require-corp');
        res.setHeader('cross-origin-opener-policy', 'same-origin');
        res.setHeader('cross-origin-resource-policy', 'cross-origin');
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.statusCode = 200;
        res.end(BOOTSTRAP.replace(/__PORT__/g, String(port)));
      });
    },
  };
}

function portFromHost(host: string | string[] | undefined): number | null {
  const m = /^(\d+)\.localhost(:\d+)?$/.exec(typeof host === 'string' ? host : '');
  if (!m) return null;
  const port = Number(m[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/**
 * The bootstrap shell served for every `<port>.localhost` document.
 *
 * It (1) registers the subdomain ServiceWorker, (2) relays that worker's
 * requests to the top-level page — the only context that shares an origin with
 * the runtime — and (3) loads the real app in a same-origin child frame, which
 * the worker then serves from the virtual filesystem.
 *
 * It lives at `/__webnode__/` so the worker can recognise and ignore it.
 */
const BOOTSTRAP = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>web-node preview :__PORT__</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0f1115; }
      iframe { border: 0; width: 100%; height: 100%; display: block; }
      .msg { color: #c8ccd4; font: 13px ui-monospace, monospace; padding: 20px; }
    </style>
  </head>
  <body>
    <p class="msg" id="msg">web-node: starting preview bridge…</p>
    <script>
      (function () {
        var msg = document.getElementById('msg');
        function fail(text) { msg.textContent = 'web-node: ' + text; }
        var port = Number(location.hostname.split('.')[0]);
        if (!port) return fail('bad preview host ' + location.hostname);
        if (!('serviceWorker' in navigator)) return fail('this browser has no service worker');

        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .then(function (registration) { return navigator.serviceWorker.ready.then(function () { return registration; }); })
          .then(function (registration) {
            if (!registration.active) throw new Error('worker did not activate');
            // The worker posts each virtual request here; hand it to the top
            // page, which owns the runtime. Ports transfer across origins.
            navigator.serviceWorker.addEventListener('message', function (event) {
              var data = event.data;
              if (!data || data.type !== 'web-node:http') return;
              try { window.top.postMessage(data, '*', event.ports); }
              catch (err) { /* top gone */ }
            });
            msg.remove();
            var frame = document.createElement('iframe');
            frame.title = 'web-node app :' + port;
            frame.src = '/';
            document.body.appendChild(frame);
            // HMR frames travel the other way: the app frame posts them to
            // window.top (the app shell, which shares the runtime's origin),
            // and the shell sends the runtime's replies to *this* window. Pass
            // them down to the app frame.
            window.addEventListener('message', function (event) {
              if (event.data && event.data.__wnHmr && frame.contentWindow) {
                frame.contentWindow.postMessage(event.data, '*');
              }
            });
          })
          .catch(function (err) { fail((err && err.message) || String(err)); });
      })();
    </script>
  </body>
</html>
`;
